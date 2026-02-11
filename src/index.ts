#!/usr/bin/env node

import process from 'node:process';
import { createRequire } from 'node:module';
import { config } from 'dotenv';
import { logger } from './util/logger.js';
import { DiscordBot } from './bot.js';

// Load environment variables from .env file
config();

/**
 * Load and initialize libsodium for voice encryption
 * CRITICAL: Voice connections require libsodium
 */
async function loadLibsodium(): Promise<void> {
  logger.info('Loading libsodium for voice encryption...');

  const require = createRequire(import.meta.url);

  try {
    // Try libsodium-wrappers-sumo first (recommended)
    // Note: some environments end up with a broken ESM build of libsodium-wrappers (missing dist/modules-esm/*.mjs).
    // We handle that by trying both ESM `import()` and CJS `require()` entrypoints.
    let sodium: any;

    const tryLoad = async (name: 'libsodium-wrappers-sumo' | 'libsodium-wrappers') => {
      // 1) ESM path
      try {
        logger.debug({ name }, 'Attempting ESM import');
        const mod = await import(name);
        return mod.default ?? mod;
      } catch (esmErr) {
        logger.warn({ err: esmErr, name }, 'ESM import failed, attempting CJS require fallback');
        // 2) CJS fallback
        const mod = require(name);
        return mod.default ?? mod;
      }
    };

    try {
      sodium = await tryLoad('libsodium-wrappers-sumo');
    } catch (sumoErr) {
      logger.warn({ err: sumoErr }, 'libsodium-wrappers-sumo not available, trying fallback');
      sodium = await tryLoad('libsodium-wrappers');
    }

// Wait for sodium to be ready
    logger.debug('Waiting for libsodium to be ready');
    await sodium.ready;

    // Verify sodium has expected functions (self-check)
    const requiredFunctions = ['crypto_secretbox_easy', 'crypto_secretbox_open_easy', 'randombytes_buf'];
    for (const fn of requiredFunctions) {
      if (typeof sodium[fn] !== 'function') {
        throw new Error(`libsodium missing required function: ${fn}`);
      }
    }

    logger.info('✓ libsodium loaded and verified successfully');
    
  } catch (err) {
    logger.fatal(
      { err },
      'FATAL: Failed to load libsodium. Voice features will not work.'
    );
    console.error('\n' + '='.repeat(70));
    console.error('LIBSODIUM LOAD FAILED');
    console.error('='.repeat(70));
    console.error('Voice encryption requires libsodium to be installed.');
    console.error('\nTroubleshooting steps:');
    console.error('1. Ensure libsodium packages are installed:');
    console.error('   npm install libsodium-wrappers libsodium-wrappers-sumo');
    console.error('2. If using Docker/Pterodactyl, ensure Node 22+ is being used');
    console.error('3. Check that node_modules is not corrupted');
    console.error('4. Try: rm -rf node_modules package-lock.json && npm install');
    console.error('='.repeat(70) + '\n');
    process.exit(1);
  }
}

/**
 * Validate environment variables
 */
function validateEnvironment(): void {
  logger.info('Validating environment...');

  const required = ['DISCORD_TOKEN', 'OWNER_ID'];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    logger.fatal({ missing }, 'Missing required environment variables');
    console.error('\n' + '='.repeat(70));
    console.error('MISSING ENVIRONMENT VARIABLES');
    console.error('='.repeat(70));
    console.error(`Required variables not set: ${missing.join(', ')}`);
    console.error('\nPlease set these in your .env file or Pterodactyl panel:');
    for (const key of missing) {
      console.error(`  ${key}=your_value_here`);
    }
    console.error('='.repeat(70) + '\n');
    process.exit(1);
  }

  // Log non-sensitive config
  logger.info(
    {
      ownerId: process.env.OWNER_ID,
      ttsProvider: process.env.TTS_PROVIDER || 'gtts',
      lang: process.env.LANG || 'es',
      maxTtsChars: process.env.MAX_TTS_CHARS || '200',
    },
    'Environment validated'
  );
}

/**
 * Setup global error handlers
 */
function setupErrorHandlers(bot: DiscordBot | null): void {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(
      { reason, promise },
      'Unhandled Promise Rejection'
    );
  });

  process.on('uncaughtException', (error, origin) => {
    logger.fatal(
      { error, origin },
      'Uncaught Exception'
    );
    
    // Attempt graceful shutdown
    if (bot) {
      bot.shutdown()
        .catch((err) => logger.error({ err }, 'Error during emergency shutdown'))
        .finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  });

  // Graceful shutdown on signals
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    
    if (bot) {
      try {
        await bot.shutdown();
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during graceful shutdown');
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info('='.repeat(70));
  logger.info('Discord TTS Bot Starting');
  logger.info('='.repeat(70));
  logger.info(`Node version: ${process.version}`);
  logger.info(`Platform: ${process.platform} ${process.arch}`);
  logger.info('='.repeat(70));

  // Validate environment first
  validateEnvironment();

  // Load libsodium
  await loadLibsodium();

  // Get token
  const token = process.env.DISCORD_TOKEN!;

  // Create bot instance
  const bot = new DiscordBot(token);

  // Setup error handlers
  setupErrorHandlers(bot);

  // Start bot
  await bot.start();

  logger.info('='.repeat(70));
  logger.info('Bot is now running. Press Ctrl+C to stop.');
  logger.info('='.repeat(70));
}

// Run main
main().catch((err) => {
  logger.fatal({ err }, 'Fatal error in main()');
  process.exit(1);
});
