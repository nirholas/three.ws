/**
 * agent-sniper container: does the image actually carry everything the worker
 * imports?
 *
 * Same transitive guard as tests/pump-claims-worker-image.test.js. The sniper
 * Dockerfile copies a hand-picked set of directories (api/, src/, the sniper
 * package, agent-payments-sdk/), so any import that reaches outside that set
 * builds clean and then crashes on boot. That happened on 2026-11-10:
 * api/_lib/execution-engine.js had started importing
 * packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js, the image never
 * copied it, and revision agent-sniper-00037 exited with ERR_MODULE_NOT_FOUND
 * before it ever listened on its port.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = join(ROOT, 'workers', 'agent-sniper');
const DOCKERFILE = join(WORKER_DIR, 'Dockerfile');

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;

function resolveModule(target) {
	if (existsSync(target) && statSync(target).isFile()) return target;
	if (existsSync(`${target}.js`)) return `${target}.js`;
	if (existsSync(join(target, 'index.js'))) return join(target, 'index.js');
	return null;
}

function workerSources(dir = WORKER_DIR) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...workerSources(full));
		else if (/\.(m?js)$/.test(name) && !/\.test\.m?js$/.test(name)) out.push(full);
	}
	return out;
}

/** Every file reachable by relative import (static or dynamic) from the worker's own source. */
function allReachableFiles() {
	const visited = new Set();
	const queue = workerSources();
	while (queue.length) {
		const file = queue.pop();
		if (visited.has(file) || !existsSync(file)) continue;
		visited.add(file);
		for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
			const resolved = resolveModule(resolve(dirname(file), m[1]));
			if (resolved && !visited.has(resolved)) queue.push(resolved);
		}
	}
	return [...visited];
}

/** Paths the Dockerfile COPYs out of the build context. */
function dockerfileCopies() {
	const copies = [];
	for (const line of readFileSync(DOCKERFILE, 'utf8').split('\n')) {
		const m = line.match(/^COPY\s+(.+)$/i);
		if (!m) continue;
		const parts = m[1].trim().split(/\s+/).filter((p) => !p.startsWith('--'));
		for (const src of parts.slice(0, -1)) copies.push(src.replace(/^\.\//, '').replace(/\*$/, ''));
	}
	return copies;
}

const covered = (rel, copies) => copies.some((c) => rel === c || rel.startsWith(c.endsWith('/') ? c : `${c}/`));

describe('agent-sniper image carries every module the worker imports', () => {
	const reachable = allReachableFiles().map((f) => relative(ROOT, f));
	const copies = dockerfileCopies();

	it('walks into the shared api/ modules, transitively', () => {
		expect(reachable).toContain('workers/agent-sniper/paid-intel.js');
		expect(reachable).toContain('api/_lib/x402/pay.js');
		expect(reachable).toContain('api/_lib/execution-engine.js');
	});

	it('every reachable file sits under a path the Dockerfile copies', () => {
		const missing = reachable.filter((rel) => !covered(rel, copies)).sort();
		expect(missing).toEqual([]);
	});
});
