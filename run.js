#!/usr/bin/env node

/**
 * Bootstrap runner for Pterodactyl/Jexactyl environments
 * Handles preflight checks, npm install, build, and start
 * ESM-compatible, Node 22+ required
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { createRequire } from 'node:module';
import { config } from 'dotenv';

// Load .env file before anything else
config();

const require = createRequire(import.meta.url);

const REQUIRED_NODE_VERSION = 22;
const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'OWNER_ID'];

// ANSI colors for logs
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function logStep(step) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(`  ${step}`, colors.bright + colors.cyan);
  log('='.repeat(60), colors.cyan);
}

function fatal(msg) {
  log(`\n❌ FATAL: ${msg}`, colors.red);
  process.exit(1);
}

// ============================================================================
// 1. PREFLIGHT CHECKS
// ============================================================================
function preflight() {
  logStep('PREFLIGHT CHECKS');
  
  // Check Node version
  const nodeVersion = parseInt(process.version.slice(1).split('.')[0], 10);
  log(`Node version: ${process.version}`, colors.blue);
  
  if (nodeVersion < REQUIRED_NODE_VERSION) {
    fatal(`Node ${REQUIRED_NODE_VERSION}+ required, got ${nodeVersion}`);
  }
  log(`✓ Node version OK (${nodeVersion} >= ${REQUIRED_NODE_VERSION})`, colors.green);
  
  // Check environment
  log(`\nEnvironment:`, colors.blue);
  log(`  Platform: ${process.platform}`, colors.blue);
  log(`  Arch: ${process.arch}`, colors.blue);
  log(`  CWD: ${process.cwd()}`, colors.blue);
  
  // Check required environment variables
  log(`\nChecking environment variables:`, colors.blue);
  const missing = [];
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
      log(`  ✗ ${envVar}: NOT SET`, colors.red);
    } else {
      const value = envVar.includes('TOKEN') 
        ? '***' + process.env[envVar].slice(-4)
        : process.env[envVar];
      log(`  ✓ ${envVar}: ${value}`, colors.green);
    }
  }
  
  if (missing.length > 0) {
    fatal(`Missing required environment variables: ${missing.join(', ')}\n` +
          `Please set them in your Pterodactyl panel or .env file`);
  }
  
  log(`\n✓ All preflight checks passed`, colors.green);
}

// ============================================================================
// 2. RUN COMMAND WITH INHERITED STDIO
// ============================================================================
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    log(`\nExecuting: ${command} ${args.join(' ')}`, colors.yellow);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    
    child.on('error', (err) => {
      reject(new Error(`Failed to start ${command}: ${err.message}`));
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

// ============================================================================
// 3. INSTALL DEPENDENCIES
// ============================================================================
async function install() {
  logStep('INSTALLING DEPENDENCIES');

  try {
    const hasNodeModules = existsSync('./node_modules');
    const forceInstall = process.env.FORCE_INSTALL === '1';

    // If node_modules exists we usually skip, but verify critical optional deps (some panels persist node_modules across zips).
    if (hasNodeModules && !forceInstall) {
      const missing = [];
      try { require.resolve('opusscript'); } catch { missing.push('opusscript'); }

      if (missing.length > 0) {
        log(`node_modules detected but missing runtime deps: ${missing.join(', ')} — installing...`, colors.yellow);
        await runCommand('npm', ['install', '--no-audit', '--no-fund', ...missing]);
        log('✓ Runtime deps installed', colors.green);
        return;
      }

      log('node_modules detected — skipping dependency install (set FORCE_INSTALL=1 to force).', colors.blue);
      return;
    }

    // Default to npm install (more robust in container environments where lockfiles may be stale/missing).
    // Set FORCE_NPM_CI=1 to use npm ci when you *know* the lockfile is correct.
    const useCi = process.env.FORCE_NPM_CI === '1' && existsSync('./package-lock.json');
    const command = useCi ? 'ci' : 'install';

    log(`Using: npm ${command}`, colors.blue);
    await runCommand('npm', [command, '--no-audit', '--no-fund']);
    log(`
✓ Dependencies installed successfully`, colors.green);
  } catch (err) {
    fatal(`Installation failed: ${err.message}`);
  }
}


// ============================================================================
// 4. BUILD TYPESCRIPT
// ============================================================================
async function build() {
  logStep('BUILDING TYPESCRIPT');

  try {
    const hasDist = existsSync('./dist/index.js') || existsSync('./dist/index.mjs');
    const forceBuild = process.env.FORCE_BUILD === '1';

    if (hasDist && !forceBuild) {
      log('dist detected — skipping TypeScript build (set FORCE_BUILD=1 to force).', colors.blue);
      return;
    }

    await runCommand('npm', ['run', 'build']);
    log(`
✓ Build completed successfully`, colors.green);
  } catch (err) {
    fatal(`Build failed: ${err.message}`);
  }
}


// ============================================================================
// 5. START APPLICATION
// ============================================================================
async function start() {
  logStep('STARTING APPLICATION');
  
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['start'], {
      stdio: 'inherit',
      shell: false,
    });
    
    // Graceful shutdown handlers
    const shutdown = (signal) => {
      log(`\n\nReceived ${signal}, shutting down gracefully...`, colors.yellow);
      child.kill(signal);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    child.on('error', (err) => {
      reject(new Error(`Failed to start application: ${err.message}`));
    });
    
    child.on('close', (code) => {
      log(`\nApplication exited with code ${code}`, 
          code === 0 ? colors.green : colors.red);
      process.exit(code);
    });
  });
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  try {
    log(`
╔════════════════════════════════════════════════════════════╗
║          Discord TTS Bot - Pterodactyl Bootstrap          ║
║                     Node ${process.version.padEnd(20)} ║
╚════════════════════════════════════════════════════════════╝
    `, colors.bright + colors.cyan);
    
    preflight();
    await install();
    await build();
    await start();
    
  } catch (err) {
    fatal(err.message);
  }
}

main();
