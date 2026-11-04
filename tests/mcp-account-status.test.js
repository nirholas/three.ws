// Order 719: account status, dashboard URLs and per-agent X posting tools.
//
// Contract under test:
//   - buildAccountStatus() answers "what plan am I on, what are my limits, what is
//     waiting for approval" in one object and never carries a secret.
//   - dashboardUrls() only emits same-origin canonical URLs, so a model never
//     guesses a link.
//   - post_to_x goes through requestAgentPost (the one place the agent's policy is
//     enforced): a review-before-post policy enqueues and does not post, and a cap
//     violation is refused with the policy's own code.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';

const sqlMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpAgent: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/dev-plans/subscription.js', () => ({
	getDevSubscription: vi.fn(async (userId) => ({
		userId,
		planId: 'builder',
		plan: { id: 'builder', name: 'Builder', priceUsd: 29, includedCalls: 100000, burstPerMinute: 300, concurrent: 10, webhooks: 10 },
		periodStart: new Date('2026-11-01T00:00:00Z'),
		periodEnd: new Date('2026-12-01T00:00:00Z'),
		renewWith: 'credits',
		paidUsd: 29,
		stripeSecret: 'sk_live_must_not_leak',
	})),
}));
vi.mock('../api/_lib/dev-plans/quota.js', () => ({
	peekDevQuota: vi.fn(async () => ({ limit: 100000, used: 1200, remaining: 98800, resetAt: new Date('2026-12-01T00:00:00Z') })),
}));
vi.mock('../api/_lib/agents-v1/billing.js', () => ({
	freeTierStatus: vi.fn(async () => ({ limit: 20, used: 5, remaining: 15, period: 'utc_day', resetsAt: '2026-11-05T00:00:00Z', models: ['m1'] })),
}));
vi.mock('../api/_lib/x402-user-payer.js', () => ({
	getUserWalletStatus: vi.fn(async () => ({
		provisioned: true,
		agent_id: 'a1',
		agent_name: 'Scout',
		address: 'THREEsynthetic1111111111111111111111111111111',
		network: 'solana',
		balances: { sol: 0.5, usdc: 12 },
		spend_enabled: false,
		caps: { max_per_call_usdc: 1, max_per_hour_usdc: 5, max_per_day_usdc: 20 },
		secret_key: 'must-not-leak',
	})),
}));

const x = vi.hoisted(() => ({
	requestAgentPost: vi.fn(),
	saveAgentPolicy: vi.fn(),
	getAgentXState: vi.fn(),
	listScheduledPosts: vi.fn(),
}));
vi.mock('../api/_lib/x-agent-policy.js', () => ({
	POST_KIND_IDS: ['launches', 'trades', 'runs', 'replies', 'updates'],
	requestAgentPost: x.requestAgentPost,
	saveAgentPolicy: x.saveAgentPolicy,
	getAgentXState: x.getAgentXState,
	listScheduledPosts: x.listScheduledPosts,
	connectUrl: (id) => `/api/auth/x/connect?scope=full&return_to=%2Fsettings%2Fconnections&agent_id=${id}&target=agent`,
}));
vi.mock('../api/_lib/x-post.js', () => ({
	XPostError: class XPostError extends Error {
		constructor(code, message, status = 400, extra = {}) {
			super(message);
			this.name = 'XPostError';
			this.code = code;
			this.status = status;
			this.extra = extra;
		}
	},
}));

const { buildAccountStatus, dashboardUrls } = await import('../api/_lib/account-status.js');
const { accountToolDefs } = await import('../api/_mcpagent/account-tools.js');
const { XPostError } = await import('../api/_lib/x-post.js');

const tool = (name) => accountToolDefs.find((t) => t.name === name);
const AGENT = '11111111-1111-4111-8111-111111111111';
const auth = { userId: 'user-1', scope: 'profile agents:read agents:write wallet:read' };

beforeEach(() => {
	vi.clearAllMocks();
	sqlMock.mockImplementation(async () => [{ plan: 'pro', agents: 3, pending_approvals: 2 }]);
});

describe('buildAccountStatus', () => {
	it('reports plan, limits, remaining, agent count, wallet and pending approvals', async () => {
		const s = await buildAccountStatus('user-1', { includeWallet: true });
		expect(s.plan.account).toBe('pro');
		expect(s.plan.api).toMatchObject({ id: 'builder', name: 'Builder' });
		expect(s.limits).toMatchObject({ api_calls_per_period: 100000, burst_per_minute: 300, concurrent: 10, free_chat_per_day: 20 });
		expect(s.remaining).toMatchObject({ api_calls: 98800, free_chat_messages: 15 });
		expect(s.agents.count).toBe(3);
		expect(s.wallet).toMatchObject({ provisioned: true, network: 'solana', balances: { sol: 0.5, usdc: 12 } });
		expect(s.approvals.pending).toBe(2);
		expect(s.approvals.url).toBe('https://three.ws/approvals');
	});

	it('never includes secrets', async () => {
		const s = await buildAccountStatus('user-1', { includeWallet: true });
		const text = JSON.stringify(s);
		expect(text).not.toMatch(/sk_live_must_not_leak|must-not-leak|secret|private_key|stripe/i);
	});

	it('omits the wallet section when the caller has no wallet grant', async () => {
		const s = await buildAccountStatus('user-1', { includeWallet: false });
		expect(s.wallet).toBeNull();
	});
});

describe('dashboardUrls', () => {
	it('returns only same-origin canonical https URLs', () => {
		const urls = dashboardUrls();
		expect(Object.keys(urls).length).toBeGreaterThan(5);
		for (const u of Object.values(urls)) {
			const parsed = new URL(u);
			expect(parsed.origin).toBe('https://three.ws');
			expect(u).not.toContain('..');
			expect(parsed.search + parsed.hash).toBe('');
		}
		expect(urls.approvals).toBe('https://three.ws/approvals');
		expect(urls.connections).toBe('https://three.ws/settings/connections');
	});

	it('the get_dashboard_urls tool needs no sign-in and only yields canonical URLs', async () => {
		const out = await tool('get_dashboard_urls').handler({}, { userId: null });
		for (const u of Object.values(out.structuredContent.urls)) expect(new URL(u).origin).toBe('https://three.ws');
	});

	it('filters by a known page and refuses an unknown one', async () => {
		const ok = await tool('get_dashboard_urls').handler({ page: 'billing' }, auth);
		expect(Object.keys(ok.structuredContent.urls)).toEqual(['billing']);
		const bad = await tool('get_dashboard_urls').handler({ page: 'https://evil.example' }, auth);
		expect(bad.isError).toBe(true);
		expect(bad.structuredContent.reason).toBe('unknown_page');
	});
});

describe('get_account_status tool', () => {
	it('requires sign-in', async () => {
		const out = await tool('get_account_status').handler({}, { userId: null });
		expect(out.isError).toBe(true);
		expect(out.structuredContent.reason).toBe('auth_required');
	});

	it('returns the status, with the wallet only when wallet:read is granted', async () => {
		const withWallet = await tool('get_account_status').handler({}, auth);
		expect(withWallet.structuredContent.status.wallet.provisioned).toBe(true);
		const without = await tool('get_account_status').handler({}, { userId: 'user-1', scope: 'profile' });
		expect(without.structuredContent.status.wallet).toBeNull();
	});
});

describe('post_to_x', () => {
	it('with review-before-post enqueues and reports it was not posted', async () => {
		x.requestAgentPost.mockResolvedValue({ status: 'pending_review', id: 'rev-1', review_url: '/settings/connections?agent=a#x' });
		const out = await tool('post_to_x').handler({ agent_id: AGENT, kind: 'updates', text: 'gm from the agent' }, auth);
		expect(out.isError).toBeUndefined();
		expect(out.structuredContent).toMatchObject({ ok: true, status: 'pending_review', posted: false });
		expect(x.requestAgentPost).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', agentId: AGENT, kind: 'updates', source: 'mcp' }));
	});

	it('reports posted:true only when the post went out', async () => {
		x.requestAgentPost.mockResolvedValue({ status: 'published', tweet_id: '123' });
		const out = await tool('post_to_x').handler({ agent_id: AGENT, kind: 'updates', text: 'hello' }, auth);
		expect(out.structuredContent.posted).toBe(true);
	});

	it('refuses a cap violation with the policy code', async () => {
		x.requestAgentPost.mockRejectedValue(new XPostError('daily_cap_reached', 'daily cap reached', 429, { settings_url: '/s' }));
		const out = await tool('post_to_x').handler({ agent_id: AGENT, kind: 'updates', text: 'one more' }, auth);
		expect(out.isError).toBe(true);
		expect(out.structuredContent).toMatchObject({ ok: false, reason: 'daily_cap_reached' });
	});

	it('refuses without agents:write', async () => {
		const out = await tool('post_to_x').handler({ agent_id: AGENT, kind: 'updates', text: 'x' }, { userId: 'user-1', scope: 'agents:read' });
		expect(out.structuredContent.reason).toBe('insufficient_scope');
		expect(x.requestAgentPost).not.toHaveBeenCalled();
	});
});

describe('X policy tools', () => {
	it('connect_twitter returns an absolute same-origin connect link', async () => {
		x.getAgentXState.mockResolvedValue({ configured: true, connection: { connected: false }, connect_url: `/api/auth/x/connect?agent_id=${AGENT}` });
		const out = await tool('connect_twitter').handler({ agent_id: AGENT }, auth);
		expect(new URL(out.structuredContent.connect_url).origin).toBe('https://three.ws');
	});

	it('configure_twitter_posting saves a partial policy', async () => {
		x.saveAgentPolicy.mockResolvedValue({ enabled: true, review_before_post: true, max_posts_per_day: 3 });
		const out = await tool('configure_twitter_posting').handler({ agent_id: AGENT, enabled: true, review_before_post: true, max_posts_per_day: 3 }, auth);
		expect(x.saveAgentPolicy).toHaveBeenCalledWith({ userId: 'user-1', agentId: AGENT, patch: { enabled: true, review_before_post: true, max_posts_per_day: 3 } });
		expect(out.structuredContent.policy.max_posts_per_day).toBe(3);
	});

	it('list_scheduled_posts lists the queue', async () => {
		x.listScheduledPosts.mockResolvedValue({ pending_review: [{ id: 'r1', text: 'hi', kind: 'updates' }], scheduled: [] });
		const out = await tool('list_scheduled_posts').handler({ agent_id: AGENT }, auth);
		expect(out.structuredContent.pending_review).toHaveLength(1);
	});
});
