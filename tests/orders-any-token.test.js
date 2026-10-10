/**
 * Orders on any SPL token: ladders, OCO pairs, price bands, venue selection, the
 * per-agent order book vocabulary, the unified DCA store's legacy shape, and the
 * MCP order tools' preview-then-confirm contract.
 *
 * Pure logic is tested directly. The MCP handlers run against a mocked DB and
 * rate limiter so the confirm and preview gates are exercised without a chain.
 * The only mint used is $THREE (per CLAUDE.md).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
	process.env.JWT_SECRET ||= 'orders-any-token-test-secret-0123456789abcdef';
});

const db = vi.hoisted(() => ({ rows: [] }));
vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn(async () => db.rows);
	return { sql, sqlValues: vi.fn(() => ''), default: sql };
});
vi.mock('../api/_lib/rate-limit.js', async (orig) => {
	const real = await orig();
	return { ...real, limits: { ...real.limits, mcpAgent: async () => ({ success: true }) } };
});

import {
	normalizeOrder, normalizeLadder, normalizeOco, normalizeOrderRequest, describeOrder, MAX_LADDER_LEGS,
} from '../api/_lib/orders.js';
import { skipCodeFor, isVenueFailure, nextFire, bookEntry, SKIP_CODES } from '../api/_lib/order-book.js';
import { presentEvmDca, validateEvmDca, delegationBlocker, railOf } from '../api/_lib/dca-unified.js';
import { issuePreview } from '../api/_lib/trading-tools/preview.js';
import { orderToolDefs } from '../api/_mcpagent/orders-tools.js';
import { TOOL_CATALOG, TOOLS } from '../api/_mcpagent/catalog.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const AGENT = '11111111-1111-4111-8111-111111111111';
const USER = 'user-orders-test';

describe('venue and price band', () => {
	it('defaults the venue to auto and accepts launchpad and aggregator', () => {
		expect(normalizeOrder({ type: 'limit', side: 'buy', mint: THREE, limit_price: 1, size_sol: 0.1 }).order.venue).toBe('auto');
		expect(normalizeOrder({ type: 'limit', side: 'buy', mint: THREE, limit_price: 1, size_sol: 0.1, venue: 'aggregator' }).order.venue).toBe('aggregator');
	});

	it('refuses the aggregator off mainnet', () => {
		const r = normalizeOrder({ type: 'limit', side: 'buy', mint: THREE, limit_price: 1, size_sol: 0.1, venue: 'aggregator', network: 'devnet' });
		expect(r.ok).toBe(false);
	});

	it('accepts a price band on a DCA and labels it in the readback', () => {
		const r = normalizeOrder({ type: 'dca', side: 'buy', mint: THREE, size_sol: 0.05, schedule: { interval_seconds: 3600, slices: 4 }, price_band: { max: 0.0001, metric: 'price_sol' } });
		expect(r.ok).toBe(true);
		expect(r.order.price_band).toEqual({ min: null, max: 0.0001, metric: 'price_sol' });
		expect(describeOrder(r.order)).toMatch(/0\.0001/);
	});

	it('rejects an inverted or empty band, and a band on a limit order', () => {
		const base = { type: 'dca', side: 'buy', mint: THREE, size_sol: 0.05, schedule: { interval_seconds: 3600, slices: 4 } };
		expect(normalizeOrder({ ...base, price_band: { min: 2, max: 1 } }).ok).toBe(false);
		expect(normalizeOrder({ ...base, price_band: {} }).ok).toBe(false);
		const limit = normalizeOrder({ type: 'limit', side: 'buy', mint: THREE, limit_price: 1, size_sol: 0.1, price_band: { max: 2 } });
		expect(limit.ok === false || limit.order.price_band == null).toBe(true);
	});
});

describe('normalizeLadder', () => {
	it('sorts a sell ladder lowest level first and keeps each leg a limit sell', () => {
		const r = normalizeLadder({ mint: THREE, side: 'sell', legs: [{ price: 3, sell_pct: 25 }, { price: 2, sell_pct: 25 }, { price: 4, sell_pct: 50 }] });
		expect(r.ok).toBe(true);
		expect(r.kind).toBe('ladder');
		expect(r.orders.map((o) => o.limit_price)).toEqual([2, 3, 4]);
		expect(r.orders.every((o) => o.type === 'limit' && o.side === 'sell')).toBe(true);
	});

	it('sorts a buy ladder highest level first', () => {
		const r = normalizeLadder({ mint: THREE, side: 'buy', legs: [{ price: 1, size_sol: 0.1 }, { price: 2, size_sol: 0.1 }] });
		expect(r.orders.map((o) => o.limit_price)).toEqual([2, 1]);
	});

	it('refuses too few or too many legs, duplicate levels and a sell over 100%', () => {
		expect(normalizeLadder({ mint: THREE, legs: [{ price: 1, sell_pct: 10 }] }).ok).toBe(false);
		const many = Array.from({ length: MAX_LADDER_LEGS + 1 }, (_, i) => ({ price: i + 1, sell_pct: 1 }));
		expect(normalizeLadder({ mint: THREE, legs: many }).ok).toBe(false);
		expect(normalizeLadder({ mint: THREE, legs: [{ price: 1, sell_pct: 10 }, { price: 1, sell_pct: 10 }] }).ok).toBe(false);
		expect(normalizeLadder({ mint: THREE, legs: [{ price: 1, sell_pct: 60 }, { price: 2, sell_pct: 60 }] }).ok).toBe(false);
	});
});

describe('normalizeOco', () => {
	it('pairs a take-profit limit with a stop below it', () => {
		const r = normalizeOco({ mint: THREE, side: 'sell', sell_pct: 100, take_profit: 2, stop_loss: 1 });
		expect(r.ok).toBe(true);
		expect(r.orders.map((o) => o.type)).toEqual(['limit', 'stop']);
		expect(r.orders[1].stop_price).toBe(1);
	});

	it('uses a trailing stop when trail_pct is given without a stop level', () => {
		const r = normalizeOco({ mint: THREE, side: 'sell', sell_pct: 50, take_profit: 2, trail_pct: 20 });
		expect(r.orders[1].type).toBe('trailing');
	});

	it('refuses a stop on the wrong side of the take-profit', () => {
		expect(normalizeOco({ mint: THREE, side: 'sell', sell_pct: 100, take_profit: 1, stop_loss: 2 }).ok).toBe(false);
		expect(normalizeOco({ mint: THREE, side: 'buy', size_sol: 0.1, limit_price: 2, stop_loss: 1 }).ok).toBe(false);
	});
});

describe('normalizeOrderRequest', () => {
	it('dispatches on kind and wraps a single order', () => {
		const single = normalizeOrderRequest({ type: 'stop', side: 'sell', mint: THREE, stop_price: 1, sell_pct: 100 });
		expect(single).toMatchObject({ ok: true, kind: 'single' });
		expect(single.orders).toHaveLength(1);
		expect(normalizeOrderRequest({ mint: THREE, sell_pct: 100, take_profit: 2, stop_loss: 1 }, 'oco').kind).toBe('oco');
		expect(normalizeOrderRequest({ mint: THREE, legs: [{ price: 1, sell_pct: 10 }, { price: 2, sell_pct: 10 }] }, 'ladder').kind).toBe('ladder');
	});
});

describe('order book vocabulary', () => {
	it('maps executor codes onto the closed skip set', () => {
		expect(skipCodeFor('daily_budget')).toBe('cap_hit');
		expect(skipCodeFor('trading_paused')).toBe('kill_switch');
		expect(skipCodeFor('insufficient_sol')).toBe('insufficient_funds');
		expect(skipCodeFor('price_outside_band')).toBe('price_outside_band');
		expect(skipCodeFor('something_new')).toBe('venue_unhealthy');
		for (const code of ['quote_failed', 'firewall_blocked', 'max_positions']) expect(SKIP_CODES[skipCodeFor(code)]).toBeTruthy();
	});

	it('only treats route failures as venue failures', () => {
		expect(isVenueFailure('quote_failed')).toBe(true);
		expect(isVenueFailure('simulation_failed')).toBe(false);
		expect(isVenueFailure('daily_budget')).toBe(false);
	});

	it('says when an order next acts', () => {
		const at = new Date(Date.now() + 60_000).toISOString();
		expect(nextFire({ status: 'active', type: 'dca', next_fire_at: at }).at).toBe(at);
		expect(nextFire({ status: 'paused', type: 'limit' }).label).toMatch(/Paused/);
		expect(nextFire({ status: 'filled', type: 'limit' }).at).toBeNull();
		expect(nextFire({ status: 'active', type: 'limit', side: 'sell', limit_price: 2, trigger_metric: 'price_sol' }).label).toMatch(/at or above 2/);
		const hold = new Date(Date.now() + 120_000).toISOString();
		expect(nextFire({ status: 'active', type: 'limit', hold_until: hold }).label).toMatch(/Backing off/);
	});

	it('attaches the labelled last skip', () => {
		const e = bookEntry({ status: 'active', type: 'dca', last_skip_code: 'cap_hit', last_skip_detail: 'daily budget', last_skip_at: 'x' });
		expect(e.last_skip).toEqual({ code: 'cap_hit', label: SKIP_CODES.cap_hit, detail: 'daily budget', at: 'x' });
		expect(bookEntry({ status: 'active', type: 'limit' }).last_skip).toBeNull();
	});
});

describe('unified DCA store', () => {
	it('presents an EVM row in the legacy /api/dca-strategies shape', () => {
		const s = presentEvmDca({
			id: 'o1', legacy_dca_strategy_id: 'l1', agent_id: AGENT, delegation_id: 'd1', chain_id: 84532, network: 'evm',
			quote_mint: '0x' + 'a'.repeat(40), mint: '0x' + 'b'.repeat(40), symbol: 'WETH', amount_in_raw: '1000000',
			schedule: { interval_seconds: 86400 }, slippage_bps: 50, status: 'active', fill_count: 3, consecutive_failures: 1,
		});
		expect(s).toMatchObject({ id: 'o1', legacy_id: 'l1', rail: 'evm', token_in: '0x' + 'a'.repeat(40), token_out_symbol: 'WETH', amount_per_execution: '1000000', period_seconds: 86400, executions_total: 3 });
		expect(s.retries_left).toBeGreaterThan(0);
		expect(railOf({ network: 'evm' })).toBe('evm');
		expect(railOf({ network: 'devnet' })).toBe('solana');
	});

	it('validates an EVM schedule against the configured allowlist and chain', () => {
		vi.stubEnv('DCA_ALLOWED_TOKEN_OUT', 'WETH');
		vi.stubEnv('DCA_CHAIN_ID', '84532');
		const body = {
			agent_id: AGENT, delegation_id: AGENT, token_in: '0x' + 'a'.repeat(40), token_out: '0x' + 'b'.repeat(40),
			token_out_symbol: 'WETH', amount_per_execution: '1000000', period_seconds: 86400,
		};
		expect(validateEvmDca(body)).toMatchObject({ ok: true, value: { chain_id: 84532, slippage_bps: 50 } });
		expect(validateEvmDca({ ...body, period_seconds: 3600 }).ok).toBe(false);
		expect(validateEvmDca({ ...body, token_out_symbol: 'OTHER' }).ok).toBe(false);
		expect(validateEvmDca({ ...body, amount_per_execution: '0' }).ok).toBe(false);
		vi.unstubAllEnvs();
	});

	it('blocks a resume behind a revoked or expired delegation', () => {
		expect(delegationBlocker({ delegation_status: 'revoked' }).code).toBe('delegation_inactive');
		expect(delegationBlocker({ delegation_status: 'active', delegation_expires_at: '2000-01-01T00:00:00Z' }).code).toBe('delegation_expired');
		expect(delegationBlocker({ delegation_status: 'active', delegation_expires_at: null })).toBeNull();
	});
});

describe('MCP order tools', () => {
	const auth = { userId: USER, scope: 'wallet:read wallet:trade' };
	const tool = (name) => orderToolDefs.find((t) => t.name === name);

	beforeEach(() => {
		db.rows = [{ id: AGENT, user_id: USER, name: 'Test agent', meta: {} }];
	});

	it('registers every order and DCA tool with its policy on the agent catalog', () => {
		const names = ['order_preview', 'limit_order_create', 'stop_order_create', 'trailing_order_create', 'ladder_order_create',
			'oco_order_create', 'limit_order_list', 'limit_order_cancel', 'limit_order_history', 'order_book',
			'dca_preview', 'dca_create', 'dca_list', 'dca_cancel'];
		for (const n of names) expect(TOOLS[n]?.handler, n).toBeTypeOf('function');
		const policy = (n) => TOOL_CATALOG.find((t) => t.name === n)._meta['three.ws/policy'];
		expect(policy('limit_order_create')).toEqual({ group: 'trading', tier: 'financial', confirm_flag: 'confirm_order', preview_tool: 'order_preview' });
		expect(policy('dca_create')).toEqual({ group: 'trading', tier: 'financial', confirm_flag: 'confirm_dca', preview_tool: 'dca_preview' });
		expect(policy('dca_cancel').tier).toBe('write');
	});

	it('validates a ladder preview request and refuses an unknown field', () => {
		const ok = TOOLS.order_preview.validate({ agent_id: AGENT, order_type: 'ladder', mint: THREE, legs: [{ price: 1, sell_pct: 10 }, { price: 2, sell_pct: 10 }] });
		expect(ok).toBe(true);
		expect(TOOLS.order_preview.validate({ agent_id: AGENT, order_type: 'limit', mint: THREE, bogus: 1 })).toBe(false);
		expect(TOOLS.dca_create.validate({ agent_id: AGENT, preview_id: 'p_x.y', confirm_dca: false })).toBe(false);
	});

	it('refuses a create without the confirm flag', async () => {
		const r = await tool('limit_order_create').handler({ agent_id: AGENT, preview_id: 'p_abc.def', confirm_order: false }, auth);
		expect(r.isError).toBe(true);
		expect(r.structuredContent.reason).toBe('confirmation_required');
	});

	it('refuses a preview issued for a different create tool or agent', async () => {
		const stop = issuePreview('order', { userId: USER, agentId: AGENT, network: 'devnet', tool: 'stop_order_create', kind: 'single', body: {} });
		const r = await tool('limit_order_create').handler({ agent_id: AGENT, preview_id: stop.id, confirm_order: true }, auth);
		expect(r.structuredContent.reason).toBe('preview_mismatch');
		const other = issuePreview('order', { userId: USER, agentId: '22222222-2222-4222-8222-222222222222', network: 'devnet', tool: 'limit_order_create', kind: 'single', body: {} });
		const r2 = await tool('limit_order_create').handler({ agent_id: AGENT, preview_id: other.id, confirm_order: true }, auth);
		expect(r2.structuredContent.reason).toBe('preview_mismatch');
	});

	it('refuses a DCA preview id on an order create, and an order preview on dca_create', async () => {
		const dca = issuePreview('dca', { userId: USER, agentId: AGENT, rail: 'solana', network: 'devnet', body: {} });
		const r = await tool('limit_order_create').handler({ agent_id: AGENT, preview_id: dca.id, confirm_order: true }, auth);
		expect(r.structuredContent.reason).toBe('preview_mismatch');
		const order = issuePreview('order', { userId: USER, agentId: AGENT, network: 'devnet', tool: 'limit_order_create', kind: 'single', body: {} });
		const r2 = await tool('dca_create').handler({ agent_id: AGENT, preview_id: order.id, confirm_dca: true }, auth);
		expect(r2.structuredContent.reason).toBe('preview_mismatch');
	});

	it('refuses an agent the caller does not own', async () => {
		db.rows = [{ id: AGENT, user_id: 'someone-else', name: 'x', meta: {} }];
		const r = await tool('order_book').handler({ agent_id: AGENT }, auth);
		expect(r.structuredContent.reason).toBe('not_found');
	});

	it('needs the trade scope to place or cancel', async () => {
		const r = await tool('limit_order_cancel').handler({ agent_id: AGENT, order_id: AGENT }, { userId: USER, scope: 'wallet:read' });
		expect(r.structuredContent.reason).toBe('insufficient_scope');
	});
});
