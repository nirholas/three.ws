// Web domains: search, check, price and register, on top of Google Cloud Domains.
//
// The registrar is cloud-domains.js. This layer adds what the platform needs
// around it:
//
//   - the daily API quota as a first-class constraint. Cloud Domains meters
//     "sensitive" requests (search, availability, register) per project per day,
//     so reads are cached, pricing is served from a snapshot (data/domain-tlds.json)
//     that costs no calls, and a 429 on the daily quota trips a flag so callers
//     get a designed answer instead of a stack of failures;
//   - registration as a gated spend: quote (validate-only against the real API),
//     then a confirmed, idempotent register that debits prepaid credits at the
//     exact price Google quoted and refunds them if the registration fails;
//   - a status poll that settles the long-running operation.
//
// Registration is one year; the yearly price is also the renewal price.
// See docs/domains.md.

import { readFileSync } from 'node:fs';
import { domainToASCII } from 'node:url';

import { sql } from './db.js';
import { cacheGet, cacheSet } from './cache.js';
import { debitCredits, refundCredits, getCreditAccount } from './credits.js';
import { logger } from './usage.js';
import {
	CloudDomainsError,
	configureCustomDns,
	getOperation,
	getRegistration,
	moneyToNumber,
	numberToMoney,
	registerDomain,
	retrieveRegisterParameters,
	searchDomains,
	GCP_PROJECT,
} from './cloud-domains.js';

const log = logger('domains');

export class DomainsError extends Error {
	constructor(message, { status = 400, code = 'bad_request', detail } = {}) {
		super(message);
		this.name = 'DomainsError';
		this.status = status;
		this.code = code;
		if (detail !== undefined) this.detail = detail;
	}
}

const FQDN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// ── Snapshot ─────────────────────────────────────────────────────────────────

let snapshotMemo;

/** The TLD snapshot written by scripts/refresh-domain-tlds.mjs, or an empty one. */
export function tldSnapshot() {
	if (snapshotMemo) return snapshotMemo;
	try {
		snapshotMemo = JSON.parse(readFileSync(new URL('../../data/domain-tlds.json', import.meta.url), 'utf8'));
	} catch {
		snapshotMemo = { generatedAt: null, probed: 0, supported: 0, tlds: [] };
	}
	return snapshotMemo;
}

/**
 * TLDs and their yearly price from the snapshot. Costs no Cloud Domains calls.
 * Registration and renewal share one price (registrations are for one year).
 */
export function domainPricing({ tld, maxPriceUsd, limit = 200 } = {}) {
	const snap = tldSnapshot();
	let rows = snap.tlds;
	if (tld) {
		const want = String(tld).toLowerCase().replace(/^\./, '');
		rows = rows.filter((r) => r.tld === want);
	}
	if (maxPriceUsd != null) rows = rows.filter((r) => r.yearlyUsd != null && r.yearlyUsd <= Number(maxPriceUsd));
	rows = rows
		.map((r) => ({
			tld: r.tld,
			registrationUsd: r.yearlyUsd,
			renewalUsd: r.yearlyUsd,
			currency: r.currency,
			termYears: 1,
			privacy: r.privacy,
			notices: r.notices,
		}))
		.sort((a, b) => (a.registrationUsd ?? 1e9) - (b.registrationUsd ?? 1e9));
	return {
		tlds: rows.slice(0, limit),
		count: rows.length,
		snapshotAt: snap.generatedAt,
		source: 'Google Cloud Domains retrieveRegisterParameters, snapshotted',
		note: 'Registrations are for one year; the yearly price is also the renewal price. A name can price above its TLD base (premium names), so check or quote a specific name for the exact figure.',
	};
}

// ── Quota ────────────────────────────────────────────────────────────────────

const QUOTA_DAILY_LIMIT = Number(process.env.DOMAINS_DAILY_QUOTA || 300);

// Cloud Domains resets its per-day quota at 07:00 UTC (midnight Pacific).
function quotaDay(now = new Date()) {
	const t = new Date(now.getTime() - 7 * 3600_000);
	return t.toISOString().slice(0, 10);
}

function secondsUntilQuotaReset(now = new Date()) {
	const next = new Date(now);
	next.setUTCHours(7, 0, 0, 0);
	if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
	return Math.max(60, Math.ceil((next - now) / 1000));
}

const exhaustedKey = () => `domains:quota-exhausted:${quotaDay()}`;
const usedKey = () => `domains:quota-used:${quotaDay()}`;

/** How much of the daily Cloud Domains quota this deployment has used, as counted here. */
export async function quotaStatus() {
	const [used, exhausted] = await Promise.all([cacheGet(usedKey()), cacheGet(exhaustedKey())]);
	return {
		dailyLimit: QUOTA_DAILY_LIMIT,
		used: Number(used || 0),
		exhausted: Boolean(exhausted),
		resetsInSeconds: secondsUntilQuotaReset(),
	};
}

async function spendQuota() {
	const used = Number((await cacheGet(usedKey())) || 0) + 1;
	await cacheSet(usedKey(), used, 86_400);
}

function quotaError() {
	return new DomainsError(
		'The registrar\'s daily request quota is used up. Cached answers and TLD pricing still work; live availability returns when the quota resets.',
		{ status: 429, code: 'domains_quota_exhausted', detail: { resetsInSeconds: secondsUntilQuotaReset() } },
	);
}

/** Run a live registrar call under the quota flag. */
async function metered(fn) {
	if (await cacheGet(exhaustedKey())) throw quotaError();
	await spendQuota();
	try {
		return await fn();
	} catch (err) {
		if (err instanceof CloudDomainsError && err.code === 'domains_rate_limited') {
			// A per-minute 429 clears in a minute; a per-day one does not.
			if (/per day|daily|PerDay/i.test(String(err.detail || '')) || (await isDailyExhausted())) {
				await cacheSet(exhaustedKey(), 1, secondsUntilQuotaReset());
				throw quotaError();
			}
		}
		throw err;
	}
}

async function isDailyExhausted() {
	const used = Number((await cacheGet(usedKey())) || 0);
	return used >= QUOTA_DAILY_LIMIT * 0.9;
}

function wrap(err) {
	if (err instanceof DomainsError) return err;
	if (err instanceof CloudDomainsError) {
		return new DomainsError(err.message, { status: err.status, code: err.code, detail: err.detail });
	}
	return err;
}

// ── Names ────────────────────────────────────────────────────────────────────

/** Lowercase, punycode, validate. Throws a 400 for anything that is not a registrable name. */
export function normalizeDomain(input) {
	const raw = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
	const ascii = domainToASCII(raw);
	if (!ascii || !FQDN_RE.test(ascii)) {
		throw new DomainsError(`"${input}" is not a valid domain name. Use a name like launchpad.app.`, { code: 'invalid_domain' });
	}
	return ascii;
}

/** A search query becomes a label: "My Cool Coin!" -> "my-cool-coin". */
export function labelFromQuery(input) {
	const first = String(input || '').trim().toLowerCase().split('.')[0];
	const label = (domainToASCII(first) || first)
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
	if (!LABEL_RE.test(label)) {
		throw new DomainsError('Give a name to search for, like "orbit".', { code: 'invalid_query' });
	}
	return label;
}

const AVAILABILITY = {
	AVAILABLE: { available: true, reason: null },
	UNAVAILABLE: { available: false, reason: 'registered', message: 'That name is already registered.' },
	UNSUPPORTED: { available: false, reason: 'unsupported_tld', message: 'The registrar does not sell that extension.' },
	AVAILABILITY_UNSPECIFIED: { available: false, reason: 'unknown', message: 'The registrar could not confirm availability.' },
};

function shape(p, domain) {
	const a = AVAILABILITY[p?.availability] || AVAILABILITY.AVAILABILITY_UNSPECIFIED;
	const price = moneyToNumber(p?.yearlyPrice);
	return {
		domain: p?.domainName || domain,
		available: a.available,
		reason: a.reason,
		message: a.message || null,
		registrationUsd: a.available ? price : null,
		renewalUsd: a.available ? price : null,
		currency: p?.yearlyPrice?.currencyCode || 'USD',
		termYears: 1,
		privacy: p?.supportedPrivacy || [],
		notices: p?.domainNotices || [],
	};
}

const CHECK_TTL = 300;
const SEARCH_TTL = 3600;

/** Exact availability and price for one name. Cached five minutes. */
export async function domainCheck(input) {
	const domain = normalizeDomain(input);
	const key = `domains:check:${domain}`;
	const hit = await cacheGet(key);
	if (hit) return { ...hit, cached: true };
	try {
		const p = await metered(() => retrieveRegisterParameters(domain));
		const out = shape(p, domain);
		await cacheSet(key, out, CHECK_TTL);
		return { ...out, cached: false };
	} catch (err) {
		const e = wrap(err);
		// A TLD the registrar does not sell answers 400: a clear unavailable
		// reason, not an error.
		if (e.code === 'domains_invalid_request') {
			return {
				domain,
				available: false,
				reason: 'unsupported_tld',
				message: 'The registrar does not sell that extension.',
				registrationUsd: null,
				renewalUsd: null,
				currency: 'USD',
				termYears: 1,
				privacy: [],
				notices: [],
				cached: false,
			};
		}
		throw e;
	}
}

/**
 * Names across TLDs for a query. One registrar search call plus, when `tlds`
 * is given, an exact check for the name on each of those TLDs (at most 6).
 */
export async function domainSearch(query, { tlds = [], limit = 20 } = {}) {
	const label = labelFromQuery(query);
	const key = `domains:search:${label}`;
	let suggestions = await cacheGet(key);
	let cached = Boolean(suggestions);
	if (!suggestions) {
		try {
			const rows = await metered(() => searchDomains(label));
			suggestions = rows.map((p) => shape(p, p.domainName));
			await cacheSet(key, suggestions, SEARCH_TTL);
		} catch (err) {
			throw wrap(err);
		}
	}
	const wanted = [...new Set((tlds || []).map((t) => String(t).toLowerCase().replace(/^\./, '')).filter(Boolean))].slice(0, 6);
	const have = new Set(suggestions.map((s) => s.domain));
	const extra = [];
	for (const tld of wanted) {
		const name = `${label}.${tld}`;
		if (have.has(name)) continue;
		extra.push(await domainCheck(name));
	}
	const results = [...extra, ...suggestions].slice(0, limit);
	return {
		query: label,
		results,
		availableCount: results.filter((r) => r.available).length,
		cached,
		note: 'Prices are per year and double as the renewal price. Availability is the registrar\'s answer at the time of the call; domain_check or domain_register_quote confirms it before any spend.',
	};
}

/** Project-name suggestions for a launch: the search plus the cheapest available picks. */
export async function suggestForProject(name, { limit = 12 } = {}) {
	const out = await domainSearch(name, { tlds: ['com', 'xyz', 'app', 'io'], limit: 40 });
	const picks = out.results.filter((r) => r.available).sort((a, b) => a.registrationUsd - b.registrationUsd).slice(0, limit);
	return { ...out, results: picks, taken: out.results.filter((r) => !r.available).map((r) => r.domain).slice(0, 8) };
}

// ── Contact ──────────────────────────────────────────────────────────────────

const CONTACT_FIELDS = ['name', 'email', 'phone', 'address_lines', 'city', 'region', 'postal_code', 'country'];

/** Validate the registrant contact the owner supplied. */
export function normalizeContact(c) {
	if (!c || typeof c !== 'object') {
		throw new DomainsError('A registrant contact is required: name, email, phone, address, city, postal_code and country.', { code: 'contact_required' });
	}
	const out = {
		name: String(c.name || '').trim(),
		email: String(c.email || '').trim(),
		phone: String(c.phone || '').replace(/[^\d+]/g, ''),
		address_lines: (Array.isArray(c.address_lines) ? c.address_lines : [c.address_line1, c.address_line2])
			.map((s) => String(s || '').trim())
			.filter(Boolean)
			.slice(0, 3),
		city: String(c.city || '').trim(),
		region: String(c.region || '').trim(),
		postal_code: String(c.postal_code || '').trim(),
		country: String(c.country || '').trim().toUpperCase(),
	};
	const missing = [];
	if (!out.name) missing.push('name');
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) missing.push('email');
	if (!/^\+\d{6,15}$/.test(out.phone)) missing.push('phone (international format, like +14155550123)');
	if (!out.address_lines.length) missing.push('address_lines');
	if (!out.city) missing.push('city');
	if (!out.postal_code) missing.push('postal_code');
	if (!/^[A-Z]{2}$/.test(out.country)) missing.push('country (two-letter code)');
	if (missing.length) {
		throw new DomainsError(`The registrant contact is incomplete: ${missing.join(', ')}.`, { code: 'contact_invalid', detail: { missing } });
	}
	return out;
}

function googleContact(c) {
	return {
		email: c.email,
		phoneNumber: c.phone,
		postalAddress: {
			regionCode: c.country,
			postalCode: c.postal_code,
			administrativeArea: c.region || undefined,
			locality: c.city,
			addressLines: c.address_lines,
			recipients: [c.name],
		},
	};
}

// Google Domains DNS is deprecated, so a name must register on custom name
// servers. Validate-only quotes use the standard Cloud DNS set; a real
// registration creates the domain's Cloud DNS zone first and uses its servers.
const QUOTE_NAME_SERVERS = ['ns-cloud-a1.googledomains.com.', 'ns-cloud-a2.googledomains.com.', 'ns-cloud-a3.googledomains.com.', 'ns-cloud-a4.googledomains.com.'];

function registrationBody(domain, contact, { autoRenew, privacy, nameServers = QUOTE_NAME_SERVERS }) {
	const gc = googleContact(contact);
	return {
		domainName: domain,
		labels: { source: 'three-ws' },
		contactSettings: { privacy, registrantContact: gc, adminContact: gc, technicalContact: gc },
		dnsSettings: { customDns: { nameServers } },
		managementSettings: { preferredRenewalMethod: autoRenew ? 'AUTOMATIC_RENEWAL' : 'MANUAL_RENEWAL' },
	};
}

const PRIVACY_PREFERENCE = ['REDACTED_CONTACT_DATA', 'PRIVATE_CONTACT_DATA', 'PUBLIC_CONTACT_DATA'];

function pickPrivacy(supported, wanted) {
	if (wanted && supported.includes(wanted)) return wanted;
	return PRIVACY_PREFERENCE.find((p) => supported.includes(p)) || supported[0] || 'PUBLIC_CONTACT_DATA';
}

// ── Quote and register ───────────────────────────────────────────────────────

/**
 * Price a registration against the real API without registering anything.
 * Runs retrieveRegisterParameters for the exact price and notices, then
 * register with validateOnly:true, which checks availability, price and the
 * contact server-side. Also reads the caller's credit balance.
 */
export async function quoteRegistration({ userId, domain: input, contact, autoRenew = false, privacy }) {
	const domain = normalizeDomain(input);
	const c = normalizeContact(contact);
	let params;
	try {
		params = await metered(() => retrieveRegisterParameters(domain));
	} catch (err) {
		const e = wrap(err);
		if (e.code === 'domains_invalid_request') {
			throw new DomainsError('The registrar does not sell that extension.', { code: 'unsupported_tld' });
		}
		throw e;
	}
	const s = shape(params, domain);
	if (!s.available) {
		throw new DomainsError(s.message || 'That name is not available.', { status: 409, code: `domain_${s.reason || 'unavailable'}` });
	}
	const chosenPrivacy = pickPrivacy(s.privacy, privacy);
	try {
		await metered(() =>
			registerDomain({
				registration: registrationBody(domain, c, { autoRenew, privacy: chosenPrivacy }),
				yearlyPrice: params.yearlyPrice,
				domainNotices: s.notices,
				validateOnly: true,
			}),
		);
	} catch (err) {
		const e = wrap(err);
		if (e.code === 'domains_invalid_request') {
			throw new DomainsError(`The registrar rejected this registration: ${e.message}`, { code: 'registration_invalid', detail: e.detail });
		}
		throw e;
	}
	const account = await getCreditAccount(userId);
	const priceUsd = s.registrationUsd;
	return {
		domain,
		priceUsd,
		currency: s.currency,
		termYears: 1,
		renewalUsd: priceUsd,
		autoRenew: Boolean(autoRenew),
		autoRenewNote: autoRenew
			? `Renews on its own each year for ${priceUsd} ${s.currency}, taken from your credits 14 days before expiry. If credits are short it switches to manual renewal and the name can lapse.`
			: 'Expires after one year unless renewed.',
		privacy: chosenPrivacy,
		notices: s.notices,
		contact: c,
		payment: { method: 'credits', balanceUsd: account.balanceUsd, sufficient: account.balanceUsd >= priceUsd },
		validated: true,
		note: 'Validated against the registrar with validate-only; nothing was registered or charged.',
	};
}

function publicRegistration(r) {
	return {
		id: r.id,
		domain: r.domain_name,
		status: r.status,
		priceUsd: Number(r.price_usd),
		currency: r.currency,
		termYears: r.years,
		autoRenew: r.auto_renew,
		privacy: r.privacy,
		agentId: r.agent_id,
		error: r.error,
		createdAt: r.created_at,
		registeredAt: r.registered_at,
		expiresAt: r.expires_at,
		renewalNote: r.renewal_note,
	};
}

/**
 * Register a domain. The caller has already shown the owner the quote and got
 * an explicit yes (`confirm`), and sends `expectedPriceUsd` (the quoted price)
 * and a stable idempotency key.
 *
 * The live price is re-read first; if it moved from what the owner approved the
 * call stops with `price_changed` and charges nothing. Credits are debited for
 * the exact yearly price before the registrar call and refunded if the
 * registrar refuses or the operation fails.
 */
export async function registerWithCredits({ userId, domain: input, contact, autoRenew = false, privacy, expectedPriceUsd, confirm, idempotencyKey, agentId = null, source = null }) {
	if (confirm !== true) {
		throw new DomainsError('Registration spends money. Show the owner the quote and send confirm: true only after they approve it.', { code: 'confirmation_required' });
	}
	if (!idempotencyKey || String(idempotencyKey).length < 8 || String(idempotencyKey).length > 128) {
		throw new DomainsError('idempotency_key is required (8 to 128 characters) so a retry never registers twice.', { code: 'idempotency_key_required' });
	}
	const domain = normalizeDomain(input);
	const c = normalizeContact(contact);

	const [existing] = await sql`select * from web_domain_registrations where user_id = ${userId} and idempotency_key = ${idempotencyKey}`;
	if (existing) {
		if (existing.domain_name !== domain) {
			throw new DomainsError('That idempotency_key was already used for a different domain.', { status: 409, code: 'idempotency_key_reused' });
		}
		return { replayed: true, registration: publicRegistration(existing) };
	}

	let params;
	try {
		params = await metered(() => retrieveRegisterParameters(domain));
	} catch (err) {
		throw wrap(err);
	}
	const s = shape(params, domain);
	if (!s.available) throw new DomainsError(s.message || 'That name is not available.', { status: 409, code: `domain_${s.reason || 'unavailable'}` });
	const priceUsd = s.registrationUsd;
	if (Number(expectedPriceUsd) !== priceUsd) {
		throw new DomainsError(`The price changed from ${expectedPriceUsd} to ${priceUsd} ${s.currency}. Nothing was charged. Request a new quote.`, {
			status: 409,
			code: 'price_changed',
			detail: { priceUsd, expectedPriceUsd: Number(expectedPriceUsd) },
		});
	}
	const chosenPrivacy = pickPrivacy(s.privacy, privacy);

	const { ensureZone } = await import('./domain-connect.js');
	const zone = await ensureZone(domain);
	const nameServers = zone.nameServers?.length ? zone.nameServers : QUOTE_NAME_SERVERS;

	let row;
	try {
		[row] = await sql`
			insert into web_domain_registrations
				(user_id, agent_id, domain_name, idempotency_key, price_usd, currency, auto_renew, privacy, status, contact, source)
			values (${userId}, ${agentId}, ${domain}, ${idempotencyKey}, ${priceUsd}, ${s.currency}, ${Boolean(autoRenew)}, ${chosenPrivacy}, 'registering', ${JSON.stringify(c)}::jsonb, ${source})
			returning *
		`;
	} catch (err) {
		if (err?.code === '23505') {
			throw new DomainsError('That domain is already being registered or is registered.', { status: 409, code: 'domain_taken' });
		}
		throw err;
	}

	let debit;
	try {
		debit = await debitCredits({
			userId,
			amountUsd: priceUsd,
			action: 'domain_registration',
			refType: 'web_domain_registration',
			refId: row.id,
			idempotencyKey: `domain:debit:${row.id}`,
			meta: { domain },
		});
	} catch (err) {
		await sql`update web_domain_registrations set status = 'failed', error = ${err.message}, updated_at = now() where id = ${row.id}`;
		if (err.code === 'insufficient_credits') {
			throw new DomainsError(`Not enough credits: this domain costs ${priceUsd} USD and the balance is ${err.available_usd}. Top up at /credits and retry with a new idempotency key.`, {
				status: 402,
				code: 'insufficient_credits',
				detail: { requiredUsd: priceUsd, availableUsd: err.available_usd },
			});
		}
		throw err;
	}
	await sql`update web_domain_registrations set debit_ledger_id = ${debit.ledgerId} where id = ${row.id}`;

	try {
		const op = await metered(() =>
			registerDomain({
				registration: registrationBody(domain, c, { autoRenew, privacy: chosenPrivacy, nameServers }),
				yearlyPrice: params.yearlyPrice || numberToMoney(priceUsd, s.currency),
				domainNotices: s.notices,
			}),
		);
		const [done] = await sql`
			update web_domain_registrations set operation_name = ${op?.name || null}, updated_at = now()
			where id = ${row.id} returning *
		`;
		log.info('register_submitted', { domain, id: row.id, op: op?.name });
		return { replayed: false, registration: publicRegistration(done) };
	} catch (err) {
		const e = wrap(err);
		await failRegistration(row.id, userId, priceUsd, e.message);
		throw e;
	}
}

async function failRegistration(id, userId, priceUsd, message) {
	const refund = await refundCredits({
		userId,
		amountUsd: priceUsd,
		action: 'domain_registration',
		refType: 'web_domain_registration',
		refId: id,
		idempotencyKey: `domain:refund:${id}`,
		meta: { reason: message },
	});
	await sql`
		update web_domain_registrations
		set status = 'failed', error = ${message}, refund_ledger_id = ${refund.ledgerId}, updated_at = now()
		where id = ${id}
	`;
}

/**
 * Settle a registration by polling its long-running operation. Idempotent:
 * an active or failed registration returns as stored.
 */
export async function registrationStatus({ userId, id, domain }) {
	const [row] = id
		? await sql`select * from web_domain_registrations where id = ${id} and user_id = ${userId}`
		: await sql`select * from web_domain_registrations where lower(domain_name) = ${normalizeDomain(domain)} and user_id = ${userId} order by created_at desc limit 1`;
	if (!row) throw new DomainsError('No registration found for that id or domain on this account.', { status: 404, code: 'not_found' });
	if (row.status !== 'registering' || !row.operation_name) return publicRegistration(row);

	let op;
	try {
		op = await getOperation(row.operation_name);
	} catch (err) {
		throw wrap(err);
	}
	if (!op?.done) return { ...publicRegistration(row), operationDone: false };
	if (op.error) {
		await failRegistration(row.id, userId, Number(row.price_usd), op.error.message || 'The registrar could not complete the registration.');
	} else {
		const reg = await getRegistration(row.domain_name).catch(() => null);
		await sql`
			update web_domain_registrations
			set status = 'active', registered_at = now(), expires_at = ${reg?.expireTime || null}, updated_at = now()
			where id = ${row.id}
		`;
	}
	const [fresh] = await sql`select * from web_domain_registrations where id = ${row.id}`;
	return { ...publicRegistration(fresh), operationDone: true };
}

/** The caller's registrations, newest first. */
export async function listRegistrations(userId, { limit = 50 } = {}) {
	const rows = await sql`select * from web_domain_registrations where user_id = ${userId} order by created_at desc limit ${limit}`;
	return rows.map(publicRegistration);
}

export { GCP_PROJECT, configureCustomDns };
