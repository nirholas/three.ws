/**
 * Pump.fun agent-skill HTTP 402 manifest helpers.
 *
 * NOTE: this module is NOT the Coinbase x402 v2 wire spec — that lives in
 * `api/_lib/x402-spec.js`. This file implements an internal Pump.fun
 * agent-skill payment flow that *also* uses HTTP 402 as the negotiation
 * status, but with its own manifest format (`version: "x402/0.1"`,
 * `kind: "agent-skill"`), retry header (`x-payment-intent`), and
 * server-side payment pipeline (`/api/agents/payments/pay-prep` +
 * `/pay-confirm`). The two flows are deliberately separate.
 *
 * Used by /api/agents/x402/[action].js (invoke + manifest) for per-skill
 * billing on agent-hosted skills.
 *

 * Server-side flow:
 *   1. Caller hits a paid endpoint.
 *   2. We look for a payment proof header (x-payment-intent or
 *      x-payment-tx-sig). If missing or unpaid, emit 402 with a manifest:
 *
 *        HTTP/1.1 402 Payment Required
 *        Content-Type: application/json
 *
 *        {
 *          "version":      "x402/0.1",
 *          "kind":         "agent-skill",
 *          "agent_id":     "...",
 *          "skill":        "summarize",
 *          "amount":       "1000000",       // raw token units (string-bigint)
 *          "currency":     "<mint base58>", // e.g. USDC
 *          "recipient":    "<owner wallet>",
 *          "memo":         "<u64 invoice nonce>",
 *          "valid_until":  "<unix>",
 *          "intent_url":   "/api/agents/payments/pay-prep",
 *          "verify_url":   "/api/agents/payments/pay-confirm"
 *        }
 *
 *   3. Caller follows the manifest, pays via /pay-prep + wallet sign +
 *      /pay-confirm, gets back an `intent_id`. They retry the original call
 *      with `x-payment-intent: <intent_id>`.
 *   4. We verify the intent is `status='paid'` for this agent + skill +
 *      caller, then proceed.
 *
 * The 402 response is cached by the spec to be idempotent — a caller may
 * request the manifest, sit on it, and pay later. We honor that by NOT
 * minting an intent until the caller calls `/pay-prep`.
 */

import { sql } from './db.js';
import { json, error } from './http.js';
import { resolvePayoutAddress } from './payout.js';
import { resolveSolanaRecipient } from '../../src/solana/sns.js';
import { IDEMPOTENCY_TTL_S } from './idempotency.js';

export const X402_VERSION = 'x402/0.1';

// The replay contract POST /api/agents/x402/invoke honours, advertised on the
// manifest and the 402 so a buyer (src/onchain/x402/client.js among them) can
// rely on it: a retry of a delivered call with the same `Idempotency-Key`, or
// the same `x-payment-intent` when no key is sent, returns the stored result
// with `replayed: true` for this long instead of a fresh 402.
export const X402_IDEMPOTENCY = Object.freeze({
	header: 'Idempotency-Key',
	ttl_seconds: IDEMPOTENCY_TTL_S,
	replay_field: 'replayed',
});

// Resolve the manifest's `recipient` to a base58 wallet and a human-readable
// `recipient_name`. Two inputs feed this:
//   - `payments.receiver` — base58 wallet OR a .sol/subdomain. When it's a
//     name, resolveSolanaRecipient() does the SNS lookup and we use the name
//     as the display value.
//   - `agent.meta.sns_domain` — preferred display name even when receiver is
//     a base58 wallet, so clients show "paying nich.threews.sol" rather than
//     a raw key.
async function resolveRecipient({ agent, payments }) {
	const receiver = payments?.receiver;
	const { address, resolved_from } = await resolveSolanaRecipient(receiver || '');
	if (resolved_from) {
		return { recipient: address, recipient_name: resolved_from };
	}
	// Receiver wasn't recognized as a SNS name — pass through whatever the
	// agent has stored. Most agents store a base58 wallet here; some legacy
	// records may use a non-base58 placeholder. We don't gatekeep at this
	// layer; the wallet adapter / payment program will validate at sign-time.
	return { recipient: address ?? (receiver || null), recipient_name: snsDisplayName(agent) };
}

function snsDisplayName(agent) {
	const metaName = agent?.meta?.sns_domain || null;
	if (!metaName) return null;
	return metaName.endsWith('.sol') ? metaName : `${metaName}.sol`;
}

/**
 * The one recipient rule for an agent-skill manifest, shared by the 402
 * challenge (emit402) and the prefetch manifest (manifestOnly), so a buyer who
 * reads the manifest first and then hits the 402 is never shown two different
 * wallets. Order: the owner's payout wallet for the chain (agent_payout_wallets),
 * then the agent's own wallet_address (both via resolvePayoutAddress), then the
 * receiver stored in meta.payments (a base58 wallet or a .sol name).
 *
 * @param {{ agent: object, chain?: string }} opts
 * @returns {Promise<{ recipient: string | null, recipient_name: string | null }>}
 */
export async function resolveSkillRecipient({ agent, chain = 'solana' }) {
	const payout = agent?.id ? await resolvePayoutAddress(agent.id, chain) : null;
	if (payout) return { recipient: payout, recipient_name: snsDisplayName(agent) };
	const payments = agent?.meta?.payments || agent?.payments;
	return resolveRecipient({ agent, payments });
}

/**
 * The prefetch URL for an agent-skill manifest. This is the route vercel.json
 * actually serves (`/api/agents/x402/manifest`), not a path-style alias.
 */
export function manifestUrl(agentId, skill) {
	return `/api/agents/x402/manifest?agent_id=${encodeURIComponent(agentId)}&skill=${encodeURIComponent(skill)}`;
}

/**
 * Emit a 402 Payment Required response with a canonical manifest body.
 *
 * @param {import('http').ServerResponse} res
 * @param {object} opts
 * @param {object} opts.agent       Agent record (must have meta.payments configured).
 * @param {string} opts.skill       Skill identifier (free-form, used by the manifest).
 * @param {string} opts.amount      Raw token units as a numeric string.
 * @param {string} opts.currency    Mint pubkey (base58) for the currency token.
 * @param {string} [opts.chain='solana']  Chain the price is denominated on.
 * @param {number} [opts.validForSec=900]  Manifest validity in seconds (default 15m).
 */
export async function emit402(res, { agent, skill, amount, currency, chain = 'solana', validForSec = 900 }) {
	const payments = agent?.meta?.payments || agent?.payments;
	if (!payments?.configured) {
		// Misconfigured: we shouldn't gate a skill behind 402 if payments aren't on.
		return error(res, 500, 'misconfigured', 'agent has no payments config');
	}
	const { recipient, recipient_name } = await resolveSkillRecipient({ agent, chain });
	if (!recipient) {
		return error(res, 412, 'recipient_unresolved', 'agent payments.receiver could not be resolved to a wallet');
	}
	const validUntil = Math.floor(Date.now() / 1000) + validForSec;
	const manifest = {
		version: X402_VERSION,
		kind: 'agent-skill',
		agent_id: agent.id,
		skill,
		amount: String(amount),
		currency,
		chain,
		recipient,
		recipient_name,
		memo: String(Math.floor(Date.now() / 1000)),
		valid_until: validUntil,
		intent_url: '/api/agents/payments/pay-prep',
		verify_url: '/api/agents/payments/pay-confirm',
		manifest_url: manifestUrl(agent.id, skill),
		retry_with_header: 'x-payment-intent',
		idempotency: X402_IDEMPOTENCY,
	};
	res.statusCode = 402;
	res.setHeader('content-type', 'application/json');
	res.setHeader('cache-control', 'no-store');
	// Hint the canonical manifest URL so x402 clients can prefetch.
	res.setHeader(
		'link',
		`</.well-known/x402>; rel="payment-config", <${manifestUrl(agent.id, skill)}>; rel="payment-manifest"`,
	);
	res.end(JSON.stringify(manifest));
	return true;
}

/**
 * Read x-payment-intent (or x-payment-tx-sig) headers and verify the request
 * is paid for `agentId` + `skill` BY `payerUserId`. Returns the verified intent
 * row, or null if not paid (caller should `emit402`).
 *
 * The intent is bound to the account that paid it: pay-prep stamps
 * payer_user_id, and only that account may redeem the intent. Without the
 * binding, anyone who saw an intent id (a log line, a shared screenshot, a
 * proxy) could spend another buyer's payment on their own call.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{ agentId: string, skill: string, payerUserId: string, expectedAmount?: string, expectedCurrency?: string }} ctx
 * @returns {Promise<null | { intentId: string, amount: string, currency: string, paidAt: Date }>}
 */
export async function verifyPaid(req, { agentId, skill, payerUserId, expectedAmount, expectedCurrency }) {
	if (!expectedAmount) throw new Error('verifyPaid: expectedAmount is required');
	if (!expectedCurrency) throw new Error('verifyPaid: expectedCurrency is required');
	if (!payerUserId) throw new Error('verifyPaid: payerUserId is required');
	const intentId = (req.headers['x-payment-intent'] || '').toString().trim();
	if (!intentId) return null;

	const [row] = await sql`
		select id, agent_id, payer_user_id, currency_mint, amount, status, paid_at, payload, end_time
		from agent_payment_intents
		where id = ${intentId} and agent_id = ${agentId}
		limit 1
	`;
	if (!row) return null;
	if (String(row.payer_user_id) !== String(payerUserId)) return null;
	if (row.status !== 'paid') return null;
	if (row.end_time && new Date(row.end_time).getTime() < Date.now()) return null;

	if (expectedAmount && String(row.amount) !== String(expectedAmount)) return null;
	if (expectedCurrency && row.currency_mint !== expectedCurrency) return null;

	// Bind the intent to the requested skill if the caller stored it. Skill
	// metadata lives in payload — older intents may not have it, in which
	// case we treat the absence as "any skill".
	const intentSkill = row.payload?.skill;
	if (intentSkill && intentSkill !== skill) return null;

	return {
		intentId: row.id,
		amount: row.amount,
		currency: row.currency_mint,
		paidAt: row.paid_at,
		payerAddress: row.payload?.wallet_address ?? null,
	};
}

/**
 * Convenience: complete a paid call. Atomically marks the intent as `consumed`
 * so it can't be reused — paid intents are single-shot per spec. Returns true
 * only for the caller that won the paid→consumed transition; concurrent callers
 * racing the same intent get false. Revenue/credit side effects MUST be gated on
 * a true return, otherwise one on-chain payment can be credited N times.
 *
 * @returns {Promise<boolean>} true if this call consumed the intent.
 */
export async function consumeIntent(intentId) {
	const rows = await sql`
		update agent_payment_intents
		set status = 'consumed'
		where id = ${intentId} and status = 'paid'
		returning id
	`;
	return rows.length > 0;
}

/**
 * Undo a consumeIntent() win when the paid work then fails. Atomically flips
 * the intent back to 'paid' (only a row currently 'consumed' transitions) so
 * the buyer can retry instead of losing a paid intent to a transient handler
 * error. Pair with consume-first delivery flows: consume as the single-use
 * lock, execute, and releaseIntent() on the error path.
 *
 * @returns {Promise<boolean>} true if this call performed the revert.
 */
export async function releaseIntent(intentId) {
	const rows = await sql`
		update agent_payment_intents
		set status = 'paid'
		where id = ${intentId} and status = 'consumed'
		returning id
	`;
	return rows.length > 0;
}

/**
 * Helper: respond with the manifest only (no 402), for prefetch/discovery via
 * `GET /api/agents/x402/manifest?agent_id=&skill=`. The recipient comes from
 * resolveSkillRecipient, the same rule emit402 uses.
 */
export async function manifestOnly(res, opts) {
	const validUntil = Math.floor(Date.now() / 1000) + (opts.validForSec || 900);
	const chain = opts.chain ?? 'solana';
	const { recipient, recipient_name } = await resolveSkillRecipient({ agent: opts.agent, chain });

	return json(res, 200, {
		version: X402_VERSION,
		kind: 'agent-skill',
		agent_id: opts.agent.id,
		skill: opts.skill,
		amount: String(opts.amount),
		currency: opts.currency,
		chain,
		recipient,
		recipient_name,
		valid_until: validUntil,
		intent_url: '/api/agents/payments/pay-prep',
		verify_url: '/api/agents/payments/pay-confirm',
		manifest_url: manifestUrl(opts.agent.id, opts.skill),
		retry_with_header: 'x-payment-intent',
		idempotency: X402_IDEMPOTENCY,
	});
}
