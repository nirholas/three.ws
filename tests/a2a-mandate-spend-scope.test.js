// api/agents/a2a-mandate.js: issuing an Intent Mandate is a spend.
//
// A mandate lets an agent pay its peers with no human in the loop, up to a
// budget. The route accepted any bearer, so an app a person connected over
// OAuth for "See your avatars" (a cloud connector such as Grok Bot, holding the
// token unattended) could arm the agent wallet to spend. It now needs the same
// wallet:write scope every other spend route demands; a session is the owner,
// present, and is unaffected.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpAgent: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

const principal = { session: null, bearer: null };
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => principal.session),
	authenticateBearer: vi.fn(async () => principal.bearer),
	extractBearer: vi.fn(() => (principal.bearer ? 'bearer-token' : null)),
}));

const issueIntentMandate = vi.fn(async (args) => ({ jws: 'signed.mandate.jws', mandate: { owner: args.ownerUserId } }));
vi.mock('../api/_lib/a2a/mandate.js', () => ({
	DEFAULT_NETWORK: 'solana',
	SUPPORTED_NETWORKS: ['solana'],
	MAX_TTL_SECONDS: 86_400,
	MandateError: class MandateError extends Error {},
	issueIntentMandate: (args) => issueIntentMandate(args),
}));

const { default: handler } = await import('../api/agents/a2a-mandate.js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: '' };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? ''; };
	return r;
}

async function post(body = { subjectAgentId: 'agent-1', maxAtomics: '1000000', perCallAtomics: '100000' }) {
	const req = {
		method: 'POST',
		url: '/api/agents/a2a-mandate',
		headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
		body: JSON.stringify(body),
		socket: { remoteAddress: '127.0.0.1' },
	};
	const res = makeRes();
	await handler(req, res);
	return { status: res.statusCode, body: res._b ? JSON.parse(res._b) : null };
}

beforeEach(() => {
	principal.session = null;
	principal.bearer = null;
	issueIntentMandate.mockClear();
});

describe('POST /api/agents/a2a-mandate spend scope', () => {
	it('refuses a connected app that was not granted wallet:write', async () => {
		principal.bearer = { userId: 'user-1', scope: 'avatars:read agents:write wallet:read', source: 'oauth', clientId: 'mcp_grok' };
		const { status, body } = await post();
		expect(status).toBe(403);
		expect(body.error).toBe('insufficient_scope');
		expect(issueIntentMandate).not.toHaveBeenCalled();
	});

	it('issues the mandate for a bearer that holds wallet:write', async () => {
		principal.bearer = { userId: 'user-1', scope: 'wallet:read wallet:write', source: 'oauth', clientId: 'mcp_desktop' };
		const { status, body } = await post();
		expect(status).toBe(201);
		expect(body.mandate).toBe('signed.mandate.jws');
		expect(issueIntentMandate).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'user-1' }));
	});

	it('issues the mandate for the signed-in owner', async () => {
		principal.session = { id: 'user-1' };
		const { status } = await post();
		expect(status).toBe(201);
	});

	it('still asks an anonymous caller to sign in', async () => {
		const { status } = await post();
		expect(status).toBe(401);
	});
});
