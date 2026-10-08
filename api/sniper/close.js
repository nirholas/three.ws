/**
 * Agent Sniper — manual position close (one-tap "Sell now").
 *
 *   POST /api/sniper/close   → owner force-closes ONE open sniper position now.
 *
 * The autonomous worker already exits on take-profit / stop-loss / trailing /
 * timeout, and the kill switch exits EVERY position. This endpoint is the missing
 * per-position lever: the owner taps "Sell now" on a single live position and the
 * agent sells its full holding of that mint immediately, at a real price, with a
 * real signature.
 *
 * It reuses the worker's own `executeSell` — the single module that signs and
 * broadcasts — so the manual exit takes the exact same path as an automated one:
 * fresh re-quote, graduation→AMM routing, the protected execution engine, the
 * realized-PnL write, and the custody/audit + Telegram notification. No trade
 * logic is duplicated, so manual and automatic exits can never drift apart.
 *
 * Owner-only (the position's user_id must equal the caller). Selling moves SOL
 * INWARD, so — like every sell path — it is deliberately not gated by the spend
 * ceilings or the wallet freeze: getting out is always the safe direction.
 *
 * Auth: session cookie OR bearer token. CSRF required on this fund-moving write.
 */

import { cors, json, method, error, readJson, rateLimited } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer, assertBearerMaySpend } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { explorerTxUrl } from '../_lib/avatar-wallet.js';
import { executeSell } from '../../workers/agent-sniper/executor.js';
import { z } from 'zod';

const CONFIRM_TIMEOUT_MS = 45_000;

const BODY = z.object({
	agent_id: z.string().uuid(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	// One of these identifies the position. position_id is exact; mint is the
	// friendlier handle from the live-positions UI (unique per agent+network).
	position_id: z.string().uuid().optional(),
	mint: z.string().min(32).max(44).optional(),
});

async function resolveUserId(req) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return bearer.userId;
	return null;
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Not behind wrap(): answer a bearer without wallet:write here.
	let userId;
	try {
		userId = await resolveUserId(req);
	} catch (e) {
		return error(res, e.status || 403, e.code || 'forbidden', e.message);
	}
	if (!userId) return error(res, 401, 'unauthorized', 'sign in to manage the sniper');

	const rlUser = await limits.tradePerUser(userId);
	if (!rlUser.success) return rateLimited(res, rlUser);
	const rlIp = await limits.authIp(clientIp(req));
	if (!rlIp.success) return rateLimited(res, rlIp);

	let raw;
	try {
		raw = await readJson(req);
	} catch (e) {
		return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body');
	}
	const parsed = BODY.safeParse(raw);
	if (!parsed.success) {
		return error(res, 400, 'bad_request', parsed.error.issues[0]?.message || 'invalid request');
	}
	const { agent_id, network, position_id, mint } = parsed.data;
	if (!position_id && !mint) {
		return error(res, 400, 'bad_request', 'provide a position_id or a mint to close');
	}

	if (!(await requireCsrf(req, res, userId))) return;

	// Atomically CLAIM the open position by flipping it to 'closing'. Owner-scoped
	// by user_id. This both authorizes the caller (no row → not theirs / not open)
	// and serializes against the worker's own sweep, so a manual close and an
	// automatic exit can never both fire a sell for the same bag: only the txn that
	// finds the row still 'open' wins the flip.
	const [claim] = await sql`
		UPDATE agent_sniper_positions
		SET status = 'closing'
		WHERE id = (
			SELECT id FROM agent_sniper_positions
			WHERE agent_id = ${agent_id}
			  AND user_id = ${userId}
			  AND network = ${network}
			  AND status = 'open'
			  AND (${position_id ?? null}::uuid IS NULL OR id = ${position_id ?? null})
			  AND (${mint ?? null}::text IS NULL OR mint = ${mint ?? null})
			ORDER BY opened_at DESC NULLS LAST
			LIMIT 1
		)
		AND status = 'open'
		RETURNING id, agent_id, user_id, network, mint, symbol, name,
		          base_amount, entry_quote_lamports, error
	`;

	if (!claim) {
		// Distinguish "nothing open" from "someone else is already closing it" so the
		// UI message is honest.
		const [existing] = await sql`
			SELECT status FROM agent_sniper_positions
			WHERE agent_id = ${agent_id} AND user_id = ${userId} AND network = ${network}
			  AND (${position_id ?? null}::uuid IS NULL OR id = ${position_id ?? null})
			  AND (${mint ?? null}::text IS NULL OR mint = ${mint ?? null})
			ORDER BY opened_at DESC NULLS LAST
			LIMIT 1
		`;
		if (existing?.status === 'closing') {
			return error(res, 409, 'position_busy', 'this position is already being closed — give it a moment');
		}
		if (existing?.status === 'closed') {
			return error(res, 409, 'already_closed', 'this position is already closed');
		}
		return error(res, 404, 'not_found', 'no open position found for that agent on this network');
	}

	// Enrich the claimed position with the fields executeSell uses for slippage,
	// notifications, and the audit name. The positions table stores none of these
	// (slippage + Telegram live on the strategy; the display name on the agent),
	// so read them once now that ownership + the claim are settled.
	const [meta] = await sql`
		SELECT a.name AS agent_name, s.slippage_bps, s.telegram_chat_id
		FROM agent_identities a
		LEFT JOIN agent_sniper_strategies s ON s.agent_id = a.id AND s.network = ${network}
		WHERE a.id = ${claim.agent_id}
		LIMIT 1
	`;
	const pos = {
		...claim,
		agent_name: meta?.agent_name || null,
		slippage_bps: meta?.slippage_bps ?? null,
		telegram_chat_id: meta?.telegram_chat_id ?? null,
	};

	if (!pos.base_amount || BigInt(pos.base_amount) <= 0n) {
		// A position with no recorded token balance can't be sold; reopen it so the
		// claim doesn't strand the row in 'closing'.
		await sql`UPDATE agent_sniper_positions SET status = 'open' WHERE id = ${pos.id} AND status = 'closing'`.catch(() => {});
		return error(res, 409, 'not_sellable', 'this position has no token balance to sell yet — try again in a moment');
	}

	const cfg = {
		network,
		mode: process.env.SNIPER_MODE === 'simulate' ? 'simulate' : 'live',
		confirmTimeoutMs: CONFIRM_TIMEOUT_MS,
	};

	let result;
	try {
		// executeSell re-reads status with its own `WHERE status='open'` guard (a
		// no-op now that we hold the 'closing' claim) and then sells, writing the
		// realized PnL + sell_sig and flipping the row to 'closed'. On failure it
		// reopens the position itself so a later retry (worker or owner) can exit.
		result = await executeSell({ cfg, position: pos, reason: 'manual' });
	} catch (e) {
		await sql`UPDATE agent_sniper_positions SET status = 'open', error = ${'manual_close_failed'} WHERE id = ${pos.id} AND status = 'closing'`.catch(() => {});
		return error(res, 502, 'sell_failed', 'the sell could not be submitted and no funds were moved — try again');
	}

	if (result.status === 'closed') {
		const live = result.sig && result.sig !== 'SIMULATED';
		const pnlSol = Number(BigInt(result.pnl || '0')) / 1e9;
		return json(res, 200, {
			data: {
				status: 'closed',
				agent_id: pos.agent_id,
				mint: pos.mint,
				symbol: pos.symbol || null,
				venue: result.venue || null,
				pnl_sol: pnlSol,
				simulated: !live,
				signature: live ? result.sig : null,
				explorer: live ? explorerTxUrl(result.sig, network) : null,
			},
		});
	}

	// executeSell already reopened the position on a retry/failure outcome.
	if (result.status === 'retry') {
		return error(res, 502, 'sell_retry', 'the sell did not land — the position is still open, try again in a moment', {
			reason: result.reason || null,
		});
	}
	return error(res, 502, 'sell_failed', `the sell did not complete (${result.reason || result.status})`, {
		reason: result.reason || null,
	});
}
