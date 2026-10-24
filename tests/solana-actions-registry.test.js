// Solana Actions registry: the file Action-aware clients (wallet extensions,
// X's Blink unfurling, dial.to-style action browsers) fetch at
// /.well-known/solana/actions.json before trusting a solana-action: or blink
// URL on this domain. vercel.json has carried a dedicated route for this path
// since before this test existed, but the file it points at was never written,
// so the route fell through to a 404 and the existing "Claim Your 3D Avatar"
// Blink (api/actions/avatar.js) was unverifiable by any client that checks the
// registry first. Every rule here must name a path a real handler implements,
// so this test would have caught that gap and will catch the next one.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = resolve(ROOT, 'public/.well-known/solana/actions.json');

describe('public/.well-known/solana/actions.json', () => {
	it('exists on disk', () => {
		expect(existsSync(REGISTRY_PATH)).toBe(true);
	});

	it('parses as JSON with a non-empty rules array', () => {
		const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
		expect(Array.isArray(registry.rules)).toBe(true);
		expect(registry.rules.length).toBeGreaterThan(0);
	});

	it('every rule names an apiPath implemented by a real file under api/actions/', () => {
		const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
		for (const rule of registry.rules) {
			expect(rule.pathPattern, 'rule missing pathPattern').toBeTruthy();
			expect(rule.apiPath, 'rule missing apiPath').toBeTruthy();
			const name = rule.apiPath
				.replace(/^\/api\/actions\//, '')
				.replace(/\?.*$/, '');
			const handler = resolve(ROOT, 'api/actions', `${name}.js`);
			expect(existsSync(handler), `${rule.apiPath} names no file at api/actions/${name}.js`).toBe(true);
		}
	});
});
