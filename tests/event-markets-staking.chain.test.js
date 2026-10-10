// Full-cycle tests for contracts/event-markets-stake against a real local
// validator, with real transactions. Skipped unless STAKE_RPC_URL is set; run
// them with `npm run test:stake-program`, which builds the program, boots
// solana-test-validator with it loaded, and tears the validator down after.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, PublicKey } from '@solana/web3.js';
import {
	createMint, createAssociatedTokenAccountIdempotent, mintTo, getAccount,
	TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { build, configPda, decodeConfig, decodePool, decodePosition, poolPda, positionPda, programErrorName } from '../api/_lib/event-markets/staking/program.js';
import { payoutFor, previewStake, splitFee } from '../api/_lib/event-markets/staking/math.js';

const RPC = process.env.STAKE_RPC_URL;
const d = RPC ? describe : describe.skip;
const kp = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, 'utf8'))));

d('event_markets_stake on a local validator', () => {
	let conn, program, payer, authority, resolver, treasuryOwner, buybackOwner, mint, mint22;
	const FEE_BPS = 250, SHARE_BPS = 4000, DEC = 6;
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const now = async () => (await conn.getBlockTime(await conn.getSlot())) ?? Math.floor(Date.now() / 1000);

	async function send(ixs, signers) {
		const tx = new Transaction().add(...ixs);
		return sendAndConfirmTransaction(conn, tx, [payer, ...signers], { commitment: 'confirmed' });
	}
	/** Sends a tx that must fail and returns the program error name (or raw text). */
	async function fails(ixs, signers) {
		try { await send(ixs, signers); } catch (err) {
			const logs = (await err.getLogs?.(conn).catch(() => null)) ?? err.logs ?? [];
			return programErrorName({ message: err.message, logs }) ?? `${err.message} ${logs.join(' ')}`;
		}
		throw new Error('transaction unexpectedly succeeded');
	}
	/** Closes staking now through the resolver, so tests do not race a wall-clock lock. */
	const lockNow = (poolId) => send([build.lock(program, { resolver: resolver.publicKey, poolId })], [resolver]);
	async function waitUntil(ts) { while ((await now()) < ts) await sleep(400); }

	async function funded(m, amount, tokenProgram = TOKEN_PROGRAM_ID) {
		const k = Keypair.generate();
		await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed');
		await createAssociatedTokenAccountIdempotent(conn, payer, m, k.publicKey, undefined, tokenProgram);
		if (amount) await mintTo(conn, payer, m, getAssociatedTokenAddressSync(m, k.publicKey, false, tokenProgram), payer, amount, [], undefined, tokenProgram);
		return k;
	}
	const bal = async (m, owner, tp = TOKEN_PROGRAM_ID) => (await getAccount(conn, getAssociatedTokenAddressSync(m, new PublicKey(owner), true, tp), 'confirmed', tp)).amount;
	const pool = async (id) => decodePool((await conn.getAccountInfo(poolPda(program, id), 'confirmed')).data);

	async function newPool({ m = mint, tp = TOKEN_PROGRAM_ID, outcomes = 3, min = 1_000n, max = 5_000_000n, cap = 20_000_000n, lockIn = 600, voidIn = 1200 } = {}) {
		const poolId = randomBytes(32);
		const t = await now();
		await send([build.createPool(program, {
			resolver: resolver.publicKey, poolId, mint: m, outcomeCount: outcomes, minStake: min, maxStake: max, maxPool: cap,
			lockTs: t + lockIn, voidAfterTs: t + voidIn, tokenProgram: tp,
		})], [resolver]);
		return poolId;
	}
	const stake = (k, poolId, outcome, amount, m = mint, tp = TOKEN_PROGRAM_ID) =>
		send([build.stake(program, { staker: k.publicKey, poolId, mint: m, outcome, amount, tokenProgram: tp })], [k]);
	const stakeIx = (k, poolId, outcome, amount, m = mint) => build.stake(program, { staker: k.publicKey, poolId, mint: m, outcome, amount });

	beforeAll(async () => {
		conn = new Connection(RPC, 'confirmed');
		program = kp('contracts/event-markets-stake/target/deploy/event_markets_stake-keypair.json').publicKey;
		payer = Keypair.generate();
		await conn.confirmTransaction(await conn.requestAirdrop(payer.publicKey, 50 * LAMPORTS_PER_SOL), 'confirmed');
		[authority, resolver, treasuryOwner, buybackOwner] = await Promise.all([1, 2, 3, 4].map(async () => {
			const k = Keypair.generate();
			await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL), 'confirmed');
			return k;
		}));
		mint = await createMint(conn, payer, payer.publicKey, null, DEC);
		mint22 = await createMint(conn, payer, payer.publicKey, null, DEC, undefined, undefined, TOKEN_2022_PROGRAM_ID);
		for (const [m, tp] of [[mint, TOKEN_PROGRAM_ID], [mint22, TOKEN_2022_PROGRAM_ID]]) {
			await createAssociatedTokenAccountIdempotent(conn, payer, m, treasuryOwner.publicKey, undefined, tp);
			await createAssociatedTokenAccountIdempotent(conn, payer, m, buybackOwner.publicKey, undefined, tp);
		}
		await send([build.initialize(program, {
			authority: authority.publicKey, resolver: resolver.publicKey, treasury: treasuryOwner.publicKey,
			buyback: buybackOwner.publicKey, feeBps: FEE_BPS, buybackShareBps: SHARE_BPS,
		})], [authority]);
	}, 120_000);

	it('stores the config it was initialised with and refuses a second initialize', async () => {
		const cfg = decodeConfig((await conn.getAccountInfo(configPda(program))).data);
		expect(cfg.resolver.equals(resolver.publicKey)).toBe(true);
		expect([cfg.feeBps, cfg.buybackShareBps, cfg.paused]).toEqual([FEE_BPS, SHARE_BPS, false]);
		const e = await fails([build.initialize(program, { authority: authority.publicKey, resolver: resolver.publicKey, treasury: treasuryOwner.publicKey, buyback: buybackOwner.publicKey, feeBps: 1, buybackShareBps: 1 })], [authority]);
		expect(e).toMatch(/already in use|custom program error: 0x0/i);
	});

	it('runs stake, lock, resolve, claim to the base unit, matching the preview', async () => {
		const poolId = await newPool({ outcomes: 3 });
		const [a, b, c, e] = await Promise.all([funded(mint, 5_000_000n), funded(mint, 5_000_000n), funded(mint, 5_000_000n), funded(mint, 5_000_000n)]);
		const plan = [[a, 0, 700_001n], [b, 0, 300_333n], [c, 1, 1_000_007n], [e, 2, 333_331n]];
		const previews = [];
		for (const [k, o, amt] of plan) {
			const p = await pool(poolId);
			// Preview taken from the state the staker would see, BEFORE they stake.
			previews.push(previewStake({ totals: p.totals, feeBps: p.feeBps, buybackShareBps: p.buybackShareBps }, o, amt));
			await stake(k, poolId, o, amt);
		}
		let p = await pool(poolId);
		const total = plan.reduce((s, [, , x]) => s + x, 0n);
		expect(p.totalStaked).toBe(total);
		expect(p.totals).toEqual([1_000_334n, 1_000_007n, 333_331n]);
		expect(await bal(mint, poolPda(program, poolId))).toBe(total);
		expect(decodePosition((await conn.getAccountInfo(positionPda(program, poolPda(program, poolId), a.publicKey))).data).amount).toBe(700_001n);

		// Resolve is refused until the lock, and to anyone but the resolver.
		expect(await fails([build.resolve(program, { resolver: resolver.publicKey, poolId, mint, winningOutcome: 0, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey })], [resolver])).toBe('NotLocked');
		await lockNow(poolId);
		const impostor = await funded(mint, 0n);
		const resolveIx = (w, who = resolver) => build.resolve(program, { resolver: who.publicKey, poolId, mint, winningOutcome: w, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey });
		expect(await fails([resolveIx(0, impostor)], [impostor])).toBe('Unauthorized');
		expect(await fails([resolveIx(9)], [resolver])).toBe('BadOutcome');
		expect(await fails([stakeIx(a, poolId, 0, 1_000n)], [a])).toBe('Locked');

		const treasuryBefore = await bal(mint, treasuryOwner.publicKey), buybackBefore = await bal(mint, buybackOwner.publicKey);
		await send([resolveIx(0)], [resolver]);
		const fee = splitFee(total, FEE_BPS, SHARE_BPS);
		expect(await bal(mint, treasuryOwner.publicKey) - treasuryBefore).toBe(fee.treasury);
		expect(await bal(mint, buybackOwner.publicKey) - buybackBefore).toBe(fee.buyback);
		p = await pool(poolId);
		expect([p.statusName, p.winningOutcome, p.feePaid]).toEqual(['resolved', 0, fee.fee]);
		expect(await fails([resolveIx(0)], [resolver])).toBe('NotOpen');

		// Losers cannot claim; winners receive exactly the previewed and formula amount.
		expect(await fails([build.claim(program, { owner: c.publicKey, poolId, mint })], [c])).toBe('NotWinner');
		let paid = 0n;
		for (const [i, [k, o, amt]] of plan.entries()) {
			if (o !== 0) continue;
			const before = await bal(mint, k.publicKey);
			await send([build.claim(program, { owner: k.publicKey, poolId, mint })], [k]);
			const got = (await bal(mint, k.publicKey)) - before;
			expect(got).toBe(payoutFor(amt, total, fee.fee, 1_000_334n));
			paid += got;
			// The preview was priced before later stakes landed, so recompute against final totals.
			expect(previewStake({ totals: p.totals.map((t, j) => (j === 0 ? t - amt : t)), feeBps: FEE_BPS, buybackShareBps: SHARE_BPS }, 0, amt).payout).toBe(got);
			expect(previews[i].payout).toBeGreaterThan(0n);
			// A second claim finds a closed position.
			expect(await fails([build.claim(program, { owner: k.publicKey, poolId, mint })], [k])).toMatch(/AccountNotInitialized|3012/);
		}
		p = await pool(poolId);
		expect(p.paidOut).toBe(paid);
		const dust = (await bal(mint, poolPda(program, poolId)));
		expect(dust).toBe(total - fee.fee - paid);
		expect(dust).toBeLessThan(2n);
	}, 180_000);

	it('previews match what the program pays for the LAST staker too', async () => {
		const poolId = await newPool({ outcomes: 2 });
		const [a, b] = await Promise.all([funded(mint, 9_000_000n), funded(mint, 9_000_000n)]);
		await stake(a, poolId, 0, 1_234_567n);
		await stake(b, poolId, 1, 2_000_003n);
		const p0 = await pool(poolId);
		const preview = previewStake({ totals: p0.totals, feeBps: p0.feeBps, buybackShareBps: p0.buybackShareBps }, 1, 777_777n);
		await stake(b, poolId, 1, 777_777n);
		await waitUntil(p0.lockTs);
		await send([build.resolve(program, { resolver: resolver.publicKey, poolId, mint, winningOutcome: 1, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey })], [resolver]);
		const stakeTotal = 2_000_003n + 777_777n;
		const before = await bal(mint, b.publicKey);
		await send([build.claim(program, { owner: b.publicKey, poolId, mint })], [b]);
		const got = (await bal(mint, b.publicKey)) - before;
		const live = previewStake({ totals: [1_234_567n, 0n], feeBps: FEE_BPS, buybackShareBps: SHARE_BPS }, 1, stakeTotal);
		expect(got).toBe(live.payout);
		expect(preview.stake).toBe(777_777n);
	}, 120_000);

	it('refunds everyone in full, without a fee, when the resolver voids', async () => {
		const poolId = await newPool({ outcomes: 2 });
		const [a, b] = await Promise.all([funded(mint, 1_000_000n), funded(mint, 1_000_000n)]);
		await stake(a, poolId, 0, 400_000n);
		await stake(b, poolId, 1, 900_000n);
		const imp = await funded(mint, 0n);
		expect(await fails([build.voidPool(program, { resolver: imp.publicKey, poolId })], [imp])).toBe('Unauthorized');
		expect(await fails([build.refund(program, { owner: a.publicKey, poolId, mint })], [a])).toBe('NotVoid');
		await send([build.voidPool(program, { resolver: resolver.publicKey, poolId })], [resolver]);
		expect(await fails([stakeIx(a, poolId, 0, 1_000n)], [a])).toBe('NotOpen');
		for (const [k, amt] of [[a, 400_000n], [b, 900_000n]]) {
			await send([build.refund(program, { owner: k.publicKey, poolId, mint })], [k]);
			expect(await bal(mint, k.publicKey)).toBe(1_000_000n);
			expect(await fails([build.refund(program, { owner: k.publicKey, poolId, mint })], [k])).toMatch(/AccountNotInitialized|3012/);
		}
		expect(await bal(mint, poolPda(program, poolId))).toBe(0n);
	}, 120_000);

	it('voids and refunds when nobody picked the winner, and when everyone picked the same side', async () => {
		const empty = await newPool({ outcomes: 3 });
		const a = await funded(mint, 1_000_000n);
		await stake(a, empty, 0, 500_000n);
		await lockNow(empty);
		await send([build.resolve(program, { resolver: resolver.publicKey, poolId: empty, mint, winningOutcome: 2, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey })], [resolver]);
		expect((await pool(empty)).statusName).toBe('void');
		await send([build.refund(program, { owner: a.publicKey, poolId: empty, mint })], [a]);
		expect(await bal(mint, a.publicKey)).toBe(1_000_000n);

		const same = await newPool({ outcomes: 2 });
		const [x, y] = await Promise.all([funded(mint, 1_000_000n), funded(mint, 1_000_000n)]);
		await stake(x, same, 1, 300_000n);
		await stake(y, same, 1, 600_000n);
		await lockNow(same);
		const treasuryBefore = await bal(mint, treasuryOwner.publicKey);
		await send([build.resolve(program, { resolver: resolver.publicKey, poolId: same, mint, winningOutcome: 1, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey })], [resolver]);
		expect((await pool(same)).statusName).toBe('void');
		expect(await bal(mint, treasuryOwner.publicKey)).toBe(treasuryBefore);
		await send([build.refund(program, { owner: y.publicKey, poolId: same, mint })], [y]);
		expect(await bal(mint, y.publicKey)).toBe(1_000_000n);
	}, 120_000);

	it('lets anyone void a pool the resolver never resolved, only after the deadline', async () => {
		const [a, stranger] = await Promise.all([funded(mint, 1_000_000n), funded(mint, 0n)]);
		const poolId = await newPool({ outcomes: 2, lockIn: 18, voidIn: 20 });
		await stake(a, poolId, 0, 250_000n);
		expect(await fails([build.voidExpired(program, { poolId })], [stranger])).toBe('NotExpired');
		const p = await pool(poolId);
		await waitUntil(p.voidAfterTs);
		expect(await fails([build.resolve(program, { resolver: resolver.publicKey, poolId, mint, winningOutcome: 0, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey })], [resolver])).toBe('Expired');
		await send([build.voidExpired(program, { poolId })], [stranger]);
		await send([build.refund(program, { owner: a.publicKey, poolId, mint })], [a]);
		expect(await bal(mint, a.publicKey)).toBe(1_000_000n);
	}, 120_000);

	it('enforces every stake limit', async () => {
		const poolId = await newPool({ outcomes: 2, min: 10_000n, max: 100_000n, cap: 150_000n });
		const [a, b] = await Promise.all([funded(mint, 1_000_000n), funded(mint, 1_000_000n)]);
		expect(await fails([stakeIx(a, poolId, 0, 9_999n)], [a])).toBe('BelowMinimum');
		expect(await fails([stakeIx(a, poolId, 5, 10_000n)], [a])).toBe('BadOutcome');
		expect(await fails([stakeIx(a, poolId, 0, 100_001n)], [a])).toBe('OverStakeCap');
		await stake(a, poolId, 0, 100_000n);
		expect(await fails([stakeIx(a, poolId, 0, 10_000n)], [a])).toBe('OverStakeCap');
		expect(await fails([stakeIx(a, poolId, 1, 10_000n)], [a])).toMatch(/OutcomeMismatch|OverStakeCap/);
		expect(await fails([stakeIx(b, poolId, 1, 60_000n)], [b])).toBe('OverPoolCap');
		await stake(b, poolId, 1, 50_000n);
		expect(await fails([stakeIx(b, poolId, 0, 10_000n)], [b])).toBe('OutcomeMismatch');
	}, 120_000);

	it('rejects bad pool parameters and non-resolver pool creation', async () => {
		const t = await now();
		const base = { resolver: resolver.publicKey, poolId: randomBytes(32), mint, outcomeCount: 2, minStake: 1n, maxStake: 10n, maxPool: 100n, lockTs: t + 60, voidAfterTs: t + 120 };
		const make = (o, who = resolver) => fails([build.createPool(program, { ...base, poolId: randomBytes(32), ...o, resolver: who.publicKey })], [who]);
		expect(await make({ outcomeCount: 1 })).toBe('BadOutcomeCount');
		expect(await make({ outcomeCount: 17 })).toBe('BadOutcomeCount');
		expect(await make({ minStake: 0n })).toBe('BadLimits');
		expect(await make({ minStake: 11n })).toBe('BadLimits');
		expect(await make({ maxPool: 5n })).toBe('BadLimits');
		expect(await make({ lockTs: t - 5 })).toBe('BadTimes');
		expect(await make({ voidAfterTs: t + 30 })).toBe('BadTimes');
		const imp = await funded(mint, 0n);
		expect(await make({}, imp)).toBe('Unauthorized');
	}, 60_000);

	it('gates config changes to the authority and caps the fee at 10%', async () => {
		const imp = await funded(mint, 0n);
		expect(await fails([build.setConfig(program, { authority: imp.publicKey, paused: true })], [imp])).toBe('Unauthorized');
		expect(await fails([build.setConfig(program, { authority: authority.publicKey, feeBps: 1_001 })], [authority])).toBe('FeeTooHigh');
		expect(await fails([build.setConfig(program, { authority: authority.publicKey, buybackShareBps: 10_001 })], [authority])).toBe('BadSplit');
	}, 60_000);

	it('the kill switch stops new pools and stakes instantly but never blocks claims or refunds', async () => {
		const poolId = await newPool({ outcomes: 2 });
		const [a, b] = await Promise.all([funded(mint, 1_000_000n), funded(mint, 1_000_000n)]);
		await stake(a, poolId, 0, 200_000n);
		await stake(b, poolId, 1, 100_000n);
		await send([build.setConfig(program, { authority: authority.publicKey, paused: true })], [authority]);
		try {
			expect(await fails([stakeIx(b, poolId, 1, 10_000n)], [b])).toBe('Paused');
			const t = await now();
			expect(await fails([build.createPool(program, { resolver: resolver.publicKey, poolId: randomBytes(32), mint, outcomeCount: 2, minStake: 1n, maxStake: 10n, maxPool: 10n, lockTs: t + 60, voidAfterTs: t + 120 })], [resolver])).toBe('Paused');
			await lockNow(poolId);
			await send([build.resolve(program, { resolver: resolver.publicKey, poolId, mint, winningOutcome: 0, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey })], [resolver]);
			await send([build.claim(program, { owner: a.publicKey, poolId, mint })], [a]);
			expect(await bal(mint, a.publicKey)).toBeGreaterThan(1_000_000n - 200_000n);
		} finally {
			await send([build.setConfig(program, { authority: authority.publicKey, paused: false })], [authority]);
		}
	}, 120_000);

	it('lets the resolver close staking early and never reopen it', async () => {
		const poolId = await newPool({ outcomes: 2, lockIn: 600, voidIn: 1200 });
		const a = await funded(mint, 1_000_000n);
		await stake(a, poolId, 0, 10_000n);
		await send([build.lock(program, { resolver: resolver.publicKey, poolId })], [resolver]);
		expect(await fails([stakeIx(a, poolId, 0, 10_000n)], [a])).toBe('Locked');
		const imp = await funded(mint, 0n);
		expect(await fails([build.lock(program, { resolver: imp.publicKey, poolId })], [imp])).toBe('Unauthorized');
		await sleep(1_500);
		expect(await fails([build.claim(program, { owner: a.publicKey, poolId, mint })], [a])).toBe('NotResolved');
	}, 60_000);

	it('works end to end with a Token-2022 mint', async () => {
		const poolId = await newPool({ m: mint22, tp: TOKEN_2022_PROGRAM_ID, outcomes: 2 });
		const [a, b] = await Promise.all([funded(mint22, 1_000_000n, TOKEN_2022_PROGRAM_ID), funded(mint22, 1_000_000n, TOKEN_2022_PROGRAM_ID)]);
		await stake(a, poolId, 0, 400_000n, mint22, TOKEN_2022_PROGRAM_ID);
		await stake(b, poolId, 1, 600_000n, mint22, TOKEN_2022_PROGRAM_ID);
		await lockNow(poolId);
		await send([build.resolve(program, { resolver: resolver.publicKey, poolId, mint: mint22, winningOutcome: 1, treasuryOwner: treasuryOwner.publicKey, buybackOwner: buybackOwner.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID })], [resolver]);
		const before = await bal(mint22, b.publicKey, TOKEN_2022_PROGRAM_ID);
		await send([build.claim(program, { owner: b.publicKey, poolId, mint: mint22, tokenProgram: TOKEN_2022_PROGRAM_ID })], [b]);
		const fee = splitFee(1_000_000n, FEE_BPS, SHARE_BPS);
		expect((await bal(mint22, b.publicKey, TOKEN_2022_PROGRAM_ID)) - before).toBe(payoutFor(600_000n, 1_000_000n, fee.fee, 600_000n));
	}, 120_000);
});
