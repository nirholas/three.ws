// Two dynamic handlers in one api/ directory (say [action].js and [id].js) are
// ambiguous: server/route-resolve.mjs takes whichever readdir lists first, so
// the other one is unreachable in production and in dev. That is how the
// Halloween drop endpoint once answered "unknown drops action" from the
// generative-drops handler. Every directory gets at most one [param].js and at
// most one [param]/ directory.

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveApiHandler } from '../server/route-resolve.mjs';

const API_ROOT = path.resolve(__dirname, '..', 'api');
const isParamFile = (n) => n.startsWith('[') && !n.startsWith('[...') && n.endsWith('].js');
const isParamDir = (n) => n.startsWith('[') && !n.startsWith('[...') && n.endsWith(']');

function collisions(dir, out = []) {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files = entries.filter((e) => e.isFile() && isParamFile(e.name)).map((e) => e.name);
	const dirs = entries.filter((e) => e.isDirectory() && isParamDir(e.name)).map((e) => e.name);
	const rel = path.relative(API_ROOT, dir) || '.';
	if (files.length > 1) out.push(`api/${rel}: ${files.join(', ')}`);
	if (dirs.length > 1) out.push(`api/${rel}: ${dirs.join('/, ')}/`);
	for (const e of entries) {
		if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') collisions(path.join(dir, e.name), out);
	}
	return out;
}

describe('api dynamic routes', () => {
	it('never puts two sibling dynamic handlers in one directory', () => {
		expect(collisions(API_ROOT)).toEqual([]);
	});

	it('routes the seasonal drop endpoint to the seasonal handler', () => {
		const hit = resolveApiHandler(API_ROOT, '/api/seasonal/halloween-2026');
		expect(hit && path.relative(API_ROOT, hit.file)).toBe(path.join('seasonal', '[id].js'));
		expect(hit.params).toEqual({ id: 'halloween-2026' });
	});

	it('keeps the generative drops actions on their own handler', () => {
		const hit = resolveApiHandler(API_ROOT, '/api/drops/list');
		expect(hit && path.relative(API_ROOT, hit.file)).toBe(path.join('drops', '[action].js'));
	});
});
