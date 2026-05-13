// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let verbose = false;
let quiet = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function setQuiet(q: boolean): void {
  quiet = q;
}

export function debug(...args: unknown[]): void {
  if (verbose) {
    console.log(chalk.gray('[debug]'), ...args);
  }
}

export function info(...args: unknown[]): void {
  if (!quiet) {
    console.log(...args);
  }
}

export function success(...args: unknown[]): void {
  if (!quiet) {
    console.log(chalk.green('✓'), ...args);
  }
}

export function warn(...args: unknown[]): void {
  if (!quiet) {
    console.log(chalk.yellow('!'), ...args);
  }
}

export function error(...args: unknown[]): void {
  console.error(chalk.red('✗'), ...args);
}

export function banner(): void {
  if (quiet) return;
  console.log();
  console.log(chalk.bold('  🎙️  X Space Agent'));
  console.log();
}

export function spacer(): void {
  if (!quiet) console.log();
}

export function label(key: string, value: string): void {
  if (!quiet) {
    console.log(`  ${chalk.gray(key + ':')} ${value}`);
  }
}


