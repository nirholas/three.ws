// GET /api/cron/x402-seed-cron
//
// Economy-tick cron that seeds the x402 activity feed with up to 60 real Solana
// micropayments per tick, fired in parallel. The sponsor pays each payment's
// SOL fee, so the batch is capped at what the wallet fee governor will admit
// after leaving X402_SEED_FEE_RESERVE_LAMPORTS for the paid pipelines.
//
// Each invocation:
//   1. Loads the seeder keypair (X402_SEED_SOLANA_SECRET_BASE58 or fallback).
//   2. Probes /api/x402/dance-tip once to get live payment requirements.
//   3. Fetches a single blockhash + mint info shared across the batch.
//   4. Sizes the batch to the payer's balance and the sponsor's fee budget.
//   5. Builds that many signed TransferChecked transactions (synchronous).
//   6. Fires them in parallel against dance-tip with X-PAYMENT headers.
//
// The payments are real on-chain USDC transfers from the seeder wallet.
// The Solana x402 facilitator co-signs (feePayer) and broadcasts each tx.
// Every successful tip is inserted into club_tips + the x402 activity feed.
//
// Env:
//   X402_SEED_SOLANA_SECRET_BASE58   base58 64-byte ed25519 seeder keypair
//   X402_SEED_ENABLED                set to 'false' to pause (default: enabled)
//   X402_SEED_BATCH_SIZE             calls per tick (default: 60)
//   X402_SEED_FEE_RESERVE_LAMPORTS   fee-wallet budget the seeder leaves for
//                                    paid pipelines (default: 200000)

// The transactions come from the ONE shared ring payment builder
// (api/_lib/x402/pay.js), whose nonce-based (priority price, CU limit) spread
// keeps every batch member byte-distinct; this cron previously carried a forked
// copy that only accepted base58 keys and priced fees above the ring floor.

import { PublicKey } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getMint,
} from '@solana/spl-token';

import { json, method, wrapCron } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { getRedis, isRedisAuthError } from '../_lib/redis.js';
import { isTransientRpcError, solanaConnection } from '../_lib/solana/connection.js';
import { logger } from '../_lib/usage.js';
import { SPONSOR_SOL_FLOOR_LAMPORTS } from '../_lib/x402/self-facilitator.js';
import {
	loadSeedKeypair, fetchWithTimeout, parseSolanaAccept, buildPaymentTx,
	ringFeeConfig, expectedFeeLamports, nextAutoNonce, RING_CU_JITTER_SLOTS,
} from '../_lib/x402/pay.js';
import { reserveFeeAdmissions } from '../_lib/x402/wallet-fee-meter.js';
import { readPayerUsdcAtomic } from './x402-autonomous-loop.js';
import { requireCron } from '../_lib/cron-auth.js';

const log = logger('x402-seed-cron');

const ORIGIN = () => env.APP_ORIGIN || 'https://three.ws';
const USDC_MINT = env.X402_ASSET_MINT_SOLANA;
const SOLANA_RPC = env.SOLANA_RPC_URL;

// Mirror of x402-pay.js FEED_KEY so our seeded payments appear on the /pay feed.
const FEED_KEY = 'x402:pay:feed';
const FEED_MAX = 50;

const DANCERS = ['1', '2', '3', '4'];
const STYLES = [
	'hiphop', 'rumba', 'silly', 'thriller', 'capoeira',
	'twerk', 'spin', 'climb', 'combo',
];

// Pick a random element from an array.
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Parse a 402 challenge body to find the Solana accept entry.

/**
 * Decide what a tick should actually send, from the two wallet balances that
 * determine whether a payment can succeed at all.
 *
 * Every call in a batch shares one sponsor (pays the SOL fee) and one payer
 * (pays the USDC), so both conditions are decided before the first transaction
 * is built. Without this gate a dry treasury turns each tick into `batchSize`
 * doomed payments: observed 2026-07-26, 6,314 `fee_wallet_below_floor` settle
 * failures and 745 `simulation_failed` verify rejects, i.e. hours of 502s on
 * /api/x402/dance-tip plus wasted RPC, for an outcome fixed in advance. The
 * ring tick and the autonomous loop already gate on these; the seeder was the
 * last paid lane that did not.
 *
 * A `null` balance means the read FAILED, not zero. Unknown leaves the path
 * open (the same contract readPayerUsdcAtomic documents) so that a transient
 * RPC blip can never silently halt seeding.
 *
 * @param {object} a
 * @param {number|null} a.sponsorSolLamports  fee payer's SOL, or null if unread
 * @param {number|null} a.payerUsdcAtomic     seeder's USDC (6dp), or null if unread
 * @param {number} a.priceAtomic              price of one call, atomic USDC
 * @param {number} a.batchSize                configured calls per tick
 * @returns {{ skip: string|null, batch: number }} `skip` names the blocking
 *   condition (and `batch` is 0); otherwise `batch` is what the payer can fund.
 */
export function planSeedBatch({ sponsorSolLamports, payerUsdcAtomic, priceAtomic, batchSize }) {
	if (sponsorSolLamports !== null && sponsorSolLamports < SPONSOR_SOL_FLOOR_LAMPORTS) {
		return { skip: 'sponsor_sol_below_floor', batch: 0 };
	}
	// A price of 0 would make "how many can we afford" meaningless; treat an
	// unusable price as unknown and let the configured batch stand.
	if (!Number.isFinite(priceAtomic) || priceAtomic <= 0 || payerUsdcAtomic === null) {
		return { skip: null, batch: batchSize };
	}
	const affordable = Math.floor(payerUsdcAtomic / priceAtomic);
	if (affordable < 1) return { skip: 'payer_usdc_exhausted', batch: 0 };
	// Right-size rather than overshoot: a float that funds 12 of 60 tips should
	// send 12 real payments, not 60 of which 48 fail at verify.
	return { skip: null, batch: Math.min(batchSize, affordable) };
}

// The seeder's fee headroom: how much of the sponsor's daily fee budget it must
// leave untouched for the pipelines that pay for real data. Default 200,000
// lamports, twenty sponsor-mode settles, the same size as the governor's
// top-of-day pacing slice. 0 lets the seeder compete for every lamport.
export function seedFeeReserveLamports(e = process.env) {
	const raw = String(e.X402_SEED_FEE_RESERVE_LAMPORTS ?? '').trim();
	const n = Number(raw);
	return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200_000;
}

// Sponsor mode may only use the price slots whose priority floors to zero
// lamports (see ringFeeConfig in api/_lib/x402/pay.js).
const SPONSOR_PRICE_SLOTS = 11;

// Worst-case SOL fee of one seed payment. The batch starts at a random nonce, so
// every admission is priced at the dearest sponsor-mode fee config there is: the
// highest price slot at the largest compute limit, which ringFeeConfig reaches at
// the top of its jitter range. Same expectedFeeLamports() math payX402 uses.
export function seedFeeEstimateLamports() {
	let worst = 0;
	for (let slot = 0; slot < SPONSOR_PRICE_SLOTS; slot += 1) {
		const { microLamports, cuLimit } = ringFeeConfig(
			SPONSOR_PRICE_SLOTS * (RING_CU_JITTER_SLOTS - 1) + slot, { selfPay: false },
		);
		worst = Math.max(worst, expectedFeeLamports({
			selfPay: false, priorityMicrolamports: microLamports, cuLimit,
		}));
	}
	return worst;
}

// Push an entry to the shared x402 activity feed in Redis.
async function pushFeedEntry(entry) {
	const r = getRedis();
	if (!r) return;
	try {
		await r.lpush(FEED_KEY, JSON.stringify(entry));
		await r.ltrim(FEED_KEY, 0, FEED_MAX - 1);
	} catch (err) {
		log.warn('feed_push_failed', { message: err?.message });
	}
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	if (process.env.X402_SEED_ENABLED === 'false') {
		return json(res, 200, { ok: true, skipped: true, reason: 'X402_SEED_ENABLED=false' });
	}

	const BATCH_SIZE = Math.max(1, Math.min(
		120,
		Number(process.env.X402_SEED_BATCH_SIZE || 60),
	));

	const origin = ORIGIN();

	// ── Pre-flight: verify Redis is reachable ─────────────────────────────────
	// The dance-tip payment handler uses the x402VerifyIp rate-limiter which is
	// CRITICAL (fails closed when Redis is unavailable). If Redis is down, every
	// payment in the batch will return 429 — generating thousands of useless
	// errors and burning Solana RPC calls. Skip the tick entirely when Redis is
	// unhealthy so the cron stays silent rather than flooding logs.
	const redis = getRedis();
	if (redis) {
		try {
			await redis.ping();
		} catch (err) {
			if (!err?.circuitOpen && !isRedisAuthError(err)) log.warn('redis_unavailable_skip', { message: err?.message });
			return json(res, 200, { ok: false, skipped: true, reason: `redis_unavailable: ${err?.message}` });
		}
	}

	// ── Step 1: probe dance-tip for live payment requirements ─────────────────
	const probeUrl = `${origin}/api/x402/dance-tip?dancer=1&dance=hiphop`;
	// A probe that aborts or cannot connect has spent nothing and left nothing to
	// seed, so it reports the skip like the gates around it. Left unguarded, the
	// abort escaped as an HTTP 500 and an ops alert on a slow self-call.
	let probe;
	try {
		probe = await fetchWithTimeout(probeUrl, {
			headers: { 'user-agent': 'threews-x402-seed/1.0' },
		});
	} catch (err) {
		log.warn('probe_failed_skip', { message: err?.message });
		return json(res, 200, { ok: false, skipped: true, reason: `dance-tip probe failed: ${err?.message}` });
	}
	if (probe.status !== 402 || !probe.body) {
		return json(res, 200, {
			ok: false,
			reason: `dance-tip probe returned ${probe.status} (expected 402)`,
		});
	}
	const accept = parseSolanaAccept(probe.body);
	if (!accept) {
		return json(res, 200, { ok: false, reason: 'no Solana accept in 402 challenge' });
	}
	if (!accept.extra?.feePayer) {
		return json(res, 200, { ok: false, reason: 'Solana accept missing feePayer' });
	}
	if (!USDC_MINT || accept.asset !== USDC_MINT) {
		return json(res, 200, {
			ok: false,
			reason: `unexpected asset in accept: ${accept.asset} (expected ${USDC_MINT})`,
		});
	}

	// ── Step 2: load keypair, fetch shared blockhash + mint info ──────────────
	let buyer;
	try { buyer = loadSeedKeypair(); } catch (err) {
		return json(res, 200, { ok: false, reason: err.message });
	}

	const conn = solanaConnection({ url: SOLANA_RPC, commitment: 'confirmed' });
	// The two balance reads ride along in this batch, so the preflight below
	// costs no extra wall-clock on a healthy tick.
	//
	// The whole preflight is one RPC round and it is the cron's only network
	// dependency, so an exhausted RPC chain used to escape as an unhandled
	// throw: 608 HTTP 500s and as many ops alerts in the week to 2026-08-27,
	// every one of them "failed to get recent blockhash: fetch failed". A tick
	// that cannot read the chain has nothing to seed; it reports the skip like
	// the Redis and keypair gates above and the next tick tries again.
	let blockhash, mintInfo, receiverAtaInfo, sponsorSolLamports, payerUsdcAtomic;
	try {
		[{ blockhash }, mintInfo, receiverAtaInfo, sponsorSolLamports, payerUsdcAtomic] =
			await Promise.all([
				conn.getLatestBlockhash('confirmed'),
				getMint(conn, new PublicKey(accept.asset)),
				conn.getAccountInfo(getAssociatedTokenAddressSync(
					new PublicKey(accept.asset),
					new PublicKey(accept.payTo),
					false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
				)),
				conn.getBalance(new PublicKey(accept.extra.feePayer), 'confirmed').catch(() => null),
				readPayerUsdcAtomic(conn, buyer.publicKey),
			]);
	} catch (err) {
		if (!isTransientRpcError(err)) throw err;
		log.warn('rpc_unavailable_skip', { message: err?.message });
		return json(res, 200, {
			ok: false,
			skipped: true,
			reason: `rpc_unavailable: ${err?.message || 'solana rpc chain exhausted'}`,
		});
	}
	const receiverAtaExists = receiverAtaInfo !== null;

	// ── Pre-flight: never fire a batch whose outcome is already decided ───────
	const plan = planSeedBatch({
		sponsorSolLamports,
		payerUsdcAtomic,
		priceAtomic: Number(accept.amount),
		batchSize: BATCH_SIZE,
	});
	if (plan.skip) {
		log.warn(`${plan.skip}_skip`, {
			feePayer: accept.extra.feePayer,
			payer: buyer.publicKey.toBase58(),
			sponsor_lamports: sponsorSolLamports,
			payer_usdc_atomic: payerUsdcAtomic,
		});
		return json(res, 200, {
			ok: false,
			skipped: true,
			reason: plan.skip,
			feePayer: accept.extra.feePayer,
			payer: buyer.publicKey.toBase58(),
			sponsor_sol: sponsorSolLamports === null ? null : sponsorSolLamports / 1e9,
			floor_sol: SPONSOR_SOL_FLOOR_LAMPORTS / 1e9,
			payer_usdc: payerUsdcAtomic === null ? null : payerUsdcAtomic / 1e6,
			price_usdc: Number(accept.amount) / 1e6,
		});
	}

	// ── Pre-flight: fit the batch inside the sponsor's fee budget ─────────────
	// The balance gate above only proves the sponsor is over its hard floor. The
	// wallet fee governor refuses anything past today's paced budget, and this
	// cron built, signed and verified 60 payments a tick regardless: measured on
	// production 2026-09-29, 3,600 of 3,660 seed payments in two hours were
	// refused at the facilitator with `fee_runway_exhausted`, about 95% of every
	// settle attempt the platform made, each after a simulated verify. The seeder
	// sends only what the governor will admit, and leaves the reserve for the
	// pipelines that buy real data from the same wallet.
	const feeEstimate = seedFeeEstimateLamports();
	const admission = await reserveFeeAdmissions({
		feeWalletB58: accept.extra.feePayer,
		estFeeLamports: feeEstimate,
		count: plan.batch,
		keepLamports: seedFeeReserveLamports(),
		connection: conn,
	});
	if (admission.admitted < 1) {
		return json(res, 200, {
			ok: false,
			skipped: true,
			reason: 'fee_budget',
			detail: admission.reason,
			feePayer: accept.extra.feePayer,
			budget_lamports: admission.budgetLamports ?? null,
			spent_today_lamports: admission.spentTodayLamports ?? null,
			reserve_lamports: admission.keepLamports ?? null,
			fee_estimate_lamports: feeEstimate,
		});
	}

	// ── Step 3: build the signed transactions (synchronous) ───────────────────
	// The nonce spread is what makes each batch member a distinct transaction;
	// see ringFeeConfig in api/_lib/x402/pay.js for why it costs ~nothing.
	// A random base keeps the batch clear of the autonomous loop's payments to
	// the same endpoint: both are fired by economy-tick and can sign against the
	// same blockhash, and a batch that always started at nonce 0 was guaranteed to
	// share a fee config with anything else that did.
	const affordable = Math.min(plan.batch, admission.admitted);
	const nonceBase = nextAutoNonce();
	const txBases = Array.from({ length: affordable }, (_, index) =>
		buildPaymentTx({ accept, buyer, blockhash, mintInfo, receiverAtaExists, nonce: nonceBase + index }),
	);

	// ── Step 4: fire all in parallel ──────────────────────────────────────────
	const resourceUrl = `${origin}/api/x402/dance-tip`;
	const paymentPayloadTemplate = {
		x402Version: 2,
		scheme: 'exact',
		network: accept.network,
		resource: { url: resourceUrl, mimeType: 'application/json' },
		accepted: accept,
	};

	const results = await Promise.allSettled(
		txBases.map((txBase64, i) => {
			const dancer = DANCERS[i % DANCERS.length];
			const style = pick(STYLES);
			const xPayment = Buffer.from(JSON.stringify({
				...paymentPayloadTemplate,
				payload: { transaction: txBase64 },
			})).toString('base64');

			return fetchWithTimeout(
				`${origin}/api/x402/dance-tip?dancer=${dancer}&dance=${style}`,
				{ headers: { 'user-agent': 'threews-x402-seed/1.0', 'X-PAYMENT': xPayment } },
			).then((r) => ({ ok: r.ok, status: r.status, dancer, style, ticket: r.body }));
		}),
	);

	// ── Step 5: record successful payments in the x402 feed ──────────────────
	const succeeded = results
		.filter((r) => r.status === 'fulfilled' && r.value.ok)
		.map((r) => r.value);
	const failed = results.filter(
		(r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
	).length;

	const feedTs = Date.now();
	if (succeeded.length > 0) {
		// Push one aggregated feed entry per tick so the activity feed ticks
		// without flooding it with 60 individual rows.
		void pushFeedEntry({
			ts: feedTs,
			tool: 'dance-tip',
			argsSummary: `seed ×${succeeded.length}`,
			network: accept.network,
			amount: accept.amount,
			batch: succeeded.length,
			payer: buyer.publicKey.toBase58(),
			payTo: accept.payTo,
		}).catch(() => {});
	}

	const payerAddress = buyer.publicKey.toBase58();
	log.info('x402_seed_tick', {
		batch: affordable,
		configured_batch: BATCH_SIZE,
		fee_admitted: admission.admitted,
		succeeded: succeeded.length,
		failed,
		payer: payerAddress,
		payTo: accept.payTo,
		amount_atomics: accept.amount,
	});

	return json(res, 200, {
		ok: true,
		batch: affordable,
		configured_batch: BATCH_SIZE,
		succeeded: succeeded.length,
		failed,
		payer: payerAddress,
		payTo: accept.payTo,
		network: accept.network,
		amount_atomics: accept.amount,
		price_usdc: (Number(accept.amount) / 1e6).toFixed(4),
		total_usdc: ((succeeded.length * Number(accept.amount)) / 1e6).toFixed(4),
	});
});
