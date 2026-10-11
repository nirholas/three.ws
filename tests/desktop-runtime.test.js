// Desktop local agent runtime: approval-hash parity with the cloud, the
// approval gate, key custody, log redaction and the paper scheduler.
// Fixtures are captured-shape pump.fun coin objects (reserves in base units).
// FakeSafeStorage stands in for Electron's safeStorage, which only exists
// inside the Electron process; its scrambling is enough to prove the key file
// is not stored in the clear.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import * as cloud from '../api/_lib/approvals.js';
import { canonicalJson, payloadHash, confirmationTable, confirmationText } from '../apps/desktop/src/runtime/hash.js';
import { redact, createLogger } from '../apps/desktop/src/runtime/log.js';
import { createSecureStore } from '../apps/desktop/src/main/secure-store.js';
import { createKeystore } from '../apps/desktop/src/runtime/keystore.js';
import { createRuntime, RuntimeError } from '../apps/desktop/src/runtime/runtime.js';
import { quoteBuy, quoteSell } from '../apps/desktop/src/runtime/curve.js';
import { bondingCurveAddress, parseBondingCurve } from '../apps/desktop/src/runtime/feed.js';

const MINT = '5a4w3tawg8y595D8pXzLrZqTnUZ5xT7e2m1q8VhJpump';
const FIXTURE_COIN = { mint: MINT, symbol: 'FIX', virtual_sol_reserves: 30_000_000_000, virtual_token_reserves: 1_073_000_000_000_000 };
const NOW = 1_800_000_000_000;

const fakeSafeStorage = {
	isEncryptionAvailable: () => true,
	encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
	decryptString: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString(),
};

describe('approval hash parity with the cloud', () => {
	const corpus = [
		{ b: 1, a: [3, { z: null, y: undefined, x: 'é' }], c: { d: 0.1, e: false } },
		{ kind: 'strategy_buy', amount_sol: 0.05, max_price_impact_pct: null, mint: MINT },
		[], {}, 'str', 7, null,
	];
	it('canonicalJson and payloadHash match api/_lib/approvals.js', () => {
		for (const v of corpus) {
			expect(canonicalJson(v)).toBe(cloud.canonicalJson(v));
			expect(payloadHash(v)).toBe(cloud.payloadHash(v));
		}
	});
	it('the confirmation table matches the cloud table', () => {
		const row = { recipient: MINT, recipient_label: '$FIX', amount: 0.05, asset: 'SOL', chain: 'solana', network: 'devnet' };
		expect(confirmationTable(row)).toEqual(cloud.confirmationTable(row));
		expect(confirmationText(row)).toBe(cloud.confirmationText(row));
	});
	it('the vendored strategy schema matches the cloud copy apart from dash punctuation', () => {
		const squash = (u) => readFileSync(new URL(u, import.meta.url), 'utf8').replace(/[\s\u2014:\-]/g, '');
		expect(squash('../apps/desktop/src/runtime/strategy-schema.js')).toBe(squash('../api/_lib/strategy-schema.js'));
	});
});

describe('log redaction', () => {
	it('masks secret fields, key bytes, base58 keys and bearer tokens', () => {
		const kp = Keypair.generate();
		const out = JSON.stringify(redact({
			secret: 'x', privateKey: 'y', note: 'Bearer abcdefghijklmnop1234', keyBytes: Array.from(kp.secretKey),
			nested: { token: 't', ok: 'fine' }, err: new Error('failed with Bearer abcdefghijklmnop1234'),
		}));
		expect(out).not.toContain('abcdefghijklmnop1234');
		expect(out).not.toContain(String(kp.secretKey[0]) + ',' + String(kp.secretKey[1]) + ',');
		expect(out).toContain('fine');
	});
	it('never writes a key to the log file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rt-log-'));
		const log = createLogger({ file: join(dir, 'l.log') });
		const kp = Keypair.generate();
		log.error('boom', { secretKey: Array.from(kp.secretKey), err: new Error('x') });
		const text = readFileSync(join(dir, 'l.log'), 'utf8');
		expect(text).toContain('[redacted]');
		expect(text).not.toContain(`${kp.secretKey[0]},${kp.secretKey[1]},${kp.secretKey[2]}`);
	});
});

describe('keystore custody', () => {
	it('keeps the key only in the encrypted key file and signs without exposing it', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rt-keys-'));
		const store = createSecureStore({ file: join(dir, 'keys.bin'), safeStorage: fakeSafeStorage });
		const ks = createKeystore({ store });
		const { address, created } = ks.create('ag_1');
		expect(created).toBe(true);
		expect(ks.create('ag_1')).toEqual({ address, created: false });
		const raw = readFileSync(join(dir, 'keys.bin'), 'utf8');
		expect(raw.startsWith('tws1:')).toBe(true);
		expect(raw).not.toContain('secret');
		expect(ks.list()).toEqual([{ agentId: 'ag_1', address }]);
		expect(() => ks.signTransaction('missing', 'AA==')).toThrow(/no signing key/);
		expect(ks.remove('ag_1')).toBe(true);
		expect(ks.address('ag_1')).toBeNull();
	});
});

describe('bonding curve maths and parsing', () => {
	it('prices a buy with impact and a sell below the buy cost', () => {
		const q = quoteBuy(FIXTURE_COIN, 1);
		expect(q.tokens).toBeGreaterThan(0);
		expect(q.impact_pct).toBeGreaterThan(0);
		const back = quoteSell(FIXTURE_COIN, q.tokens);
		expect(back.lamports).toBeLessThan(1e9);
	});
	it('reads a bonding curve account and derives its address', () => {
		const buf = Buffer.alloc(49);
		buf.writeBigUInt64LE(1073000000000000n, 8);
		buf.writeBigUInt64LE(30000000000n, 16);
		buf.writeBigUInt64LE(793100000000000n, 24);
		buf.writeBigUInt64LE(0n, 32);
		const c = parseBondingCurve(buf);
		expect(c.virtual_sol_reserves).toBe(30000000000);
		expect(c.complete).toBe(false);
		expect(bondingCurveAddress(MINT)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
	});
});

function build({ mode = 'live', strategy = {}, coin = FIXTURE_COIN, launches } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'rt-run-'));
	let clock = NOW;
	const calls = { buy: [], sell: [] };
	const events = [];
	const keystore = createKeystore({ store: createSecureStore({ file: join(dir, 'keys.bin'), safeStorage: fakeSafeStorage }) });
	const feed = {
		launches: async () => launches ?? [{ mint: MINT, symbol: 'FIX', created_at: clock - 60_000, market_cap_usd: 9000, liquidity_sol: 3, twitter: 'x', is_usdc_pair: false, graduated: false }],
		coin: async () => coin,
	};
	const live = { buy: async (a) => { calls.buy.push(a); return 'sig-buy'; }, sell: async (a) => { calls.sell.push(a); return 'sig-sell'; } };
	const stateStore = createSecureStore({ file: join(dir, 'state.bin'), safeStorage: null });
	const runtime = createRuntime({ stateStore, keystore, log: createLogger({}), feed, live, onEvent: (e) => events.push(e), now: () => clock });
	const agent = runtime.createAgent({ name: 'a', mode, strategy: { entry: { max_age_minutes: 120 }, exits: { take_profit_pct: 50, stop_loss_pct: 30 }, ...strategy } });
	return { runtime, agent, calls, events, dir, advance: (ms) => { clock += ms; }, setCoin: (c) => { coin = c; } };
}

describe('approval gate (live agent, ask mode)', () => {
	let ctx;
	beforeEach(async () => {
		ctx = build();
		await ctx.runtime.tick();
	});

	it('files an approval and signs nothing until approved', () => {
		const [ap] = ctx.runtime.listApprovals({ status: 'pending' });
		expect(ap).toBeTruthy();
		expect(ctx.calls.buy).toHaveLength(0);
		expect(ctx.runtime.getAgent(ctx.agent.id).status).toBe('waiting_approval');
		expect(ap.hash).toBe(cloud.payloadHash(ap.payload));
		expect(ap.table.map((r) => r.key)).toEqual(['recipient', 'amount', 'asset', 'chain']);
		expect(ctx.events.some((e) => e.type === 'approval' && e.notify)).toBe(true);
	});

	it('rejects a wrong or missing hash and runs nothing', async () => {
		const [ap] = ctx.runtime.listApprovals({ status: 'pending' });
		await expect(ctx.runtime.decide(ap.id, { decision: 'approve', hash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'hash_mismatch', status: 409 });
		await expect(ctx.runtime.decide(ap.id, { decision: 'approve' })).rejects.toMatchObject({ code: 'hash_mismatch' });
		expect(ctx.calls.buy).toHaveLength(0);
	});

	it('rejects an approval whose stored action changed after it was shown', async () => {
		const [ap] = ctx.runtime.listApprovals({ status: 'pending' });
		const shownHash = ap.hash;
		ap.payload.amount_sol = 99;
		await expect(ctx.runtime.decide(ap.id, { decision: 'approve', hash: shownHash })).rejects.toMatchObject({ code: 'payload_changed', status: 409 });
		expect(ctx.calls.buy).toHaveLength(0);
	});

	it('executes exactly once with the right hash and records the hash on the receipt', async () => {
		const [ap] = ctx.runtime.listApprovals({ status: 'pending' });
		const done = await ctx.runtime.decide(ap.id, { decision: 'approve', hash: ap.hash.toUpperCase() });
		expect(done.status).toBe('executed');
		expect(ctx.calls.buy).toHaveLength(1);
		const [receipt] = ctx.runtime.receipts({ agentId: ctx.agent.id });
		expect(receipt).toMatchObject({ kind: 'buy', mode: 'live', signature: 'sig-buy', payload_hash: ap.hash });
		await expect(ctx.runtime.decide(ap.id, { decision: 'approve', hash: ap.hash })).rejects.toMatchObject({ code: 'approval_not_pending' });
		expect(ctx.calls.buy).toHaveLength(1);
	});

	it('expires after fifteen minutes and runs nothing', async () => {
		const [ap] = ctx.runtime.listApprovals({ status: 'pending' });
		ctx.advance(16 * 60_000);
		await expect(ctx.runtime.decide(ap.id, { decision: 'approve', hash: ap.hash })).rejects.toMatchObject({ code: 'approval_expired' });
		expect(ctx.calls.buy).toHaveLength(0);
	});

	it('deny and kill both leave nothing signed', async () => {
		const [ap] = ctx.runtime.listApprovals({ status: 'pending' });
		const denied = await ctx.runtime.decide(ap.id, { decision: 'deny', hash: ap.hash });
		expect(denied.status).toBe('denied');
		ctx.runtime.kill(ctx.agent.id);
		expect(ctx.runtime.getAgent(ctx.agent.id).status).toBe('killed');
		expect(ctx.calls.buy).toHaveLength(0);
		await expect(ctx.runtime.tick()).resolves.toBeUndefined();
		expect(ctx.runtime.getAgent(ctx.agent.id).status).toBe('killed');
	});
});

describe('paper agent and scheduler', () => {
	it('fills from reserves with no approval, then exits on take profit', async () => {
		const ctx = build({ mode: 'paper' });
		await ctx.runtime.tick();
		expect(ctx.runtime.listApprovals()).toHaveLength(0);
		const open = ctx.runtime.positions({ agentId: ctx.agent.id });
		expect(open).toHaveLength(1);
		expect(ctx.calls.buy).toHaveLength(0);
		ctx.setCoin({ ...FIXTURE_COIN, virtual_sol_reserves: FIXTURE_COIN.virtual_sol_reserves * 3 });
		await ctx.runtime.tick();
		expect(ctx.runtime.positions({ agentId: ctx.agent.id })[0].status).toBe('closed');
		const kinds = ctx.runtime.receipts({ agentId: ctx.agent.id }).map((r) => r.kind);
		expect(kinds).toEqual(['sell', 'buy']);
	});

	it('pause holds the agent and the mascot face reports the most urgent state', async () => {
		const ctx = build({ mode: 'paper' });
		ctx.runtime.pause(ctx.agent.id);
		expect(ctx.runtime.face().state).toBe('paused');
		await ctx.runtime.tick();
		expect(ctx.runtime.positions()).toHaveLength(0);
		ctx.runtime.resume(ctx.agent.id);
		expect(ctx.runtime.face().state).toBe('idle');
		const live = build();
		await live.runtime.tick();
		expect(live.runtime.face().state).toBe('waiting_approval');
	});

	it('limit orders fire on price and validate input', async () => {
		const ctx = build({ mode: 'paper', launches: [] });
		expect(() => ctx.runtime.addOrder(ctx.agent.id, { mint: MINT, side: 'buy', amount_sol: 0.05, trigger: {} })).toThrow(RuntimeError);
		ctx.runtime.addOrder(ctx.agent.id, { mint: MINT, side: 'buy', amount_sol: 0.05, trigger: { price_sol_above: 1e-9 } });
		await ctx.runtime.tick();
		expect(ctx.runtime.getAgent(ctx.agent.id).orders).toHaveLength(0);
		expect(ctx.runtime.positions()).toHaveLength(1);
	});

	it('refuses a live agent when the keychain is unavailable', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rt-nokc-'));
		const keystore = createKeystore({ store: createSecureStore({ file: join(dir, 'keys.bin'), safeStorage: null }) });
		const runtime = createRuntime({ stateStore: createSecureStore({ file: join(dir, 's.bin'), safeStorage: null }), keystore, log: createLogger({}), feed: { launches: async () => [], coin: async () => null } });
		expect(() => runtime.createAgent({ name: 'x', mode: 'live', strategy: { exits: { take_profit_pct: 50, stop_loss_pct: 30 } } })).toThrow(/keychain/i);
	});
});
