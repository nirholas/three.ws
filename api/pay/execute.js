// POST /api/pay/execute: execute an x402 payment using a Payment Session token.
//
// This is the core "agent proposes spend, governance enforces" endpoint.
// The agent presents:
//   - session_token: their payment session bearer token
//   - url: the x402 endpoint to pay
//   - method: GET | POST (optional, default GET)
//   - body: JSON body for POST requests (optional)
//   - idempotency_key: caller's dedup key (optional, recommended)
//
// The platform:
//   1. Verifies the session token and reads the session's network preference
//   2. Probes the endpoint for its 402 challenge, selecting the right network accept
//   3. Enforces governance (budget, allowlist, per-tx cap) and reserves budget atomically
//   4. Signs the payment using the platform Solana payer wallet (loadSeedKeypair:
//      X402_SEED_SOLANA_SECRET_BASE58, falling back to X402_AGENT_SOLANA_SECRET_BASE58)
//   5. Presents X-PAYMENT header and returns the endpoint's response
//   6. Records the execution in payment_session_executions
//   7. On failure, rolls back the budget reservation so the session isn't charged
//
// No private key is ever exposed to the caller. The only secret is the session
// token, which is a time-bounded spending grant, not wallet access.

import {
	PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction,
	TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import { loadSeedKeypair } from '../_lib/x402/pay.js';
import { cors, error, json, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { validatePublicUrl, SsrfError } from '../_lib/ssrf.js';
import {
	guardedFetch,
	safeJson,
	b64decodeJson,
	readChallenge,
	USDC_SOLANA_MINT,
} from '../_lib/pay/probe.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import { mintDecimals, ataExists, getRecentBlockhash, isRpcUnavailable, RPC_RETRY_AFTER_SECONDS } from '../_lib/solana/read-guards.js';
import {
	atomicsToUsd,
	verifySessionToken,
	reserveSessionSpend,
	rollbackReservation,
	recordExecution,
	SpendGovernorError,
} from '../_lib/pay/spend-governor.js';
import { computeRequestHash } from '../_lib/pay/policy.js';
import { createApprovalRequest, runApproved, isUuid, TTL_MS } from '../_lib/approvals.js';
import { sql } from '../_lib/db.js';

const SOLANA_RPC = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Source key this file registers its executor under (api/_lib/approvals.js EXECUTORS).
export const APPROVAL_SOURCE = 'payment_session_execute';

// ── Platform payer: Solana ───────────────────────────────────────────────────
let _solanaKeypair = null;

function loadSolanaKeypair() {
	if (_solanaKeypair) return _solanaKeypair;
	// Same payer wallet as the x402 ring and /api/x402-pay: loadSeedKeypair reads
	// X402_SEED_SOLANA_SECRET_BASE58 (primary) then X402_AGENT_SOLANA_SECRET_BASE58
	// (fallback), auto-detects the key encoding, and falls back to the dev test
	// keypair off disk outside production. See api/_lib/solana-signers.js.
	try {
		_solanaKeypair = loadSeedKeypair();
		return _solanaKeypair;
	} catch (err) {
		const e = new Error(err?.message || 'Platform Solana payer wallet not configured');
		e.status = 503;
		e.code = /undecodable/i.test(err?.message || '') ? 'wallet_misconfigured' : 'wallet_unconfigured';
		e.cause = err;
		throw e;
	}
}

// ── Probe a 402 endpoint and select a Solana USDC accept ────────────────────
// Exported for tests/pay-probe-endpoint-error.test.js: this is where a caller's
// URL turns into an amount the session is about to be charged, so its refusals
// are worth pinning independently of the signing path around them.
export async function probe402(rawUrl, { method, body }) {
	let res;
	try {
		res = await guardedFetch(rawUrl, { method, body });
	} catch (err) {
		if (err instanceof SsrfError) {
			throw Object.assign(new Error('Target URL is not a reachable public endpoint'), {
				status: 400, code: 'blocked_url',
			});
		}
		throw Object.assign(new Error(`Could not reach endpoint: ${err?.message}`), {
			status: 502, code: 'endpoint_unreachable',
		});
	}

	if (res.status !== 402) {
		// A success without a challenge is genuinely free and is handed straight
		// back. An error status is not: answering `ok: true, paid: false, "no
		// payment needed"` for a 500 told the agent its call succeeded for free
		// when the endpoint had in fact failed. Nothing was signed and no budget
		// was reserved at this point, so this is a clean 502 about the endpoint.
		if (res.ok) {
			return { free: true, status: res.status, result: safeJson(res.text) ?? res.text };
		}
		const parsed = safeJson(res.text);
		throw Object.assign(
			new Error(`Endpoint answered HTTP ${res.status} with no payment challenge, so there was nothing to pay`),
			{
				status: 502,
				code: 'endpoint_error',
				detail: {
					upstream_status: res.status,
					upstream_body: parsed ?? String(res.text ?? '').slice(0, 500),
				},
			},
		);
	}

	const challenge = readChallenge(res);
	if (!challenge || !Array.isArray(challenge.accepts)) {
		throw Object.assign(new Error('Service returned an unreadable payment challenge'), {
			status: 502, code: 'invalid_challenge',
		});
	}

	let accept = challenge.accepts.find(
		(a) => typeof a?.network === 'string' &&
			a.network.startsWith('solana') &&
			a.asset === USDC_SOLANA_MINT,
	);
	if (!accept) {
		accept = challenge.accepts.find(
			(a) => typeof a?.network === 'string' && a.network.startsWith('solana'),
		);
	}
	if (!accept) {
		throw Object.assign(new Error('Service has no Solana USDC payment option'), {
			status: 422, code: 'no_solana_accept',
			detail: { networks: [...new Set(challenge.accepts.map((a) => a?.network).filter(Boolean))] },
		});
	}
	if (accept.asset !== USDC_SOLANA_MINT) {
		throw Object.assign(new Error(`Service requested payment in a non-USDC asset (${accept.asset})`), {
			status: 422, code: 'unsupported_asset',
			detail: { asset: accept.asset, expected: USDC_SOLANA_MINT },
		});
	}
	if (!accept.extra?.feePayer) {
		throw Object.assign(new Error('Solana 402 challenge is missing feePayer'), {
			status: 422, code: 'missing_fee_payer',
		});
	}
	if (!accept.payTo) {
		throw Object.assign(new Error('Solana 402 challenge is missing payTo'), {
			status: 422, code: 'missing_pay_to',
		});
	}

	// The price is third-party input and every later step treats it as a BigInt:
	// it sizes the budget reservation and the transfer instruction. Parsing it
	// here means a challenge quoting "1.5" or "free" is a 422 about the service,
	// not an uncaught throw that reserves nothing and reports a 500.
	let amountAtomics;
	try {
		amountAtomics = BigInt(accept.amount);
	} catch {
		throw Object.assign(
			new Error(`Service quoted an unreadable price (${accept.amount})`),
			{ status: 422, code: 'invalid_amount', detail: { amount: accept.amount ?? null } },
		);
	}
	if (amountAtomics <= 0n) {
		throw Object.assign(
			new Error('Service quoted a non-positive price, which cannot be paid'),
			{ status: 422, code: 'invalid_amount', detail: { amount: String(amountAtomics) } },
		);
	}

	const resource =
		challenge.resource && typeof challenge.resource === 'object'
			? challenge.resource
			: { url: typeof challenge.resource === 'string' ? challenge.resource : rawUrl };

	return { challenge, accept, resource, amountAtomics };
}

// ── Build and sign the Solana USDC transfer ─────────────────────────────────
async function buildSolanaPayload({ accept, amount, buyer, conn, resourceUrl }) {
	const mint = new PublicKey(accept.asset);
	const payTo = new PublicKey(accept.payTo);
	const feePayer = new PublicKey(accept.extra.feePayer);

	const senderAta = getAssociatedTokenAddressSync(
		mint, buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	const receiverAta = getAssociatedTokenAddressSync(
		mint, payTo, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	// Guarded reads (api/_lib/solana/read-guards.js): USDC decimals resolve
	// locally, the ATA probe fails open to an idempotent create, and the blockhash
	// is served from the shared cache inside its validity window during an outage.
	const decimals = await mintDecimals(conn, mint);

	const ixs = [
		ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
	];
	if (!(await ataExists(conn, receiverAta))) {
		ixs.push(createAssociatedTokenAccountIdempotentInstruction(
			feePayer, receiverAta, payTo, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
		));
	}
	ixs.push(createTransferCheckedInstruction(
		senderAta, mint, receiverAta, buyer.publicKey,
		amount, decimals, [], TOKEN_PROGRAM_ID,
	));

	const blockhash = await getRecentBlockhash(conn, SOLANA_RPC);
	const message = new TransactionMessage({
		payerKey: feePayer,
		recentBlockhash: blockhash,
		instructions: ixs,
	}).compileToV0Message();
	const vtx = new VersionedTransaction(message);
	vtx.sign([buyer]);

	return {
		x402Version: 2,
		scheme: 'exact',
		network: accept.network,
		resource: { url: resourceUrl, mimeType: 'application/json' },
		accepted: accept,
		payload: { transaction: Buffer.from(vtx.serialize()).toString('base64') },
	};
}

// Explorer URL for a given tx hash
function explorerUrl(txHash) {
	if (!txHash) return null;
	return `https://solscan.io/tx/${txHash}`;
}

function hostOf(rawUrl) {
	try { return new URL(rawUrl).hostname; } catch { return String(rawUrl || ''); }
}

// ── Settle a reserved payment: sign, submit, record ─────────────────────────
// Everything after governance clears (build the signed payload, submit it,
// record the execution). Pulled out of the main handler so the exact same
// settlement path can run either synchronously (the direct call) or later,
// from the approval executor, once the owner has approved a call that crossed
// the session's approval threshold. Never writes to an HTTP response: it
// returns a plain result so both callers can shape their own response.
async function settlePayment({
	sessionRecord, railReservationId, policyDigest, verdictCode, verdictSignature, verdictSignedAt,
	targetUrl, method, requestBody, accept, resource, amountAtomics, amountUsd, idempotencyKey, t0,
}) {
	let keypair;
	try {
		keypair = loadSolanaKeypair();
	} catch (err) {
		await rollbackReservation(sessionRecord.id, amountAtomics, { railReservationId }).catch(() => {});
		return {
			ok: false,
			status: err.status ?? 503,
			code: err.code ?? 'wallet_unconfigured',
			message: err.message || 'Platform Solana payment wallet is not configured',
		};
	}
	const payerAddress = keypair.publicKey.toBase58();
	const conn = solanaConnection({ url: SOLANA_RPC, commitment: 'confirmed' });

	let paymentPayload;
	try {
		paymentPayload = await buildSolanaPayload({
			accept, amount: amountAtomics, buyer: keypair, conn, resourceUrl: resource.url || targetUrl,
		});
	} catch (err) {
		await rollbackReservation(sessionRecord.id, amountAtomics, { railReservationId }).catch(() => {});
		if (isRpcUnavailable(err)) {
			return {
				ok: false, status: 503, code: 'rpc_unavailable',
				message: 'Solana RPC temporarily unavailable; payment not built, retry shortly',
				detail: { retryable: true, retry_after: RPC_RETRY_AFTER_SECONDS },
				headers: { 'retry-after': String(RPC_RETRY_AFTER_SECONDS) },
			};
		}
		return { ok: false, status: 502, code: 'build_failed', message: `Failed to build Solana payment: ${err?.message}` };
	}

	const xPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

	let paid;
	try {
		paid = await guardedFetch(targetUrl, { method, body: requestBody, headers: { 'X-PAYMENT': xPayment } });
	} catch (err) {
		// Network failure AFTER signing: chain state unknown, do NOT roll back.
		await recordExecution({
			sessionId: sessionRecord.id, userId: sessionRecord.user_id, endpointUrl: targetUrl, method,
			amountAtomics, network: accept.network, txHash: null, payerAddress, payeeAddress: accept.payTo,
			status: 'failed', errorCode: 'settle_uncertain', errorMessage: err?.message,
			durationMs: Date.now() - t0, idempotencyKey, policyDigest, verdictCode, verdictSignature, verdictSignedAt,
		}).catch(() => {});
		return {
			ok: false, status: 502, code: 'settle_uncertain',
			message: 'Payment was submitted but confirmation was not received. Do not retry immediately.',
		};
	}

	const paidJson = safeJson(paid.text) ?? paid.text;
	const settled = b64decodeJson(paid.headers.get('x-payment-response'));
	const txHash = settled?.transaction || settled?.txHash || null;
	const payer = settled?.payer || payerAddress;
	const durationMs = Date.now() - t0;

	if (paid.status === 402) {
		// The signed transfer was already handed to the host. A host that is also
		// the fee payer can co-sign and broadcast it, then answer 402, so a 402
		// is not proof nothing landed: the reservation stays spent.
		await recordExecution({
			sessionId: sessionRecord.id, userId: sessionRecord.user_id, endpointUrl: targetUrl, method,
			amountAtomics, network: accept.network, txHash: null, payerAddress: payer, payeeAddress: accept.payTo,
			status: 'failed', errorCode: 'payment_rejected', errorMessage: 'Service rejected the payment before settlement',
			durationMs, idempotencyKey, policyDigest, verdictCode, verdictSignature, verdictSignedAt,
		}).catch(() => {});
		return {
			ok: false, status: 402, code: 'payment_rejected',
			message: 'Service answered 402 after the signed payment was submitted. The budget stays reserved because the transfer may still land.',
			detail: typeof paidJson === 'object' ? paidJson : null,
		};
	}

	if (!paid.ok) {
		await recordExecution({
			sessionId: sessionRecord.id, userId: sessionRecord.user_id, endpointUrl: targetUrl, method,
			amountAtomics, network: accept.network, txHash, payerAddress: payer, payeeAddress: accept.payTo,
			status: 'failed', errorCode: 'upstream_error', errorMessage: `Endpoint returned HTTP ${paid.status}`,
			responseBody: typeof paidJson === 'object' ? paidJson : null,
			durationMs, idempotencyKey, policyDigest, verdictCode, verdictSignature, verdictSignedAt,
		}).catch(() => {});
		return {
			ok: false, status: 502, code: 'upstream_error',
			message: `Endpoint returned HTTP ${paid.status} after payment. Check wallet activity before retrying.`,
		};
	}

	await recordExecution({
		sessionId: sessionRecord.id, userId: sessionRecord.user_id, endpointUrl: targetUrl, method,
		amountAtomics, network: accept.network, txHash, payerAddress: payer, payeeAddress: accept.payTo,
		status: 'settled', responseBody: typeof paidJson === 'object' ? paidJson : null,
		durationMs, idempotencyKey, policyDigest, verdictCode, verdictSignature, verdictSignedAt,
	}).catch(() => {});

	return {
		ok: true,
		body: {
			ok: true,
			paid: true,
			result: paidJson,
			payment: {
				session_id: sessionRecord.id,
				amount_usd: amountUsd,
				network: accept.network,
				payer,
				pay_to: accept.payTo,
				tx_hash: txHash,
				explorer: explorerUrl(txHash),
			},
			session: {
				id: sessionRecord.id,
				spent_usd: atomicsToUsd(BigInt(sessionRecord.spent_usdc)),
				remaining_usd: atomicsToUsd(BigInt(sessionRecord.budget_usdc) - BigInt(sessionRecord.spent_usdc)),
			},
			duration_ms: durationMs,
		},
	};
}

function sendSettlement(res, result) {
	if (result.ok) return json(res, 200, result.body);
	if (result.headers) for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
	return error(res, result.status, result.code, result.message, result.detail);
}

// ── Resume a call the owner approved, with no session token in hand ─────────
// The approval payload stores only the session id (never the bearer token: a
// polling agent should not need to have kept it, and the owner approving from
// the web UI never sees it either). approvalGranted:true lifts only the
// approval-threshold rule inside the governor; every other rule (allowlist,
// per-tx, rail cap, budget) still runs for real, so an approval can never
// widen anything but the one check it answered.
export async function runPaymentSessionApproval({ sessionId, url, method, body, idempotencyKey }) {
	const t0 = Date.now();
	const probeResult = await probe402(url, { method, body });
	if (probeResult.free) {
		return {
			ok: true,
			body: {
				ok: true, paid: false,
				note: 'Endpoint served response without a 402. No payment needed.',
				status: probeResult.status, result: probeResult.result,
			},
		};
	}
	const { accept, resource, amountAtomics } = probeResult;
	const amountUsd = atomicsToUsd(amountAtomics);
	const reservation = await reserveSessionSpend({ sessionId, url, amountAtomics, approvalGranted: true });
	return settlePayment({
		sessionRecord: reservation.session,
		railReservationId: reservation.railReservationId,
		policyDigest: reservation.policyDigest,
		verdictCode: reservation.verdictCode,
		verdictSignature: reservation.verdictSignature,
		verdictSignedAt: reservation.verdictSignedAt,
		targetUrl: url, method, requestBody: body, accept, resource, amountAtomics, amountUsd, idempotencyKey, t0,
	});
}

/**
 * Executor registered for source 'payment_session_execute' (api/_lib/approvals.js
 * EXECUTORS). Runs ONLY row.payload, once, after the owner approves.
 */
export async function executeApprovedPaymentSessionCall(row) {
	const p = row.payload || {};
	if (p.kind !== 'payment_session_execute') {
		return { status: 'error', note: 'Unknown payment action, so nothing was executed.' };
	}
	try {
		const result = await runPaymentSessionApproval({
			sessionId: p.session_id, url: p.url, method: p.method, body: p.body, idempotencyKey: p.idempotency_key,
		});
		if (!result.ok) return { status: 'error', note: result.message || 'The payment did not go through.' };
		return {
			status: 'ok',
			signature: result.body?.payment?.tx_hash || undefined,
			usd: result.body?.payment?.amount_usd ?? undefined,
			note: 'Payment executed after owner approval.',
			data: result.body,
		};
	} catch (err) {
		return { status: 'error', note: (err?.message || 'execution failed').slice(0, 240) };
	}
}

/** Shared by the direct 202 response and the GET poll: render the current state of a parked call. */
function respondFromApprovalStatus(res, approvalRow) {
	const status = approvalRow.status;
	if (status === 'executed') {
		const data = approvalRow.result?.data;
		if (data) return json(res, 200, data);
		return error(res, 502, 'approved_execution_missing_result', 'The payment was approved and executed, but its result was not retained.');
	}
	if (status === 'failed') {
		return error(res, 502, 'approved_execution_failed', approvalRow.result?.note || 'The approved payment did not go through.');
	}
	if (status === 'denied') {
		return error(res, 403, 'approval_denied', 'The owner denied this payment.');
	}
	if (status === 'expired') {
		return error(res, 410, 'approval_expired', 'This approval request expired before the owner answered. Call execute again to ask once more.');
	}
	// pending, approved, executing: still waiting on the owner (or the inline executor).
	return json(res, 202, {
		ok: false,
		paid: false,
		pending_approval: true,
		approval: {
			id: approvalRow.id,
			status: approvalRow.status,
			link: `/approvals/${approvalRow.id}`,
			expires_at: approvalRow.expires_at,
		},
		message: `This payment needs the owner's approval before it settles: ${approvalRow.summary}. Poll GET /api/pay/execute?approval_id=${approvalRow.id}&session_token=<token>, or call this same request again, to check status.`,
	});
}

/** Park a call that crossed the session's approval threshold and respond 202 with a poll URL. */
async function respondRequiresApproval(res, { session, targetUrl, method, requestBody, idempotencyKey, amountAtomics, amountUsd, detail }) {
	const reqHash = computeRequestHash({ sessionId: session.id, url: targetUrl, amountAtomics });
	const label = session.label || `session ${String(session.id).slice(0, 8)}`;
	const created = await createApprovalRequest({
		userId: session.user_id,
		agentId: session.agent_id || null,
		source: APPROVAL_SOURCE,
		sourceRef: reqHash,
		actionType: 'payment_session_execute',
		venue: 'payment_session_execute',
		payload: {
			kind: 'payment_session_execute',
			session_id: session.id,
			url: targetUrl,
			method,
			body: requestBody,
			idempotency_key: idempotencyKey,
		},
		summary: `Payment session "${label}" wants to pay $${amountUsd.toFixed(2)} to ${hostOf(targetUrl)}`,
		amount: amountUsd,
		amountUsd,
		asset: 'USDC',
		chain: session.network === 'base' ? 'base' : 'solana',
		network: 'mainnet',
		recipient: hostOf(targetUrl),
		riskNotes: [
			`This session's approval threshold is $${Number(detail?.threshold_usd ?? 0).toFixed(2)}.`,
			`Target endpoint: ${targetUrl}`,
		],
		gateReason: detail?.message || 'Payment exceeds the session approval threshold.',
		idempotencyKey: `${APPROVAL_SOURCE}:${reqHash}`,
		ttlMs: TTL_MS.transfer,
		// A numeric threshold the owner set is a decision to see each crossing by
		// hand; it is never covered by an auto-approve policy (VENUES marks this
		// venue auto:false), so this branch never actually triggers today, but the
		// inline path is kept correct in case that ever changes.
		autoApprovable: false,
	});

	const req = created.request;
	if (created.autoApproved) {
		const { outcome } = await runApproved(req, (claim) => executeApprovedPaymentSessionCall(claim));
		if (outcome?.status === 'ok' && outcome.data) return json(res, 200, outcome.data);
		return error(res, 502, 'approved_execution_failed', outcome?.note || 'The auto-approved payment did not go through.');
	}
	return respondFromApprovalStatus(res, req);
}

// ── GET poll: an agent checking on a parked call with only its session token ──
async function handlePoll(req, res) {
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const approvalId = params.get('approval_id') || '';
	const sessionToken = params.get('session_token') || '';
	if (!approvalId || !isUuid(approvalId) || !sessionToken) {
		return error(res, 400, 'missing_params', 'approval_id (uuid) and session_token are required');
	}

	let session;
	try {
		session = await verifySessionToken(sessionToken);
	} catch (err) {
		if (err instanceof SpendGovernorError) return error(res, err.status, err.code, err.message, err.detail);
		throw err;
	}

	const [row] = await sql`
		SELECT * FROM approval_requests WHERE id = ${approvalId} AND source = ${APPROVAL_SOURCE}
	`;
	if (!row || row.payload?.session_id !== session.id) {
		return error(res, 404, 'not_found', 'No matching approval request for this session.');
	}
	return respondFromApprovalStatus(res, row);
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,GET,OPTIONS', origins: '*' })) return;
	if (req.method?.toUpperCase() === 'GET') return handlePoll(req, res);
	if (req.method?.toUpperCase() !== 'POST') {
		return error(res, 405, 'method_not_allowed', 'POST required');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	// readJson's second argument is a byte limit, not the response. Passing `res`
	// there made every size comparison `n > [object]`, i.e. NaN, i.e. false, so
	// the 1 MB body cap this call was meant to apply never applied at all.
	const body = await readJson(req);
	if (!body || typeof body !== 'object') {
		return error(res, 400, 'invalid_body', 'a JSON object body is required');
	}

	const sessionToken = body.session_token;
	if (!sessionToken) return error(res, 400, 'missing_token', 'session_token is required');

	const targetUrl = body.url;
	if (!targetUrl) return error(res, 400, 'missing_url', 'url is required');

	const method = body.method === 'POST' ? 'POST' : 'GET';
	const requestBody = method === 'POST' ? body.body ?? null : null;
	const idempotencyKey = body.idempotency_key ?? null;

	try {
		// allowHttp is pinned off rather than left to the default, which relaxes
		// to http outside production. This endpoint hands a caller-chosen URL a
		// signed payment; a plaintext hop is not something a dev box should allow
		// when the error message promises https.
		validatePublicUrl(targetUrl, { allowHttp: false });
	} catch {
		return error(res, 400, 'invalid_url', 'url must be a public https endpoint');
	}

	const t0 = Date.now();

	// Phase 0: verify the token is valid before probing the endpoint. Kept (not
	// discarded) because respondRequiresApproval needs the session's user_id and
	// label if the approval-threshold rule ends up parking this call in phase 2.
	let session0;
	try {
		session0 = await verifySessionToken(sessionToken);
	} catch (err) {
		if (err instanceof SpendGovernorError) {
			return error(res, err.status, err.code, err.message, err.detail);
		}
		throw err;
	}

	// Phase 1: probe the endpoint for its 402 challenge
	let probeResult;
	try {
		probeResult = await probe402(targetUrl, { method, body: requestBody });
	} catch (err) {
		return error(res, err.status ?? 502, err.code ?? 'probe_failed', err.message, err.detail);
	}

	// Endpoint is free: return the result directly without touching the session
	if (probeResult.free) {
		return json(res, 200, {
			ok: true,
			paid: false,
			note: 'Endpoint served response without a 402. No payment needed.',
			status: probeResult.status,
			result: probeResult.result,
		});
	}

	const { accept, resource, amountAtomics } = probeResult;
	const amountUsd = atomicsToUsd(amountAtomics);

	// Phase 2: governance enforcement (check session, allowlist, budget) is atomic
	let reservation;
	try {
		reservation = await reserveSessionSpend({
			token: sessionToken,
			url: targetUrl,
			amountAtomics,
		});
	} catch (err) {
		if (err instanceof SpendGovernorError) {
			if (err.code === 'requires_approval') {
				return await respondRequiresApproval(res, {
					session: session0, targetUrl, method, requestBody, idempotencyKey,
					amountAtomics, amountUsd, detail: err.detail,
				});
			}
			return error(res, err.status, err.code, err.message, err.detail);
		}
		throw err;
	}

	// Phase 3-5: sign, submit, record. Shared with the post-approval resume path
	// (runPaymentSessionApproval) so a call that got parked above and later gets
	// approved settles through the exact same code, not a parallel copy of it.
	const result = await settlePayment({
		sessionRecord: reservation.session,
		railReservationId: reservation.railReservationId,
		policyDigest: reservation.policyDigest,
		verdictCode: reservation.verdictCode,
		verdictSignature: reservation.verdictSignature,
		verdictSignedAt: reservation.verdictSignedAt,
		targetUrl, method, requestBody, accept, resource, amountAtomics, amountUsd, idempotencyKey, t0,
	});
	return sendSettlement(res, result);
});
