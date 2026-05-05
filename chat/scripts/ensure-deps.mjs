#!/usr/bin/env node
// Skips `npm ci` when package-lock.json hasn't changed since last install.
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const lockfile = 'package-lock.json';
const stamp = 'node_modules/.install-stamp';
const hash = createHash('sha256').update(readFileSync(lockfile)).digest('hex');

const needsInstall =
	!existsSync('node_modules') ||
	!existsSync(stamp) ||
	readFileSync(stamp, 'utf8').trim() !== hash;

if (needsInstall) {
	execSync('npm ci --prefer-offline --no-audit --no-fund', { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
	writeFileSync(stamp, hash);
} else {
	console.log('chat deps up-to-date, skipping npm ci');
}
