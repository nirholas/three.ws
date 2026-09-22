// x402 ring payer-wallet POOL — a reused set of custodial payer wallets the ring
// tick rotates through so the closed-loop economy presents many distinct,
// attributed payers instead of one seed wallet, at NO extra per-settle cost.
//
// Design (see docs/x402-ring-economy.md "Payer pool"):
//   • REUSED, not throwaway. A fresh wallet per call would add a funding hop plus
//     ~0.00204 SOL of USDC-ATA rent EVERY settle and still cluster on-chain to the
//     one float that funds them. A reused pool pays that rent once per wallet, keeps
//     the settle on the 1-signature self-pay hot path, and rotates least-recently-
//     used-first so a few hundred wallets yield unlimited distinct-payer sequences.
//   • Membership is automatic. generatePoolWallets() mirrors every pubkey into
//     x402_ring_wallets(role='pool'), so ringAllowedAddresses() (the controlled
//     set), the on-chain leak scanner (classifies them INTERNAL), and the
//     facilitator allowlist all pick them up with no extra wiring.
//   • Sweepback-safe by construction. Pool wallets are NOT in solana-signers.js, so
//     the excess-mode treasury-sweepback never enumerates them — the exact bug that
//     was closing the treasury's USDC ATA and churning ~2.04M lamports of rent per
//     settle cannot recur across 1,000 pool wallets.
//   • Secrets never live in env. Each key is secret-box-encrypted at rest
//     (WALLET_ENCRYPTION_KEY + random per-record salt), decrypted only in-process
//     for the moment it signs.
//   • Funded-only rotation. The funder (pipelines/ring-pool-fund.js) records every
//     wallet's last on-chain SOL + USDC here on each run, and claimNextPayer()
//     only draws a wallet whose recorded balances cover the call it is about to
//     pay. A freshly minted pool is all zeros, so until the funder has moved
//     money the claim returns null and the tick keeps paying from the seed payer.
//     Without this gate, growing the pool to 2,000 wallets on 2026-09-22 handed
//     the tick empty wallets on its first 20 claims and every one of those
//     settles failed simulation.

import { Keypair } from '@solana/web3.js';
import { encryptSecret, decryptSecret } from '../secret-box.js';
import { sql as defaultSql } from '../db.js';
import { logger } from '../usage.js';

const log = logger('x402-ring-pool');

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

/**
 * SOL a claim assumes the settle will burn. A 1-signature self-pay settle costs
 * ~5k lamports base + priority fee (the ledger averages ~6.7k), so 10k leaves a
 * margin without over-reserving; the funder's next balance read corrects it.
 */
export const CLAIM_FEE_ESTIMATE_LAMPORTS = 10_000;

/**
 * Floors a pool wallet must clear to be handed to the tick as a payer.
 *   minSolLamports: enough for a few self-pay settles, not just one.
 *   maxBalanceAgeMinutes: a recorded balance older than this is not trusted;
 *                           the funder refreshes every run (120s cooldown), so a
 *                           stale row means the funder has not been running.
 */
export function poolClaimFloors() {
	return {
		minSolLamports: Math.floor(num(process.env.X402_RING_POOL_CLAIM_MIN_SOL_LAMPORTS, 20_000)),
		maxBalanceAgeMinutes: Math.max(1, Math.floor(num(process.env.X402_RING_POOL_BALANCE_MAX_AGE_MINUTES, 30))),
	};
}

/** True when the ring should rotate through the payer pool. Off by default. */
export function ringPoolEnabled() {
	return String(process.env.X402_RING_POOL_ENABLED || '').trim().toLowerCase() === 'true';
}

/** Target pool size (number of reused payer wallets). 0 disables growth. */
export function ringPoolTargetSize() {
	const n = Number(process.env.X402_RING_POOL_SIZE || 0);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Hard cap on how many wallets a single generate call will mint — a runaway-loop
 * backstop far above any real target. Env-tunable for an unusually large pool.
 */
export function ringPoolMaxGenerate() {
	const n = Number(process.env.X402_RING_POOL_MAX_GENERATE || 2000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

let _schemaReady = false;
/** Idempotent DDL guard (mirrors the migration; keeps standalone runs self-sufficient). */
export async function ensurePoolSchema(sql = defaultSql) {
	if (_schemaReady) return;
	await sql`
		CREATE TABLE IF NOT EXISTS x402_ring_pool (
			pubkey            text PRIMARY KEY,
			encrypted_secret  text NOT NULL,
			enabled           boolean NOT NULL DEFAULT true,
			last_used_at      timestamptz,
			use_count         bigint NOT NULL DEFAULT 0,
			created_at        timestamptz NOT NULL DEFAULT now()
		)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_ring_pool_rotation
		ON x402_ring_pool (enabled, last_used_at NULLS FIRST, pubkey)`;
	// Last recorded on-chain balances (migration 20260922230000). NULL = never
	// read, which the claim treats as unfunded.
	await sql`ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS last_sol_lamports bigint`;
	await sql`ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS last_usdc_atomic bigint`;
	await sql`ALTER TABLE x402_ring_pool ADD COLUMN IF NOT EXISTS balances_checked_at timestamptz`;
	_schemaReady = true;
}

/** Count of enabled pool wallets. */
export async function poolCount(sql = defaultSql) {
	await ensurePoolSchema(sql);
	const rows = await sql`SELECT count(*)::int AS n FROM x402_ring_pool WHERE enabled = true`;
	return rows[0]?.n ?? 0;
}

/**
 * Count of enabled pool wallets whose recorded balances would clear a claim for
 * `minUsdcAtomic` right now. This is the number that says whether the rotation
 * has anything to rotate through, which `poolCount` alone does not.
 */
export async function poolFundedCount(sql = defaultSql, { minUsdcAtomic = 0 } = {}) {
	await ensurePoolSchema(sql);
	const { minSolLamports, maxBalanceAgeMinutes } = poolClaimFloors();
	const minUsdc = Math.max(0, Math.floor(Number(minUsdcAtomic) || 0));
	const rows = await sql`
		SELECT count(*)::int AS n FROM x402_ring_pool
		WHERE enabled = true
		  AND last_sol_lamports >= ${minSolLamports}::bigint
		  AND last_usdc_atomic >= ${minUsdc}::bigint
		  AND balances_checked_at > now() - (${maxBalanceAgeMinutes}::int * interval '1 minute')`;
	return rows[0]?.n ?? 0;
}

/**
 * Record fresh on-chain balances for a batch of pool wallets in ONE round trip
 * (unnest, the same array-parameter shape agent-embeddings uses). The funder
 * calls this with every wallet it read, after applying the moves it just made,
 * so the claim always sees a balance at most one funder run old.
 *
 * @param {{ pubkey:string, solLamports:number|bigint, usdcAtomic:number|bigint }[]} entries
 * @returns {Promise<number>} rows updated
 */
export async function recordPoolBalances(entries, sql = defaultSql) {
	if (!entries?.length) return 0;
	await ensurePoolSchema(sql);
	const pubkeys = entries.map((e) => e.pubkey);
	const sols = entries.map((e) => clampAtomic(e.solLamports));
	const usdcs = entries.map((e) => clampAtomic(e.usdcAtomic));
	const rows = await sql`
		UPDATE x402_ring_pool p
		SET last_sol_lamports = v.sol::bigint,
		    last_usdc_atomic = v.usdc::bigint,
		    balances_checked_at = now()
		FROM unnest(${pubkeys}::text[], ${sols}::text[], ${usdcs}::text[]) AS v(pubkey, sol, usdc)
		WHERE p.pubkey = v.pubkey
		RETURNING p.pubkey`;
	return rows.length;
}

// A balance as a non-negative integer string, whatever numeric shape it arrived in.
function clampAtomic(v) {
	let b;
	try { b = typeof v === 'bigint' ? v : BigInt(Math.floor(Number(v) || 0)); } catch { b = 0n; }
	return (b < 0n ? 0n : b).toString();
}

/** All enabled pool pubkeys (for the funding pipeline's batched balance reads). */
export async function listEnabledPubkeys(sql = defaultSql) {
	await ensurePoolSchema(sql);
	const rows = await sql`SELECT pubkey FROM x402_ring_pool WHERE enabled = true ORDER BY pubkey`;
	return rows.map((r) => r.pubkey);
}

/** Recover a single pool keypair by pubkey (used by the funding pipeline to sweep an overfull wallet). */
export async function recoverPoolKeypair(pubkey, sql = defaultSql) {
	await ensurePoolSchema(sql);
	const rows = await sql`SELECT encrypted_secret FROM x402_ring_pool WHERE pubkey = ${pubkey} AND enabled = true LIMIT 1`;
	if (!rows[0]?.encrypted_secret) return null;
	return decodeKeypair(await decryptSecret(rows[0].encrypted_secret));
}

// Decode a base64-encoded 64-byte secret key into a Keypair.
function decodeKeypair(secretB64) {
	const raw = Buffer.from(secretB64, 'base64');
	if (raw.length !== 64) throw new Error(`pool key decode: expected 64 bytes, got ${raw.length}`);
	return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Generate `count` NEW pool wallets, encrypt each secret at rest, insert them into
 * x402_ring_pool, and mirror each pubkey into x402_ring_wallets(role='pool') so it
 * joins the controlled set immediately. Idempotent per pubkey (fresh keypairs never
 * collide, but the upsert is ON CONFLICT-safe). Returns the created pubkeys.
 *
 * @param {{ count:number, sql?:Function }} args
 */
export async function generatePoolWallets({ count, sql = defaultSql } = {}) {
	const n = Math.max(0, Math.min(Math.floor(Number(count) || 0), ringPoolMaxGenerate()));
	if (n === 0) return { created: [], total: await poolCount(sql) };
	await ensurePoolSchema(sql);

	const created = [];
	for (let i = 0; i < n; i++) {
		const kp = Keypair.generate();
		const pubkey = kp.publicKey.toBase58();
		const encrypted = await encryptSecret(Buffer.from(kp.secretKey).toString('base64'));
		// Insert the pool row and register membership in ONE round-trip pair. Both are
		// ON CONFLICT DO NOTHING so a re-run never duplicates or overwrites a wallet.
		await sql`
			INSERT INTO x402_ring_pool (pubkey, encrypted_secret)
			VALUES (${pubkey}, ${encrypted})
			ON CONFLICT (pubkey) DO NOTHING`;
		await sql`
			INSERT INTO x402_ring_wallets (pubkey, label, role, enabled, note)
			VALUES (${pubkey}, ${'ring-pool'}, ${'pool'}, ${true},
			        ${'reused rotating ring payer (x402_ring_pool)'})
			ON CONFLICT (pubkey) DO UPDATE SET role = 'pool', enabled = true`;
		created.push(pubkey);
	}
	const total = await poolCount(sql);
	log.info('ring_pool_generated', { created: created.length, total });
	return { created, total };
}

/**
 * Grow the pool up to `target` (default X402_RING_POOL_SIZE), minting only the
 * shortfall. Safe to call every provisioning run — it never shrinks or re-keys.
 */
export async function growPoolToTarget({ target, sql = defaultSql } = {}) {
	const want = Number.isFinite(target) && target > 0 ? Math.floor(target) : ringPoolTargetSize();
	if (want <= 0) return { created: [], total: await poolCount(sql), target: 0 };
	const current = await poolCount(sql);
	const shortfall = Math.max(0, want - current);
	if (shortfall === 0) return { created: [], total: current, target: want };
	const { created, total } = await generatePoolWallets({ count: shortfall, sql });
	return { created, total, target: want };
}

/**
 * Atomically claim the next payer wallet on a least-recently-used rotation, bump
 * its usage cursor, and return its decrypted Keypair. Concurrent ticks never pick
 * the same wallet (FOR UPDATE SKIP LOCKED). Only a FUNDED wallet is eligible: its
 * last recorded SOL must clear the claim floor, its last recorded USDC must cover
 * `minUsdcAtomic` (the price of the call about to be paid), and that record must
 * be fresh. The claim debits the recorded balances by the call price and a fee
 * estimate so a wallet is not handed out again before the funder re-reads it.
 * Returns null when no wallet qualifies (empty pool, unfunded pool, or a funder
 * that has stopped running); the caller falls back to the seed payer so the ring
 * never stalls.
 *
 * @param {Function} [sql]
 * @param {{ minUsdcAtomic?: number }} [opts]
 * @returns {Promise<{ keypair: Keypair, pubkey: string } | null>}
 */
export async function claimNextPayer(sql = defaultSql, { minUsdcAtomic = 0 } = {}) {
	await ensurePoolSchema(sql);
	const { minSolLamports, maxBalanceAgeMinutes } = poolClaimFloors();
	const minUsdc = Math.max(0, Math.floor(Number(minUsdcAtomic) || 0));
	const rows = await sql`
		UPDATE x402_ring_pool
		SET last_used_at = now(),
		    use_count = use_count + 1,
		    last_usdc_atomic = last_usdc_atomic - ${minUsdc}::bigint,
		    last_sol_lamports = last_sol_lamports - ${CLAIM_FEE_ESTIMATE_LAMPORTS}::bigint
		WHERE pubkey = (
			SELECT pubkey FROM x402_ring_pool
			WHERE enabled = true
			  AND last_sol_lamports >= ${minSolLamports}::bigint
			  AND last_usdc_atomic >= ${minUsdc}::bigint
			  AND balances_checked_at > now() - (${maxBalanceAgeMinutes}::int * interval '1 minute')
			ORDER BY last_used_at NULLS FIRST, pubkey
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING pubkey, encrypted_secret`;
	if (!rows[0]) return null;
	try {
		const keypair = decodeKeypair(await decryptSecret(rows[0].encrypted_secret));
		return { keypair, pubkey: rows[0].pubkey };
	} catch (err) {
		log.warn('ring_pool_claim_decrypt_failed', { pubkey: rows[0].pubkey, message: err?.message });
		return null;
	}
}
