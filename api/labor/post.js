// POST /api/labor/post: an agent (owned by the caller) posts a bounty and
// escrows the reward in $THREE from its own custodial wallet into real on-chain
// escrow. Every guard is server-side: ownership, spend policy (per-tx + daily
// ceiling + kill switch), and a fail-closed price feed so the spend is valued in
// real USD before any $THREE moves. If escrow funding fails, NO money moved and
// the bounty is cancelled. On success the bounty is open and the autonomy engine
// immediately collects auto-bids (and auto-awards + runs the job if the poster
// opted in) so the market visibly comes alive.

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { authWrite, loadOwnedAgent, ownershipError, requireSolanaWallet, requireUuid } from '../_lib/labor-auth.js';
import { TOKEN_MINT } from '../_lib/token/config.js';
import { getTokenPriceUsd } from '../_lib/token/price.js';
import { recoverSolanaAgentKeypair } from '../_lib/agent-wallet.js';
import {
	SpendLimitError, reserveSpendUsd, releaseSpendReservation, updateCustodyEvent,
} from '../_lib/agent-trade-guards.js';
import { escrowConfigured, escrowAddressOrNull, fundEscrow } from '../_lib/labor-escrow.js';
import { createBounty, setBountyEscrow, setBountyStatus, parseAtomics, parseThree, atomicsToThree, _toBig as toBig } from '../_lib/agent-labor.js';
import { runAutopilot } from '../_lib/labor-settle.js';
import { EscrowError, normalizeEvaluator, normalizeDisputeWindow } from '../_lib/labor-escrow-machine.js';
import { ensureCase } from '../_lib/labor-evaluation.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await authWrite(req, res, { spend: true });
	if (!auth) return;
	const { userId } = auth;

	const rl = await limits.laborPost(userId || 'anon');
	if (!rl.success) return rateLimited(res, rl, 'bounty rate limit exceeded');

	const body = (await readJson(req)) || {};
	const { posterAgentId, title, spec, requiredSkill = null, rewardThree, rewardAtomics, deadline = null } = body;

	if (!posterAgentId || typeof posterAgentId !== 'string') return error(res, 400, 'validation_error', 'posterAgentId is required');
	if (!requireUuid(res, posterAgentId, 'posterAgentId')) return;
	if (!title || typeof title !== 'string' || title.length > 140) return error(res, 400, 'validation_error', 'title is required (max 140 chars)');
	if (!spec || typeof spec !== 'string' || spec.length > 4000) return error(res, 400, 'validation_error', 'spec is required (max 4000 chars)');

	// Parse the reward strictly. toBig() throws a SyntaxError on junk (an opaque
	// 500 for what is plainly bad input) and threeToAtomics() silently returns
	// zero, which reported "reward must be greater than zero" for a typo that was
	// never a number at all. Both now answer a 400 that names the real problem.
	if (rewardAtomics == null && rewardThree == null) {
		return error(res, 400, 'validation_error', 'rewardThree or rewardAtomics is required');
	}
	const reward = rewardAtomics != null ? parseAtomics(rewardAtomics) : parseThree(rewardThree);
	if (reward == null) return error(res, 400, 'validation_error', 'reward must be a non-negative amount of $THREE');
	if (reward <= 0n) return error(res, 400, 'validation_error', 'reward must be greater than zero');

	// A deadline lands in a timestamptz column, so an unparseable one used to
	// blow up inside the INSERT as a 500 after the bounty row was already shaped.
	let deadlineIso = null;
	if (deadline != null && deadline !== '') {
		const at = new Date(deadline);
		if (Number.isNaN(at.getTime())) return error(res, 400, 'validation_error', 'deadline must be an ISO 8601 timestamp');
		deadlineIso = at.toISOString();
	}

	// Who judges the delivery and how long the losing side may dispute. Validated
	// before any money moves; stored on the bounty and read when its case opens.
	let escrowCfg;
	try {
		const evaluator = normalizeEvaluator(body.evaluator, { posterAgentId });
		if (evaluator.kind === 'agent') {
			if (!requireUuid(res, evaluator.agentId, 'evaluator.agentId')) return;
			const [reg] = await sql`SELECT meta FROM agent_identities WHERE id = ${evaluator.agentId} AND deleted_at IS NULL`;
			if (!reg?.meta?.solana_address) {
				return error(res, 400, 'bad_evaluator', 'the evaluator agent does not exist or has no Solana wallet to sign with');
			}
			if (evaluator.agentId === posterAgentId) {
				return error(res, 400, 'bad_evaluator', "use evaluator 'poster' to judge your own bounty");
			}
		}
		escrowCfg = {
			evaluator: evaluator.kind === 'agent' ? { kind: 'agent', agentId: evaluator.agentId } : evaluator.kind,
			dispute_window_seconds: normalizeDisputeWindow(body.disputeWindowSeconds),
		};
	} catch (e) {
		if (e instanceof EscrowError) return error(res, e.status, e.code, e.message);
		throw e;
	}

	if (!escrowConfigured()) {
		return error(res, 503, 'escrow_unavailable', 'the labor-market escrow wallet is not configured on this server');
	}

	let poster;
	try {
		poster = requireSolanaWallet(await loadOwnedAgent(posterAgentId, userId));
	} catch (e) {
		return ownershipError(res, e);
	}

	if (!(await requireRealFundsAgreement(req, res, { userId, context: 'labor-post' }))) return;

	// Value the reward in real USD for the spend policy. Fail closed if no price
	// feed is live: a paid action must never proceed on a guessed price.
	let usd;
	try {
		const { priceUsd } = await getTokenPriceUsd();
		usd = atomicsToThree(reward) * priceUsd;
	} catch {
		return error(res, 503, 'price_unavailable', 'live $THREE price is unavailable, so the escrow cannot be valued; try again shortly');
	}

	// Create the bounty row first so the reservation + escrow can reference it.
	const bounty = await createBounty({
		posterAgentId, posterUserId: userId, title: title.trim(), spec: spec.trim(),
		requiredSkill: requiredSkill ? String(requiredSkill).slice(0, 80) : null,
		rewardAtomics: reward, deadline: deadlineIso, auto: false,
		meta: { reward_usd_at_post: usd, escrow: escrowCfg },
	});

	// Reserve the spend against the poster's spend policy BEFORE moving funds.
	let reservationId = null;
	try {
		const r = await reserveSpendUsd({
			agentId: posterAgentId, userId, meta: poster.meta, category: 'x402',
			usdValue: usd, asset: 'THREE', network: 'mainnet',
			rowMeta: { kind: 'labor_bounty_escrow', bounty_id: bounty.id, reward_atomics: String(reward) },
		});
		reservationId = r.reservationId;
	} catch (e) {
		await setBountyStatus(bounty.id, 'cancelled');
		if (e instanceof SpendLimitError) return error(res, e.status || 403, e.code || 'spend_blocked', e.message, e.detail || {});
		console.error('[labor/post] reserve failed', e?.message);
		return error(res, 500, 'reserve_failed', 'could not reserve the escrow spend');
	}

	// Fund escrow on-chain: poster wallet to escrow wallet. A throw here means the
	// transfer did not land, so release the hold and cancel; no money moved.
	let fundSig;
	try {
		const posterKeypair = await recoverSolanaAgentKeypair(poster.meta.encrypted_solana_secret, {
			agentId: posterAgentId, userId, reason: 'labor_bounty_escrow_fund',
		});
		fundSig = await fundEscrow({ fromKeypair: posterKeypair, amountAtomics: reward });
	} catch (e) {
		await releaseSpendReservation(reservationId, 'labor_escrow_fund_failed');
		await setBountyStatus(bounty.id, 'cancelled');
		console.error('[labor/post] escrow funding failed', e?.message);
		return error(res, 502, 'escrow_fund_failed', `the bounty was not posted, no $THREE moved: ${e?.message || 'transfer failed'}`);
	}

	await updateCustodyEvent(reservationId, { status: 'confirmed', signature: fundSig, meta: { settled: true } })
		.catch((e) => console.error('[labor/post] finalize custody failed', e?.message));

	const escrowAddress = escrowAddressOrNull();
	const funded = await setBountyEscrow(bounty.id, { escrowAddress, escrowFundSig: fundSig });

	// Open the escrow case now that the money is in. A failure here cannot lose the
	// bounty: the case is opened again at award or delivery.
	await ensureCase(funded).catch((e) => console.error('[labor/post] escrow case not opened yet', e?.message));

	// Kick the autonomy engine: collect auto-bids and, if the poster auto-awards,
	// run the job through to settlement. Bounded; failures leave a resumable state.
	const autopilot = await runAutopilot(bounty.id).catch((e) => {
		console.warn('[labor/post] autopilot error', e?.message);
		return null;
	});

	const [final] = await sql`
		SELECT b.*, pa.name AS poster_name,
		       (SELECT COUNT(*) FROM agent_bids bd WHERE bd.bounty_id = b.id AND bd.status != 'withdrawn') AS bid_count
		FROM agent_bounties b LEFT JOIN agent_identities pa ON pa.id = b.poster_agent_id
		WHERE b.id = ${bounty.id}`;

	return json(res, 200, {
		ok: true,
		bounty: {
			id: final.id, title: final.title, status: final.status,
			reward_atomics: String(toBig(final.reward_atomics)), reward_three: atomicsToThree(final.reward_atomics),
			required_skill: final.required_skill, escrow_address: final.escrow_address,
			escrow_fund_sig: final.escrow_fund_sig,
			escrow_explorer: final.escrow_fund_sig ? `https://solscan.io/tx/${final.escrow_fund_sig}` : null,
			bid_count: Number(final.bid_count || 0), award_rationale: final.award_rationale || null,
			evaluator: escrowCfg.evaluator, dispute_window_seconds: escrowCfg.dispute_window_seconds,
		},
		autopilot: autopilot || { bids: 0, awarded: false, settled: null },
	});
});
