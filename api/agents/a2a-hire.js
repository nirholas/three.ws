// POST /api/agents/a2a-hire — one agent autonomously hires and pays another for a
// real, executable skill, over the real x402 rails, bounded by the hiring agent's
// spend policy + kill switch, and recorded as a real on-chain invocation receipt.
//
// This is the load-bearing piece of the agent-to-agent economy. The flow, every
// step real, every spend gated server-side:
//
//   1. Owner-gate: the caller must own the hiring agent (agent_identities.user_id).
//   2. Resolve the provider's offer from the real offer registry (agent_paid_services
//      → /api/x402/service/<slug>), which pays the PROVIDER agent's own wallet.
//   3. Reserve the spend against the hiring agent's spend policy (agent-trade-guards):
//      per-tx + daily ceilings, withdraw allowlist, and the kill switch (frozen) —
//      all enforced atomically BEFORE any money moves. Idempotent: a retry with the
//      same key never double-charges.
//   4. Pay over the real x402 protocol (x402-user-payer → @x402/svm exact scheme):
//      the hiring agent's custodial Solana wallet settles USDC to the provider, and
//      the provider's upstream executes the REAL skill. The x402 endpoint settles
//      ONLY after the work succeeds (verify → work → settle), so a failed invocation
//      can never charge the hirer — "real value or no transaction" by construction.
//   5. Record a real on-chain invocation receipt (agent-invocation program) with the
//      hiring agent as invoker and the provider agent as target — auditable on both
//      sides with explorer links.
//   6. Finalize the hire + custody ledger so both wallets show the income/outlay and
//      the marketplace's completion stats update from real data only.

import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { limits } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { randomUUID } from 'node:crypto';

import {
	SpendLimitError,
	reserveSpendUsd,
	releaseSpendReservation,
	updateCustodyEvent,
	recordCustodyEvent,
	getSpendLimits,
} from '../_lib/agent-trade-guards.js';
import { writeScreenFrame } from '../_lib/agent-screen-frame.js';
import { hirePhaseFrame, hireCapMath } from '../_lib/a2a-hire-phases.js';
import { payExternalX402, resolveSpendEnabled } from '../_lib/x402-user-payer.js';
import { serviceResourceUrl } from '../_lib/agent-paid-services.js';
import { recoverSolanaAgentKeypair } from '../_lib/agent-wallet.js';
import { recordInvocationReceipt } from '../_lib/agent-invocation-onchain.js';
import {
	atomicsToUsdc,
	getOfferBySlug,
	getHireById,
	recordHire,
	updateHire,
} from '../_lib/agent-economy.js';
import { createApprovalRequest, runApproved, TTL_MS } from '../_lib/approvals.js';
import { recordHireAttestation } from '../_lib/trust/hire-attestations.js';
import { getEffectiveReputation } from '../_lib/trust/reputation-store.js';
import { tierDiscountBps, signDiscountVoucher, DISCOUNT_VOUCHER_HEADER } from '../_lib/trust/hire-discount.js';

// Source key this file registers its executor under (api/_lib/approvals.js EXECUTORS).
export const APPROVAL_SOURCE = 'a2a_hire';

// Pull the settlement signature out of the x402 receipt header object, whatever
// shape the facilitator returned it in.
function receiptSignature(receipt) {
	if (!receipt || typeof receipt !== 'object') return null;
	return receipt.transaction || receipt.signature || receipt.txHash || receipt.tx || null;
}

// Resolve a signed reputation-discount voucher header for this hire, or
// undefined when the offer hasn't opted in or the hirer's tier earns no
// discount. Never throws: a voucher failure must fall back to full price, not
// break the hire.
async function discountHeaders(offer, hirerAgentId) {
	if (!offer.reputation_discount_enabled) return undefined;
	try {
		const rep = await getEffectiveReputation(hirerAgentId);
		const bps = tierDiscountBps(rep?.tier);
		if (bps <= 0) return undefined;
		const voucher = signDiscountVoucher({ slug: offer.slug, hirerAgentId, discountBps: bps });
		return voucher ? { [DISCOUNT_VOUCHER_HEADER]: voucher } : undefined;
	} catch (err) {
		console.error('[a2a-hire] discount voucher failed', err?.message || err);
		return undefined;
	}
}

// A short, human summary of the provider's result for the hire record + speech.
function summarizeResult(result) {
	try {
		if (result == null) return null;
		if (typeof result === 'string') return result.slice(0, 280);
		const inner = result.result ?? result;
		const s = typeof inner === 'string' ? inner : JSON.stringify(inner);
		return s.slice(0, 280);
	} catch {
		return null;
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required to hire an agent');
	const userId = session?.id ?? bearer?.userId;

	// CSRF on the session (cookie) path, like every other custodial write.
	if (session && !(await requireCsrf(req, res, userId))) return;

	const rl = await limits.mcpAgentPay(userId || 'anon');
	if (!rl.success) return rateLimited(res, rl, 'hire rate limit exceeded');

	const body = (await readJson(req)) || {};
	const { hirerAgentId, serviceSlug, input = null, maxUsd } = body;
	const idempotencyKey = body.idempotencyKey || randomUUID();

	if (!hirerAgentId || typeof hirerAgentId !== 'string') {
		return error(res, 400, 'validation_error', 'hirerAgentId is required');
	}
	if (!serviceSlug || typeof serviceSlug !== 'string') {
		return error(res, 400, 'validation_error', 'serviceSlug is required');
	}

	// ── Owner gate: the caller must own the hiring agent ────────────────────
	const [hirer] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${hirerAgentId} AND deleted_at IS NULL
	`;
	if (!hirer) return error(res, 404, 'not_found', 'hiring agent not found');
	if (hirer.user_id !== userId) {
		return error(res, 403, 'forbidden', 'you do not own this agent');
	}
	if (!hirer.meta?.solana_address || !hirer.meta?.encrypted_solana_secret) {
		return error(res, 409, 'no_wallet', 'this agent has no Solana wallet provisioned to pay from');
	}

	// ── Live hire visualizer: push one screen frame per real milestone ──────
	// Viewers on /agent-screen?agentId=<hirer> watch this hire happen. Every push
	// is fire-and-forget and isolated in its own try/catch by writeScreenFrame —
	// a frame write must NEVER block or fail a real settlement.
	let hireRow = null;
	let baseCtx = {}; // filled once the offer resolves; merged into every phase
	// NOT named `limits`: that shadows the rate-limit import used above, which put
	// the whole handler in a temporal dead zone and 500'd every authenticated hire.
	const spendPolicy = getSpendLimits(hirer.meta);
	const pushPhase = (phase, extra = {}) => {
		const frame = hirePhaseFrame(phase, {
			...baseCtx,
			hireId: hireRow?.id ?? null,
			hirerId: hirerAgentId,
			hirerName: hirer.name || null,
			...extra,
		});
		writeScreenFrame(hirerAgentId, frame).catch(() => {});
	};
	// Build the badge cap object from the agent's real spend policy.
	const capBadge = (dailySpentUsd, priceUsd) => {
		const m = hireCapMath({
			usd: priceUsd,
			maxUsd: typeof maxUsd === 'number' ? maxUsd : null,
			perTxUsd: spendPolicy.per_tx_usd,
			dailyUsd: spendPolicy.daily_usd,
			dailySpentUsd,
		});
		return {
			perCallCap: m.perCallCap,
			dailyUsd: m.dailyUsd,
			dailyRemaining: dailySpentUsd != null ? m.dailyRemainingAfter : m.dailyRemainingBefore,
			overCap: m.overCap,
		};
	};

	pushPhase('discover', { slug: serviceSlug });

	// ── Resolve the provider's offer ────────────────────────────────────────
	const offer = await getOfferBySlug(serviceSlug);
	if (!offer) return error(res, 404, 'offer_not_found', `no service offer at ${serviceSlug}`);
	if (!offer.provider?.id) return error(res, 409, 'offer_unavailable', 'this offer has no provider agent');
	if (offer.provider.is_public === false) {
		return error(res, 409, 'offer_unavailable', 'this provider is not currently available');
	}
	if (offer.provider.id === hirerAgentId) {
		return error(res, 400, 'self_hire', 'an agent cannot hire its own service');
	}

	const usd = atomicsToUsdc(offer.price_atomics);
	const priceNetwork = offer.network === 'solana' ? 'solana' : 'base';

	// The hire settles USDC on Solana mainnet; explorer links default to that
	// cluster. Provider/price context is now known — every later phase carries it.
	baseCtx = {
		slug: offer.slug,
		skill: offer.name,
		providerName: offer.provider.name || null,
		providerId: offer.provider.id,
		usd,
		maxUsd: typeof maxUsd === 'number' ? maxUsd : null,
		network: 'mainnet',
	};
	pushPhase('quote', { cap: capBadge(null, usd) });

	// Owner-set per-call ceiling for this hire (can only lower the price gate).
	if (typeof maxUsd === 'number' && Number.isFinite(maxUsd) && usd > maxUsd + 1e-9) {
		pushPhase('over_cap', { cap: capBadge(null, usd) });
		return error(res, 402, 'over_cap', `this service costs $${usd.toFixed(2)}, above your $${maxUsd.toFixed(2)} per-call limit`, {
			price_usd: usd,
			max_usd: maxUsd,
		});
	}

	// Every hire pays mainnet USDC from the hirer's custodial wallet, so the caller
	// must have signed the real-funds agreements before any hire is recorded or
	// any spend is reserved.
	if (!(await requireRealFundsAgreement(req, res, { userId, context: 'a2a-hire' }))) return;

	if (!resolveSpendEnabled()) {
		return error(res, 501, 'spend_disabled', 'autonomous agent spending is not enabled on this server (set THREEWS_AGENT_PAY_ENABLED=1)');
	}

	// ── Idempotency: never double-charge a retried hire ─────────────────────
	try {
		const { row, existing } = await recordHire({
			hirerAgentId,
			hirerUserId: userId,
			providerAgentId: offer.provider.id,
			serviceId: offer.service_id,
			serviceSlug: offer.slug,
			skillName: offer.name,
			amountAtomics: offer.price_atomics,
			usd,
			currency: 'USDC',
			network: priceNetwork,
			payerAddress: hirer.meta.solana_address,
			payoutAddress: offer.provider.solana_address || null,
			idempotencyKey,
			meta: { hirer_name: hirer.name || null, provider_name: offer.provider.name },
		});
		hireRow = row;
		if (existing) {
			if (row.status === 'completed') {
				return json(res, 200, { ok: true, idempotent: true, hire: publicHire(row, offer) });
			}
			if (row.status === 'pending' && row.meta?.awaiting_approval && row.meta?.approval_id) {
				return await respondHireApprovalStatus(res, { userId, approvalId: row.meta.approval_id, hireRow: row, offer });
			}
			if (row.status === 'pending') {
				return error(res, 409, 'hire_in_progress', 'a hire with this key is already in progress');
			}
			// failed/refunded/disputed: tell the caller to retry with a fresh key.
			return error(res, 409, 'hire_terminal', `a prior hire with this key ended '${row.status}'; retry with a new idempotencyKey`, {
				status: row.status,
			});
		}
	} catch (err) {
		console.error('[a2a-hire] recordHire failed', err?.message || err);
		return error(res, 500, 'hire_record_failed', 'could not record the hire');
	}

	// ── Human approval above the hiring agent's spend threshold ─────────────
	// A threshold the owner set on this agent (approval_threshold_usd, settable
	// via PUT on /api/agents/solana-wallet's limits endpoint, same policy object
	// as per_tx_usd/daily_usd) is a decision to see every crossing by hand, not a
	// cap to enforce silently. Checked here, after the hire is recorded but
	// before any spend reservation, so a parked hire never holds funds while it
	// waits and a retry of the same idempotencyKey re-enters at the branch above.
	if (spendPolicy.approval_threshold_usd != null && usd > Number(spendPolicy.approval_threshold_usd) + 1e-9) {
		return await requestHireApproval(res, {
			hirer, offer, hireRow, usd, maxUsd, threshold: spendPolicy.approval_threshold_usd,
			input, pushPhase, capBadge,
		});
	}

	// ── Reserve the spend against the hiring agent's spend policy ────────────
	// Per-tx + daily ceilings + kill switch (frozen), atomic, BEFORE payment.
	let reservationId = null;
	try {
		const reservation = await reserveSpendUsd({
			agentId: hirerAgentId,
			userId,
			meta: hirer.meta,
			category: 'x402',
			usdValue: usd,
			asset: 'USDC',
			network: 'mainnet',
			rowMeta: { kind: 'a2a_hire', slug: offer.slug, provider_agent_id: offer.provider.id, hire_id: hireRow.id },
		});
		reservationId = reservation.reservationId;
		await sql`UPDATE agent_hires SET spend_reservation_id = ${reservationId}, updated_at = now() WHERE id = ${hireRow.id}`;
		// Spend is held within the agent's caps — show the badge with real headroom.
		pushPhase('reserved', { cap: capBadge(Number(reservation.dailySpentUsd ?? 0), usd) });
	} catch (err) {
		await updateHire(hireRow.id, { status: 'failed', error: err?.message || 'spend policy blocked' });
		if (err instanceof SpendLimitError) {
			// A cap/freeze block at reserve time renders as the amber "skipped" card,
			// not a silent gap. over_cap covers per-tx/daily/owner-cap exceedance.
			const capCode = err.code === 'per_tx_exceeded' || err.code === 'daily_exceeded';
			pushPhase(capCode ? 'over_cap' : 'failed', {
				cap: capBadge(null, usd),
				error: capCode ? undefined : err.message,
			});
			return error(res, err.status || 403, err.code || 'spend_blocked', err.message, err.detail || {});
		}
		console.error('[a2a-hire] reserve failed', err?.message || err);
		return error(res, 500, 'reserve_failed', 'could not reserve the spend');
	}

	// ── Pay over the real x402 rails (settles to the provider's wallet) ──────
	// The remote skill runs inside this call (verify → work → settle). Narrate the
	// "running" beat before it; the coin animation fires only on the settled frame.
	pushPhase('running');
	let payment;
	try {
		payment = await payExternalX402({
			userId,
			agentId: hirerAgentId,
			url: serviceResourceUrl(offer.slug),
			method: offer.method === 'POST' ? 'POST' : 'GET',
			body: offer.method === 'POST' ? (input ?? {}) : undefined,
			maxUsd: usd,
			headers: await discountHeaders(offer, hirerAgentId),
		});
	} catch (err) {
		// The x402 endpoint settles only after the provider's work succeeds, so a
		// throw here means NO money moved: release the hold and fail honestly.
		await releaseSpendReservation(reservationId, 'hire_payment_failed');
		await updateHire(hireRow.id, { status: 'failed', error: err?.message || String(err) });
		await recordHireAttestation(hireRow, { phase: 'failed', err }).catch((e) =>
			console.error('[a2a-hire] attestation failed', e?.message || e),
		);
		const code = err?.code || 'payment_failed';
		const status = code === 'spend_disabled' ? 501 : code === 'no_wallet' || code === 'no_solana_wallet' ? 409 : 502;
		// Verify-then-settle means no funds moved — say so on the screen, no coin.
		pushPhase('failed', { error: err?.message || code });
		console.error('[a2a-hire] payment failed', code, err?.message || err);
		return error(res, status, code, `the hire did not complete — no funds were moved: ${err?.message || code}`);
	}

	const paymentSignature = receiptSignature(payment.receipt);
	const payerAddress = payment.payer || hirer.meta.solana_address;

	// Real USDC has settled to the provider — this is the frame the coin animation
	// fires on. Then the delivery beat with a short summary of the provider's work.
	pushPhase('settled', { txSig: paymentSignature, cap: capBadge(null, usd) });
	const deliveredSummary = summarizeResult(payment.result);
	pushPhase('delivered', { txSig: paymentSignature, resultSummary: deliveredSummary });

	// Finalize the spend reservation as confirmed (real, settled).
	await updateCustodyEvent(reservationId, {
		status: 'confirmed',
		signature: paymentSignature,
		meta: { settled: true },
	}).catch((e) => console.error('[a2a-hire] finalize custody failed', e?.message));

	// Record the provider's income in the custody ledger so it surfaces in the
	// live money pulse / money-cam as the provider earning (real inflow, real tx).
	if (offer.provider.id) {
		recordCustodyEvent({
			agentId: offer.provider.id,
			userId: null,
			eventType: 'tip',
			category: null,
			network: 'mainnet',
			asset: 'USDC',
			usd,
			signature: paymentSignature,
			status: 'confirmed',
			meta: { source: 'a2a_hire', from_agent_id: hirerAgentId, from: payerAddress, hire_id: hireRow.id, skill: offer.name },
		}).catch((e) => console.error('[a2a-hire] provider income record failed', e?.message));
	}

	// ── Write the real on-chain invocation receipt ──────────────────────────
	let invocation = null;
	let invocationError = null;
	try {
		const invokerKeypair = await recoverSolanaAgentKeypair(hirer.meta.encrypted_solana_secret, {
			agentId: hirerAgentId,
			userId,
			reason: 'a2a_hire_invocation_receipt',
		});
		const targetAuthority = offer.provider.solana_address;
		if (!targetAuthority) throw new Error('provider has no Solana authority to record against');
		invocation = await recordInvocationReceipt({
			invokerKeypair,
			targetAuthority,
			skillName: offer.name,
			parameters: JSON.stringify({ slug: offer.slug, hire: hireRow.id, usd }).slice(0, 480),
		});
	} catch (err) {
		// The payment + work are real and done; a receipt-write failure (e.g. the
		// agent wallet lacks SOL for the fee) must not undo a completed hire. Record
		// the reason and surface it honestly rather than faking a signature.
		invocationError = err?.message || String(err);
		console.error('[a2a-hire] invocation receipt failed', invocationError);
	}

	// Terminal beat: the receipt card resolves with both real signatures. If the
	// invocation write failed we still emit `recorded` (without an invocation sig)
	// so the viewer sees a completed hire, with the settlement proof intact.
	pushPhase('recorded', {
		txSig: paymentSignature,
		invocationSig: invocation?.signature || null,
		resultSummary: deliveredSummary,
		error: invocationError || undefined,
	});

	// ── Finalize the hire ───────────────────────────────────────────────────
	const finalized = await updateHire(hireRow.id, {
		status: 'completed',
		paymentSignature,
		payerAddress,
		invocationSignature: invocation?.signature || null,
		invocationError,
		resultSummary: summarizeResult(payment.result),
		meta: {
			receipt: payment.receipt || null,
			invocation: invocation || null,
		},
	});

	await recordHireAttestation(finalized || hireRow, {
		phase: 'recorded',
		paymentSignature,
		invocationSignature: invocation?.signature || null,
		resultSummary: deliveredSummary,
	}).catch((e) => console.error('[a2a-hire] attestation failed', e?.message || e));

	return json(res, 200, {
		ok: true,
		hire: publicHire(finalized || hireRow, offer, { invocation, payment }),
		result: payment.result ?? null,
	});
});

// ── Park a hire that crossed the hiring agent's approval threshold ──────────
// Spend was never reserved for this hire (the threshold is checked before the
// "Reserve the spend" block), so there is nothing to roll back here: the hire
// row stays 'pending' and simply waits for executeApprovedA2aHire to run the
// rest of the flow once the owner approves.
async function requestHireApproval(res, { hirer, offer, hireRow, usd, maxUsd, threshold, input, pushPhase, capBadge }) {
	pushPhase('awaiting_approval', { cap: capBadge(null, usd) });
	const created = await createApprovalRequest({
		userId: hirer.user_id,
		agentId: hirer.id,
		source: APPROVAL_SOURCE,
		sourceRef: hireRow.id,
		actionType: 'a2a_hire',
		venue: 'a2a_hire',
		payload: {
			kind: 'a2a_hire',
			hire_id: hireRow.id,
			hirer_agent_id: hirer.id,
			provider_agent_id: offer.provider.id,
			service_slug: offer.slug,
			usd,
			max_usd: typeof maxUsd === 'number' ? maxUsd : null,
			input,
		},
		summary: `Agent "${hirer.name || hirer.id}" wants to hire "${offer.provider.name || offer.provider.id}" for ${offer.name} ($${usd.toFixed(2)})`,
		amount: usd,
		amountUsd: usd,
		asset: 'USDC',
		chain: 'solana',
		network: 'mainnet',
		recipient: offer.provider.name || offer.provider.id,
		riskNotes: [
			`This agent's approval threshold is $${Number(threshold).toFixed(2)}.`,
			`Service: ${offer.slug}`,
		],
		gateReason: `Hire price $${usd.toFixed(2)} exceeds this agent's $${Number(threshold).toFixed(2)} approval threshold.`,
		idempotencyKey: `${APPROVAL_SOURCE}:${hireRow.id}`,
		ttlMs: TTL_MS.transfer,
		autoApprovable: false,
	});

	const req = created.request;
	await updateHire(hireRow.id, { meta: { awaiting_approval: true, approval_id: req.id } });

	if (created.autoApproved) {
		const { outcome } = await runApproved(req, (claim) => executeApprovedA2aHire(claim));
		if (outcome?.status === 'ok' && outcome.data) return json(res, 200, outcome.data);
		return error(res, 502, 'approved_execution_failed', outcome?.note || 'the auto-approved hire did not complete');
	}
	return renderHireApprovalStatus(res, req, hireRow, offer);
}

// Shared by the fresh-create 202 and the idempotent-retry poll: render the
// current state of a hire that is (or was) parked on an approval request.
async function respondHireApprovalStatus(res, { userId, approvalId, hireRow, offer }) {
	const [approvalRow] = await sql`
		SELECT * FROM approval_requests WHERE id = ${approvalId} AND user_id = ${userId}
	`;
	if (!approvalRow) return error(res, 404, 'not_found', 'approval request not found');
	return renderHireApprovalStatus(res, approvalRow, hireRow, offer);
}

function renderHireApprovalStatus(res, approvalRow, hireRow, offer) {
	const status = approvalRow.status;
	if (status === 'executed') {
		const data = approvalRow.result?.data;
		if (data) return json(res, 200, data);
		return error(res, 502, 'approved_execution_missing_result', 'the hire was approved and executed, but its result was not retained');
	}
	if (status === 'failed') {
		return error(res, 502, 'approved_execution_failed', approvalRow.result?.note || 'the approved hire did not complete');
	}
	if (status === 'denied') {
		return error(res, 403, 'approval_denied', 'the owner denied this hire');
	}
	if (status === 'expired') {
		return error(res, 410, 'approval_expired', 'this approval request expired before the owner answered; retry with a new idempotencyKey to ask again');
	}
	// pending, approved, executing: still waiting on the owner (or the executor).
	return json(res, 202, {
		ok: false,
		hire: publicHire(hireRow, offer),
		pending_approval: true,
		approval: {
			id: approvalRow.id,
			status: approvalRow.status,
			link: `/approvals/${approvalRow.id}`,
			expires_at: approvalRow.expires_at,
		},
		message: `this hire needs the owner's approval before it runs: ${approvalRow.summary}. Call this same request again to check status.`,
	});
}

/**
 * Executor registered for source 'a2a_hire' (api/_lib/approvals.js EXECUTORS).
 * Re-runs the reserve-spend → pay-over-x402 → receipt → finalize sequence from
 * the main handler, scoped to ONLY the data stashed in row.payload, after the
 * owner has approved. Mirrors the main handler's error handling exactly:
 * payment_failed still releases the spend reservation, and a receipt failure
 * still completes the hire (the payment already settled).
 */
export async function executeApprovedA2aHire(row) {
	const p = row.payload || {};
	if (p.kind !== 'a2a_hire') {
		return { status: 'error', note: 'unknown hire action, so nothing was executed' };
	}

	const hireRow = await getHireById(p.hire_id);
	if (!hireRow) return { status: 'error', note: 'the hire record for this approval no longer exists' };

	const offer = await getOfferBySlug(p.service_slug);
	if (!offer) return { status: 'error', note: `the service offer "${p.service_slug}" is no longer available` };

	if (hireRow.status === 'completed') {
		return {
			status: 'ok',
			signature: hireRow.payment_signature || undefined,
			usd: hireRow.usd != null ? Number(hireRow.usd) : undefined,
			note: 'hire already completed',
			data: { ok: true, hire: publicHire(hireRow, offer), result: null },
		};
	}

	const [hirer] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${p.hirer_agent_id} AND deleted_at IS NULL
	`;
	if (!hirer) return { status: 'error', note: 'the hiring agent no longer exists' };
	if (!hirer.meta?.solana_address || !hirer.meta?.encrypted_solana_secret) {
		return { status: 'error', note: 'the hiring agent no longer has a Solana wallet provisioned' };
	}

	const usd = Number(p.usd ?? hireRow.usd ?? 0);
	const userId = hirer.user_id;

	let reservationId = null;
	try {
		const reservation = await reserveSpendUsd({
			agentId: hirer.id,
			userId,
			meta: hirer.meta,
			category: 'x402',
			usdValue: usd,
			asset: 'USDC',
			network: 'mainnet',
			rowMeta: { kind: 'a2a_hire', slug: offer.slug, provider_agent_id: offer.provider.id, hire_id: hireRow.id },
		});
		reservationId = reservation.reservationId;
		await sql`UPDATE agent_hires SET spend_reservation_id = ${reservationId}, updated_at = now() WHERE id = ${hireRow.id}`;
	} catch (err) {
		await updateHire(hireRow.id, { status: 'failed', error: err?.message || 'spend policy blocked' });
		return { status: 'error', note: err?.message || 'the hire could not be re-reserved after approval' };
	}

	let payment;
	try {
		payment = await payExternalX402({
			userId,
			agentId: hirer.id,
			url: serviceResourceUrl(offer.slug),
			method: offer.method === 'POST' ? 'POST' : 'GET',
			body: offer.method === 'POST' ? (p.input ?? {}) : undefined,
			maxUsd: usd,
			headers: await discountHeaders(offer, hirer.id),
		});
	} catch (err) {
		await releaseSpendReservation(reservationId, 'hire_payment_failed');
		await updateHire(hireRow.id, { status: 'failed', error: err?.message || String(err) });
		await recordHireAttestation(hireRow, { phase: 'failed', err }).catch((e) =>
			console.error('[a2a-hire] attestation failed', e?.message || e),
		);
		return {
			status: 'error',
			note: `the hire did not complete after approval, no funds were moved: ${err?.message || err?.code || 'payment_failed'}`,
		};
	}

	const paymentSignature = receiptSignature(payment.receipt);
	const payerAddress = payment.payer || hirer.meta.solana_address;
	const deliveredSummary = summarizeResult(payment.result);

	await updateCustodyEvent(reservationId, {
		status: 'confirmed',
		signature: paymentSignature,
		meta: { settled: true },
	}).catch(() => {});

	if (offer.provider.id) {
		recordCustodyEvent({
			agentId: offer.provider.id,
			userId: null,
			eventType: 'tip',
			category: null,
			network: 'mainnet',
			asset: 'USDC',
			usd,
			signature: paymentSignature,
			status: 'confirmed',
			meta: { source: 'a2a_hire', from_agent_id: hirer.id, from: payerAddress, hire_id: hireRow.id, skill: offer.name },
		}).catch(() => {});
	}

	let invocation = null;
	let invocationError = null;
	try {
		const invokerKeypair = await recoverSolanaAgentKeypair(hirer.meta.encrypted_solana_secret, {
			agentId: hirer.id,
			userId,
			reason: 'a2a_hire_invocation_receipt',
		});
		const targetAuthority = offer.provider.solana_address;
		if (!targetAuthority) throw new Error('provider has no Solana authority to record against');
		invocation = await recordInvocationReceipt({
			invokerKeypair,
			targetAuthority,
			skillName: offer.name,
			parameters: JSON.stringify({ slug: offer.slug, hire: hireRow.id, usd }).slice(0, 480),
		});
	} catch (err) {
		invocationError = err?.message || String(err);
	}

	const finalized = await updateHire(hireRow.id, {
		status: 'completed',
		paymentSignature,
		payerAddress,
		invocationSignature: invocation?.signature || null,
		invocationError,
		resultSummary: deliveredSummary,
		meta: {
			receipt: payment.receipt || null,
			invocation: invocation || null,
			awaiting_approval: false,
		},
	});

	await recordHireAttestation(finalized || hireRow, {
		phase: 'recorded',
		paymentSignature,
		invocationSignature: invocation?.signature || null,
		resultSummary: deliveredSummary,
	}).catch((e) => console.error('[a2a-hire] attestation failed', e?.message || e));

	return {
		status: 'ok',
		signature: paymentSignature || undefined,
		usd,
		note: 'hire executed after owner approval',
		data: {
			ok: true,
			hire: publicHire(finalized || hireRow, offer, { invocation, payment }),
			result: payment.result ?? null,
		},
	};
}

// Shape the hire for the client, including explorer links derived from the real
// on-chain signatures. The embodied layer + money-cam consume `embodied`.
function publicHire(row, offer, extra = {}) {
	const cluster = (extra?.invocation?.network || 'mainnet') === 'devnet' ? '?cluster=devnet' : '';
	const paymentSig = row.payment_signature || null;
	const invSig = row.invocation_signature || extra?.invocation?.signature || null;
	return {
		id: row.id,
		status: row.status,
		skill_name: row.skill_name,
		service_slug: row.service_slug,
		amount_atomics: String(row.amount_atomics),
		usd: row.usd != null ? Number(row.usd) : atomicsToUsdc(row.amount_atomics),
		currency: row.currency || 'USDC',
		network: row.network,
		hirer_agent_id: row.hirer_agent_id,
		provider_agent_id: row.provider_agent_id,
		provider: offer?.provider || null,
		payer_address: row.payer_address || null,
		payout_address: row.payout_address || null,
		payment_signature: paymentSig,
		payment_explorer: paymentSig ? `https://solscan.io/tx/${paymentSig}` : null,
		invocation_signature: invSig,
		invocation_explorer: invSig
			? `https://solscan.io/tx/${invSig}${cluster}`
			: null,
		invocation_error: row.invocation_error || null,
		result_summary: row.result_summary || null,
		created_at: row.created_at,
		completed_at: row.completed_at || null,
		// Drives the embodied 3D hand-off + Galaxy money-cam flow on the client.
		embodied: {
			from: row.hirer_agent_id,
			to: row.provider_agent_id,
			amountUsdc: row.usd != null ? Number(row.usd) : atomicsToUsdc(row.amount_atomics),
			type: 'payment',
		},
	};
}
