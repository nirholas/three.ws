// Contract test: every request the SDK can make must land on a route the v1
// server actually mounts. It parses `this.call(METHOD, PATH)` and
// `this.list(PATH)` out of src/client.ts and matches each against the route
// tables the server serves, so an SDK method can never point at a 404 again.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ROUTES as REST_ROUTES } from '../../../api/v1/rest.js';
import { tradingRoutes } from '../../../api/_lib/trading-tools/routes.js';

const CLIENT = fileURLToPath(new URL('../src/client.ts', import.meta.url));

/** Routes served by their own files under api/v1/ (see vercel.json). */
const FILE_ROUTES = [
	{ method: 'GET', path: '/models' },
	{ method: 'GET', path: '/me/free-tier' },
];

function normalize(path) {
	return path
		.replace(/\$\{seg\([^)]*\)\}/g, ':x')
		.replace(/\?.*$/, '')
		.replace(/\/+$/, '');
}

/** Every [method, path] the client sends, in source order. */
function clientRequests() {
	const src = readFileSync(CLIENT, 'utf8');
	const out = [];
	const call = /this\.call(?:<[^>]*>)?\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*(?:`([^`]*)`|"([^"]*)")/g;
	for (const m of src.matchAll(call)) out.push({ method: m[1], path: normalize(m[2] ?? m[3]) });
	const list = /this\.list(?:<[^>]*>)?\(\s*(?:`([^`]*)`|"([^"]*)")/g;
	for (const m of src.matchAll(list)) out.push({ method: 'GET', path: normalize(m[1] ?? m[2]) });
	return out;
}

function matches(pattern, concrete) {
	const a = pattern.split('/').filter(Boolean);
	const b = concrete.split('/').filter(Boolean);
	return a.length === b.length && a.every((p, i) => p.startsWith(':') || b[i].startsWith(':') || p === b[i]);
}

const MOUNTED = [
	...REST_ROUTES.map((r) => ({ method: r.method, path: r.path })),
	...tradingRoutes.map((r) => ({ method: r.method, path: r.path })),
	...FILE_ROUTES,
];

describe('SDK to server route parity', () => {
	const requests = clientRequests();

	it('finds the client requests', () => {
		expect(requests.length).toBeGreaterThan(40);
	});

	for (const req of requests) {
		it(`${req.method} ${req.path} is mounted`, () => {
			const hit = MOUNTED.find((r) => r.method === req.method && matches(r.path, req.path));
			expect(hit, `no mounted v1 route for ${req.method} ${req.path}`).toBeTruthy();
		});
	}

	it('streamRun targets the mounted SSE route', () => {
		const src = readFileSync(CLIENT, 'utf8');
		expect(src).toMatch(/runs\/\$\{seg\(runId, "runId"\)\}\/events/);
		expect(MOUNTED.some((r) => r.method === 'GET' && r.path === '/runs/:id/events')).toBe(true);
	});
});
