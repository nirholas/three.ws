import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from './helpers/test-server.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Two header faults on the versioned embed routes, both measured live on
// 2026-10-08:
//
//   GET /agent-3d/1.5.2/agent-3d.umd.cjs -> content-type: application/node
//     With nosniff, a browser refuses to run that from a <script> tag, so the
//     UMD embed documented in docs/web-component.md never executed.
//
//   GET /agent-3d/1.5.3/ (not released) -> 404 with max-age=31536000, immutable
//     The versioned rule's cache policy carried into the 404 fallback, so the
//     CDN would keep answering 404 for a year after the version was cut.

// publish:lib writes dist/agent-3d/; without it there is nothing to serve.
const HAS_LIB = existsSync(fileURLToPath(new URL('../dist/agent-3d/versions.json', import.meta.url)));
if (!HAS_LIB) console.warn('[server-agent-3d-headers] skipping: dist/agent-3d/ is missing. Run `npm run publish:lib`.');

let BASE;
let server;

beforeAll(async () => {
	if (!HAS_LIB) return;
	server = await startTestServer();
	BASE = server.base;
}, 30000);

afterAll(() => {
	server?.close();
});

describe.skipIf(!HAS_LIB)('agent-3d versioned route headers', () => {
	it('serves the UMD build as JavaScript a script tag will execute', async (ctx) => {
		const versions = await (await fetch(`${BASE}/agent-3d/versions.json`)).json().catch(() => null);
		const pinned = Object.entries(versions?.channels || {}).find(([, c]) => c?.immutable)?.[0];
		if (!pinned) ctx.skip();
		const res = await fetch(`${BASE}/agent-3d/${pinned}/agent-3d.umd.cjs`);
		if (res.status === 404) ctx.skip();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
		expect(res.headers.get('cache-control')).toContain('immutable');
	});

	it('never marks a miss on an unreleased version immutable', async () => {
		const res = await fetch(`${BASE}/agent-3d/999.999.999/agent-3d.js`);
		expect(res.status).toBe(404);
		expect(res.headers.get('cache-control') || '').not.toContain('immutable');
		expect(res.headers.get('cache-control') || '').not.toContain('31536000');
	});
});
