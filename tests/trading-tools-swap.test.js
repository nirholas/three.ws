// Swap route comparison, wallet-outflow checks and the stale-quote guard, run
// against quote bodies recorded from the live aggregators
// (tests/fixtures/trading-tools/sol-usdc-quotes.json, see its recorded_at).

import { describe, it, expect } from 'vitest';
import {
	Keypair,
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	createTransferInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import fixture from './fixtures/trading-tools/sol-usdc-quotes.json' with { type: 'json' };
import {
	normalizeJupiter,
	normalizeLifi,
	normalizeRaydium,
	netOutcome,
	compareRoutes,
	parseDexChoice,
	feeAllowance,
	walletOutflows,
	decompileRouteTx,
} from '../api/_lib/trading-tools/swap-routes.js';
import { routeToTradeQuote, breakerImpact, freshPinnedRoute } from '../api/_lib/trading-tools/swap.js';
import { LEG_FEE_LAMPORTS } from '../api/_lib/trading-tools/arbitrage.js';
import { WSOL_MINT, USDC_MINT } from '../api/_lib/trading-tools/market.js';

const { amount_raw: amountRaw, slippage_bps: slippageBps } = fixture.pair;
const ctx = { inputMint: WSOL_MINT, outputMint: USDC_MINT, feeBps: 0, outDecimals: 6, outSymbol: 'USDC' };
const ok = (row) => ({ ...row, status: 'ok', latency_ms: 1 });

const jupiter = () => ok(normalizeJupiter(fixture.jupiter, { amountRaw, slippageBps }));
const lifi = () => ok(normalizeLifi(fixture.lifi, { amountRaw, slippageBps }));
const raydium = () => ok(normalizeRaydium(fixture.raydium, { amountRaw, slippageBps }));

describe('normalizers on recorded quotes', () => {
	it('reads the Jupiter quote as reported', () => {
		const r = jupiter();
		expect(r.aggregator).toBe('jupiter');
		expect(r.in_amount_raw).toBe(amountRaw);
		expect(r.out_amount_raw).toBe(fixture.jupiter.outAmount);
		expect(r.min_out_raw).toBe(fixture.jupiter.otherAmountThreshold);
		expect(r.price_impact_pct).toBeCloseTo(Number(fixture.jupiter.priceImpactPct) * 100, 10);
		expect(r.impact_source).toBe('reported');
		expect(r.route).toEqual(fixture.jupiter.routePlan.map((p) => p.swapInfo.label));
	});

	it('names a single-venue Jupiter route by its dex label', () => {
		const r = normalizeJupiter(fixture.jupiter, { amountRaw, slippageBps, dexLabel: 'Example' });
		expect(r.aggregator).toBe('dex:Example');
	});

	it('lists the LI.FI fixed fee as already deducted and keeps the rent deposit apart', () => {
		const r = lifi();
		expect(r.out_amount_raw).toBe(fixture.lifi.estimate.toAmount);
		const included = fixture.lifi.estimate.feeCosts.filter((f) => f.included !== false);
		expect(r.provider_fees).toHaveLength(included.length);
		for (const f of r.provider_fees) expect(f.already_deducted).toBe(true);
		// LI.FI names native SOL by the system program; it reads back as wrapped SOL.
		expect(r.provider_fees[0].mint).toBe(WSOL_MINT);
		const rent = fixture.lifi.estimate.feeCosts.filter((f) => f.included === false && /rent/i.test(f.name));
		expect(r.deposits_lamports).toBe(rent.reduce((s, f) => s + Number(f.amount), 0));
		expect(r.impact_source).toBe('derived_from_usd_values');
		expect(r.price_impact_pct).toBeGreaterThanOrEqual(0);
		expect(r.raw.tx).toBe(fixture.lifi.transactionRequest.data);
	});

	it('reads Raydium impact in percent and its pool fees as already inside the output', () => {
		const r = raydium();
		expect(r.out_amount_raw).toBe(String(fixture.raydium.data.outputAmount));
		expect(r.price_impact_pct).toBe(Math.max(0, Number(fixture.raydium.data.priceImpactPct)));
		expect(r.provider_fees.every((f) => f.name === 'Raydium pool fee' && f.already_deducted)).toBe(true);
	});

	it('turns a recorded Raydium liquidity refusal into a readable no_route', () => {
		let err;
		try {
			normalizeRaydium(fixture.raydium_no_route.body, { amountRaw: fixture.raydium_no_route.pair.amount_raw, slippageBps });
		} catch (e) {
			err = e;
		}
		expect(err.routeStatus).toBe('no_route');
		expect(err.message).toBe('no Raydium pool with enough liquidity for this pair');
	});

	it('refuses an empty LI.FI body as no_route', () => {
		expect(() => normalizeLifi({ message: 'No available quotes' }, { amountRaw, slippageBps })).toThrow('No available quotes');
	});
});

describe('netOutcome', () => {
	it('scales a SOL-input route to the SOL actually spent', () => {
		const r = jupiter();
		const n = netOutcome(r, { ...ctx, feeBps: 50 });
		const inRaw = BigInt(r.in_amount_raw);
		const fee = (inRaw * 50n) / 10_000n;
		const expected = (BigInt(r.out_amount_raw) * inRaw) / (inRaw + fee + BigInt(LEG_FEE_LAMPORTS));
		expect(n.net_out_raw).toBe(expected.toString());
		expect(n.costs.three_ws_fee_raw).toBe(fee.toString());
		expect(n.costs.three_ws_fee_mint).toBe(WSOL_MINT);
	});

	it('subtracts the fee and network cost from a SOL-output route', () => {
		const route = { in_amount_raw: '1000000', out_amount_raw: '9000000', provider_fees: [] };
		const n = netOutcome(route, { inputMint: USDC_MINT, outputMint: WSOL_MINT, feeBps: 100 });
		expect(n.net_out_raw).toBe(String(9_000_000 - 90_000 - LEG_FEE_LAMPORTS));
	});

	it('leaves a token-to-token route at router output and says the network fee is separate', () => {
		const route = { in_amount_raw: '1000000', out_amount_raw: '777', provider_fees: [] };
		const n = netOutcome(route, { inputMint: USDC_MINT, outputMint: 'THREEsynthetic1111111111111111111111111111', feeBps: 100 });
		expect(n.net_out_raw).toBe('777');
		expect(n.basis).toMatch(/listed separately/);
	});
});

describe('compareRoutes on the recorded quotes', () => {
	it('ranks every aggregator by net output and explains the winner', () => {
		const cmp = compareRoutes([jupiter(), lifi(), raydium()], ctx);
		const nets = cmp.routes.map((r) => BigInt(r.net_out_raw));
		for (let i = 1; i < nets.length; i++) expect(nets[i - 1] >= nets[i]).toBe(true);
		expect(cmp.routes).toHaveLength(3);
		expect(cmp.best).toBe(cmp.routes[0].aggregator);
		expect(cmp.selected.aggregator).toBe(cmp.best);
		expect(cmp.routes[0].vs_best_bps).toBe(0);
		expect(cmp.routes[1].vs_best_bps).toBeLessThanOrEqual(0);
		expect(cmp.why[0]).toMatch(new RegExp(`^${cmp.best} (delivers|and)`));
		// The LI.FI fee is called out by name; Raydium pool fees are not.
		expect(cmp.why.some((w) => /lifi charges a LIFI Fixed Fee of 0\.25%/.test(w))).toBe(true);
		expect(cmp.why.some((w) => /pool fee/i.test(w))).toBe(false);
	});

	it('reports a failed aggregator without dropping the others', () => {
		const cmp = compareRoutes([jupiter(), { aggregator: 'raydium', status: 'no_route', reason: 'no pool' }], ctx);
		expect(cmp.routes).toHaveLength(1);
		expect(cmp.unavailable).toEqual([{ aggregator: 'raydium', status: 'no_route', reason: 'no pool' }]);
		expect(cmp.why).toContain('jupiter is the only aggregator that priced this trade.');
		expect(cmp.why).toContain('raydium: no pool.');
	});

	it('honors a chosen aggregator and says what it costs against the best', () => {
		const all = [jupiter(), lifi(), raydium()];
		const best = compareRoutes(all, ctx);
		const worst = best.routes[best.routes.length - 1].aggregator;
		const cmp = compareRoutes(all, { ...ctx, chosen: worst });
		expect(cmp.selected.aggregator).toBe(worst);
		expect(cmp.best).toBe(best.best);
		if (worst !== best.best) expect(cmp.why.at(-1)).toMatch(new RegExp(`^You picked ${worst}; it returns [\\d.]+ bps less net than ${best.best}\\.$`));
	});

	it('calls an exact tie a tie', () => {
		const a = jupiter();
		const b = { ...raydium(), out_amount_raw: a.out_amount_raw, in_amount_raw: a.in_amount_raw, price_impact_pct: 5 };
		const cmp = compareRoutes([b, a], ctx);
		expect(cmp.why[0]).toMatch(/^jupiter and raydium tie at /);
	});
});

describe('parseDexChoice', () => {
	it('accepts auto, each aggregator and a dex label', () => {
		expect(parseDexChoice().aggregator).toBeNull();
		expect(parseDexChoice('lifi').aggregator).toBe('lifi');
		expect(parseDexChoice('dex:Some Pool V2')).toEqual({ choice: 'dex:Some Pool V2', aggregator: 'jupiter', dexLabel: 'Some Pool V2' });
	});

	it('refuses anything else', () => {
		expect(() => parseDexChoice('bogus')).toThrow(/dex must be one of/);
		expect(() => parseDexChoice('dex:<script>')).toThrow(/dex must be one of/);
	});
});

describe('wallet outflow checks', () => {
	const owner = Keypair.generate().publicKey;
	const stranger = Keypair.generate().publicKey;
	const mint = new PublicKey(USDC_MINT);

	it('allows only disclosed provider fees, never pool fees', () => {
		const allowed = feeAllowance([...lifi().provider_fees, ...raydium().provider_fees]);
		expect([...allowed.keys()]).toEqual([WSOL_MINT]);
		expect(allowed.get(WSOL_MINT)).toBe(BigInt(fixture.lifi.estimate.feeCosts.find((f) => f.included !== false).amount));
	});

	it('counts SOL sent to someone else and ignores the wallet funding its own accounts', () => {
		const ownWsol = getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT), owner, false);
		const fresh = Keypair.generate().publicKey;
		const ixs = [
			SystemProgram.transfer({ fromPubkey: owner, toPubkey: stranger, lamports: 1234 }),
			SystemProgram.transfer({ fromPubkey: owner, toPubkey: ownWsol, lamports: 10_000_000 }),
			SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: fresh, lamports: 2_039_280, space: 165, programId: SystemProgram.programId }),
			SystemProgram.transfer({ fromPubkey: owner, toPubkey: fresh, lamports: 5 }),
		];
		const flows = walletOutflows(ixs, { ownerPk: owner, inputMint: WSOL_MINT });
		expect(flows.lamports).toBe(1234n);
		expect(flows.destinations).toEqual([stranger.toBase58()]);
	});

	it('counts SPL transfers the owner signs, by mint', () => {
		const src = getAssociatedTokenAddressSync(mint, owner, false);
		const dst = getAssociatedTokenAddressSync(mint, stranger, false);
		const ixs = [
			createTransferInstruction(src, dst, owner, 700n),
			createTransferCheckedInstruction(src, mint, dst, owner, 300n, 6),
			createTransferInstruction(src, dst, stranger, 999n),
		];
		const flows = walletOutflows(ixs, { ownerPk: owner, inputMint: USDC_MINT });
		expect(flows.tokens.get(USDC_MINT)).toBe(1000n);
		expect(flows.lamports).toBe(0n);
	});

	const encode = (payer, ixs) => {
		const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: ixs }).compileToV0Message();
		return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
	};
	const conn = { getAddressLookupTable: async () => ({ value: null }) };

	it('refuses a route that needs more than one transaction', async () => {
		await expect(decompileRouteTx(['a', 'b'], { conn, ownerPk: owner, inputMint: WSOL_MINT })).rejects.toMatchObject({ code: 'multi_tx_route' });
	});

	it('refuses a transaction another wallet pays for or co-signs', async () => {
		const other = encode(stranger, [SystemProgram.transfer({ fromPubkey: stranger, toPubkey: owner, lamports: 1 })]);
		await expect(decompileRouteTx([other], { conn, ownerPk: owner, inputMint: WSOL_MINT })).rejects.toMatchObject({ code: 'unexpected_signer' });
		const cosigned = encode(owner, [SystemProgram.transfer({ fromPubkey: stranger, toPubkey: owner, lamports: 1 })]);
		await expect(decompileRouteTx([cosigned], { conn, ownerPk: owner, inputMint: WSOL_MINT })).rejects.toMatchObject({ code: 'unexpected_signer' });
	});

	it('refuses a transfer above the disclosed fees and passes one within them', async () => {
		const fee = lifi().provider_fees;
		const disclosed = feeAllowance(fee).get(WSOL_MINT);
		const over = encode(owner, [SystemProgram.transfer({ fromPubkey: owner, toPubkey: stranger, lamports: disclosed + 1n })]);
		await expect(decompileRouteTx([over], { conn, ownerPk: owner, inputMint: WSOL_MINT, providerFees: fee })).rejects.toMatchObject({
			code: 'unexpected_transfer',
			detail: { over: [{ asset: 'SOL', moved: String(disclosed + 1n), disclosed: String(disclosed) }] },
		});
		const within = encode(owner, [SystemProgram.transfer({ fromPubkey: owner, toPubkey: stranger, lamports: disclosed })]);
		const out = await decompileRouteTx([within], { conn, ownerPk: owner, inputMint: WSOL_MINT, providerFees: fee });
		expect(out.instructions).toHaveLength(1);
		expect(out.addressLookupTables).toEqual([]);
	});
});

describe('executor quote shape and the impact breaker input', () => {
	it('maps a buy route into the guarded executor quote', () => {
		const q = routeToTradeQuote(jupiter(), { side: 'buy', tokenDecimals: 6, impactPct: 0.1 });
		expect(q).toMatchObject({ venue: 'jupiter', inAsset: 'SOL', inAtomics: amountRaw, outAtomics: fixture.jupiter.outAmount, minOutAtomics: fixture.jupiter.otherAmountThreshold, priceImpactPct: 0.1 });
		expect(q.inAmount).toBe(Number(amountRaw) / 1e9);
	});

	it('maps a sell route with SOL as the output', () => {
		const route = { aggregator: 'lifi', in_amount_raw: '5000000', out_amount_raw: '45000000', min_out_raw: '44550000', route: [], raw: {} };
		const q = routeToTradeQuote(route, { side: 'sell', tokenDecimals: 6, impactPct: 0.2 });
		expect(q).toMatchObject({ inAsset: 'TOKEN', inUi: 5, outAsset: 'SOL', outUi: 0.045, minOutUi: 0.04455 });
	});

	it('borrows the worst impact another router reported when a route reports none', () => {
		const a = { ...lifi(), price_impact_pct: null };
		expect(breakerImpact(a, [a, { ...jupiter(), price_impact_pct: 0.4 }, { ...raydium(), price_impact_pct: 0.9 }])).toBe(0.9);
		expect(breakerImpact(a, [a])).toBeNull();
	});
});

describe('freshPinnedRoute never fills a stale quote', () => {
	const pin = {
		aggregator: 'jupiter', inputMint: WSOL_MINT, outputMint: USDC_MINT, amountRaw,
		slippageBps: 100, outRaw: '10978811', minOutRaw: '10869022',
	};
	const live = (out, minOut) => ({ ...jupiter(), out_amount_raw: String(out), min_out_raw: String(minOut) });

	it('fills when the live route still clears the approved minimum', async () => {
		const route = await freshPinnedRoute(pin, { userAddress: 'w', quote: async () => live(10_980_000, 10_870_200) });
		expect(route.out_amount_raw).toBe('10980000');
	});

	it('refuses when the live output fell below the approved minimum', async () => {
		await expect(freshPinnedRoute(pin, { userAddress: 'w', quote: async () => live(10_800_000, 10_692_000) })).rejects.toMatchObject({ status: 409, code: 'quote_moved' });
	});

	it('tightens slippage so the on-chain floor never drops below what was approved', async () => {
		const calls = [];
		const quote = async (_agg, args) => {
			calls.push(args.slippageBps);
			return calls.length === 1 ? live(10_900_000, 10_791_000) : live(10_900_000, 10_869_100);
		};
		const route = await freshPinnedRoute(pin, { userAddress: 'w', quote });
		const expectedBps = Number(((10_900_000n - 10_869_022n) * 10_000n) / 10_900_000n);
		expect(calls).toEqual([100, expectedBps]);
		expect(BigInt(route.min_out_raw) >= BigInt(pin.minOutRaw)).toBe(true);
	});

	it('refuses when the tightened re-quote still undercuts the approved minimum', async () => {
		let n = 0;
		const quote = async () => (++n === 1 ? live(10_900_000, 10_791_000) : live(10_900_000, 10_860_000));
		await expect(freshPinnedRoute(pin, { userAddress: 'w', quote })).rejects.toMatchObject({ code: 'quote_moved' });
	});

	it('refuses when the pinned route cannot be re-priced', async () => {
		await expect(freshPinnedRoute(pin, { userAddress: 'w', quote: async () => ({ aggregator: 'jupiter', status: 'unavailable', reason: 'could not be reached' }) })).rejects.toMatchObject({ status: 503, code: 'route_unavailable' });
	});
});
