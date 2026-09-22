// Agent mail configuration: the receiving domain, the price list, and the
// deliverability limits. Everything a deployment may want to tune lives here so
// the store, the routes and the MCP tools read one source.
//
// Domain: agents.three.ws. `mail.three.ws` already routes to the team's own
// mailbox provider, so agent addresses get a subdomain nothing else uses. Set
// AGENT_MAIL_DOMAIN to point a deployment at the provider's sandbox domain.
//
// Prices are USD and overridable at runtime through app_settings key
// `agent_mail_pricing` ({ "create_usd": 1, "send_usd": 0.01 }) so the owner can
// reprice without a deploy. A malformed or missing row falls back to the
// defaults below, never to free.

import { sql } from '../db.js';

export const DEFAULT_MAIL_DOMAIN = 'agents.three.ws';

export function mailDomain() {
	const d = String(process.env.AGENT_MAIL_DOMAIN || DEFAULT_MAIL_DOMAIN).trim().toLowerCase();
	return d || DEFAULT_MAIL_DOMAIN;
}

export const PRICING_SETTINGS_KEY = 'agent_mail_pricing';

export const DEFAULT_PRICING = Object.freeze({ create_usd: 1, send_usd: 0.01 });

// A quote is valid for ten minutes, the window prompt 03 sets for every preview.
export const QUOTE_TTL_MS = 10 * 60 * 1000;

// Outbound limits. A new mailbox starts narrow and widens daily for two weeks,
// which is how a fresh sending identity earns reputation with receiving
// providers instead of being filtered as a burst sender.
export const WARMUP_DAYS = 14;
export const WARMUP_START = Object.freeze({ perHour: 10, perDay: 30 });
export const WARMUP_FULL = Object.freeze({ perHour: 60, perDay: 500 });

export const MAX_RECIPIENTS = 10;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 100_000;
export const MAX_HTML_CHARS = 300_000;

// Inbound attachment storage caps. Anything above is recorded but not stored.
export const MAX_INBOUND_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_INBOUND_TOTAL_BYTES = 30 * 1024 * 1024;

// Local parts no agent can take: they are role addresses receiving systems and
// abuse desks expect to reach a human operator.
export const RESERVED_LOCAL_PARTS = new Set([
	'abuse', 'admin', 'administrator', 'billing', 'help', 'hostmaster', 'info', 'mailer-daemon',
	'no-reply', 'noreply', 'postmaster', 'root', 'security', 'support', 'webmaster', 'www',
	'three', 'threews', 'team', 'staff', 'owner', 'dmarc', 'bounce', 'bounces',
]);

function positive(v, fallback) {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 && n < 1000 ? n : fallback;
}

/** Normalize a stored pricing object onto the defaults. Pure, exported for tests. */
export function normalizePricing(raw) {
	const p = raw && typeof raw === 'object' ? raw : {};
	return {
		create_usd: positive(p.create_usd, DEFAULT_PRICING.create_usd),
		send_usd: positive(p.send_usd, DEFAULT_PRICING.send_usd),
	};
}

/** Current price list, read from app_settings with the defaults as the floor. */
export async function mailPricing() {
	try {
		const [row] = await sql`select value from app_settings where key = ${PRICING_SETTINGS_KEY} limit 1`;
		return normalizePricing(row?.value);
	} catch {
		return normalizePricing(null);
	}
}

/**
 * Hourly and daily outbound caps for a mailbox of a given age. Linear ramp from
 * WARMUP_START on day 0 to WARMUP_FULL on day WARMUP_DAYS. Pure.
 */
export function warmupLimits(createdAt, now = Date.now()) {
	const ageDays = Math.max(0, (now - new Date(createdAt).getTime()) / 86_400_000);
	const t = Math.min(1, ageDays / WARMUP_DAYS);
	const lerp = (a, b) => Math.round(a + (b - a) * t);
	return {
		perHour: lerp(WARMUP_START.perHour, WARMUP_FULL.perHour),
		perDay: lerp(WARMUP_START.perDay, WARMUP_FULL.perDay),
		warming: t < 1,
		ageDays: Math.floor(ageDays),
	};
}
