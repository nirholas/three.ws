// Pay-per-request access to POST /api/v1/chat/completions, funded over x402.
//
// A caller with no API key and no session pays for the one request with its own
// Solana wallet, through the x402 `upto` scheme (api/_lib/x402/upto.js):
//
//   1. No payment header: 402 whose `upto` accept is sized to the model's worst
//      case for THIS request (`capAtomics`), so the buyer authorizes a cap and
//      never more.
//   2. Payment header: verify it, escrow the cap (deposit), run the completion.
//   3. The completion's measured tokens times the model's published price is the
//      charge. The claim settles exactly that and the program refunds the rest.
//   4. A completion that fails before any token was produced settles nothing:
//      a claim of zero returns the whole deposit.
//
// Streaming: the deposit is escrowed before the first byte, the claim happens
// when the model loop reports its final usage (before the closing SSE frames),
// and a client that drops the stream is charged for the tokens already sent.
//
// The keyed path (account credits) lives in api/_lib/inference-billing.js and
// is untouched by this module.

import { env } from './env.js';
import { clientIp } from './rate-limit.js';
import { estimateTokens } from './inference-billing.js';
import { inferenceModelRow, INFERENCE_MODEL_ROWS } from './pricing/inference-models.js';
import { logPaymentEvent } from './x402/audit-log.js';
import {
	NETWORK_SOLANA_MAINNET,
	X402Error,
	decodePaymentHeader,
	send402,
	verifyPayment,
	resolveResourceUrl,
} from './x402-spec.js';
import {
	buildUptoRequirement,
	normaliseCharge,
	settleUptoClaim,
	settleUptoDeposit,
	uptoEnabled,
} from './x402/upto.js';

export const METERED_ROUTE = '/api/v1/chat/completions';
const ATOMICS_PER_USD = 1_000_000; // USDC has 6 decimals; credits are USD-denominated

/** Tokens for the caller's side of a request (messages plus any client tools). */
export function promptTokensOf(body) {
	return estimateTokens(body?.messages) + estimateTokens(body?.tools);
}

/** USD -> USDC atomics, rounded up so the claim never undercharges the ledger. */
export function usdToAtomics(usd) {
	return BigInt(Math.ceil(Number(usd) * ATOMICS_PER_USD - 1e-6));
}

/** Price tokens at a model row's published per-million rates, in USD. */
export function priceTokens(row, inputTokens, outputTokens) {
	const input = Math.max(0, Number(inputTokens) || 0);
	const output = Math.max(0, Number(outputTokens) || 0);
	const raw = (input * row.input_usd_per_mtok + output * row.output_usd_per_mtok) / 1e6;
	const micro = Math.ceil(raw * 1e6 - 1e-9);
	return Math.max(row.min_call_usd, micro / 1e6);
}

/** The measured charge in USDC atomics for a finished (or cut-off) completion. */
export function chargeAtomics(row, inputTokens, outputTokens) {
	return usdToAtomics(priceTokens(row, inputTokens, outputTokens));
}

/**
 * The most this request can cost, in USDC atomics: every round the loop may run
 * at the model's per-round output limit, each reading the caller's prompt plus
 * the context a round may add. A request that brings its own tools is one round
 * bounded by its own max_tokens.
 */
export function worstCaseAtomics(row, body, { clientTools = false } = {}) {
	const prompt = promptTokensOf(body);
	if (clientTools) {
		const asked = Number(body?.max_tokens ?? body?.max_completion_tokens);
		const out = Number.isFinite(asked) && asked > 0 ? Math.min(Math.round(asked), row.client_tools_max_output) : 4096;
		return chargeAtomics(row, prompt, out);
	}
	const rounds = row.max_rounds;
	let input = 0;
	for (let i = 0; i < rounds; i++) input += prompt + row.context_allowance_round;
	return chargeAtomics(row, input, rounds * row.max_output_tokens_round);
}

export function paymentHeaderOf(req) {
	return req.headers['payment-signature'] || req.headers['x-payment'] || null;
}

/** True when this deployment can sell a request over x402 `upto`. */
export function meteredAvailable() {
	return uptoEnabled() && !!env.X402_PAY_TO_SOLANA && !!env.X402_ASSET_MINT_SOLANA;
}

async function offerFor(row, body, opts) {
	const cap = worstCaseAtomics(row, body, opts);
	const resourceUrl = resolveResourceUrl(null, METERED_ROUTE);
	const offer = await buildUptoRequirement({
		capAtomics: cap,
		network: NETWORK_SOLANA_MAINNET,
		asset: env.X402_ASSET_MINT_SOLANA,
		payTo: env.X402_PAY_TO_SOLANA,
		resourceUrl,
	});
	return { requirement: { ...offer, resource: resourceUrl }, resourceUrl, cap };
}

/** Answer 402 with the `upto` challenge for this request. */
export async function sendMeteredChallenge(res, row, body, opts, errorText) {
	const { requirement, resourceUrl } = await offerFor(row, body, opts);
	return send402(res, {
		resourceUrl,
		accepts: [requirement],
		error: errorText || 'Payment required: pay for this request with x402 upto, or send an API key.',
		description: `${row.id} chat completion, metered by tokens (input ${row.input_usd_per_mtok} and output ${row.output_usd_per_mtok} USD per million tokens)`,
		mimeType: 'application/json',
		serviceName: 'three.ws model router',
		tags: ['llm', 'openai-compatible', 'metered'],
	});
}

/**
 * Verify the caller's payment against this request's own offer and escrow the
 * cap. Resolves { session } to run the completion, or { challenge } when the
 * payment was refused and a fresh 402 has been written.
 */
export async function admitMeteredPayment(req, res, row, body, opts) {
	const { requirement, resourceUrl, cap } = await offerFor(row, body, opts);
	const header = paymentHeaderOf(req);
	let verified;
	try {
		decodePaymentHeader(header);
		verified = await verifyPayment({ paymentHeader: header, requirements: [requirement] });
	} catch (err) {
		if (!(err instanceof X402Error) && !err?.status) throw err;
		if (err.status === 402 || err.status === 400) {
			await sendMeteredChallenge(res, row, body, opts, err.message);
			return { challenge: true };
		}
		throw err;
	}
	if (!verified.upto) {
		await sendMeteredChallenge(res, row, body, opts, 'this endpoint is paid with the x402 upto scheme');
		return { challenge: true };
	}

	let deposit;
	try {
		deposit = await settleUptoDeposit({ paymentPayload: verified.paymentPayload, requirement: verified.requirement });
	} catch (err) {
		throw Object.assign(new Error(`upto deposit failed: ${err?.message || err}`), { status: 502, code: 'upto_deposit_failed' });
	}
	if (!deposit?.success) {
		await sendMeteredChallenge(res, row, body, opts, `upto deposit rejected: ${deposit?.errorReason || 'deposit_failed'}`);
		return { challenge: true };
	}

	const session = {
		row,
		cap,
		resourceUrl,
		payer: verified.payer || null,
		paymentPayload: verified.paymentPayload,
		requirement: verified.requirement,
		depositTransaction: deposit.transaction || null,
		settled: null,
		settling: null,
		ip: clientIp(req),
		userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
	};
	logPaymentEvent({
		eventType: 'payment_upto_deposit',
		route: METERED_ROUTE,
		resourceUrl,
		payer: session.payer,
		network: session.requirement.network,
		txHash: session.depositTransaction,
		ipAddress: session.ip,
		userAgent: session.userAgent,
		metadata: { cap_atomics: String(cap), model: row.id },
	});
	return { session };
}

/**
 * Claim the measured charge, exactly once. `inputTokens` and `outputTokens` are
 * what the model produced; zero tokens out and zero tokens in cancels the
 * channel so the whole deposit returns to the buyer. Concurrent callers (the
 * usage hook and the close handler) share the one in-flight claim.
 */
export function settleMetered(session, { inputTokens, outputTokens, reason = 'completed', cancel = false }) {
	if (session.settling) return session.settling;
	session.settling = (async () => {
		const atomics = cancel ? 0n : normaliseCharge(chargeAtomics(session.row, inputTokens, outputTokens), session.cap);
		let result;
		try {
			result = await settleUptoClaim({
				paymentPayload: session.paymentPayload,
				requirement: session.requirement,
				amountAtomics: atomics.toString(),
			});
		} catch (err) {
			logPaymentEvent({
				eventType: 'payment_upto_claim_failed',
				route: METERED_ROUTE,
				resourceUrl: session.resourceUrl,
				payer: session.payer,
				network: session.requirement.network,
				ipAddress: session.ip,
				userAgent: session.userAgent,
				metadata: { reason, charge_atomics: atomics.toString(), error: String(err?.message || err).slice(0, 300) },
			});
			throw err;
		}
		const settled = {
			paid_via: 'x402-upto',
			network: session.requirement.network,
			payer: session.payer,
			model: session.row.id,
			input_tokens: Math.max(0, Number(inputTokens) || 0),
			output_tokens: Math.max(0, Number(outputTokens) || 0),
			cap_atomics: String(session.cap),
			charged_atomics: atomics.toString(),
			charged_usd: Number(atomics) / ATOMICS_PER_USD,
			refunded_atomics: (BigInt(session.cap) - atomics).toString(),
			transaction: result?.transaction || null,
			success: result?.success !== false,
			reason,
		};
		session.settled = settled;
		logPaymentEvent({
			eventType: cancel ? 'payment_upto_cancel' : 'payment_settled',
			route: METERED_ROUTE,
			resourceUrl: session.resourceUrl,
			payer: session.payer,
			network: session.requirement.network,
			txHash: settled.transaction,
			amountAtomics: settled.charged_atomics,
			ipAddress: session.ip,
			userAgent: session.userAgent,
			metadata: { reason, model: session.row.id, cap_atomics: settled.cap_atomics, input_tokens: settled.input_tokens, output_tokens: settled.output_tokens },
		});
		return settled;
	})();
	return session.settling;
}

/**
 * Watch a response so a dropped stream can be charged for what was sent. Wraps
 * res.write to count the characters of every streamed `delta.content`, and runs
 * `onClose` when the connection closes before the response was ended (a client
 * that dropped the stream).
 */
export function watchStream(res, { onClose }) {
	let chars = 0;
	const write = res.write.bind(res);
	res.write = (chunk, ...rest) => {
		const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
		for (const line of text.split('\n')) {
			if (!line.startsWith('data: ') || line.startsWith('data: [DONE]')) continue;
			try {
				const content = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content;
				if (typeof content === 'string') chars += content.length;
			} catch {
				/* a partial frame carries no countable content */
			}
		}
		return write(chunk, ...rest);
	};
	res.once('close', () => {
		if (res.writableEnded) return;
		onClose({ outputTokens: Math.ceil(chars / 4) });
	});
	return { outputTokensSoFar: () => Math.ceil(chars / 4) };
}

export { INFERENCE_MODEL_ROWS };
