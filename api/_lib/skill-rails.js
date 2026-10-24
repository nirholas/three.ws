// Skill rails: one pricing record, four ways to pay it.
//
// A paid marketplace skill is priced once (marketplace_skills.price_per_call_usd)
// and the author picks which rails may redeem it (marketplace_skills.rails):
//
//   x402  HTTP 402 + X-PAYMENT, the platform's native rail.
//   mpp   HTTP 402 with the `Payment` authentication scheme (WWW-Authenticate /
//         Authorization / Payment-Receipt). Same Solana USDC settlement.
//   a2a   JSON-RPC `message/send` task envelope carrying the a2a-x402 extension.
//   ap2   The caller presents an Intent Mandate, the server answers with a signed
//         Cart Mandate for this exact invocation, and the payment is redeemed
//         against that cart.
//
// Every rail settles through the same verify/settle path and ends in
// recordSkillInvocation(), so the author/platform split and the receipt row are
// identical whichever rail carried the call. This module is the pure policy
// (rail names, quote, endpoint map, MPP framing) plus that one writer.

import { sql } from './db.js';
import { env } from './env.js';
import { priceFor } from './x402-prices.js';
import { accrueSkillCallRoyalty, computeSkillRoyaltySplit, skillRoyaltyPlatformBps } from './skill-royalty.js';

export const SKILL_RAILS = Object.freeze(['x402', 'mpp', 'a2a', 'ap2']);
export const DEFAULT_SKILL_RAILS = Object.freeze(['x402', 'a2a']);

export const RAIL_PROTOCOL = Object.freeze({
	x402: 'x402 v2 (HTTP 402, X-PAYMENT)',
	mpp: 'MPP (HTTP Payment authentication scheme)',
	a2a: 'A2A JSON-RPC message/send with the a2a-x402 extension',
	ap2: 'AP2 (Intent Mandate in, Cart Mandate out, payment against the cart)',
});

export const RECEIPT_FORMAT = 'three.ws/skill-invoke/v1';

/**
 * Normalize an author-supplied rails list: lowercased, de-duplicated, in canonical
 * order. Returns null when the input is not a non-empty array of known rails, so
 * a caller can answer 400 instead of silently dropping an author's choice.
 * @param {unknown} input
 * @returns {string[]|null}
 */
export function normalizeRails(input) {
	if (!Array.isArray(input) || input.length === 0) return null;
	const wanted = new Set();
	for (const raw of input) {
		const rail = String(raw ?? '').trim().toLowerCase();
		if (!SKILL_RAILS.includes(rail)) return null;
		wanted.add(rail);
	}
	return SKILL_RAILS.filter((r) => wanted.has(r));
}

/** Rails enabled on a skill row; a row that predates the column gets the defaults. */
export function enabledRails(skill) {
	const rails = Array.isArray(skill?.rails) ? normalizeRails(skill.rails) : null;
	return rails ?? [...DEFAULT_SKILL_RAILS];
}

export function railEnabled(skill, rail) {
	return enabledRails(skill).includes(rail);
}

/** The single URL every rail redeems against. Also the receipt's resource key. */
export function invokeUrl(skill, origin = env.APP_ORIGIN) {
	return `${origin}/api/skills/${skill.id}/invoke`;
}

// USD (price_per_call_usd) to USDC atomics (6 decimals), floored at 1 atomic so a
// priced skill can never be free.
export function usdToAtomics(usd) {
	return String(Math.max(1, Math.round(Number(usd) * 1_000_000)));
}

/**
 * The one quote every rail prices from: amount, author/platform split, payout
 * wallets and the networks the author can actually be paid on. Solana leads.
 */
export function quoteSkill(skill, { platformBps } = {}) {
	const priceAtomics = priceFor(`skill-call-${skill.slug}`, usdToAtomics(skill.price_per_call_usd));
	const split = computeSkillRoyaltySplit({
		priceAtomics,
		platformBps: platformBps ?? skillRoyaltyPlatformBps(),
	});
	const payTo = {};
	if (skill.author_payto_base) payTo.base = skill.author_payto_base;
	if (skill.author_payto_solana) payTo.solana = skill.author_payto_solana;
	const networks = [];
	if (payTo.solana) networks.push('solana');
	if (payTo.base) networks.push('base');
	if (!networks.length) networks.push('solana', 'base');
	return {
		skillId: skill.id,
		slug: skill.slug,
		priceAtomics: String(split.priceAtomics),
		split,
		payTo: Object.keys(payTo).length ? payTo : undefined,
		networks,
		resourceUrl: invokeUrl(skill),
	};
}

export function splitSummary(split) {
	return {
		price_atomics: String(split.priceAtomics),
		author_atomics: String(split.authorAtomics),
		platform_atomics: String(split.platformAtomics),
		platform_bps: split.platformBps,
		currency: 'USDC',
	};
}

/** What the skill returns once a rail has been paid. Same body on every rail. */
export function skillDelivery(skill) {
	return {
		ok: true,
		skill: {
			id: skill.id,
			slug: skill.slug,
			name: skill.name,
			description: skill.description ?? '',
			category: skill.category ?? 'general',
		},
		tools: Array.isArray(skill.schema_json) ? skill.schema_json : [],
		content: skill.content ?? '',
		calledAt: new Date().toISOString(),
	};
}

/** Endpoint map for the agent card: one entry per enabled rail, nothing for a disabled one. */
export function railEndpoints(skill, origin = env.APP_ORIGIN) {
	const url = invokeUrl(skill, origin);
	const all = {
		x402: { method: 'GET', url, headers: { 'X-PAYMENT': '<x402 payment payload>' } },
		mpp: { method: 'GET', url: `${url}?rail=mpp`, headers: { Authorization: 'Payment <credential>' } },
		a2a: { method: 'POST', url, headers: { 'X-A2A-Extensions': 'https://github.com/google-a2a/a2a-x402/v0.1' } },
		ap2: { method: 'GET', url, headers: { 'X-AP2-Mandate': '<intent mandate JWS>' } },
	};
	const out = {};
	for (const rail of enabledRails(skill)) out[rail] = { protocol: RAIL_PROTOCOL[rail], ...all[rail] };
	return out;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * Which rail is this caller speaking? An explicit `?rail=` / `X-Payment-Rail` wins,
 * then the credential they carry, then the shape of the request. Falls back to x402.
 * @returns {{ rail: string, explicit: boolean, unknown?: string }}
 */
export function detectRail(req, body) {
	const h = req.headers || {};
	const asked = String(first(req.query?.rail) ?? first(h['x-payment-rail']) ?? '').trim().toLowerCase();
	if (asked) {
		return SKILL_RAILS.includes(asked)
			? { rail: asked, explicit: true }
			: { rail: asked, explicit: true, unknown: asked };
	}
	if (h['x-ap2-mandate'] || (body && typeof body.mandate === 'string')) return { rail: 'ap2', explicit: false };
	if (/^\s*payment\s/i.test(String(h.authorization || ''))) return { rail: 'mpp', explicit: false };
	if (body && body.jsonrpc === '2.0') return { rail: 'a2a', explicit: false };
	if (h['x-a2a-extensions']) return { rail: 'a2a', explicit: false };
	return { rail: 'x402', explicit: false };
}

// ── MPP framing ──────────────────────────────────────────────────────────────
// The wire format (spec-shaped Solana charge challenge, credential and receipt)
// lives in mpp-solana.js so the skill rail, paid endpoints, the agent payer and
// the CLI all speak the same bytes. These aliases keep the rail module's API.

export {
	buildSolanaChargeChallenge as buildMppChallenge,
	parseSolanaChargeCredential as parseMppCredential,
	solanaChargeReceiptHeader as mppReceiptHeader,
} from './mpp-solana.js';

/** x402 payment header (base64 JSON) from a decoded payment payload. */
export function encodePaymentHeader(payload) {
	return Buffer.from(JSON.stringify(payload)).toString('base64');
}

// ── Shared receipt writer ────────────────────────────────────────────────────

/**
 * Record one settled skill invocation: the same x402_receipts row and the same
 * royalty accrual whichever rail carried it. Never throws; the payment already
 * settled, so a database hiccup is logged and the response still ships.
 * @returns {Promise<{ receiptId: string|null, split: object, royalty: object }>}
 */
export async function recordSkillInvocation({ skill, rail, payer, network, transaction, amountAtomics, asset, extra }) {
	const split = computeSkillRoyaltySplit({ priceAtomics: amountAtomics, platformBps: skillRoyaltyPlatformBps() });
	const resourceUrl = invokeUrl(skill);
	const receipt = {
		format: RECEIPT_FORMAT,
		rail,
		skill: { id: skill.id, slug: skill.slug },
		resource: resourceUrl,
		payer: payer ?? null,
		network: network ?? null,
		transaction: transaction ?? null,
		split: splitSummary(split),
		...(extra ? { extra } : {}),
	};
	let receiptId = null;
	try {
		const [row] = await sql`
			insert into x402_receipts
				(payer, network, resource_url, format, receipt, transaction, amount_atomics, asset,
				 rail, skill_id, author_atomics, platform_atomics)
			values
				(${payer ?? 'unknown'}, ${network ?? 'unknown'}, ${resourceUrl}, ${RECEIPT_FORMAT},
				 ${JSON.stringify(receipt)}::jsonb, ${transaction ?? null}, ${String(split.priceAtomics)},
				 ${asset ?? null}, ${rail}, ${skill.id}, ${String(split.authorAtomics)}, ${String(split.platformAtomics)})
			returning id
		`;
		receiptId = row?.id ?? null;
	} catch (err) {
		console.error('[skill-rails] receipt insert failed:', err?.message || err);
	}
	const royalty = skill.author_id
		? await accrueSkillCallRoyalty({
				skillId: skill.id,
				authorId: skill.author_id,
				payer,
				network,
				txHash: transaction,
				priceAtomics: amountAtomics,
				source: rail,
			})
		: { ok: false, reason: 'no_author' };
	return { receiptId, split, receipt, royalty };
}
