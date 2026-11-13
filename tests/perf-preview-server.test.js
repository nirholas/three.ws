// scripts/perf-preview-server.mjs decides, per request, whether a page comes
// from the local build or from production. A wrong call silently measures the
// wrong thing (production's HTML instead of the fix, or a 404 error state
// instead of real data), so the routing is pinned here against the real
// vercel.json route table.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRouteTable } from '../server/route-resolve.mjs';
import { resolveRequest, staticFileFor } from '../scripts/perf-preview-server.mjs';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
let distRoot;
let table;

beforeAll(() => {
	distRoot = mkdtempSync(path.join(tmpdir(), 'perf-preview-'));
	for (const f of ['index.html', 'home.html', 'marketplace.html', 'coin.html', 'avatar-page.html', 'assets/app-abc.js']) {
		mkdirSync(path.dirname(path.join(distRoot, f)), { recursive: true });
		writeFileSync(path.join(distRoot, f), f);
	}
	const { phase1Routes, postFsRoutes } = loadRouteTable(path.join(process.cwd(), 'vercel.json'));
	table = { distRoot, phase1Routes, postFsRoutes };
});

afterAll(() => rmSync(distRoot, { recursive: true, force: true }));

function resolve(pathname, headers = {}) {
	const url = new URL(pathname, 'http://perf-preview.local');
	return resolveRequest(table, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5)', ...headers } }, url);
}

describe('perf-preview-server routing', () => {
	it('serves the routed page document from the build', () => {
		expect(resolve('/marketplace')).toEqual({ kind: 'file', file: path.join(distRoot, 'marketplace.html') });
		expect(resolve(`/coin/${THREE}`)).toEqual({ kind: 'file', file: path.join(distRoot, 'coin.html') });
		expect(resolve('/agents/d94d2a50-86fa-4d2e-b87b-580f7517aa4c')).toEqual({
			kind: 'file',
			file: path.join(distRoot, 'avatar-page.html'),
		});
	});

	it('serves built assets from the build', () => {
		expect(resolve('/assets/app-abc.js')).toEqual({ kind: 'file', file: path.join(distRoot, 'assets/app-abc.js') });
	});

	it('sends API calls and anything the build lacks upstream, so pages render real data', () => {
		expect(resolve('/api/marketplace/agents?limit=1')).toEqual({ kind: 'upstream' });
		expect(resolve('/cdn/thumb/abc.png')).toEqual({ kind: 'upstream' });
		expect(resolve('/avatars/default.glb')).toEqual({ kind: 'upstream' });
	});

	it('sends crawler-only routes upstream instead of serving the visitor page', () => {
		expect(resolve('/agents/d94d2a50-86fa-4d2e-b87b-580f7517aa4c', { 'user-agent': 'Twitterbot/1.0' })).toEqual({
			kind: 'upstream',
		});
	});

	it('honours route-table redirects', () => {
		expect(resolve('/coin/')).toEqual({ kind: 'redirect', status: 301, location: '/demo/coin' });
	});

	it('never resolves a path outside the build directory', () => {
		expect(staticFileFor(distRoot, '/../../etc/passwd')).toBeNull();
		expect(staticFileFor(distRoot, '/%E0%A4%A')).toBeNull();
	});
});
