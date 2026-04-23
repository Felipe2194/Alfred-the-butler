#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path      = require('path');

const args    = process.argv.slice(2);
const command = args[0]?.toLowerCase();

const ART = `
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░  ██╗     ██╗███████╗███████╗   ░
  ░  ██║     ██║██╔════╝██╔════╝   ░
  ░  ██║     ██║█████╗  █████╗     ░
  ░  ██║     ██║██╔══╝  ██╔══╝     ░
  ░  ███████╗██║██║     ███████╗   ░
  ░  ╚══════╝╚═╝╚═╝     ╚══════╝   ░
  ░          C H E C K             ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
`;

function printHelp() {
  console.log(ART);
  console.log('  Usage:');
  console.log('    hi alfred        — Wake Alfred and start LifeCheck');
  console.log('    hi alfred --help — Show this message\n');
}

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command !== 'alfred') {
  console.error(`\n  Unknown command: "${command}"\n  Did you mean: hi alfred\n`);
  process.exit(1);
}

// ── Launch Alfred ─────────────────────────────────────────────────────────────
const appDir      = path.resolve(__dirname, '..');
const electronBin = require('electron');   // returns path to the electron executable

console.log(ART);
console.log('  Summoning Alfred...\n');

const child = spawn(electronBin, [appDir], {
  detached: true,
  stdio:    'ignore',
  cwd:      appDir,
  env:      { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
});

child.on('error', (err) => {
  console.error('  Alfred could not be summoned:', err.message);
  process.exit(1);
});

child.unref();

setTimeout(() => {
  console.log('  Alfred is now on duty. Good day.\n');
  process.exit(0);
}, 800);
