// The threews-agent MCP portfolio, sniper, alert-rule and duel tools, driven
// through the real dispatcher: the real policy gate (enablement, confirm flags,
// bound preview ids), the real scope checks and Ajv validation. Only the store
// and chain boundaries underneath the tools are stubbed, so these tests prove
// the tool surface and its gates, not the stores (which have their own suites).

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const USER = '0a1b2c3d-0000-4000-8000-0000000009a1';
const AGENT = '7e57a9e1-0000-4000-8000-000000000946';
const OPPONENT = '7e57a9e1-0000-4000-8000-000000000947';
const RULE = 'a1e47000-0000-4000-8000-000000000946';
const CHALLENGE = 'c4a11e00-0000-4000-8000-000000000946';
const DUEL = 'd0e10000-0000-4000-8000-000000000946';
const WALLET = 'THREEsyntheticWa11et111111111111111111111111';

const state = vi.hoisted(() => ({ owned: true, signed: true }));

vi.mock('../../api/_lib/db.js', () => ({
	// The only query a tool here runs itself: sniper_subscribe's ownership read.
	sql: vi.fn(async () => (state.owned ? [{ name: 'Scout' }] : [])),
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) }),
	clientIp: vi.fn(() => '203.0.113.46'),
}));

vi.mock('../../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../../api/_lib/real-funds-agreement.js', () => ({
	currentSignatureFor: vi.fn(async () => (state.signed ? { signedAt: '2026-10-01T00:00:00.000Z', signatureName: 'Test Signer' } : null)),
	agreementRequirement: () => ({ version: 2, sign_url: 'https://three.ws/legal/agreements', documents: [] }),
}));

vi.mock('../../api/_lib/portfolio-history.js', async (orig) => ({
	...(await orig()),
	loadPortfolioAgent: vi.fn(async () => ({ id: AGENT })),
	portfolioWithSnapshot: vi.fn(),
	getBalanceHistory: vi.fn(),
}));

vi.mock('../../api/_lib/sniper-control.js', async (orig) => ({
	...(await orig()),
	sniperStatus: vi.fn(),
	previewActivation: vi.fn(),
	activateSniper: vi.fn(),
	deactivateSniper: vi.fn(),
}));

vi.mock('../../api/_lib/signal-subscription-control.js', async (orig) => ({
	...(await orig()),
	listSignalSubscriptions: vi.fn(async () => []),
	listSubscribableFeeds: vi.fn(async () => []),
	loadSignalSubscription: vi.fn(),
	loadSubscribableFeed: vi.fn(),
	existingSubscription: vi.fn(async () => null),
	upsertSignalSubscription: vi.fn(),
	setSignalSubscriptionStatus: vi.fn(),
	setSignalSubscriptionKilled: vi.fn(),
}));

vi.mock('../../api/_lib/pump-alert-rules.js', async (orig) => ({
	...(await orig()),
	listAlertRules: vi.fn(),
	createAlertRule: vi.fn(),
	deleteAlertRule: vi.fn(),
}));

vi.mock('../../api/_lib/duel-challenges.js', async (orig) => ({
	...(await orig()),
	createChallenge: vi.fn(),
	respondChallenge: vi.fn(),
	getChallenge: vi.fn(),
	listChallenges: vi.fn(async () => []),
	challengeLeaderboard: vi.fn(),
}));

vi.mock('../../api/_lib/trader-duels.js', async (orig) => ({
	...(await orig()),
	listDuels: vi.fn(async () => []),
	getDuel: vi.fn(),
	seasonLeaderboard: vi.fn(async () => ({ season: { id: '2026-10' }, leaders: [] })),
}));

const portfolio = await import('../../api/_lib/portfolio-history.js');
const sniper = await import('../../api/_lib/sniper-control.js');
const signals = await import('../../api/_lib/signal-subscription-control.js');
const alerts = await import('../../api/_lib/pump-alert-rules.js');
const challenges = await import('../../api/_lib/duel-challenges.js');
const duels = await import('../../api/_lib/trader-duels.js');
const { dispatch } = await import('../../api/_mcpagent/dispatch.js');

const ALL = { userId: USER, rateKey: USER, scope: 'wallet:read wallet:write wallet:trade agents:write', source: 'bearer' };
const READONLY = { userId: USER, rateKey: USER, scope: 'wallet:read', source: 'bearer' };
const ANON = { userId: null, rateKey: 'anon', scope: '', source: 'x402' };
const GROUPS_ON = 'default,wallet,trading,intelligence,predictions';
const req = (tools) => ({ url: '/api/mcp-agent', headers: { 'x-three-tools': tools } });

const call = (name, args, auth = ALL, tools = GROUPS_ON) =>
	dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, auth, req(tools));
const list = (tools = GROUPS_ON, auth = ALL) => dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth, req(tools));
const text = (res) => res.result?.content?.[0]?.text || '';
const out = (res) => res.result?.structuredContent;
const previewIdOf = (res) => res.result?._meta?.['three.ws/preview']?.preview_id;

const NEW_TOOLS = {
	get_portfolio: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	get_balance_history: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	get_pnl: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	sniper_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	sniper_activate_preview: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	sniper_activate: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
	sniper_deactivate: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	sniper_subscribe: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	alert_rule_create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	alert_rule_list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	alert_rule_delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
	duel_challenge: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	duel_accept: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	duel_details: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
	duel_markets: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

function portfolioFixture() {
	return {
		agent: { id: AGENT, name: 'Scout', wallet: WALLET },
		network: 'devnet',
		sol_usd: 150,
		net_worth: { sol: 2, usd: 300, realized_pnl_sol: 0.25, unrealized_pnl_sol: -0.05 },
		holdings: [
			{ isNative: true, symbol: 'SOL', amount: 1.5, usd_value: 225 },
			{ mint: 'THREEsyntheticMint11111111111111111111111111', symbol: 'THREE', amount: 1000, usd_value: 75, cost_basis_sol: 0.55, unrealized_sol: -0.05, unrealized_pct: -9.09 },
		],
		attribution: [{ source: 'sniper', label: 'Sniper', realized_sol: 0.25, unrealized_sol: -0.05, sells: 3 }],
		risk_flags: [{ level: 'warn', text: 'THREE is 25% of net worth.' }],
		metrics: { closed_count: 0, open_count: 1 },
	};
}

function duelFixture(over = {}) {
	return {
		id: DUEL,
		a: { name: 'Scout' },
		b: { name: 'Rival' },
		headline: 'Scout challenged Rival',
		window_kind: 'week',
		window_start: '2026-10-12T00:00:00.000Z',
		window_end: '2026-10-19T00:00:00.000Z',
		phase: 'open',
		url: `/duels/${DUEL}`,
		crowd: { a: { calls: 2, points: 200 }, b: { calls: 1, points: 50 } },
		standing: null,
		my_call: null,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.owned = true;
	state.signed = true;
	portfolio.loadPortfolioAgent.mockResolvedValue({ id: AGENT });
});

describe('threews-agent MCP: listing and annotations', () => {
	it('lists all fifteen tools with the annotations their behavior earns', async () => {
		const tools = (await list()).result.tools;
		for (const [name, hints] of Object.entries(NEW_TOOLS)) {
			const tool = tools.find((t) => t.name === name);
			expect(tool, name).toBeTruthy();
			expect(tool.annotations, name).toEqual(hints);
		}
	});

	it('keeps the two irreversible tools off by default and gates them with a confirm flag and preview id', async () => {
		const defaults = (await list('default')).result.tools.map((t) => t.name);
		expect(defaults).not.toContain('sniper_activate');
		expect(defaults).not.toContain('alert_rule_delete');

		const tools = (await list()).result.tools;
		const arm = tools.find((t) => t.name === 'sniper_activate');
		expect(Object.keys(arm.inputSchema.properties)).toEqual(expect.arrayContaining(['confirm_spend', 'preview_id']));
		expect(arm._meta['three.ws/policy']).toMatchObject({ tier: 'financial', confirmFlag: 'confirm_spend', previewTool: 'sniper_activate_preview' });
		const del = tools.find((t) => t.name === 'alert_rule_delete');
		expect(Object.keys(del.inputSchema.properties)).toEqual(expect.arrayContaining(['confirm_delete', 'preview_id']));
		expect(del._meta['three.ws/policy']).toMatchObject({ tier: 'financial', confirmFlag: 'confirm_delete', previewTool: 'alert_rule_list' });
	});
});

describe('portfolio tools', () => {
	it('get_portfolio values the wallet and lists holdings with cost basis and risk flags', async () => {
		portfolio.portfolioWithSnapshot.mockResolvedValue(portfolioFixture());
		const res = await call('get_portfolio', { agent_id: AGENT, network: 'devnet' });
		expect(portfolio.loadPortfolioAgent).toHaveBeenCalledWith(AGENT, USER);
		expect(portfolio.portfolioWithSnapshot).toHaveBeenCalledWith({ agentId: AGENT, network: 'devnet' });
		expect(text(res)).toContain('Scout on devnet');
		expect(text(res)).toContain('Net worth 2.0000 SOL = $300');
		expect(text(res)).toContain('- THREE: 1000 worth $75, cost 0.5500 SOL, unrealized -0.0500 SOL (-9.09%)');
		expect(text(res)).toContain('Risk flags: warn: THREE is 25% of net worth.');
	});

	it('refuses another account\'s agent with the store\'s reason', async () => {
		portfolio.loadPortfolioAgent.mockRejectedValue(new portfolio.PortfolioAccessError('forbidden', 'That agent belongs to another account.', 403));
		const res = await call('get_pnl', { agent_id: AGENT });
		expect(res.result.isError).toBe(true);
		expect(out(res)).toMatchObject({ ok: false, reason: 'forbidden' });
		expect(portfolio.portfolioWithSnapshot).not.toHaveBeenCalled();
	});

	it('needs a signed-in caller', async () => {
		const res = await call('get_balance_history', { agent_id: AGENT }, ANON);
		expect(out(res)).toMatchObject({ reason: 'auth_required' });
	});

	it('get_pnl reports n/a win rate and ROI before any trade has closed', async () => {
		portfolio.portfolioWithSnapshot.mockResolvedValue(portfolioFixture());
		const res = await call('get_pnl', { agent_id: AGENT, network: 'devnet' });
		expect(text(res)).toContain('0 closed, 1 open, win rate n/a, ROI n/a');
		expect(text(res)).toContain('- Sniper: realized 0.2500 SOL');
	});

	it('get_balance_history passes the window and thinning through', async () => {
		portfolio.getBalanceHistory.mockResolvedValue({
			days: 7, network: 'devnet', snapshot_count: 3, note: 'n',
			summary: { start_sol: 1, end_sol: 2, change_sol: 1, change_pct: 100, start_usd: 150, end_usd: 300, peak_sol: 2, max_drawdown_pct: 0 },
			realized_curve: [{ date: '2026-10-09', cumulative_realized_sol: 0.25 }],
		});
		const res = await call('get_balance_history', { agent_id: AGENT, network: 'devnet', days: 7, max_points: 10 });
		expect(portfolio.getBalanceHistory).toHaveBeenCalledWith({ agentId: AGENT, network: 'devnet', days: 7, maxPoints: 10 });
		expect(text(res)).toContain('1.0000 SOL to 2.0000 SOL');
		expect(text(res)).toContain('2026-10-09 0.2500 SOL');
	});
});

describe('sniper tools', () => {
	const sizing = { agent_id: AGENT, network: 'devnet', per_trade_sol: 0.01, daily_budget_sol: 0.05, stop_loss_pct: 25 };

	function previewFixture(over = {}) {
		return {
			agent: { id: AGENT, name: 'Scout', wallet: WALLET }, network: 'devnet', real_funds: false, trigger: 'new_mint',
			trigger_description: 'every new launch that passes the filters', asset: 'SOL', recipient: 'the launch bonding curve of each coin bought',
			per_trade_sol: 0.01, daily_budget_sol: 0.05, stop_loss_pct: 25, take_profit_pct: null, max_concurrent_positions: 3,
			wallet_sol: 1.2, checks: [{ ok: true, label: 'wallet provisioned' }], executable: true, blocked_by: [], ...over,
		};
	}

	it('the preview shows chain, asset, recipient, wallet and every check before anything is armed', async () => {
		sniper.previewActivation.mockResolvedValue(previewFixture());
		const res = await call('sniper_activate_preview', sizing);
		expect(text(res)).toContain('on Solana devnet (devnet, no real funds)');
		expect(text(res)).toContain(`in SOL, from the agent wallet ${WALLET}`);
		expect(text(res)).toContain('Recipient: the launch bonding curve of each coin bought.');
		expect(text(res)).toContain('Fires on every new launch that passes the filters.');
		expect(text(res)).toContain('[ok] wallet provisioned');
		expect(previewIdOf(res)).toMatch(/^p_/);
		expect(sniper.activateSniper).not.toHaveBeenCalled();
	});

	it('refuses to arm without a preview, or with sizing that drifted from it', async () => {
		const none = await call('sniper_activate', { ...sizing, confirm_spend: true });
		expect(out(none).reason).toBe('preview_required');

		sniper.previewActivation.mockResolvedValue(previewFixture());
		const preview_id = previewIdOf(await call('sniper_activate_preview', sizing));
		const drifted = await call('sniper_activate', { ...sizing, per_trade_sol: 0.02, confirm_spend: true, preview_id });
		expect(out(drifted).reason).toBe('preview_mismatch');
		expect(sniper.activateSniper).not.toHaveBeenCalled();
	});

	it('arms with the exact preview and confirm_spend, once', async () => {
		sniper.previewActivation.mockResolvedValue(previewFixture());
		sniper.activateSniper.mockResolvedValue({ agent_name: 'Scout', trigger: 'new_mint', per_trade_sol: 0.01, daily_budget_sol: 0.05, stop_loss_pct: 25 });
		const preview_id = previewIdOf(await call('sniper_activate_preview', sizing));

		const unconfirmed = await call('sniper_activate', { ...sizing, preview_id });
		expect(out(unconfirmed).reason).toBe('confirmation_required');

		const armed = await call('sniper_activate', { ...sizing, confirm_spend: true, preview_id });
		expect(out(armed)).toMatchObject({ ok: true });
		expect(sniper.activateSniper).toHaveBeenCalledTimes(1);
		expect(sniper.activateSniper.mock.calls[0][0]).toMatchObject({ userId: USER, agentId: AGENT, network: 'devnet' });

		const replay = await call('sniper_activate', { ...sizing, confirm_spend: true, preview_id });
		expect(out(replay).reason).toBe('preview_unknown');
		expect(sniper.activateSniper).toHaveBeenCalledTimes(1);
	});

	it('will not arm a mainnet sniper without the signed real-funds agreement', async () => {
		state.signed = false;
		const main = { ...sizing, network: 'mainnet' };
		sniper.previewActivation.mockResolvedValue(previewFixture({ network: 'mainnet', real_funds: true }));
		const preview_id = previewIdOf(await call('sniper_activate_preview', main));
		const res = await call('sniper_activate', { ...main, confirm_spend: true, preview_id });
		expect(out(res).reason).toBe('risk_ack_required');
		expect(sniper.activateSniper).not.toHaveBeenCalled();
	});

	it('a read-only grant can read status but cannot arm or disarm', async () => {
		sniper.sniperStatus.mockResolvedValue({ worker: { state: 'live', network: 'devnet' }, strategies: [], armed_count: 0 });
		expect(text(await call('sniper_status', {}, READONLY))).toContain('Sniper worker: live on devnet.');
		const res = await call('sniper_deactivate', { agent_id: AGENT }, READONLY);
		expect(out(res).reason).toBe('insufficient_scope');
		expect(sniper.deactivateSniper).not.toHaveBeenCalled();
	});

	it('disarms with the kill switch, and says so when there was nothing to disarm', async () => {
		sniper.deactivateSniper.mockResolvedValueOnce({ existed: true, agent_name: 'Scout', kill_switch: true, positions: { open: 2 } });
		const res = await call('sniper_deactivate', { agent_id: AGENT, network: 'devnet', kill: true });
		expect(sniper.deactivateSniper).toHaveBeenCalledWith({ userId: USER, agentId: AGENT, network: 'devnet', kill: true });
		expect(text(res)).toBe('Disarmed Scout on devnet and set the kill switch. 2 positions remain open under their exits.');

		sniper.deactivateSniper.mockResolvedValueOnce({ existed: false });
		expect(text(await call('sniper_deactivate', { agent_id: AGENT }))).toContain('nothing to disarm');
	});

	it('maps a designed store refusal to a tool refusal', async () => {
		sniper.deactivateSniper.mockRejectedValue(new sniper.SniperControlError('not_your_agent', 'That agent is not one of yours.'));
		const res = await call('sniper_deactivate', { agent_id: AGENT });
		expect(out(res)).toMatchObject({ ok: false, reason: 'not_your_agent' });
	});
});

describe('sniper_subscribe', () => {
	const FEED = { id: 7, slug: 'alpha', title: 'Alpha calls', network: 'devnet', publisher_agent_id: OPPONENT };

	it('subscribes on paper only, whatever the caller asks', async () => {
		signals.loadSubscribableFeed.mockResolvedValue(FEED);
		signals.upsertSignalSubscription.mockImplementation(async ({ knobs }) => ({ id: 3, base_sol: knobs.baseSol, max_per_trade_sol: knobs.maxPerTrade, copy_exits: knobs.copyExits }));
		const res = await call('sniper_subscribe', { action: 'subscribe', agent_id: AGENT, feed_id: 7, base_sol: 0.02 });
		expect(signals.upsertSignalSubscription.mock.calls[0][0].knobs.mode).toBe('simulate');
		expect(text(res)).toContain('Scout now follows "Alpha calls" on paper (#3)');

		const live = await call('sniper_subscribe', { action: 'subscribe', agent_id: AGENT, feed_id: 7, mode: 'live' });
		expect(live.error?.code ?? live.result?.isError).toBeTruthy();
		expect(signals.upsertSignalSubscription).toHaveBeenCalledTimes(1);
	});

	it('leaves a live subscription to the owner', async () => {
		signals.loadSubscribableFeed.mockResolvedValue(FEED);
		signals.existingSubscription.mockResolvedValue({ id: 4, mode: 'live', status: 'active' });
		const res = await call('sniper_subscribe', { action: 'subscribe', agent_id: AGENT, feed_id: 7 });
		expect(out(res)).toMatchObject({ reason: 'live_subscription_exists', subscription_id: 4 });

		signals.loadSignalSubscription.mockResolvedValue({ id: 4, mode: 'live', status: 'paused' });
		const resume = await call('sniper_subscribe', { action: 'resume', subscription_id: 4 });
		expect(out(resume).reason).toBe('live_resume_requires_owner');
		expect(signals.setSignalSubscriptionStatus).not.toHaveBeenCalled();
	});

	it('refuses an agent the caller does not own', async () => {
		state.owned = false;
		const res = await call('sniper_subscribe', { action: 'subscribe', agent_id: AGENT, feed_id: 7 });
		expect(out(res).reason).toBe('not_your_agent');
		expect(signals.loadSubscribableFeed).not.toHaveBeenCalled();
	});

	it('pauses and kills an existing subscription', async () => {
		signals.loadSignalSubscription.mockResolvedValue({ id: 5, mode: 'simulate', status: 'active' });
		signals.setSignalSubscriptionStatus.mockResolvedValue({ id: 5, status: 'paused' });
		expect(text(await call('sniper_subscribe', { action: 'pause', subscription_id: 5 }))).toBe('Subscription #5 is now paused.');
		signals.setSignalSubscriptionKilled.mockResolvedValue({ id: 5 });
		expect(text(await call('sniper_subscribe', { action: 'kill', subscription_id: 5 }))).toContain('Killed subscription #5');
		expect(signals.setSignalSubscriptionKilled).toHaveBeenCalledWith({ userId: USER, subId: 5, killed: true });
	});
});

describe('alert rule tools', () => {
	const RULE_ROW = { id: RULE, kind: 'launch_match', label: 'Cats', enabled: true, last_fired_at: null, filters: { name_pattern: '*cat*', min_safety_score: 60 } };

	it('creates a launch_match rule that always delivers to the owner', async () => {
		alerts.createAlertRule.mockResolvedValue(RULE_ROW);
		const res = await call('alert_rule_create', { kind: 'launch_match', label: 'Cats', filters: { name_pattern: '*cat*', min_safety_score: 60 } });
		expect(alerts.createAlertRule).toHaveBeenCalledWith(USER, expect.objectContaining({ kind: 'launch_match', deliver_in_app: true, enabled: true }));
		expect(text(res)).toContain(`Created alert rule ${RULE}: Cats`);
		expect(text(res)).toContain('bell, by push, and in your paired chats');
	});

	it('rejects an unknown filter before the store sees it', async () => {
		const res = await call('alert_rule_create', { kind: 'launch_match', filters: { favourite_colour: 'blue' } });
		expect(res.error?.code ?? res.result?.isError).toBeTruthy();
		expect(alerts.createAlertRule).not.toHaveBeenCalled();
	});

	it('surfaces the store\'s validation issues', async () => {
		alerts.createAlertRule.mockRejectedValue(new alerts.AlertRuleError('validation_error', 'launch_match needs at least one filter', 400, [{ path: 'filters' }]));
		const res = await call('alert_rule_create', { kind: 'launch_match', filters: {} });
		expect(out(res)).toMatchObject({ ok: false, reason: 'validation_error', issues: [{ path: 'filters' }] });
	});

	it('deletes only with a preview of the same rule and confirm_delete', async () => {
		alerts.listAlertRules.mockResolvedValue([RULE_ROW]);
		alerts.deleteAlertRule.mockResolvedValue(RULE);

		expect(out(await call('alert_rule_delete', { rule_id: RULE, confirm_delete: true })).reason).toBe('preview_required');

		const listed = await call('alert_rule_list', { rule_id: RULE });
		expect(text(listed)).toContain(`[${RULE}] Cats (launch_match, on, never fired)`);
		const preview_id = previewIdOf(listed);
		const other = await call('alert_rule_delete', { rule_id: 'a1e47000-0000-4000-8000-000000000999', confirm_delete: true, preview_id });
		expect(out(other).reason).toBe('preview_mismatch');
		expect(alerts.deleteAlertRule).not.toHaveBeenCalled();

		const res = await call('alert_rule_delete', { rule_id: RULE, confirm_delete: true, preview_id });
		expect(text(res)).toBe(`Deleted alert rule ${RULE}.`);
		expect(alerts.deleteAlertRule).toHaveBeenCalledWith(USER, RULE);
	});

	it('alert_rule_list with an unknown rule_id is a refusal, not an empty list', async () => {
		alerts.listAlertRules.mockResolvedValue([]);
		expect(out(await call('alert_rule_list', { rule_id: RULE })).reason).toBe('not_found');
	});
});

describe('duel tools', () => {
	const challengeRow = (over = {}) => ({
		id: CHALLENGE, challenger: { name: 'Scout' }, challenged: { name: 'Rival' }, window_kind: 'week', status: 'pending',
		expires_at: '2026-10-12T06:00:00.000Z', message: 'Bring it', can_respond: false, can_cancel: true, ...over,
	});

	it('duel_challenge maps its arguments and reports who was notified', async () => {
		challenges.createChallenge.mockResolvedValue({ ...challengeRow(), notified: { bell: true, push: 2, telegram: false } });
		const res = await call('duel_challenge', { agent_id: AGENT, opponent_agent_id: OPPONENT, window: 'week', message: 'Bring it' });
		expect(challenges.createChallenge).toHaveBeenCalledWith({ userId: USER, challengerAgentId: AGENT, challengedAgentId: OPPONENT, windowKind: 'week', message: 'Bring it' });
		expect(text(res)).toContain(`Challenge ${CHALLENGE} sent: Scout vs Rival, week window.`);
		expect(text(res)).toContain('notified by bell, push.');
	});

	it('duel_challenge needs sign-in and a write scope', async () => {
		expect(out(await call('duel_challenge', { agent_id: AGENT, opponent_agent_id: OPPONENT }, ANON)).reason).toBe('auth_required');
		expect(out(await call('duel_challenge', { agent_id: AGENT, opponent_agent_id: OPPONENT }, READONLY)).reason).toBe('insufficient_scope');
		expect(challenges.createChallenge).not.toHaveBeenCalled();
	});

	it('duel_accept refuses with the store\'s reason and opens the duel on accept', async () => {
		challenges.respondChallenge.mockRejectedValueOnce(new challenges.DuelChallengeError('not_challenged', 'Only the challenged agent\'s owner can accept or decline. You can cancel it.', 403));
		expect(out(await call('duel_accept', { challenge_id: CHALLENGE })).reason).toBe('not_challenged');

		challenges.respondChallenge.mockResolvedValueOnce({ challenge: challengeRow({ status: 'accepted' }), duel: duelFixture() });
		const res = await call('duel_accept', { challenge_id: CHALLENGE, response: 'accept' });
		expect(text(res)).toContain('Accepted. The duel is open: Scout vs Rival.');
		expect(text(res)).toContain('week window 2026-10-12 to 2026-10-18 (UTC), open.');
		// A challenge duel's headline only restates the matchup.
		expect(text(res)).not.toContain('Scout vs Rival: Scout challenged Rival');
	});

	it('duel_details needs an id and shows a challenge with its duel', async () => {
		expect(out(await call('duel_details', {})).reason).toBe('invalid_request');
		challenges.getChallenge.mockResolvedValue({ challenge: challengeRow({ status: 'accepted', duel_url: `/duels/${DUEL}` }), duel: duelFixture() });
		const res = await call('duel_details', { challenge_id: CHALLENGE });
		expect(text(res)).toContain('Message: "Bring it"');
		expect(text(res)).toContain('Crowd: 2 calls (200 pts) on Scout, 1 calls (50 pts) on Rival.');
	});

	it('duel_details reads a public duel without sign-in, and a one-day window as one date', async () => {
		duels.getDuel.mockResolvedValue(duelFixture({ window_kind: 'day', window_start: '2026-10-11T00:00:00.000Z', window_end: '2026-10-12T00:00:00.000Z', headline: 'Who trades the weekend better?' }));
		const res = await call('duel_details', { duel_id: DUEL }, ANON);
		expect(duels.getDuel).toHaveBeenCalledWith(DUEL, { userId: null });
		expect(text(res)).toContain('Scout vs Rival: Who trades the weekend better?');
		expect(text(res)).toContain('day window 2026-10-11 (UTC), open.');
	});

	it('duel_markets leaderboard ranks challenge records and names the asked-for agent', async () => {
		challenges.challengeLeaderboard.mockResolvedValue({
			leaders: [{ rank: 1, name: 'Scout', wins: 3, losses: 1, voids: 0, win_rate: 0.75, realized_pnl_sol: 1.2, trader: `/trader/${AGENT}` }],
			agent: { rank: 4, name: 'Rival', wins: 1, losses: 2 },
			challenges: { pending: 2, accepted: 5 },
		});
		const res = await call('duel_markets', { view: 'leaderboard', agent_id: OPPONENT });
		expect(challenges.challengeLeaderboard).toHaveBeenCalledWith({ limit: 20, agentId: OPPONENT });
		expect(text(res)).toContain('1. Scout: 3W 1L, win rate 75%, +1.2000 SOL');
		expect(text(res)).toContain('Rival: rank 4, 1W 2L.');
		expect(text(res)).toContain('2 challenges pending, 5 accepted.');
	});

	it('duel_markets challenges view needs sign-in', async () => {
		expect(out(await call('duel_markets', { view: 'challenges' }, ANON)).reason).toBe('auth_required');
	});
});
