#!/usr/bin/env node
// Copies the CDN bundle from dist-lib/ into dist/agent-3d/<version>/
// and moving aliases (<major>, <major>.<minor>, latest). Emits SRI hashes
// and a versions.json manifest so embedders can pin with integrity.
//
// Run after `vite build && TARGET=lib vite build` — see npm run build:all.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version;
const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
if (!match) {
	console.error(`[publish-lib] package.json version "${version}" is not semver`);
	process.exit(1);
}
const [, major, minor] = match;

const srcDir = resolve(root, 'dist-lib');
const destRoot = resolve(root, 'dist', 'agent-3d');

const files = [
	{ name: 'agent-3d.js', required: true },
	{ name: 'agent-3d.umd.cjs', required: true },
];

for (const f of files) {
	const p = resolve(srcDir, f.name);
	if (!existsSync(p)) {
		if (f.required) {
			console.error(`[publish-lib] missing ${p} — did you run \`npm run build:lib\`?`);
			process.exit(1);
		}
		f.skip = true;
	}
}

mkdirSync(destRoot, { recursive: true });

const channels = [version, `${major}.${minor}`, major, 'latest'];
const sri = {};

for (const f of files) {
	if (f.skip) continue;
	const bytes = readFileSync(resolve(srcDir, f.name));
	const hash = createHash('sha384').update(bytes).digest('base64');
	sri[f.name] = `sha384-${hash}`;

	for (const channel of channels) {
		const outDir = resolve(destRoot, channel);
		mkdirSync(outDir, { recursive: true });
		writeFileSync(resolve(outDir, f.name), bytes);
	}
}

// Per-version SRI sidecars under the immutable path only.
const immutableDir = resolve(destRoot, version);
writeFileSync(
	resolve(immutableDir, 'integrity.json'),
	JSON.stringify({ version, integrity: sri }, null, '\t') + '\n',
);

const versions = {
	latest: version,
	channels: {
		[version]: { integrity: sri, immutable: true },
		[`${major}.${minor}`]: { tracks: `>=${major}.${minor}.0 <${major}.${Number(minor) + 1}.0` },
		[major]: { tracks: `>=${major}.0.0 <${Number(major) + 1}.0.0` },
		latest: { tracks: '*' },
	},
	publishedAt: new Date().toISOString(),
};
writeFileSync(resolve(destRoot, 'versions.json'), JSON.stringify(versions, null, '\t') + '\n');

const sizes = files
	.filter((f) => !f.skip)
	.map((f) => {
		const bytes = readFileSync(resolve(srcDir, f.name)).byteLength;
		return `${f.name}: ${(bytes / 1024).toFixed(1)} KiB`;
	})
	.join(', ');

console.log(`[publish-lib] v${version} → dist/agent-3d/{${channels.join(',')}}/  (${sizes})`);
for (const [name, hash] of Object.entries(sri)) console.log(`[publish-lib]   ${name}  ${hash}`);
