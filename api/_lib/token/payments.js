// On-chain verification + settlement + audit for the $THREE token layer.
//
// Flow (server-authoritative — a client "paid" claim is never trusted):
//   1. verifyQuote()   — quote untampered + unexpired
//   2. nonce-unused    — fast reject of a replayed quote before any RPC
//   3. verifyOnChain() — tx confirmed, memo == nonce, each split leg credited
//   4. settlePayment() — record with UNIQUE(nonce) + UNIQUE(tx_signature); a
//                        duplicate insert is a replay/double-submit, surfaced
//                        as already_settled rather than crediting twice.
//
// Money that left the wallet must stay recordable. A quote that expired before
// its settle call arrived is still settled when the transaction's block time
// shows it was paid while the quote was valid, and a caller that opts in
// (resumeSameTx) gets the recorded payment back when the same user resends the
// same transaction, instead of a 409 that strands what they paid for.

import { solanaConnection } from '../solana/connection.js';
import { sql } from '../db.js';
import { env } from '../env.js';
import { verifyQuote } from './quote.js';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

// Clock skew allowed between our quote clock and the cluster's block time when
// a late settle proves the transfer landed before the quote expired.
const LATE_SETTLE_SKEW_S = 30;

function rpcUrl(network) {
	return network === 'devnet'
		? env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

function verifyError(message, status = 422, code = 'verification_failed', extra = {}) {
	return Object.assign(new Error(message), { status, code, ...extra });
}

// Net atomics credited to an owner across all of its token accounts for `mint`,
// computed from pre/post token balances. Robust to which transfer variant was
// used and to the destination ATA being created within the same transaction
// (it simply has no pre-balance entry). Works uniformly for the burn address,
// treasury, and a marketplace seller.
function creditedTo(tx, { mint, ownerAddress }) {
	const pre = tx.meta?.preTokenBalances || [];
	const post = tx.meta?.postTokenBalances || [];
	let delta = 0n;
	for (const p of post) {
		if (p.mint !== mint || p.owner !== ownerAddress) continue;
		const before = pre.find((x) => x.accountIndex === p.accountIndex);
		const beforeAmt = BigInt(before?.uiTokenAmount?.amount ?? '0');
		const afterAmt = BigInt(p.uiTokenAmount?.amount ?? '0');
		delta += afterAmt - beforeAmt;
	}
	return delta;
}

/**
 * Verify the on-chain transaction satisfies the quote.
 * @returns {Promise<{ confirmedAt: string, slot: number|null, credited: object }>}
 */
export async function verifyOnChain({ quote, txSignature, network = 'mainnet' }) {
	const connection = solanaConnection({ url: rpcUrl(network), commitment: 'confirmed' });
	let tx;
	try {
		tx = await connection.getParsedTransaction(txSignature, {
			maxSupportedTransactionVersion: 1,
			commitment: 'confirmed',
		});
	} catch {
		throw verifyError(
			'transaction not found — may need more confirmations',
			422,
			'tx_not_found',
		);
	}
	if (!tx) throw verifyError('transaction not found', 422, 'tx_not_found');
	if (tx.meta?.err) throw verifyError('transaction failed on-chain', 422, 'tx_failed');

	// Memo must equal the quote nonce — binds this tx to this exact quote and
	// blocks a transfer whose numbers happen to line up from a different intent.
	const memoIx = tx.transaction.message.instructions.find(
		(ix) => ix.programId?.toString() === MEMO_PROGRAM,
	);
	const memo = typeof memoIx?.parsed === 'string' ? memoIx.parsed : null;
	if (!memo || memo !== quote.nonce) {
		throw verifyError('transaction memo does not match quote nonce', 422, 'memo_mismatch');
	}

	// Every split leg must have received at least its share. Underpaying any leg
	// (treasury, rewards, or seller) voids the whole payment.
	const credited = {};
	for (const leg of quote.legs) {
		const need = BigInt(leg.atomics);
		const got = creditedTo(tx, { mint: quote.mint, ownerAddress: leg.address });
		credited[leg.role] = got.toString();
		if (got < need) {
			throw verifyError(
				`split leg "${leg.role}" received ${got} < required ${need}`,
				422,
				'split_underpaid',
				{ role: leg.role, required: need.toString(), received: got.toString() },
			);
		}
	}

	return { confirmedAt: new Date().toISOString(), slot: tx.slot ?? null, blockTime: tx.blockTime ?? null, credited };
}

function isUniqueViolation(err) {
	return err?.code === '23505' || /duplicate key|unique constraint/i.test(err?.message || '');
}

/**
 * Record a $THREE allowance pull as a settled payment, in the exact same
 * token_payments shape as settlePayment(). The allowance rail (Solana native
 * Subscriptions program) pulls funds with the platform delegate key instead of a
 * user-signed quote tx, but the economic record is identical — same purpose,
 * mint, split legs, and on-chain signature — so economy stats and creator
 * earnings (which match the `seller` split leg) stay consistent across both rails.
 *
 * Uses the issued quote's nonce as the unique key (the quote was priced normally;
 * only its settlement path differs), so a double-submit is caught by the same
 * UNIQUE(nonce)/UNIQUE(tx_signature) guard.
 */
export async function recordAllowancePayment({ quote, txSignature, network, payerWallet, userId, slot = null }) {
	try {
		const [row] = await sql`
			insert into token_payments
				(user_id, payer_wallet, purpose, mint, decimals, usd, price_usd,
				 total_atomics, splits, nonce, tx_signature, network, slot, ref_type, ref_id, confirmed_at)
			values
				(${userId ?? null}, ${payerWallet ?? null}, ${quote.purpose}, ${quote.mint}, ${quote.decimals},
				 ${quote.usd}, ${quote.priceUsd}, ${quote.total}, ${JSON.stringify(quote.legs)}::jsonb,
				 ${quote.nonce}, ${txSignature}, ${network}, ${slot},
				 ${quote.refType ?? null}, ${quote.refId ?? null}, now())
			returning id, created_at
		`;
		return { id: row.id, replay: false, created_at: row.created_at };
	} catch (err) {
		if (isUniqueViolation(err)) {
			const [existing] = await sql`
				select id, created_at from token_payments
				where nonce = ${quote.nonce} or tx_signature = ${txSignature}
				limit 1
			`;
			return { id: existing?.id ?? null, replay: true, created_at: existing?.created_at ?? null };
		}
		throw err;
	}
}

/**
 * Record a verified payment. Returns { id, replay, created_at }. A duplicate
 * nonce or tx_signature resolves to { replay: true } (the prior settled row).
 */
export async function settlePayment({
	quote,
	txSignature,
	network,
	payerWallet,
	userId,
	confirmation,
}) {
	try {
		const [row] = await sql`
			insert into token_payments
				(user_id, payer_wallet, purpose, mint, decimals, usd, price_usd,
				 total_atomics, splits, nonce, tx_signature, network, slot, ref_type, ref_id, confirmed_at)
			values
				(${userId ?? null}, ${payerWallet ?? null}, ${quote.purpose}, ${quote.mint}, ${quote.decimals},
				 ${quote.usd}, ${quote.priceUsd}, ${quote.total}, ${JSON.stringify(quote.legs)}::jsonb,
				 ${quote.nonce}, ${txSignature}, ${network}, ${confirmation?.slot ?? null},
				 ${quote.refType ?? null}, ${quote.refId ?? null}, now())
			returning id, created_at
		`;
		return { id: row.id, replay: false, created_at: row.created_at };
	} catch (err) {
		if (isUniqueViolation(err)) {
			const [existing] = await sql`
				select id, created_at, tx_signature, user_id from token_payments
				where nonce = ${quote.nonce} or tx_signature = ${txSignature}
				limit 1
			`;
			return {
				id: existing?.id ?? null,
				replay: true,
				created_at: existing?.created_at ?? null,
				tx_signature: existing?.tx_signature ?? null,
				user_id: existing?.user_id ?? null,
			};
		}
		throw err;
	}
}

/**
 * Full verified-payment path reused by Task 19 (paid spins) and Task 20
 * (token-priced listings). Validates the quote, rejects replays, verifies the
 * transaction on-chain, records the settlement.
 * @returns {Promise<{ ok: true, payment_id: string, quote: object, confirmation: object }>}
 */
export async function verifyAndSettlePayment({
	quoteToken,
	txSignature,
	payerWallet = null,
	userId = null,
	network,
	resumeSameTx = false,
}) {
	const quote = verifyQuote(quoteToken, { allowExpired: true });
	const expired = quote.exp < Math.floor(Date.now() / 1000);
	const net = network || quote.network || 'mainnet';

	// The same user resending the same transaction is a lost response, not a
	// replay: hand back the payment it already recorded. Only for callers that
	// opt in, because they own a single-use redemption downstream of the id.
	const resumed = (row) =>
		resumeSameTx && row?.id && row.tx_signature === txSignature && userId && String(row.user_id) === String(userId)
			? { ok: true, replay: true, payment_id: row.id, quote, confirmation: { slot: null, blockTime: null, credited: null } }
			: null;

	// Fast pre-check (the UNIQUE constraint in settlePayment is the source of
	// truth, but this avoids an RPC round-trip on an obvious replay).
	const [used] =
		await sql`select id, tx_signature, user_id from token_payments where nonce = ${quote.nonce} limit 1`;
	if (used) {
		const again = resumed(used);
		if (again) return again;
		throw verifyError('quote already settled', 409, 'already_settled', {
			tx_signature: used.tx_signature,
		});
	}

	const confirmation = await verifyOnChain({ quote, txSignature, network: net });
	// An expired quote settles only when the chain shows it was paid in time.
	if (expired && !(Number(confirmation.blockTime) > 0 && confirmation.blockTime <= quote.exp + LATE_SETTLE_SKEW_S)) {
		throw verifyError('quote expired', 410, 'quote_expired');
	}
	const settled = await settlePayment({
		quote,
		txSignature,
		network: net,
		payerWallet,
		userId,
		confirmation,
	});
	if (settled.replay) {
		const again = resumed({ id: settled.id, tx_signature: settled.tx_signature, user_id: settled.user_id });
		if (again) return again;
		throw verifyError('payment already settled', 409, 'already_settled');
	}

	return { ok: true, payment_id: settled.id, quote, confirmation };
}

/**
 * Audit read for reconciliation. Keyset paginated by created_at. No secrets are
 * stored on the row, so the whole record is safe to return to an authorized reader.
 */
export async function listPayments({
	purpose = null,
	userId = null,
	refType = null,
	refId = null,
	limit = 50,
	before = null,
} = {}) {
	const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const rows = await sql`
		select id, user_id, payer_wallet, purpose, mint, decimals, usd, price_usd,
		       total_atomics, splits, nonce, tx_signature, network, slot,
		       ref_type, ref_id, confirmed_at, created_at
		from token_payments
		where (${purpose}::text is null or purpose = ${purpose})
		  and (${userId}::uuid is null or user_id = ${userId})
		  and (${refType}::text is null or ref_type = ${refType})
		  and (${refId}::text is null or ref_id = ${refId})
		  and (${before}::timestamptz is null or created_at < ${before})
		order by created_at desc
		limit ${cap + 1}
	`;
	const hasMore = rows.length > cap;
	const items = (hasMore ? rows.slice(0, cap) : rows).map((r) => ({
		id: r.id,
		user_id: r.user_id,
		payer_wallet: r.payer_wallet,
		purpose: r.purpose,
		mint: r.mint,
		decimals: r.decimals,
		usd: Number(r.usd),
		price_usd: Number(r.price_usd),
		total_atomics: r.total_atomics,
		splits: r.splits,
		nonce: r.nonce,
		tx_signature: r.tx_signature,
		network: r.network,
		slot: r.slot,
		ref_type: r.ref_type,
		ref_id: r.ref_id,
		confirmed_at: r.confirmed_at,
		created_at: r.created_at,
	}));
	return { items, next_cursor: hasMore ? items[items.length - 1].created_at : null };
}

/**
 * Creator/seller earnings for a wallet — every settled sale whose `seller` split
 * leg paid this wallet. Sums the seller-leg atomics so the dashboard shows real
 * $THREE earned, not the gross sale. Reads the same settle ledger; no second
 * source of truth. The leg match uses a jsonb containment so it's index-friendly.
 * @returns {Promise<{ total_atomics: string, sale_count: number, mint: string|null, decimals: number|null, items: object[] }>}
 */
export async function creatorEarnings({ sellerWallet, limit = 50, before = null } = {}) {
	if (!sellerWallet) {
		const e = new Error('sellerWallet is required');
		e.status = 400;
		e.code = 'bad_request';
		throw e;
	}
	const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const legMatch = JSON.stringify([{ role: 'seller', address: sellerWallet }]);
	const rows = await sql`
		select id, mint, decimals, usd, total_atomics, splits, tx_signature, ref_type, ref_id, created_at
		from token_payments
		where splits @> ${legMatch}::jsonb
		  and (${before}::timestamptz is null or created_at < ${before})
		order by created_at desc
		limit ${cap + 1}
	`;
	const hasMore = rows.length > cap;
	const page = hasMore ? rows.slice(0, cap) : rows;

	// Sum the seller leg across ALL matching sales (not just this page) for the
	// headline total, so pagination never understates lifetime earnings.
	const [{ total = '0', n = 0 } = {}] = await sql`
		select coalesce(sum((leg->>'atomics')::numeric), 0)::text as total, count(*) as n
		from token_payments,
		     lateral jsonb_array_elements(splits) as leg
		where splits @> ${legMatch}::jsonb
		  and leg->>'role' = 'seller'
		  and leg->>'address' = ${sellerWallet}
	`;

	const items = page.map((r) => {
		const sellerLeg = (r.splits || []).find((l) => l.role === 'seller' && l.address === sellerWallet);
		return {
			id: r.id,
			mint: r.mint,
			decimals: r.decimals,
			usd: Number(r.usd),
			earned_atomics: sellerLeg?.atomics ?? '0',
			total_atomics: r.total_atomics,
			tx_signature: r.tx_signature,
			ref_type: r.ref_type,
			ref_id: r.ref_id,
			created_at: r.created_at,
		};
	});

	return {
		total_atomics: String(total),
		sale_count: Number(n),
		mint: page[0]?.mint ?? null,
		decimals: page[0]?.decimals ?? null,
		items,
		next_cursor: hasMore ? items[items.length - 1].created_at : null,
	};
}

/**
 * Economy-wide aggregates over the settle ledger — the data behind the public
 * /three economy dashboard and the treasury/rewards loop. Sums gross settled
 * volume, payment count, and the per-role flow (treasury / rewards / seller) by
 * unrolling the jsonb split legs. `sinceDays` windows the dashboard headline.
 * @returns {Promise<{ since: string|null, payment_count: number, gross_atomics: string,
 *   by_role: Record<string,string>, by_purpose: { purpose: string, count: number, gross_atomics: string }[],
 *   mint: string|null, decimals: number|null }>}
 */
export async function economyStats({ sinceDays = null } = {}) {
	const since = sinceDays != null ? `${Math.max(1, Math.floor(sinceDays))} days` : null;

	const [head = {}] = await sql`
		select count(*) as n,
		       coalesce(sum(total_atomics::numeric), 0)::text as gross,
		       max(mint) as mint,
		       max(decimals) as decimals
		from token_payments
		where (${since}::interval is null or created_at >= now() - ${since}::interval)
	`;

	const roleRows = await sql`
		select leg->>'role' as role, coalesce(sum((leg->>'atomics')::numeric), 0)::text as atomics
		from token_payments, lateral jsonb_array_elements(splits) as leg
		where (${since}::interval is null or created_at >= now() - ${since}::interval)
		group by leg->>'role'
	`;
	const by_role = {};
	for (const r of roleRows) by_role[r.role] = String(r.atomics);

	const purposeRows = await sql`
		select purpose, count(*) as count, coalesce(sum(total_atomics::numeric), 0)::text as gross
		from token_payments
		where (${since}::interval is null or created_at >= now() - ${since}::interval)
		group by purpose
		order by gross desc
	`;

	return {
		since: since,
		payment_count: Number(head.n || 0),
		gross_atomics: String(head.gross || '0'),
		by_role,
		by_purpose: purposeRows.map((r) => ({
			purpose: r.purpose,
			count: Number(r.count),
			gross_atomics: String(r.gross),
		})),
		mint: head.mint ?? null,
		decimals: head.decimals ?? null,
	};
}

// ── Holder-rewards (reflections) distribution ledger ──────────────────────────
// The public, verifiable record of every distribution run. This is what lets
// /three show a real "reflected to holders" number with history — the deflation-
// free answer to a burn counter. No secrets stored; every row is on-chain facts.

/**
 * Record a distribution run. `status` is 'planned' for a dry run (no signer) or
 * 'completed'/'failed' once executed. Returns the new row's id + created_at.
 */
export async function recordRewardsDistribution({
	mint,
	poolWallet,
	poolAtomics,
	distributedAtomics = 0n,
	dustAtomics = 0n,
	holderCount = 0,
	eligibleSupplyAtomics = 0n,
	status = 'planned',
	txSignatures = [],
	note = null,
}) {
	const [row] = await sql`
		insert into three_rewards_distributions
			(mint, pool_wallet, pool_atomics, distributed_atomics, dust_atomics,
			 holder_count, eligible_supply_atomics, status, tx_signatures, note)
		values
			(${mint}, ${poolWallet}, ${String(poolAtomics)}, ${String(distributedAtomics)},
			 ${String(dustAtomics)}, ${Math.max(0, Math.floor(holderCount))},
			 ${String(eligibleSupplyAtomics)}, ${status},
			 ${JSON.stringify(txSignatures)}::jsonb, ${note})
		returning id, created_at
	`;
	return { id: row.id, created_at: row.created_at };
}

/**
 * Public history of distributions + the cumulative reflected total. `completed`
 * runs count toward the headline; `planned` (dry) runs are shown but excluded
 * from the reflected total so the number only ever reflects real on-chain payouts.
 * @returns {Promise<{ total_reflected_atomics: string, run_count: number, items: object[] }>}
 */
export async function listRewardsDistributions({ limit = 20 } = {}) {
	const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
	const rows = await sql`
		select id, mint, pool_wallet, pool_atomics, distributed_atomics, dust_atomics,
		       holder_count, eligible_supply_atomics, status, tx_signatures, note, created_at
		from three_rewards_distributions
		order by created_at desc
		limit ${cap}
	`;
	const [{ total = '0', n = 0 } = {}] = await sql`
		select coalesce(sum(distributed_atomics), 0)::text as total, count(*) as n
		from three_rewards_distributions
		where status = 'completed'
	`;
	return {
		total_reflected_atomics: String(total),
		run_count: Number(n),
		items: rows.map((r) => ({
			id: r.id,
			mint: r.mint,
			pool_wallet: r.pool_wallet,
			pool_atomics: String(r.pool_atomics),
			distributed_atomics: String(r.distributed_atomics),
			dust_atomics: String(r.dust_atomics),
			holder_count: Number(r.holder_count),
			eligible_supply_atomics: String(r.eligible_supply_atomics),
			status: r.status,
			tx_signatures: r.tx_signatures,
			note: r.note,
			created_at: r.created_at,
		})),
	};
}
