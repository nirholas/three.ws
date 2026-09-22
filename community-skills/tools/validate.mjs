#!/usr/bin/env node
// Validate every skill and (re)write registry.json.
//
//   node tools/validate.mjs           validate, then write registry.json
//   node tools/validate.mjs --check   validate and fail if registry.json is stale
//
// Exit 0 when every skill passes, 1 otherwise. Run it before opening a pull request.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry, serializeRegistry } from './registry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const registryPath = join(root, 'registry.json');

const { ok, errors, registry } = buildRegistry(root);

if (!ok) {
	console.error(`community skills: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
	for (const e of errors) console.error(`  ${e.slug}: ${e.message}`);
	process.exit(1);
}

const next = serializeRegistry(registry);
const current = existsSync(registryPath) ? readFileSync(registryPath, 'utf8') : '';

if (check) {
	if (current !== next) {
		console.error('community skills: registry.json is stale. Run `node tools/validate.mjs` and commit the result.');
		process.exit(1);
	}
	console.log(`community skills: ${registry.count} skills valid, registry.json up to date`);
} else {
	if (current !== next) writeFileSync(registryPath, next);
	console.log(`community skills: ${registry.count} skills valid, registry.json ${current === next ? 'unchanged' : 'written'}`);
}
