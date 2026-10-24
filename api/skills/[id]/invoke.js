// GET|POST /api/skills/:id/invoke
//
// One paid skill, one URL, four rails. The caller's request decides which rail
// answers (see detectRail in api/_lib/skill-rails.js): an x402 payment header or
// a bare GET gets the x402 challenge, `Authorization: Payment` or `?rail=mpp` the
// MPP challenge, a JSON-RPC `message/send` the A2A task envelope, and an
// `X-AP2-Mandate` header the AP2 cart flow. A rail the author has switched off
// answers 404 `rail_disabled`, so a disabled rail is unreachable, not just hidden.
//
// Every rail prices from quoteSkill(), settles through verifyPayment/settlePayment
// to the same payout wallets, and ends in recordSkillInvocation(): the same
// receipt row and the same author/platform split regardless of rail.
//
// `?dry_run=1` returns the exact challenge the rail would send plus the computed
// split, without moving funds, so an author or integrator can see what each rail
// will ask for.

import { sql } from '../../_lib/db.js';
import { env } from '../../_lib/env.js';
import { cors, error, json, readBody, respondError, wrap } from '../../_lib/http.js';
import { isUuid } from '../../_lib/validate.js';
import { paidEndpoint, buildRequirements } from '../../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema, settlePayment, verifyPayment, X402Error, X402_VERSION } from '../../_lib/x402-spec.js';
import { withService } from '../../_lib/x402/bazaar-helpers.js';
import {
	A2A_EXTENSIONS_HEADER,
	A2A_X402_EXTENSION_URI,
	buildPaymentRequiredTask,
	handleA2ARequest,
} from '../../_lib/x402/a2a-server.js';
import {
	assertMandateAllows,
	MandateError,
	verifyIntentMandate,
} from '../../_lib/a2a/mandate.js';
import {
	assertCartMatchesPayment,
	issueCartMandate,
	verifyCartMandate,
} from '../../_lib/a2a/cart-mandate.js';
import { release, reserve } from '../../_lib/a2a/spend-ledger.js';
import { getSpendLimits } from '../../_lib/agent-trade-guards.js';
import {
	buildMppChallenge,
	detectRail,
	enabledRails,
	encodePaymentHeader,
	mppReceiptHeader,
	parseMppCredential,
	quoteSkill,
	railEnabled,
	recordSkillInvocation,
	skillDelivery,
	splitSummary,
} from '../../_lib/skill-rails.js';
import { chargeMatchesRequirement, chargeToX402Payment } from '../../_lib/mpp-solana.js';
import { isSolanaNetwork } from '../../_lib/x402/a2a-client.js';

const DESCRIPTION_SUFFIX = 'paid per call in USDC, settled to the skill author';

const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: {} };
const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['ok', 'skill', 'calledAt'],
	properties: {
		ok: { type: 'boolean', const: true },
		skill: { type: 'object' },
		tools: { type: 'array', items: { type: 'object' } },
		content: { type: 'string' },
		calledAt: { type: 'string', format: 'date-time' },
	},
};

async function loadSkill(idOrSlug) {
	const byId = isUuid(idOrSlug);
	const rows = await sql`
		SELECT ms.id, ms.slug, ms.name, ms.description, ms.category, ms.rails,
		       ms.schema_json, ms.content, ms.price_per_call_usd, ms.author_id,
		       evm.address AS author_payto_base,
		       sol.address AS author_payto_solana
		  FROM marketplace_skills ms
		  LEFT JOIN user_wallets evm
		         ON evm.user_id = ms.author_id AND evm.chain_type = 'evm' AND evm.is_primary = true
		  LEFT JOIN user_wallets sol
		         ON sol.user_id = ms.author_id AND sol.chain_type = 'solana' AND sol.is_primary = true
		 WHERE ${byId ? sql`ms.id = ${idOrSlug}` : sql`ms.slug = ${idOrSlug}`} AND ms.is_public = true
		 LIMIT 1
	`;
	return rows[0] || null;
}

async function readOptionalJson(req) {
	if (req.method !== 'POST') return { body: null };
	const buf = await readBody(req, 1_000_000);
	if (!buf.length) return { body: null };
	try {
		return { body: JSON.parse(buf.toString('utf8')) };
	} catch (err) {
		return { body: null, parseError: err.message };
	}
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const isDryRun = (req) => ['1', 'true'].includes(String(first(req.query?.dry_run) ?? '').toLowerCase());

function requirementsFor(skill, quote) {
	return buildRequirements({
		priceAtomics: quote.priceAtomics,
		networks: quote.networks,
		resourceUrl: quote.resourceUrl,
		payToOverride: quote.payTo,
		acceptThree: false,
	});
}

function describe(skill) {
	return `three.ws skill "${skill.name}", ${DESCRIPTION_SUFFIX}.`;
}

function sendJson(res, status, body, headers = {}) {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
	res.end(JSON.stringify(body));
}

// Verify then settle one payment payload against the given requirements, then
// write the shared receipt. Throws X402Error on a verify/settle failure.
async function redeem({ skill, quote, rail, requirements, paymentHeader, extra }) {
	const verified = await verifyPayment({ paymentHeader, requirements });
	const settled = await settlePayment({ verified });
	const payer = settled.payer || verified.payer || null;
	const recorded = await recordSkillInvocation({
		skill,
		rail,
		payer,
		network: settled.network || verified.requirement?.network,
		transaction: settled.transaction,
		amountAtomics: verified.requirement?.amount ?? quote.priceAtomics,
		asset: verified.requirement?.asset,
		extra,
	});
	return { verified, settled, payer, recorded };
}

function x402Rail(skill, quote) {
	const bazaar = {
		discoverable: true,
		info: {
			input: { type: 'http', method: 'GET', queryParams: {} },
			output: { type: 'json', example: { ok: true, skill: { slug: skill.slug }, calledAt: '2026-01-01T00:00:00.000Z' } },
		},
		schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
	};
	return paidEndpoint({
		route: `/api/skills/${skill.id}/invoke`,
		method: 'GET',
		priceAtomics: quote.priceAtomics,
		networks: quote.networks,
		description: describe(skill),
		mimeType: 'application/json',
		bazaar,
		service: withService({ serviceName: 'three.ws Skill Call', tags: ['skill', 'agent', 'tool', 'pay-per-call'] }),
		payTo: quote.payTo,
		acceptThree: false,
		resourceUrlBuilder: () => quote.resourceUrl,
		onSettled: ({ payer, network, txHash, amountAtomics, asset }) =>
			recordSkillInvocation({
				skill,
				rail: 'x402',
				payer,
				network,
				transaction: txHash,
				amountAtomics: amountAtomics ?? quote.priceAtomics,
				asset,
			}),
		async handler() {
			return skillDelivery(skill);
		},
	});
}

function mppRequirement(requirements) {
	return requirements.find((r) => isSolanaNetwork(r.network) && r.scheme === 'exact') || null;
}

function sendMppChallenge(res, skill, quote, requirement, errText) {
	const challenge = buildMppChallenge({ requirement, description: describe(skill) });
	return sendJson(
		res,
		402,
		{
			type: 'https://three.ws/problems/payment-required',
			title: 'Payment Required',
			status: 402,
			detail: errText || 'Pay the Solana USDC charge in the Payment challenge, then retry with Authorization: Payment.',
			rail: 'mpp',
			challenge_id: challenge.id,
		},
		{ 'www-authenticate': challenge.header, 'content-type': 'application/problem+json; charset=utf-8' },
	);
}

async function handleMpp(req, res, skill, quote) {
	const requirements = requirementsFor(skill, quote);
	const requirement = mppRequirement(requirements);
	if (!requirement) {
		return error(res, 501, 'mpp_unavailable', 'this skill has no Solana payout configured, so the mpp rail cannot settle it');
	}
	if (!req.headers.authorization) return sendMppChallenge(res, skill, quote, requirement);

	const parsed = parseMppCredential(req.headers.authorization);
	if (!parsed.ok) {
		const status = parsed.code === 'challenge_expired' ? 402 : 401;
		return status === 402
			? sendMppChallenge(res, skill, quote, requirement, parsed.message)
			: error(res, status, parsed.code, parsed.message);
	}
	if (!chargeMatchesRequirement(parsed.request, requirement)) {
		return sendMppChallenge(res, skill, quote, requirement, 'the skill price or payout changed since this challenge, retry with a fresh one');
	}
	try {
		const { settled, payer } = await redeem({
			skill,
			quote,
			rail: 'mpp',
			requirements: [requirement],
			paymentHeader: encodePaymentHeader(chargeToX402Payment({ requirement, transaction: parsed.transaction })),
		});
		return sendJson(res, 200, skillDelivery(skill), {
			'payment-receipt': mppReceiptHeader({ transaction: settled.transaction, network: settled.network, payer }),
		});
	} catch (err) {
		if (err instanceof X402Error && err.status === 402) return sendMppChallenge(res, skill, quote, requirement, err.message);
		if (err instanceof X402Error) return error(res, err.status, err.code, err.message);
		return respondError(res, 502, 'settle_failed', err);
	}
}

async function handleA2a(req, res, skill, quote, body, parseError) {
	res.setHeader(A2A_EXTENSIONS_HEADER, A2A_X402_EXTENSION_URI);
	if (parseError) {
		return sendJson(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: `invalid JSON: ${parseError}` } });
	}
	const reply = await handleA2ARequest({
		req,
		body,
		route: `/api/skills/${skill.id}/invoke`,
		resourceUrl: quote.resourceUrl,
		description: describe(skill),
		priceAtomics: quote.priceAtomics,
		networks: quote.networks,
		payTo: quote.payTo,
		services: ['skill-call'],
		prompt: `Payment of ${quote.priceAtomics} USDC atomics is required to invoke "${skill.name}". Retry with the signed payment payload.`,
		async handler({ taskId, payer, requirement, settled }) {
			await recordSkillInvocation({
				skill,
				rail: 'a2a',
				payer: settled?.payer ?? payer,
				network: settled?.network ?? requirement?.network,
				transaction: settled?.transaction,
				amountAtomics: requirement?.amount ?? quote.priceAtomics,
				asset: requirement?.asset,
			});
			return {
				text: `Skill "${skill.name}" delivered.`,
				artifacts: [
					{
						artifactId: taskId,
						name: `${skill.slug}.json`,
						description: 'Skill schema and content.',
						parts: [{ kind: 'data', data: skillDelivery(skill) }],
					},
				],
			};
		},
	});
	return sendJson(res, 200, reply);
}

function mandateRequestBody(skill, quote, requirements) {
	return {
		type: 'ap2.mandate_request',
		version: 1,
		issuer: env.APP_ORIGIN,
		issue_url: `${env.APP_ORIGIN}/api/agents/a2a-mandate`,
		header: 'X-AP2-Mandate',
		constraints: {
			resource: quote.resourceUrl,
			amountAtomics: quote.priceAtomics,
			currency: 'USDC',
			networks: requirements.map((r) => r.network),
		},
		split: splitSummary(quote.split),
	};
}

async function handleAp2(req, res, skill, quote, body) {
	const requirements = requirementsFor(skill, quote);
	const mandateJws = first(req.headers['x-ap2-mandate']) || (typeof body?.mandate === 'string' ? body.mandate : null);

	if (!mandateJws) {
		return sendJson(res, 402, {
			error: 'mandate_required',
			rail: 'ap2',
			message: 'present an Intent Mandate in the X-AP2-Mandate header',
			ap2: mandateRequestBody(skill, quote, requirements),
		});
	}

	let mandate;
	try {
		mandate = await verifyIntentMandate(mandateJws);
	} catch (err) {
		if (err instanceof MandateError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	const [agent] = await sql`
		SELECT id, meta FROM agent_identities
		WHERE id = ${mandate.subjectAgentId} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'agent_not_found', 'the agent this mandate authorizes no longer exists');
	if (getSpendLimits(agent.meta).frozen) {
		return error(res, 403, 'wallet_frozen', 'the agent behind this mandate is halted, so the mandate cannot be used');
	}

	let chosen = null;
	let firstError = null;
	for (const r of requirements) {
		try {
			assertMandateAllows({
				mandate,
				amountAtomics: r.amount,
				network: r.network,
				resource: quote.resourceUrl,
				currency: 'USDC',
			});
			chosen = r;
			break;
		} catch (err) {
			if (!(err instanceof MandateError)) throw err;
			firstError ??= err;
		}
	}
	if (!chosen) return error(res, firstError?.status || 402, firstError?.code || 'mandate_rejected', firstError?.message || 'mandate does not allow this skill');

	const paymentHeader = first(req.headers['x-payment']) || first(req.headers['payment-signature']);
	const cartJws = first(req.headers['x-ap2-cart']);

	if (!cartJws || !paymentHeader) {
		const { jws, cartMandate } = await issueCartMandate({
			intentMandate: mandate,
			cart: {
				resource: quote.resourceUrl,
				amountAtomics: chosen.amount,
				currency: 'USDC',
				network: chosen.network,
				items: [{ name: skill.name, amountAtomics: chosen.amount }],
			},
		});
		return sendJson(res, 402, {
			x402Version: X402_VERSION,
			error: cartJws ? 'payment_required' : 'cart_issued',
			rail: 'ap2',
			message: 'pay the cart, then retry with X-AP2-Mandate, X-AP2-Cart and X-PAYMENT',
			accepts: [chosen],
			ap2: { cart_mandate: jws, cart: cartMandate, split: splitSummary(quote.split) },
		});
	}

	let cart;
	try {
		cart = await verifyCartMandate(cartJws, { expectedIntentMandateId: mandate.mandateId });
		assertCartMatchesPayment({
			cartMandate: cart,
			amountAtomics: chosen.amount,
			network: cart.network,
			resource: quote.resourceUrl,
			currency: 'USDC',
		});
	} catch (err) {
		if (err instanceof MandateError) return error(res, err.status, err.code, err.message);
		throw err;
	}
	const requirement = requirements.find((r) => r.network === cart.network);
	if (!requirement) return error(res, 402, 'cart_network_mismatch', 'the cart names a network this skill does not accept');

	const nowSec = Math.floor(Date.now() / 1000);
	const reservation = await reserve(
		mandate.mandateId,
		requirement.amount,
		mandate.maxAtomics,
		Math.max(60, (mandate.expiresAt || nowSec) - nowSec),
	);
	if (!reservation.ok) {
		return error(res, 402, 'budget_exceeded', 'mandate budget would be exceeded by this payment', {
			spent: reservation.spent,
			cap: reservation.cap,
		});
	}

	try {
		const { settled } = await redeem({
			skill,
			quote,
			rail: 'ap2',
			requirements: [requirement],
			paymentHeader,
			extra: { mandate_id: mandate.mandateId, cart_mandate_id: cart.cartMandateId, agent_id: String(agent.id) },
		});
		return sendJson(res, 200, { ...skillDelivery(skill), ap2: { mandate_id: mandate.mandateId, cart_mandate_id: cart.cartMandateId, transaction: settled.transaction } });
	} catch (err) {
		await release(mandate.mandateId, requirement.amount);
		if (err instanceof X402Error) return error(res, err.status, err.code, err.message);
		return respondError(res, 502, 'settle_failed', err);
	}
}

// What each rail would send, without sending it. Never touches funds.
async function dryRun(res, rail, skill, quote) {
	const requirements = requirementsFor(skill, quote);
	let challenge;
	if (rail === 'x402') {
		challenge = { x402Version: X402_VERSION, accepts: requirements };
	} else if (rail === 'mpp') {
		const requirement = mppRequirement(requirements);
		if (!requirement) return error(res, 501, 'mpp_unavailable', 'no Solana payout is configured for this skill');
		const c = buildMppChallenge({ requirement, description: describe(skill) });
		challenge = { 'WWW-Authenticate': c.header };
	} else if (rail === 'a2a') {
		const { task } = buildPaymentRequiredTask({
			resourceUrl: quote.resourceUrl,
			description: describe(skill),
			priceAtomics: quote.priceAtomics,
			networks: quote.networks,
			payTo: quote.payTo,
		});
		challenge = { task };
	} else {
		challenge = mandateRequestBody(skill, quote, requirements);
	}
	return json(res, 200, {
		dry_run: true,
		rail,
		skill: { id: skill.id, slug: skill.slug },
		enabled_rails: enabledRails(skill),
		quote: splitSummary(quote.split),
		payTo: requirements.map((r) => ({ network: r.network, payTo: r.payTo })),
		challenge,
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (req.method !== 'GET' && req.method !== 'POST') {
		res.setHeader('allow', 'GET,POST,OPTIONS');
		return error(res, 405, 'method_not_allowed', 'use GET or POST');
	}

	const idOrSlug = String(first(req.query?.id) ?? '').trim();
	if (!idOrSlug) return error(res, 404, 'not_found', 'skill not found');

	let skill;
	try {
		skill = await loadSkill(idOrSlug);
	} catch (err) {
		return respondError(res, 502, 'skill_lookup_failed', err);
	}
	if (!skill) return error(res, 404, 'not_found', 'skill not found');
	if (!(Number(skill.price_per_call_usd) > 0)) {
		return error(res, 409, 'skill_not_priced', `skill "${skill.slug}" is free, fetch it without payment via /api/skills/${skill.id}`);
	}

	const { body, parseError } = await readOptionalJson(req);
	const detected = detectRail(req, body);
	if (detected.unknown) {
		return error(res, 404, 'unknown_rail', `no payment rail named "${detected.unknown}"`, { enabled_rails: enabledRails(skill) });
	}
	const rail = detected.rail;
	if (!railEnabled(skill, rail)) {
		return error(res, 404, 'rail_disabled', `the ${rail} rail is not enabled for skill "${skill.slug}"`, {
			enabled_rails: enabledRails(skill),
		});
	}

	let quote;
	try {
		quote = quoteSkill(skill);
	} catch (err) {
		return respondError(res, 500, 'quote_failed', err);
	}

	try {
		if (isDryRun(req)) return await dryRun(res, rail, skill, quote);
		if (rail === 'x402') return await x402Rail(skill, quote)(req, res);
		if (rail === 'mpp') return await handleMpp(req, res, skill, quote);
		if (rail === 'a2a') return await handleA2a(req, res, skill, quote, body, parseError);
		return await handleAp2(req, res, skill, quote, body);
	} catch (err) {
		if (err instanceof X402Error) return error(res, err.status, err.code, err.message);
		throw err;
	}
});
