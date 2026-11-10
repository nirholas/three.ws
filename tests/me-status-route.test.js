import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).routes;

function resolve(path) {
	for (const r of routes) {
		if (!r.src || !r.dest) continue;
		if (new RegExp(`^${r.src}$`).test(path)) return r.dest;
	}
	return null;
}

describe('GET /api/v1/me/status routing', () => {
	it('reaches the v1 REST handler like the other /me sub-routes', () => {
		expect(resolve('/api/v1/me/status')).toBe('/api/v1/rest');
		expect(resolve('/api/v1/me/usage')).toBe('/api/v1/rest');
	});
});
