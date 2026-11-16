// vite.config.js rewrites stable unhashed URLs (/notifications.js,
// /feature-tour.js, ...) to their src/ modules in dev. Vite serves public/
// before that rewrite runs, so a stale public/ file with the same name wins and
// the dev server runs old code (2026-11-16: a stale public/notifications.js hid
// the Microsoft trial banner that only exists in src/notifications.js).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const config = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
const rewrites = [...config.matchAll(/if \(path === '(\/[\w.-]+\.js)'\) \{\s*req\.url = '(\/src\/[^']+)'/g)].map((m) => ({
	url: m[1],
	src: m[2],
}));

describe('vite dev rewrites to src/', () => {
	it('finds the rewrite table', () => {
		expect(rewrites.map((r) => r.url)).toContain('/notifications.js');
	});

	it('has no stale public/ file shadowing a rewritten URL', () => {
		const shadows = rewrites.filter((r) => existsSync(resolve(root, 'public' + r.url))).map((r) => `public${r.url} shadows ${r.src}`);
		expect(shadows).toEqual([]);
	});
});
