/**
 * agent-sniper moon-bag manager: the pure decision, the sweep driver against an
 * injected store/chain, and the dry-run guarantee. No RPC, no database.
 */
import { describe, it, expect, vi } from 'vitest';
import { decideMoonbagAction } from '../workers/agent-sniper/exit-logic.js';
import { runMoonbagSweep } from '../workers/agent-sniper/moonbag-manager.js';

const OPTS = { trailPct: 40, dustLamports: 50_000, writeOffS: 600 };
const SOL = 1_000_000_000;
const bag = (o = {}) => ({
	value: 0.5 * SOL, peak: 0.5 * SOL, prevValue: 0.5 * SOL, staleSince: null, entry: 0, ...o,
});

describe('decideMoonbagAction', () => {
	it('holds while the bag is above its trailing stop and lifts the peak', () => {
		const r = decideMoonbagAction(bag({ value: 0.8 * SOL, prevValue: 0.5 * SOL }), 1_000, OPTS);
		expect(r).toMatchObject({ action: 'hold', peak: 0.8 * SOL });
	});

	it('sells the whole bag when value falls trailPct below the high-water mark', () => {
		const r = decideMoonbagAction(bag({ peak: 1 * SOL, value: 0.59 * SOL, prevValue: 0.7 * SOL }), 1_000, OPTS);
		expect(r).toMatchObject({ action: 'sell', reason: 'trailing_stop' });
	});

	it('does not sell exactly above the trail line', () => {
		const r = decideMoonbagAction(bag({ peak: 1 * SOL, value: 0.61 * SOL, prevValue: 0.7 * SOL }), 1_000, OPTS);
		expect(r.action).toBe('hold');
	});

	it('never sells a bag worth less than dust, however far it fell', () => {
		const r = decideMoonbagAction(bag({ peak: 1 * SOL, value: 10_000, prevValue: 20_000 }), 1_000, OPTS);
		expect(r.action).toBe('hold');
	});

	it('starts the stale clock on a dust bag whose value did not move', () => {
		const r = decideMoonbagAction(bag({ peak: 1 * SOL, value: 10_000, prevValue: 10_000 }), 5_000, OPTS);
		expect(r).toMatchObject({ action: 'hold', staleSince: 5_000 });
	});

	it('writes off a dust bag once the stale clock has run writeOffS', () => {
		const r = decideMoonbagAction(
			bag({ peak: 1 * SOL, value: 0, prevValue: 0, staleSince: 1_000 }), 1_000 + 601_000, OPTS,
		);
		expect(r).toMatchObject({ action: 'write_off', reason: 'written_off' });
	});

	it('keeps holding a stale dust bag before the write-off window ends', () => {
		const r = decideMoonbagAction(
			bag({ peak: 1 * SOL, value: 0, prevValue: 0, staleSince: 1_000 }), 1_000 + 599_000, OPTS,
		);
		expect(r.action).toBe('hold');
	});

	it('never writes off or stales a bag that is still worth more than dust', () => {
		const r = decideMoonbagAction(bag({ value: 0.2 * SOL, peak: 0.2 * SOL, prevValue: 0.2 * SOL, staleSince: 1 }), 10_000_000, OPTS);
		expect(r).toMatchObject({ action: 'hold', staleSince: null });
	});

	it('does not arm the trail until the bag has been worth more than dust', () => {
		const r = decideMoonbagAction(bag({ peak: 40_000, value: 20_000, prevValue: 30_000 }), 1_000, OPTS);
		expect(r.action).toBe('hold');
	});
});

function makeWorld(bags) {
	const rows = new Map(bags.map((b) => [b.id, { ...b }]));
	const calls = { sells: [], quoted: [], ticks: [] };
	const store = {
		async listBags() { return [...rows.values()].filter((r) => r.moonbag_closed_at == null); },
		async saveQuote(id, patch) { Object.assign(rows.get(id), patch); calls.quoted.push(id); },
		async writeOff(id, reason) { Object.assign(rows.get(id), { moonbag_closed_at: 'now', moonbag_exit_reason: reason }); },
	};
	const deps = {
		store,
		quote: async (b) => b._quote,
		sell: async (b, reason) => { calls.sells.push({ id: b.id, reason }); return { status: 'closed' }; },
		recordTick: async (t) => { calls.ticks.push(t); },
		now: () => 1_000_000,
	};
	return { rows, calls, deps };
}

const mk = (o) => ({
	id: 'p1', mint: 'THREEsynthetic1111', network: 'mainnet', moonbag_base_amount: '1000',
	moonbag_entry_lamports: '0', moonbag_peak_value_lamports: String(1 * SOL),
	moonbag_last_value_lamports: String(1 * SOL), moonbag_stale_since: null, moonbag_closed_at: null,
	slippage_bps: 500, _quote: 1 * SOL, ...o,
});
const cfg = { network: 'mainnet', mode: 'simulate', moonbag: OPTS, moonbagBatch: 50 };

describe('runMoonbagSweep', () => {
	it('stamps moonbag_last_quoted_at, the value and the peak on every bag it quotes', async () => {
		const w = makeWorld([mk({ _quote: 1.5 * SOL })]);
		await runMoonbagSweep(cfg, w.deps);
		const r = w.rows.get('p1');
		expect(r.moonbag_last_value_lamports).toBe(Math.round(1.5 * SOL));
		expect(r.moonbag_peak_value_lamports).toBe(Math.round(1.5 * SOL));
		expect(r.moonbag_last_quoted_at).toBeInstanceOf(Date);
		expect(w.calls.sells).toHaveLength(0);
		expect(w.calls.ticks[0]).toMatchObject({ source: 'moonbag', value_lamports: Math.round(1.5 * SOL) });
	});

	it('routes a tripped trailing stop into the sell path with its reason', async () => {
		const w = makeWorld([mk({ _quote: 0.5 * SOL })]);
		await runMoonbagSweep(cfg, w.deps);
		expect(w.calls.sells).toEqual([{ id: 'p1', reason: 'trailing_stop' }]);
	});

	it('writes off a dead coin after the stale window instead of quoting it forever', async () => {
		const stale = new Date(1_000_000 - 700_000).toISOString();
		const w = makeWorld([mk({ _quote: 0, moonbag_last_value_lamports: '0', moonbag_stale_since: stale })]);
		await runMoonbagSweep(cfg, w.deps);
		expect(w.rows.get('p1')).toMatchObject({ moonbag_closed_at: 'now', moonbag_exit_reason: 'written_off' });
		expect(w.calls.sells).toHaveLength(0);
	});

	it('skips a bag whose quote failed this sweep and keeps the rest going', async () => {
		const w = makeWorld([mk({ id: 'a', _quote: null }), mk({ id: 'b', _quote: 2 * SOL })]);
		await runMoonbagSweep(cfg, w.deps);
		expect(w.calls.quoted).toEqual(['b']);
	});

	it('one bag throwing does not stop the others', async () => {
		const w = makeWorld([mk({ id: 'a' }), mk({ id: 'b', _quote: 2 * SOL })]);
		const realQuote = w.deps.quote;
		w.deps.quote = async (b) => { if (b.id === 'a') throw new Error('rpc down'); return realQuote(b); };
		await runMoonbagSweep(cfg, w.deps);
		expect(w.calls.quoted).toEqual(['b']);
	});

	it('in simulate mode the real sell path is only ever called with the simulate cfg', async () => {
		const sell = vi.fn(async () => ({ status: 'closed' }));
		const w = makeWorld([mk({ _quote: 0.5 * SOL })]);
		w.deps.sell = sell;
		await runMoonbagSweep(cfg, w.deps);
		expect(sell).toHaveBeenCalledTimes(1);
		expect(cfg.mode).toBe('simulate');
	});
});
