#!/usr/bin/env node

/**
 * Pre-flight check script
 * Verifies that the bot can compile and load critical modules
 * Does not require network access or Discord token
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { config } from 'dotenv';

// Load .env if it exists
if (existsSync('.env')) {
  config();
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function success(msg) {
  log(`✓ ${msg}`, colors.green);
}

function error(msg) {
  log(`✗ ${msg}`, colors.red);
}

function warn(msg) {
  log(`⚠ ${msg}`, colors.yellow);
}

function info(msg) {
  log(`ℹ ${msg}`, colors.cyan);
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function checkTypeScript() {
  info('Checking TypeScript compilation...');
  try {
    await runCommand('npm', ['run', 'build']);
    success('TypeScript compilation successful');
    return true;
  } catch (err) {
    error('TypeScript compilation failed');
    console.error(err);
    return false;
  }
}

async function checkImports() {
  info('Checking critical module imports...');
  
  try {
    // Try to import discord.js
    await import('discord.js');
    success('discord.js imports successfully');
  } catch (err) {
    error('Failed to import discord.js');
    console.error(err);
    return false;
  }

  try {
    // Try to import @discordjs/voice
    await import('@discordjs/voice');
    success('@discordjs/voice imports successfully');
  } catch (err) {
    error('Failed to import @discordjs/voice');
    console.error(err);
    return false;
  }

  try {
    // Try to import libsodium
    let sodium;
    try {
      const sumo = await import('libsodium-wrappers-sumo');
      sodium = sumo.default ?? sumo;
      success('libsodium-wrappers-sumo imports successfully');
    } catch (sumoErr) {
      warn('libsodium-wrappers-sumo not available, trying fallback');
      const regular = await import('libsodium-wrappers');
      sodium = regular.default ?? regular;
      success('libsodium-wrappers imports successfully');
    }
    
    await sodium.ready;
    success('libsodium initialized successfully');
  } catch (err) {
    error('Failed to load libsodium');
    console.error(err);
    return false;
  }

  try {
    // Try to import TTS provider
    await import('gtts');
    success('gtts imports successfully');
  } catch (err) {
    error('Failed to import gtts');
    console.error(err);
    return false;
  }

  return true;
}

function checkFiles() {
  info('Checking required files...');
  
  const requiredFiles = [
    'package.json',
    'tsconfig.json',
    'src/index.ts',
    'src/bot.ts',
  ];

  let allExist = true;
  for (const file of requiredFiles) {
    if (existsSync(file)) {
      success(`${file} exists`);
    } else {
      error(`${file} missing`);
      allExist = false;
    }
  }

  return allExist;
}

async function main() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('  Discord TTS Bot - Pre-flight Check', colors.cyan);
  log('='.repeat(60) + '\n', colors.cyan);

  let allPassed = true;

  // Check files
  if (!checkFiles()) {
    allPassed = false;
  }

  console.log('');

  // Check TypeScript compilation
  if (!await checkTypeScript()) {
    allPassed = false;
  }

  console.log('');

  // Check imports
  if (!await checkImports()) {
    allPassed = false;
  }

  console.log('');
  log('='.repeat(60), colors.cyan);
  
  if (allPassed) {
    success('All checks passed! ✨');
    log('='.repeat(60) + '\n', colors.cyan);
    process.exit(0);
  } else {
    error('Some checks failed');
    log('='.repeat(60) + '\n', colors.cyan);
    process.exit(1);
  }
}

main().catch((err) => {
  error('Fatal error during checks');
  console.error(err);
  process.exit(1);
});
