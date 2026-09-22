// api/_lib/x402/fresh-workers/wallets.js
//
// The x402_fresh_wallets store: mint a brand-new keypair with its secret
// encrypted at rest, walk it through its states, hand stranded work to the
// next tick, and answer the public stats the /data-desk page shows.
//
// Every state change bumps updated_at, which is also the reclaim lock: a
// reclaim pass only claims rows nobody has touched for the configured window,
// so two instances never sweep the same wallet at once.

import { Keypair, PublicKey } from '@solana/web3.js';

import { encryptSecret, decryptSecret } from '../../secret-box.js';
import { sql as defaultSql } from '../../db.js';
import { usdcAtaOf } from './chain.js';

let _schemaReady = false;
/** Idempotent DDL guard mirroring the migration, so a first tick before the migration lands still works. */
export async function ensureFreshSchema(sql = defaultSql) {
	if (_schemaReady) return;
	await sql`
		CREATE TABLE IF NOT EXISTS x402_fresh_wallets (
			id                      bigserial PRIMARY KEY,
			pubkey                  text NOT NULL UNIQUE,
			usdc_ata                text NOT NULL,
			encrypted_secret        text NOT NULL,
			state                   text NOT NULL DEFAULT 'minted',
			job_kind                text NOT NULL,
			job_slug                text NOT NULL,
			job_title               text,
			sol_funded_lamports     bigint NOT NULL DEFAULT 0,
			usdc_funded_atomic      bigint NOT NULL DEFAULT 0,
			fund_sig                text,
			pay_sig                 text,
			amount_atomic           bigint NOT NULL DEFAULT 0,
			sweep_sig               text,
			sol_reclaimed_lamports  bigint NOT NULL DEFAULT 0,
			usdc_returned_atomic    bigint NOT NULL DEFAULT 0,
			rent_reclaimed_lamports bigint NOT NULL DEFAULT 0,
			attempts                int NOT NULL DEFAULT 0,
			error                   text,
			run_id                  uuid,
			created_at              timestamptz NOT NULL DEFAULT now(),
			updated_at              timestamptz NOT NULL DEFAULT now(),
			funded_at               timestamptz,
			paid_at                 timestamptz,
			closed_at               timestamptz
		)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_fresh_wallets_state_updated ON x402_fresh_wallets (state, updated_at)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_fresh_wallets_created ON x402_fresh_wallets (created_at DESC)`;
	_schemaReady = true;
}

function decodeKeypair(secretB64) {
	const raw = Buffer.from(secretB64, 'base64');
	if (raw.length !== 64) throw new Error(`fresh wallet key decode: expected 64 bytes, got ${raw.length}`);
	return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Mint one never-used wallet for a job and record it as 'minted'. The secret is
 * encrypted before it is written and the plaintext keypair lives only in the
 * returned object for the tick that uses it.
 */
export async function mintWallet({ sql = defaultSql, job, mint, runId }) {
	const keypair = Keypair.generate();
	const pubkey = keypair.publicKey.toBase58();
	const ata = usdcAtaOf(keypair.publicKey, mint).toBase58();
	const encrypted = await encryptSecret(Buffer.from(keypair.secretKey).toString('base64'));
	const rows = await sql`
		INSERT INTO x402_fresh_wallets (pubkey, usdc_ata, encrypted_secret, state, job_kind, job_slug, job_title, run_id)
		VALUES (${pubkey}, ${ata}, ${encrypted}, 'minted', ${job.kind}, ${job.slug}, ${job.title}, ${runId})
		RETURNING id`;
	return { id: rows[0].id, pubkey, ata, keypair, job };
}

export async function recoverKeypair(encryptedSecret) {
	return decodeKeypair(await decryptSecret(encryptedSecret));
}

const clip = (s) => (s == null ? null : String(s).slice(0, 400));

export async function markFunded(sql, ids, { fundSig, solLamports, usdcAtomicById }) {
	for (const id of ids) {
		await sql`
			UPDATE x402_fresh_wallets
			SET state = 'funded', fund_sig = ${fundSig}, sol_funded_lamports = ${solLamports},
			    usdc_funded_atomic = ${Number(usdcAtomicById.get(id) ?? 0)},
			    funded_at = now(), updated_at = now()
			WHERE id = ${id}`;
	}
}

export async function markFundFailed(sql, ids, error) {
	for (const id of ids) {
		await sql`UPDATE x402_fresh_wallets SET state = 'fund_failed', error = ${clip(error)}, updated_at = now() WHERE id = ${id}`;
	}
}

export async function markPaid(sql, id, { paySig, amountAtomic }) {
	await sql`
		UPDATE x402_fresh_wallets
		SET state = 'paid', pay_sig = ${paySig || null}, amount_atomic = ${Number(amountAtomic || 0)},
		    paid_at = now(), updated_at = now(), error = NULL
		WHERE id = ${id}`;
}

export async function markPayFailed(sql, id, error) {
	await sql`UPDATE x402_fresh_wallets SET state = 'pay_failed', error = ${clip(error)}, updated_at = now() WHERE id = ${id}`;
}

export async function markClosed(sql, id, { sweepSig, solLamports, usdcAtomic, rentLamports }) {
	await sql`
		UPDATE x402_fresh_wallets
		SET state = 'closed', sweep_sig = ${sweepSig || null},
		    sol_reclaimed_lamports = ${Number(solLamports || 0)},
		    usdc_returned_atomic = ${Number(usdcAtomic || 0)},
		    rent_reclaimed_lamports = ${Number(rentLamports || 0)},
		    closed_at = now(), updated_at = now(), error = NULL
		WHERE id = ${id}`;
}

export async function markSweepFailed(sql, id, error) {
	await sql`UPDATE x402_fresh_wallets SET state = 'sweep_failed', error = ${clip(error)}, updated_at = now() WHERE id = ${id}`;
}

export async function markStranded(sql, id, error) {
	await sql`UPDATE x402_fresh_wallets SET state = 'stranded', error = ${clip(error)}, updated_at = now() WHERE id = ${id}`;
}

/**
 * Claim wallets a previous tick left mid-flight: funded but never paid, paid
 * but never swept, or whose sweep failed. The claim bumps attempts and
 * updated_at in the same statement, so a concurrent instance sees them as
 * freshly touched and leaves them alone.
 */
export async function claimReclaimable({ sql = defaultSql, reclaimAfterS, limit }) {
	return sql`
		UPDATE x402_fresh_wallets
		SET attempts = attempts + 1, updated_at = now()
		WHERE id IN (
			SELECT id FROM x402_fresh_wallets
			WHERE state IN ('funded', 'paid', 'pay_failed', 'sweep_failed')
			  AND updated_at < now() - make_interval(secs => ${reclaimAfterS})
			ORDER BY updated_at ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, pubkey, usdc_ata, encrypted_secret, state, attempts, pay_sig, job_kind, job_slug`;
}

/** USDC the lane has spent so far this UTC day, from the shared call log. */
export async function dailySpentAtomic(sql = defaultSql) {
	const rows = await sql`
		SELECT COALESCE(SUM(amount_atomic), 0)::bigint AS spent
		FROM x402_autonomous_log
		WHERE pipeline = 'fresh-workers' AND ts >= date_trunc('day', now())`;
	return Number(rows[0]?.spent || 0);
}

/** Public, key-free lane statistics for the last 24 hours and all time. */
export async function laneStats(sql = defaultSql) {
	const [day] = await sql`
		SELECT count(*)::int AS minted,
		       count(*) FILTER (WHERE state = 'closed')::int AS closed,
		       count(*) FILTER (WHERE state IN ('paid', 'closed') AND pay_sig IS NOT NULL)::int AS paid,
		       count(*) FILTER (WHERE job_kind = 'forge' AND pay_sig IS NOT NULL)::int AS forge_jobs,
		       count(*) FILTER (WHERE job_kind = 'data' AND pay_sig IS NOT NULL)::int AS data_jobs,
		       count(*) FILTER (WHERE state IN ('funded', 'paid', 'pay_failed', 'sweep_failed'))::int AS in_flight,
		       count(*) FILTER (WHERE state = 'stranded')::int AS stranded,
		       coalesce(sum(amount_atomic), 0)::bigint AS spent_atomic,
		       coalesce(sum(sol_funded_lamports) FILTER (WHERE state = 'closed'), 0)::bigint AS sol_out,
		       coalesce(sum(sol_reclaimed_lamports) FILTER (WHERE state = 'closed'), 0)::bigint AS sol_back,
		       coalesce(sum(rent_reclaimed_lamports), 0)::bigint AS rent_back,
		       max(closed_at) AS last_closed_at
		FROM x402_fresh_wallets
		WHERE created_at > now() - interval '24 hours'`;
	const [all] = await sql`
		SELECT count(*)::int AS minted,
		       count(*) FILTER (WHERE state = 'closed')::int AS closed,
		       count(*) FILTER (WHERE pay_sig IS NOT NULL)::int AS paid,
		       coalesce(sum(amount_atomic), 0)::bigint AS spent_atomic
		FROM x402_fresh_wallets`;
	const toNum = (v) => Number(v || 0);
	return {
		last_24h: {
			wallets_minted: day.minted,
			wallets_closed: day.closed,
			jobs_paid: day.paid,
			forge_jobs: day.forge_jobs,
			data_jobs: day.data_jobs,
			in_flight: day.in_flight,
			stranded: day.stranded,
			spent_usdc: toNum(day.spent_atomic) / 1e6,
			// SOL the closed wallets burned as network fees: what they were given
			// minus what came back. Rent is excluded because it round-trips.
			sol_fees: Math.max(0, toNum(day.sol_out) - toNum(day.sol_back)) / 1e9,
			rent_recycled_sol: toNum(day.rent_back) / 1e9,
			last_closed_at: day.last_closed_at,
		},
		all_time: {
			wallets_minted: all.minted,
			wallets_closed: all.closed,
			jobs_paid: all.paid,
			spent_usdc: toNum(all.spent_atomic) / 1e6,
		},
	};
}

export { PublicKey };
