import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const dockerfile = readFileSync(resolve(ROOT, 'workers/agent-orders/Dockerfile'), 'utf8');

const copied = [...dockerfile.matchAll(/^COPY\s+(?!--)(\S+)\s+\S+\s*$/gm)].map((m) =>
	m[1].replace(/^\.\//, '').replace(/\/$/, ''),
);
const isCopied = (rel) => copied.some((c) => rel === c || rel.startsWith(c + '/'));

function localImports(file) {
	const src = readFileSync(file, 'utf8');
	const out = new Set();
	for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
		const target = resolve(dirname(file), m[1].split('?')[0]);
		if (existsSync(target) && /\.(m?js|json)$/.test(target)) out.add(target);
	}
	for (const m of src.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
		const target = resolve(dirname(file), m[1]);
		if (existsSync(target) && /\.(m?js|json)$/.test(target)) out.add(target);
	}
	return out;
}

describe('agent-orders image', () => {
	it('copies every local module the worker can import at runtime', () => {
		const seen = new Set();
		const queue = [resolve(ROOT, 'workers/agent-orders/index.js')];
		const missing = new Set();
		while (queue.length) {
			const f = queue.pop();
			if (seen.has(f)) continue;
			seen.add(f);
			const rel = relative(ROOT, f);
			if (!isCopied(rel)) {
				missing.add(rel);
				continue;
			}
			if (/\.m?js$/.test(f)) for (const dep of localImports(f)) queue.push(dep);
		}
		expect([...missing]).toEqual([]);
	});
});
