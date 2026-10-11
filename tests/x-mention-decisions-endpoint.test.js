// api/x/mention-decisions.js: the owner's read of an agent's recent mention
// decisions, previewed by the "Answer mentions" panel on pages/agent-edit.html.
// The one rule worth pinning mechanically: an agent id that exists but is not
// owned by the caller must answer 404, exactly like every other agent-scoped
// route guarded by loadOwnedAgent (api/x/agents.js).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XPostError } from '../api/_lib/x-post.js';

const getRequestUserMock = vi.fn();
const hasScopeMock = vi.fn(() => true);
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: (...a) => getRequestUserMock(...a),
	hasScope: (...a) => hasScopeMock(...a),
}));

const authedReadIpMock = vi.fn();
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authedReadIp: (...a) => authedReadIpMock(...a) },
	clientIp: () => '127.0.0.1',
}));

const loadOwnedAgentMock = vi.fn();
vi.mock('../api/_lib/x-agent-policy.js', () => ({
	loadOwnedAgent: (...a) => loadOwnedAgentMock(...a),
}));

const recentDecisionsMock = vi.fn();
vi.mock('../api/_lib/x-mention-store.js', () => ({
	recentDecisions: (...a) => recentDecisionsMock(...a),
}));

const { default: handler } = await import('../api/x/mention-decisions.js');

const OWNER = '11111111-1111-1111-1111-111111111111';
const AGENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function mkReq({ url }) {
	return { method: 'GET', url, headers: {} };
}

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
			this.writableEnded = true;
		},
	};
}

const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);

beforeEach(() => {
	getRequestUserMock.mockReset().mockResolvedValue({ id: OWNER, source: 'session' });
	hasScopeMock.mockReset().mockReturnValue(true);
	authedReadIpMock.mockReset().mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 0 });
	loadOwnedAgentMock.mockReset().mockResolvedValue({ id: AGENT, name: 'Test Agent' });
	recentDecisionsMock.mockReset().mockResolvedValue([]);
});

describe('GET /api/x/mention-decisions', () => {
	it('requires a signed-in user', async () => {
		getRequestUserMock.mockResolvedValue(null);
		const res = mkRes();
		await handler(mkReq({ url: `/api/x/mention-decisions?agent_id=${AGENT}` }), res);
		expect(res.statusCode).toBe(401);
	});

	it('rejects a missing or malformed agent_id', async () => {
		const res = mkRes();
		await handler(mkReq({ url: '/api/x/mention-decisions' }), res);
		expect(res.statusCode).toBe(400);
		expect(loadOwnedAgentMock).not.toHaveBeenCalled();
	});

	it('answers 404 for an agent the caller does not own', async () => {
		loadOwnedAgentMock.mockRejectedValue(new XPostError('not_found', 'agent not found', 404));
		const res = mkRes();
		await handler(mkReq({ url: `/api/x/mention-decisions?agent_id=${AGENT}` }), res);
		expect(res.statusCode).toBe(404);
		expect(parse(res).error).toBe('not_found');
		expect(recentDecisionsMock).not.toHaveBeenCalled();
	});

	it('returns the owner-scoped decision rows, newest first, capped at the requested limit', async () => {
		recentDecisionsMock.mockResolvedValue([
			{
				tweet_id: '123',
				author_username: 'someone',
				mention_text: '@bot make me a dragon',
				intent: 'make',
				decision: 'reply',
				reason: 'intent allowed',
				reply_text: 'Done, here is your dragon.',
				reply_media_url: 'https://cdn.three.ws/forge/dragon.png',
				reply_link: null,
				dry_run: true,
				created_at: '2026-10-11T00:00:00.000Z',
				decided_at: '2026-10-11T00:00:01.000Z',
			},
		]);
		const res = mkRes();
		await handler(mkReq({ url: `/api/x/mention-decisions?agent_id=${AGENT}&limit=5` }), res);
		expect(res.statusCode).toBe(200);
		expect(loadOwnedAgentMock).toHaveBeenCalledWith(OWNER, AGENT);
		expect(recentDecisionsMock).toHaveBeenCalledWith({ kind: 'agent', ref: AGENT }, { limit: 5 });
		const body = parse(res);
		expect(body.decisions).toHaveLength(1);
		expect(body.decisions[0].reply_text).toBe('Done, here is your dragon.');
		expect(body.decisions[0].reply_media_url).toContain('dragon.png');
	});

	it('clamps an out-of-range limit into 1..20', async () => {
		const res = mkRes();
		await handler(mkReq({ url: `/api/x/mention-decisions?agent_id=${AGENT}&limit=999` }), res);
		expect(res.statusCode).toBe(200);
		expect(recentDecisionsMock).toHaveBeenCalledWith({ kind: 'agent', ref: AGENT }, { limit: 20 });
	});

	it('requires the agents:read scope for bearer callers', async () => {
		getRequestUserMock.mockResolvedValue({ id: OWNER, source: 'bearer', scope: 'agents:write' });
		hasScopeMock.mockReturnValue(false);
		const res = mkRes();
		await handler(mkReq({ url: `/api/x/mention-decisions?agent_id=${AGENT}` }), res);
		expect(res.statusCode).toBe(403);
		expect(loadOwnedAgentMock).not.toHaveBeenCalled();
	});
});
