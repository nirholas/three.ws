#!/usr/bin/env node
// Vendor @three-ws/tool-sdk into @three-ws/naming-mcp.
//
// naming-mcp is published to npm; tool-sdk is private and never published. A
// published package cannot depend on an unpublished one (npm cannot resolve it
// for anyone outside this monorepo), so naming-mcp ships a byte-identical copy
// of tool-sdk's runtime sources under src/vendor/tool-sdk/ instead of declaring
// a `file:` dependency. The copy's only external import is `zod`, which
// naming-mcp already depends on.
//
//   node packages/naming-mcp/scripts/vendor-tool-sdk.mjs           copy, then write VENDORED.md
//   node packages/naming-mcp/scripts/vendor-tool-sdk.mjs --check   exit 1 on any drift, write nothing
//
// `npm run vendor:tool-sdk` runs the copy; `npm run check:vendored` runs the check.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(PKG_DIR, '../tool-sdk/src');
const TARGET_DIR = path.join(PKG_DIR, 'src/vendor/tool-sdk');
const MANIFEST = 'VENDORED.md';
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const rel = (p) => path.relative(REPO_ROOT, p);

function sourceFiles() {
	return readdirSync(SOURCE_DIR)
		.filter((f) => f.endsWith('.js'))
		.sort();
}

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

function sourceCommit() {
	try {
		return execFileSync('git', ['log', '-1', '--format=%H', '--', 'packages/tool-sdk/src'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return '';
	}
}

function manifestText(files) {
	const commit = sourceCommit();
	const rows = files.map((f) => `| \`${f}\` | \`${sha256(readFileSync(path.join(SOURCE_DIR, f))).slice(0, 16)}\` |`);
	return [
		'# Vendored: @three-ws/tool-sdk',
		'',
		'These files are a byte-identical copy of `packages/tool-sdk/src/*.js`. Do not edit them here.',
		'',
		'`@three-ws/tool-sdk` is private and unpublished, and `@three-ws/naming-mcp` is published to npm, so',
		'naming-mcp cannot declare it as a dependency: an npm install outside this monorepo could not resolve it.',
		'The copy ships inside the naming-mcp tarball instead. Its only external import is `zod`, a regular',
		'naming-mcp dependency.',
		'',
		'To change this code, edit `packages/tool-sdk/src/`, then run `npm run vendor:tool-sdk` and commit both.',
		'`npm run check:vendored` fails on any drift between the two.',
		'',
		`Source: \`packages/tool-sdk/src\` at commit \`${commit || 'uncommitted'}\`.`,
		'',
		'| File | sha256 (first 16) |',
		'|---|---|',
		...rows,
		'',
	].join('\n');
}

function drift() {
	const problems = [];
	const files = sourceFiles();
	for (const f of files) {
		const target = path.join(TARGET_DIR, f);
		if (!existsSync(target)) {
			problems.push(`${rel(target)} is missing`);
			continue;
		}
		if (!readFileSync(target).equals(readFileSync(path.join(SOURCE_DIR, f)))) {
			problems.push(`${rel(target)} differs from ${rel(path.join(SOURCE_DIR, f))}`);
		}
	}
	if (existsSync(TARGET_DIR)) {
		for (const f of readdirSync(TARGET_DIR)) {
			if (f !== MANIFEST && !files.includes(f)) problems.push(`${rel(path.join(TARGET_DIR, f))} has no source in packages/tool-sdk/src`);
		}
	}
	if (!existsSync(path.join(TARGET_DIR, MANIFEST))) problems.push(`${rel(path.join(TARGET_DIR, MANIFEST))} is missing`);
	return problems;
}

if (process.argv.includes('--check')) {
	const problems = drift();
	if (problems.length) {
		console.error('[vendor:tool-sdk] naming-mcp vendored tool-sdk has drifted:');
		for (const p of problems) console.error(`  - ${p}`);
		console.error('Fix: npm run vendor:tool-sdk, then commit packages/naming-mcp/src/vendor/tool-sdk/.');
		process.exit(1);
	}
	console.log(`[vendor:tool-sdk] OK: ${sourceFiles().length} files in ${rel(TARGET_DIR)} match packages/tool-sdk/src`);
} else {
	const files = sourceFiles();
	mkdirSync(TARGET_DIR, { recursive: true });
	for (const f of readdirSync(TARGET_DIR)) {
		if (f !== MANIFEST && !files.includes(f)) rmSync(path.join(TARGET_DIR, f));
	}
	for (const f of files) writeFileSync(path.join(TARGET_DIR, f), readFileSync(path.join(SOURCE_DIR, f)));
	writeFileSync(path.join(TARGET_DIR, MANIFEST), manifestText(files));
	console.log(`[vendor:tool-sdk] copied ${files.length} files into ${rel(TARGET_DIR)}`);
}
