#!/usr/bin/env node
// Skips tsup rebuild when agent-payments-sdk/dist is already up to date.
// dist/ is committed to the repo; Vercel never needs to rebuild it unless
// src/ changes. A SHA-256 stamp in dist/.src-hash tracks whether src changed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'agent-payments-sdk/src');
const distIndex = resolve(root, 'agent-payments-sdk/dist/index.js');
const stamp = resolve(root, 'agent-payments-sdk/dist/.src-hash');

function hashDir(dir) {
	const h = createHash('sha256');
	function walk(d) {
		for (const f of readdirSync(d).sort()) {
			const full = join(d, f);
			if (statSync(full).isDirectory()) { walk(full); continue; }
			h.update(f).update(readFileSync(full));
		}
	}
	walk(dir);
	return h.digest('hex');
}

// tsup is a dev dep — absent when installed with --omit=dev (Vercel CI).
// Gate on whether the binary actually exists rather than any env var,
// since VERCEL/CI are not reliably set during the npm install phase.
const tsupBin = resolve(root, 'node_modules/.bin/tsup');
const srcIndex = resolve(root, 'agent-payments-sdk/src/index.ts');
// Check for the actual entry point: .vercelignore removes files but can leave empty subdirs,
// so readdirSync length > 0 is not a reliable "src is present" signal.
const srcPresent = existsSync(tsupBin) && existsSync(srcIndex);

const srcHash = srcPresent ? hashDir(srcDir) : null;
const needsBuild =
	srcPresent && (
		!existsSync(distIndex) ||
		!existsSync(stamp) ||
		readFileSync(stamp, 'utf8').trim() !== srcHash
	);

if (!srcPresent) {
	console.log('[postinstall] agent-payments-sdk src not present — trusting committed dist');
} else if (needsBuild) {
	console.log('[postinstall] agent-payments-sdk src changed — rebuilding...');
	// Use the root tsup binary directly; `npm run build --prefix` resolves binaries
	// from the sub-package's own node_modules/.bin, which may be absent (e.g. Vercel CI).
	const sdkRoot = resolve(root, 'agent-payments-sdk');
	try {
		execSync(`"${tsupBin}"`, { stdio: 'inherit', cwd: sdkRoot });
		writeFileSync(stamp, srcHash);
	} catch (e) {
		if (existsSync(distIndex)) {
			console.warn('[postinstall] tsup build failed — committed dist present, continuing');
		} else {
			throw e;
		}
	}
} else {
	console.log('[postinstall] agent-payments-sdk dist up to date — skipping tsup');
}

execSync('node scripts/fix-pump-sdk-esm.mjs', { stdio: 'inherit', cwd: root });
