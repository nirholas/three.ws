// Audit 2026-10-25 hardening note: marketplace versions and analytics lacked
// publish filters. Both are public, unauthenticated reads, so an unpublished or
// deleted agent's version history (changelog, tags) and name/image must never
// leave the server. The versions handler is exercised with a recording sql tag;
// the analytics queries are judged from source like the sibling paid-only test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const queries = [];
vi.mock('../api/_lib/db.js', async (importOriginal) => ({
	...(await importOriginal()),
	sql: vi.fn(async (strings) => {
		queries.push(strings.join('?'));
		return [];
	}),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 1000 })) }),
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const AGENT = '11111111-1111-4111-8111-111111111111';

function call(url) {
	const req = Readable.from([]);
	req.method = 'GET';
	req.url = url;
	req.headers = { host: 'localhost' };
	const res = {
		statusCode: 200, headers: {}, body: '', writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(chunk) { if (chunk != null) this.body += chunk; this.writableEnded = true; },
	};
	return import('../api/marketplace/[action].js').then(async ({ default: handler }) => {
		await handler(req, res);
		return res;
	});
}

beforeEach(() => { queries.length = 0; });

describe('GET /api/marketplace/agents/:id/versions', () => {
	it('only reads the history of a published, undeleted agent', async () => {
		await call(`/api/marketplace/agents/${AGENT}/versions`);
		const q = queries.find((s) => /agent_versions/.test(s));
		expect(q, 'versions query ran').toBeTruthy();
		expect(q).toMatch(/is_published\s*=\s*true/);
		expect(q).toMatch(/deleted_at\s+IS\s+NULL/i);
	});
});

describe('GET /api/marketplace/analytics', () => {
	const SRC = readFileSync(fileURLToPath(new URL('../api/marketplace/analytics.js', import.meta.url)), 'utf8');
	const blocks = SRC.match(/sql`[\s\S]*?`/g) || [];

	it('never joins an agent identity without the publish and delete filter', () => {
		const joining = blocks.filter((b) => /JOIN agent_identities ai/i.test(b));
		expect(joining.length).toBeGreaterThanOrEqual(3);
		for (const b of joining) {
			expect(b).toMatch(/ai\.is_published\s*=\s*true/);
			expect(b).toMatch(/ai\.deleted_at\s+IS\s+NULL/i);
		}
	});
});
