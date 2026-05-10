#!/usr/bin/env node
// Skips `vite build:lib` when src/ hasn't changed since the last lib build.
// On Vercel every build starts cold, so FORCE_LIB_BUILD=1 bypasses the check.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const stamp = resolve(root, 'dist-lib/.lib-src-hash');

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

const srcHash = hashDir(resolve(root, 'src'));

const needsBuild =
	process.env.FORCE_LIB_BUILD === '1' ||
	!existsSync(resolve(root, 'dist-lib/agent-3d.js')) ||
	!existsSync(stamp) ||
	readFileSync(stamp, 'utf8').trim() !== srcHash;

if (!needsBuild) {
	console.log('[build-lib-cached] src/ unchanged — skipping lib build');
	process.exit(0);
}

execSync('npm run build:lib', { stdio: 'inherit', cwd: root });
writeFileSync(stamp, srcHash);
