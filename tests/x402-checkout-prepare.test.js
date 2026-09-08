import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';

import { acceptSchema, prepareSchema, ataExists, getRecentBlockhash, validateTip } from '../api/x402-checkout.js';

// The 402 challenge's `accept` is built from operator env (X402_PAY_TO_SOLANA /
// X402_FEE_PAYER_SOLANA). Those values are pasted into dashboards and routinely
// carry a trailing newline. An untrimmed address makes prepare throw
// "Non-base58 character" inside `new PublicKey()` — an opaque 500 that took down
// every USDC checkout at the club door. The schema must trim it back to a valid
// address so the transaction still builds.
const PAY_TO = 'Cta6nRgbTuhM65E3g4UsEed6go9QHGoY75p5HPdHm3J4';
const FEE_PAYER = 'PayeRNCipcerPHCsYMTrX9pAYDm1LnPGzgb66NUDG5a';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BUYER = 'wwwPqsM4N7T9J69tB82nLyzxqsH159j4orftLTQfUGV';

const challengeAccept = (overrides = {}) => ({
	scheme: 'exact',
	amount: '10000',
	maxTimeoutSeconds: 60,
	network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	payTo: PAY_TO,
	asset: USDC,
	extra: { name: 'USDC', decimals: 6, feePayer: FEE_PAYER },
	...overrides,
});

describe('x402-checkout acceptSchema — whitespace-tolerant addresses', () => {
	it('trims a trailing newline on payTo so PublicKey construction succeeds', () => {
		const accept = challengeAccept({ payTo: `${PAY_TO}\n` });
		const parsed = acceptSchema.parse(accept);
		expect(parsed.payTo).toBe(PAY_TO);
		// The exact call that 500'd in prepare before the trim landed.
		expect(() => new PublicKey(parsed.payTo)).not.toThrow();
	});

	it('trims whitespace on every address field (asset, feePayer)', () => {
		const accept = challengeAccept({
			asset: `  ${USDC}`,
			extra: { name: 'USDC', decimals: 6, feePayer: `${FEE_PAYER}\r\n` },
		});
		const parsed = acceptSchema.parse(accept);
		expect(parsed.asset).toBe(USDC);
		expect(parsed.extra.feePayer).toBe(FEE_PAYER);
	});

	it('still rejects an address that is malformed beyond whitespace', () => {
		expect(() => acceptSchema.parse(challengeAccept({ payTo: 'too-short' }))).toThrow();
	});
});

describe('x402-checkout prepareSchema', () => {
	it('trims the buyer address from the posted body', () => {
		const parsed = prepareSchema.parse({ accept: challengeAccept(), buyer: `${BUYER}\n` });
		expect(parsed.buyer).toBe(BUYER);
		expect(() => new PublicKey(parsed.buyer)).not.toThrow();
	});

	it('trims donation (tip) recipient addresses', () => {
		const parsed = prepareSchema.parse({
			accept: challengeAccept(),
			buyer: BUYER,
			tips: [{ to: `${USDC}\n`, amount: '1000' }],
		});
		expect(parsed.tips[0].to).toBe(USDC);
	});
});

describe('x402-checkout validateTip — donation safety caps (moves real USDC)', () => {
	const payTo = new PublicKey(PAY_TO);
	// A distinct, valid charity recipient (≠ payTo) for the happy-path cases.
	const CHARITY = FEE_PAYER;

	it('accepts a well-formed donation under the caps, returning typed to/amount', () => {
		const v = validateTip({ to: CHARITY, amount: '1000' }, { payTo, paymentAmount: 10_000n });
		expect(v.ok).toBe(true);
		expect(v.to).toBeInstanceOf(PublicKey);
		expect(v.to.toBase58()).toBe(CHARITY);
		expect(v.amount).toBe(1000n);
	});

	it('skips a zero-amount donation (nothing to send) without erroring', () => {
		const v = validateTip({ to: CHARITY, amount: '0' }, { payTo, paymentAmount: 10_000n });
		expect(v).toEqual({ skip: true });
	});

	it('rejects a donation above the absolute 100-token cap', () => {
		// 100.000001 USDC: over the abs cap, but well under 50× a large payment so
		// the abs cap is the binding rule being exercised here.
		const v = validateTip({ to: CHARITY, amount: '100000001' }, { payTo, paymentAmount: 1_000_000_000n });
		expect(v.ok).toBe(false);
		expect(v.code).toBe('tip_too_large');
	});

	it('rejects a donation above 50× the payment even when under the abs cap', () => {
		// 60k atomics > 50 × 1000 = 50k, and far below the 100-token abs cap.
		const v = validateTip({ to: CHARITY, amount: '60000' }, { payTo, paymentAmount: 1_000n });
		expect(v.ok).toBe(false);
		expect(v.code).toBe('tip_too_large');
	});

	it('rejects a donation routed back to the merchant payout (silent inflation)', () => {
		const v = validateTip({ to: PAY_TO, amount: '1000' }, { payTo, paymentAmount: 10_000n });
		expect(v.ok).toBe(false);
		expect(v.code).toBe('invalid_tip');
	});

	it('rejects a malformed recipient address', () => {
		const v = validateTip({ to: 'not-a-valid-base58-address!!', amount: '1000' }, { payTo, paymentAmount: 10_000n });
		expect(v.ok).toBe(false);
		expect(v.code).toBe('invalid_tip');
	});

	it('rejects a non-numeric donation amount', () => {
		const v = validateTip({ to: CHARITY, amount: 'abc' }, { payTo, paymentAmount: 10_000n });
		expect(v.ok).toBe(false);
		expect(v.code).toBe('invalid_tip');
	});

	it('caps the donation array at 2 entries in prepareSchema', () => {
		expect(() =>
			prepareSchema.parse({
				accept: challengeAccept(),
				buyer: BUYER,
				tips: [
					{ to: USDC, amount: '1' },
					{ to: USDC, amount: '2' },
					{ to: USDC, amount: '3' },
				],
			}),
		).toThrow();
	});
});

describe('x402-checkout ataExists — fail-open on a flaky RPC', () => {
	const ata = new PublicKey('HgwbNyweQUiV5diWJ1a7ocxgzf3AYSLhTpphEYRLujtN');

	it('reports existing when the RPC returns account data', async () => {
		const conn = { getAccountInfo: async () => ({ data: Buffer.alloc(165), owner: ata }) };
		expect(await ataExists(conn, ata)).toBe(true);
	});

	it('reports missing when the RPC returns a clean null', async () => {
		const conn = { getAccountInfo: async () => null };
		expect(await ataExists(conn, ata)).toBe(false);
	});

	it('assumes missing (fail-open) when getAccountInfo throws StructError — the prepare-step 500 this guards', async () => {
		const conn = {
			getAccountInfo: async () => {
				throw new Error('failed to get info about account: StructError: Expected the value to satisfy a union');
			},
		};
		// Must NOT propagate — assuming-missing only adds an idempotent ATA-create,
		// safe whether or not the account exists.
		await expect(ataExists(conn, ata)).resolves.toBe(false);
	});
});

describe('x402-checkout getRecentBlockhash — fail-open on a total RPC outage', () => {
	const BH = 'GfVcyD4kkTrj4bKc7Wd9G4nf2k1zk8mF8YQ4i6N2bQrs';
	const ok = (blockhash) => ({ getLatestBlockhash: async () => ({ blockhash }) });
	const dead = {
		getLatestBlockhash: async () => {
			throw new Error('all solana rpc endpoints failed');
		},
	};

	it('serves a fresh blockhash and caches it for reuse', async () => {
		const rpc = 'https://rpc.test/fresh';
		const bh = await getRecentBlockhash(ok(BH), rpc, { now: () => 1000 });
		expect(bh).toBe(BH);
		// Within the hot TTL, the cached value is returned without touching the RPC.
		const cached = await getRecentBlockhash(dead, rpc, { now: () => 1000 + 5000 });
		expect(cached).toBe(BH);
	});

	it('falls back to a slightly-stale cached blockhash when every RPC endpoint fails — the Authorize-step 500 this guards', async () => {
		const rpc = 'https://rpc.test/stale-fallback';
		await getRecentBlockhash(ok(BH), rpc, { now: () => 1000 }); // warm the cache
		// 20s later: past the 8s freshness TTL but inside the ~60s validity window,
		// so a dead failover chain must NOT 500 — it serves the cached blockhash.
		const bh = await getRecentBlockhash(dead, rpc, { now: () => 1000 + 20_000 });
		expect(bh).toBe(BH);
	});

	it('propagates the error only when no usable cached blockhash remains', async () => {
		const rpc = 'https://rpc.test/too-stale';
		await getRecentBlockhash(ok(BH), rpc, { now: () => 1000 });
		// 90s later the cached blockhash is past the cluster's validity window —
		// serving it would just fail to confirm, so we surface the RPC error instead.
		await expect(
			getRecentBlockhash(dead, rpc, { now: () => 1000 + 90_000 }),
		).rejects.toThrow(/all solana rpc endpoints failed/);
	});

	it('propagates the error when the cache is cold (first request hits the outage)', async () => {
		await expect(
			getRecentBlockhash(dead, 'https://rpc.test/cold', { now: () => 1000 }),
		).rejects.toThrow(/all solana rpc endpoints failed/);
	});
});

// Self-pay: an accept with no `extra.feePayer` means the buyer covers their own
// Solana fee. That is what a paid endpoint advertises when the sponsor wallet
// is empty, and it is the difference between still taking money and answering
// 503 on an endpoint whose whole purpose is receiving crypto.
describe('x402-checkout self-pay accepts', () => {
	it('accepts a challenge with no feePayer', () => {
		const { extra, ...rest } = challengeAccept();
		const parsed = acceptSchema.parse({
			...rest,
			extra: { name: extra.name, decimals: extra.decimals },
		});
		expect(parsed.extra.feePayer).toBeUndefined();
		// Everything else still has to be there: self-pay changes who pays gas,
		// not where the money goes.
		expect(parsed.payTo).toBe(PAY_TO);
		expect(parsed.asset).toBe(USDC);
	});

	it('still validates feePayer when one IS supplied', () => {
		expect(() =>
			acceptSchema.parse(
				challengeAccept({ extra: { name: 'USDC', decimals: 6, feePayer: 'not-an-address' } }),
			),
		).toThrow();
	});

	it('still requires payTo and asset on a self-pay accept', () => {
		const { extra, payTo, ...rest } = challengeAccept();
		expect(() =>
			acceptSchema.parse({ ...rest, extra: { name: 'USDC', decimals: 6 } }),
		).toThrow();
	});
});
