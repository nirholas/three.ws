// Token due diligence: definitions, thresholds, evidence floor, funding graph,
// signature paging, the cache wrapper, and the agent-trade guard over the
// fields. The $THREE case replays a recorded real read of the mint (chain RPC
// plus our wallet_reputation table) from tests/fixtures/token-dd/three-recorded.json;
// the other cases use clearly synthetic wallets so each rule is pinned alone.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import {
	DD_THRESHOLDS, DD_FIELDS, DD_DEFINITIONS, clusterHolders, computeDueDiligence, buildFundingGraph,
	oldestSignature, getTokenDueDiligence, traceFundingGraph, isProgramDerived,
} from '../api/_lib/token-due-diligence.js';
import { checkDueDiligence, guardDueDiligence, normalizeTradeLimits, tradeGuardResponse, TRADE_LIMIT_DEFAULTS } from '../api/_lib/agent-trade-guards.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const rec = JSON.parse(readFileSync(new URL('./fixtures/token-dd/three-recorded.json', import.meta.url), 'utf8'));

// Synthetic wallets: real on-curve keys derived from fixed seeds, never real holders.
const wallet = (n) => new PublicKey(Buffer.alloc(32, n)).toBase58();
const W = Array.from({ length: 12 }, (_, i) => wallet(i + 1));
const SUPPLY = '1000000';
const LAUNCH = { slot: 1000, time: 1_000_000, creator: W[0], creator_funder: null };
const DAY = 86400;

let slotSeq = 5000;
// Distinct first slots by default: three holders in one slot is itself a bundle signal.
const holder = (owner, amount, over = {}) => ({
	owner, token_account: `ta-${owner.slice(0, 6)}`, amount: String(amount), program_derived: false,
	first_slot: slotSeq++ * 100, first_time: LAUNCH.time + 3600 * 48,
	profile: { first_time: LAUNCH.time - 40 * DAY, history_complete: true, sig_count: 50, funder: null, funder_at: null, funder2: null, funder2_at: null },
	...over,
});
const compute = (holders, extra = {}) => computeDueDiligence({ mint: 'm', supplyRaw: SUPPLY, decimals: 6, launch: LAUNCH, holders, smartAvailable: true, smart: new Map(), ...extra });

describe('recorded $THREE read', () => {
	const dd = computeDueDiligence({
		...rec.raw,
		services: new Set(rec.raw.services),
		readErrors: rec.raw.read_errors,
		smartAvailable: true,
		smart: new Map(rec.reputation.map((r) => [r.wallet, r])),
	});

	it('produces every documented field, each null or a bounded number', () => {
		for (const key of DD_FIELDS) {
			const v = dd.fields[key];
			expect(v === null || (typeof v === 'number' && v >= 0), key).toBe(true);
			if (key.endsWith('_pct')) expect(v === null || v <= 100, key).toBe(true);
		}
	});

	it('keeps holder shares on the supply basis and classifies pools as programs', () => {
		const total = dd.holders.reduce((s, h) => s + h.pct, 0);
		expect(total).toBeGreaterThan(5);
		expect(total).toBeLessThanOrEqual(100);
		expect(dd.holders.some((h) => h.kind === 'program')).toBe(true);
		expect(dd.coverage.holders_analyzed).toBe(rec.raw.holders.length);
	});

	it('says why a field is withheld instead of printing a zero', () => {
		const withheld = DD_FIELDS.filter((k) => dd.fields[k] === null && !k.startsWith('smart'));
		if (withheld.length) expect(dd.notes.join(' ')).toMatch(/withheld/);
	});
});

describe('definitions and thresholds', () => {
	it('defines every field with a doc link into docs/token-due-diligence.md', () => {
		for (const key of DD_FIELDS) {
			expect(DD_DEFINITIONS[key].definition.length, key).toBeGreaterThan(30);
			expect(DD_DEFINITIONS[key].doc).toMatch(/docs\/token-due-diligence\.md#/);
		}
	});

	it('documents every threshold in the doc', () => {
		const doc = readFileSync(new URL('../docs/token-due-diligence.md', import.meta.url), 'utf8');
		for (const key of Object.keys(DD_THRESHOLDS)) expect(doc, key).toContain(key);
		for (const key of DD_FIELDS) expect(doc, key).toContain(`### ${key}`);
	});
});

describe('field rules (synthetic wallets)', () => {
	it('counts the creator and creator-funded holders as insiders', () => {
		const dd = compute([
			holder(W[0], 100_000),
			holder(W[1], 50_000, { profile: { ...holder(W[1], 0).profile, funder: W[0], funder_at: LAUNCH.time } }),
			holder(W[2], 40_000),
			holder(W[3], 30_000),
		]);
		expect(dd.fields.insider_pct).toBe(15);
		expect(dd.holders.find((h) => h.owner === W[1]).flags).toContain('insider');
	});

	it('counts first receipts inside the sniper window and excludes the creator', () => {
		const dd = compute([
			holder(W[0], 100_000, { first_slot: 1000 }),
			holder(W[1], 50_000, { first_slot: 1000 + DD_THRESHOLDS.sniper_slots }),
			holder(W[2], 40_000, { first_slot: 1000 + DD_THRESHOLDS.sniper_slots + 1 }),
			holder(W[3], 30_000, { first_slot: 5000 }),
		]);
		expect(dd.fields.sniper_pct).toBe(5);
	});

	it('clusters holders funded by one source within the window, not outside it', () => {
		const funded = (at) => ({ profile: { ...holder(W[9], 0).profile, funder: W[8], funder_at: at } });
		const inside = compute([
			holder(W[1], 50_000, funded(1_500_000)),
			holder(W[2], 40_000, funded(1_500_000 + 3 * 3600)),
			holder(W[3], 30_000),
		]);
		expect(inside.fields.bundler_pct).toBe(9);
		expect(inside.clusters).toHaveLength(1);
		const outside = compute([
			holder(W[1], 50_000, funded(1_500_000)),
			holder(W[2], 40_000, funded(1_500_000 + 30 * 3600)),
			holder(W[3], 30_000),
		]);
		expect(outside.fields.bundler_pct).toBe(0);
	});

	it('does not cluster holders that share a service funder', () => {
		const funded = { profile: { ...holder(W[9], 0).profile, funder: W[8], funder_at: 1_500_000 } };
		const dd = compute([holder(W[1], 50_000, funded), holder(W[2], 40_000, funded), holder(W[3], 30_000)], { services: new Set([W[8]]) });
		expect(dd.fields.bundler_pct).toBe(0);
	});

	it('flags wallets under 24h old at first receipt as fresh', () => {
		const young = { profile: { ...holder(W[9], 0).profile, first_time: 5000 * 0 + (LAUNCH.time + 3600 * 48) - 3600 } };
		const dd = compute([holder(W[1], 50_000, young), holder(W[2], 40_000), holder(W[3], 30_000), holder(W[4], 20_000)]);
		expect(dd.fields.fresh_wallet_pct).toBe(5);
		expect(dd.fields.fresh_wallet_ratio).toBe(0.25);
	});

	it('marks smart money from our own reputation rows only at or above the bar', () => {
		const smart = new Map([[W[1], { smart_money_score: 80, label: 'consistent' }], [W[2], { smart_money_score: 40, label: null }]]);
		const dd = compute([holder(W[1], 50_000), holder(W[2], 40_000), holder(W[3], 30_000)], { smart });
		expect(dd.fields.smart_money_holders).toBe(1);
		expect(dd.fields.smart_money_pct).toBe(5);
	});

	it('withholds a field when too few wallets yielded its evidence', () => {
		const blind = { first_slot: null, first_time: null, profile: null };
		const dd = compute([holder(W[1], 50_000), holder(W[2], 40_000, blind), holder(W[3], 30_000, blind), holder(W[4], 20_000, blind)]);
		expect(dd.fields.sniper_pct).toBeNull();
		expect(dd.fields.insider_pct).toBeNull();
		expect(dd.fields.fresh_wallet_pct).toBeNull();
		expect(dd.notes.join(' ')).toMatch(/withheld/);
	});

	it('withholds smart-money fields when the reputation lookup did not run', () => {
		const dd = compute([holder(W[1], 50_000)], { smartAvailable: false });
		expect(dd.fields.smart_money_holders).toBeNull();
	});
});

describe('clusterHolders', () => {
	it('links through a shared second-hop source', () => {
		const mk = (o, f1) => ({ owner: o, funder: f1, funder_at: 10, funder2: W[8], funder2_at: 10 });
		const { clusters } = clusterHolders([mk(W[1], W[5]), mk(W[2], W[6])]);
		expect(clusters).toHaveLength(1);
	});
});

describe('funding graph', () => {
	it('builds holder, funder and second-hop nodes with edges pointing funder to funded', () => {
		const dd = compute([holder(W[1], 50_000, { profile: { ...holder(W[1], 0).profile, funder: W[5], funder_at: 1, funder2: W[6], funder2_at: 1 } })]);
		const g = buildFundingGraph(dd, { creator: W[0] });
		expect(g.nodes.find((n) => n.id === W[5]).hop).toBe(1);
		expect(g.nodes.find((n) => n.id === W[6]).hop).toBe(2);
		expect(g.nodes.some((n) => n.id === W[0])).toBe(true);
		expect(g.edges).toEqual(expect.arrayContaining([{ source: W[5], target: W[1], hop: 1, lamports: null }, { source: W[6], target: W[5], hop: 2, lamports: null }]));
	});
});

describe('signature paging', () => {
	const sig = (n, slot) => ({ signature: `s${n}`, slot, blockTime: slot });
	it('returns the oldest signature and marks a short last page complete', async () => {
		const rpc = vi.fn(async () => [sig(3, 30), sig(2, 20), sig(1, 10)]);
		const o = await oldestSignature(W[1], rpc);
		expect(o).toEqual({ oldest: sig(1, 10), count: 3, complete: true });
	});
	it('ignores signatures older than minSlot', async () => {
		const rpc = vi.fn(async () => [sig(3, 30), sig(2, 20), sig(1, 10)]);
		const o = await oldestSignature(W[1], rpc, { minSlot: 15 });
		expect(o.oldest.slot).toBe(20);
	});
	it('reports incomplete when the page budget runs out', async () => {
		let n = 1_000_000;
		const rpc = vi.fn(async () => Array.from({ length: 1000 }, () => sig(n, n--)));
		const o = await oldestSignature(W[1], rpc);
		expect(o.complete).toBe(false);
	});
});

describe('traceFundingGraph', () => {
	it('stops at a service funder whose history cannot be reached', async () => {
		const rpc = vi.fn(async (method) => {
			if (method === 'getSignaturesForAddress') return Array.from({ length: 1000 }, (_, i) => ({ signature: `x${i}`, slot: 9e9 - i, blockTime: 9e9 - i }));
			return null;
		});
		const g = await traceFundingGraph(W[7], { deps: { rpc, history: rpc, now: () => 0 } });
		expect(g.truncated).toBe(true);
		expect(g.nodes[0].service).toBe(true);
	});
});

describe('getTokenDueDiligence', () => {
	const deps = (calls) => ({
		now: () => 1_800_000_000,
		rpc: async (method) => {
			calls.push(method);
			if (method === 'getAccountInfo') return null;
			return null;
		},
	});
	it('reports not_found for an address that is not a mint, without caching it', async () => {
		const calls = [];
		const r = await getTokenDueDiligence(THREE_MINT, { deps: deps(calls), smartLookup: async () => [], force: true });
		expect(r.status).toBe('not_found');
	});
});

describe('isProgramDerived', () => {
	it('separates off-curve accounts from wallets', () => {
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('pool')], new PublicKey(THREE_MINT));
		expect(isProgramDerived(pda.toBase58())).toBe(true);
		expect(isProgramDerived('not-a-key')).toBe(false);
	});
});

describe('agent trade guard over the due-diligence fields', () => {
	const limits = (over) => normalizeTradeLimits({ ...over });
	const fields = { insider_pct: 22.5, sniper_pct: 3, bundler_pct: 0, fresh_wallet_pct: 1 };

	it('defaults to no holder limits', () => {
		for (const k of ['max_insider_pct', 'max_sniper_pct', 'max_bundler_pct', 'max_fresh_wallet_pct']) expect(TRADE_LIMIT_DEFAULTS[k]).toBeNull();
		expect(checkDueDiligence(fields, limits({}))).toBeNull();
	});

	it('refuses a token whose insider share is above the configured limit', () => {
		const blocked = checkDueDiligence(fields, limits({ max_insider_pct: 10 }));
		expect(blocked).toMatchObject({ reason: 'due_diligence', detail: { field: 'insider_pct', value_pct: 22.5, max_pct: 10 } });
		const resp = tradeGuardResponse(blocked);
		expect(resp.status).toBe(422);
		expect(resp.message).toMatch(/22\.5% of supply, above your 10\.0% limit/);
	});

	it('allows a token at or below the limit', () => {
		expect(checkDueDiligence(fields, limits({ max_insider_pct: 22.5 }))).toBeNull();
		expect(checkDueDiligence(fields, limits({ max_insider_pct: 30, max_sniper_pct: 5 }))).toBeNull();
	});

	it('checks each configured limit and names the one that failed', () => {
		const blocked = checkDueDiligence(fields, limits({ max_insider_pct: 30, max_sniper_pct: 2 }));
		expect(blocked.detail.field).toBe('sniper_pct');
	});

	it('fails closed when a limit is set but the field could not be read', () => {
		const blocked = checkDueDiligence({ ...fields, insider_pct: null }, limits({ max_insider_pct: 10 }));
		expect(blocked.reason).toBe('due_diligence_unavailable');
		expect(tradeGuardResponse(blocked).message).toMatch(/could not be checked/);
	});

	it('guardDueDiligence reads the report only when a limit is set', async () => {
		const load = vi.fn(async () => ({ status: 'ok', fields }));
		expect(await guardDueDiligence(THREE_MINT, limits({}), { load })).toBeNull();
		expect(load).not.toHaveBeenCalled();
		const blocked = await guardDueDiligence(THREE_MINT, limits({ max_insider_pct: 10 }), { load });
		expect(blocked.reason).toBe('due_diligence');
		expect(load).toHaveBeenCalledWith(THREE_MINT);
	});

	it('guardDueDiligence fails closed when the report cannot be loaded', async () => {
		const down = await guardDueDiligence(THREE_MINT, limits({ max_insider_pct: 10 }), { load: async () => { throw new Error('rpc down'); } });
		expect(down.reason).toBe('due_diligence_unavailable');
		const bad = await guardDueDiligence(THREE_MINT, limits({ max_insider_pct: 10 }), { load: async () => ({ status: 'upstream_down' }) });
		expect(bad.reason).toBe('due_diligence_unavailable');
	});

	it('normalizes out-of-range limits to unset instead of a silent zero', () => {
		const n = limits({ max_insider_pct: 250, max_sniper_pct: -4, max_bundler_pct: 'abc', max_fresh_wallet_pct: '12.5' });
		expect(n.max_insider_pct).toBeNull();
		expect(n.max_sniper_pct).toBeNull();
		expect(n.max_bundler_pct).toBeNull();
		expect(n.max_fresh_wallet_pct).toBe(12.5);
	});
});
