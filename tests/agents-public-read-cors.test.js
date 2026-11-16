// An <agent-3d> embed on a site that is not three.ws (a SharePoint page, an
// intranet, a customer's landing page) reads GET /api/agents/:id without
// credentials to price the agent's skills. The handler only echoed first-party
// origins, so every such embed logged a CORS error and lost the read. A
// credential-less public read is answered with a wildcard origin; writes and
// credentialed reads stay first-party only.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({
	sql: () => Promise.resolve([]),
	sqlValues: () => ({}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => null,
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.7',
}));

const { handleGetOne } = await import('../api/agents.js');
const { env } = await import('../api/_lib/env.js');

const AGENT_ID = '5eff00ac-65fa-4b0f-aef1-c26eb1a9c37d';

function response() {
	const headers = {};
	return {
		headers,
		statusCode: 200,
		setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
		getHeader: (k) => headers[k.toLowerCase()],
		removeHeader: (k) => { delete headers[k.toLowerCase()]; },
		writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
		end() { this.ended = true; },
	};
}

async function call(method, origin) {
	const res = response();
	await handleGetOne({ method, headers: origin ? { origin } : {}, url: `/api/agents/${AGENT_ID}` }, res, AGENT_ID);
	return res;
}

describe('GET /api/agents/:id from a site that is not three.ws', () => {
	it('answers the preflight with a wildcard origin limited to reads', async () => {
		const res = await call('OPTIONS', 'https://contoso.sharepoint.com');
		expect(res.statusCode).toBe(204);
		expect(res.headers['access-control-allow-origin']).toBe('*');
		expect(res.headers['access-control-allow-methods']).toBe('GET,OPTIONS');
		expect(res.headers['access-control-allow-credentials']).toBeUndefined();
	});

	it('marks the read itself readable by any origin', async () => {
		const res = await call('GET', 'https://contoso.sharepoint.com');
		expect(res.headers['access-control-allow-origin']).toBe('*');
	});

	it('keeps credentialed, write-capable CORS for the first-party origin', async () => {
		const res = await call('OPTIONS', env.APP_ORIGIN);
		expect(res.headers['access-control-allow-origin']).toBe(env.APP_ORIGIN);
		expect(res.headers['access-control-allow-credentials']).toBe('true');
		expect(res.headers['access-control-allow-methods']).toContain('PUT');
	});
});
