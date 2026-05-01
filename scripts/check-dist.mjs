#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
	'dist/agent-3d/latest/agent-3d.js',
	'dist/agent-3d/latest/agent-3d.umd.cjs',
	'dist/agent-3d/versions.json',
];

let ok = true;
for (const rel of required) {
	if (!existsSync(resolve(root, rel))) {
		console.error(`[check-dist] MISSING: ${rel}`);
		ok = false;
	}
}

if (ok) {
	const versions = JSON.parse(readFileSync(resolve(root, 'dist/agent-3d/versions.json'), 'utf8'));
	const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	if (versions.latest !== pkg.version) {
		console.error(
			`[check-dist] versions.json "latest" is "${versions.latest}" but package.json is "${pkg.version}"`,
		);
		ok = false;
	}
}

// dist-lib mirror checks
const distLibChecks = [
	{ rel: 'dist/dist-lib/agent-3d.js', min: 1_000_000 },
	{ rel: 'dist/dist-lib/agent-3d.umd.cjs', min: 100_000 },
];
for (const { rel, min } of distLibChecks) {
	const p = resolve(root, rel);
	if (!existsSync(p)) {
		console.error(`[check-dist] MISSING: ${rel}`);
		ok = false;
	} else {
		const size = statSync(p).size;
		if (size < min) {
			console.error(`[check-dist] TOO SMALL: ${rel} (${size} bytes, expected >= ${min})`);
			ok = false;
		}
	}
}

if (!ok) process.exit(1);
console.log('[check-dist] dist-lib mirror OK');
console.log('[check-dist] OK — dist/agent-3d/latest/ ready for deploy');
