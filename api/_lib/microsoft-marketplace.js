// Microsoft Marketplace SaaS offer: the publisher side of a transactable listing.
//
// Three Microsoft surfaces meet here:
//
//   SaaS Fulfillment API v2   resolve a landing-page purchase token, read and
//                             activate a subscription, read and acknowledge the
//                             operations Microsoft sends to the webhook.
//   Marketplace Metering API  report hourly usage of the metered dimensions
//                             declared on each plan (data/microsoft-marketplace.json).
//   Microsoft Entra ID        the publisher app token for both APIs, the bearer
//                             token Microsoft signs every webhook call with, and
//                             the multitenant sign-in the landing page requires.
//
// A Microsoft subscription grants the same three.ws plan (data/plans.json) a
// direct on-chain payment does. Nothing forks for this channel: the subscription
// row links to a three.ws user and users.plan is recomputed from every active
// entitlement that user holds.
//
// Env (production values live on the Cloud Run service):
//   MS_MARKETPLACE_TENANT_ID      publisher Entra tenant id
//   MS_MARKETPLACE_CLIENT_ID      publisher app (single tenant), entered in
//                                 Partner Center technical configuration
//   MS_MARKETPLACE_CLIENT_SECRET  that app's client secret
//   MS_ENTRA_SSO_CLIENT_ID        multitenant app for buyer sign-in on the landing page
//   MS_ENTRA_SSO_CLIENT_SECRET    that app's client secret

import { readFileSync } from 'node:fs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sql } from './db.js';
import { env } from './env.js';
import { fetchUpstream } from './upstream-fetch.js';
import { randomToken, sha256Base64Url } from './crypto.js';

const CONFIG = JSON.parse(readFileSync(new URL('../../data/microsoft-marketplace.json', import.meta.url), 'utf8'));

/** The Microsoft Marketplace first-party app: the resource both APIs are called on, and the caller of every webhook. */
export const MARKETPLACE_APP_ID = '20e940b3-4c77-4b0b-9a53-9e16a1b010a7';
export const FULFILLMENT_BASE = 'https://marketplaceapi.microsoft.com/api';
export const API_VERSION = '2018-08-31';
const LOGIN_BASE = 'https://login.microsoftonline.com';
const JWKS_URL = `${LOGIN_BASE}/common/discovery/v2.0/keys`;

export const OFFER_ID = CONFIG.offer_id;
export const LANDING_PATH = CONFIG.landing_path;
export const DIMENSIONS = Object.freeze(CONFIG.dimensions.map((d) => Object.freeze({ ...d })));

/** Statuses Microsoft reports on a SaaS subscription (saasSubscriptionStatus). */
export const SAAS_STATUSES = Object.freeze(['PendingFulfillmentStart', 'Subscribed', 'Suspended', 'Unsubscribed']);

/** Webhook actions that wait for the publisher's PATCH before Microsoft completes them. */
export const ACK_ACTIONS = Object.freeze(['ChangePlan', 'ChangeQuantity', 'Reinstate']);
/** Webhook actions Microsoft has already applied; the publisher only reflects them. */
export const NOTIFY_ACTIONS = Object.freeze(['Renew', 'Suspend', 'Unsubscribe']);

export class MarketplaceError extends Error {
	constructor(code, message, status = 400, extra = undefined) {
		super(message);
		this.code = code;
		this.status = status;
		this.extra = extra;
	}
}

// ── Configuration ───────────────────────────────────────────────────────────

function envValue(name) {
	const v = process.env[name];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Publisher app credentials, or null when the offer is not configured on this deployment. */
export function publisherConfig() {
	const tenantId = envValue('MS_MARKETPLACE_TENANT_ID');
	const clientId = envValue('MS_MARKETPLACE_CLIENT_ID');
	const clientSecret = envValue('MS_MARKETPLACE_CLIENT_SECRET');
	if (!tenantId || !clientId || !clientSecret) return null;
	return { tenantId, clientId, clientSecret };
}

/** Landing-page sign-in app credentials, or null when not configured. */
export function ssoConfig() {
	const clientId = envValue('MS_ENTRA_SSO_CLIENT_ID');
	const clientSecret = envValue('MS_ENTRA_SSO_CLIENT_SECRET');
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}

export function ssoRedirectUri() {
	return `${env.APP_ORIGIN}/api/microsoft-marketplace/sso/callback`;
}

/** Names of the env vars a deployment still needs, for an honest 501. */
export function missingConfig() {
	return ['MS_MARKETPLACE_TENANT_ID', 'MS_MARKETPLACE_CLIENT_ID', 'MS_MARKETPLACE_CLIENT_SECRET', 'MS_ENTRA_SSO_CLIENT_ID', 'MS_ENTRA_SSO_CLIENT_SECRET']
		.filter((n) => !envValue(n));
}

// ── Plans and entitlements (pure) ───────────────────────────────────────────

const PLAN_RANK = Object.freeze({ free: 0, pro: 1, team: 2, enterprise: 3 });

/** The three.ws plan a Partner Center plan id grants, or null for an unknown plan. */
export function planForMicrosoftPlan(planId) {
	if (typeof planId !== 'string') return null;
	return Object.hasOwn(CONFIG.plans, planId) ? CONFIG.plans[planId] : null;
}

/** Highest-ranked plan in a list; 'free' when the list holds nothing paid. */
export function highestPlan(plans) {
	let best = 'free';
	for (const p of plans) {
		if (p && Object.hasOwn(PLAN_RANK, p) && PLAN_RANK[p] > PLAN_RANK[best]) best = p;
	}
	return best;
}

/** Whether a Microsoft subscription in this status should grant its plan. */
export function entitles(saasStatus) {
	return saasStatus === 'Subscribed';
}

// ── Publisher token ─────────────────────────────────────────────────────────

let cachedToken = null;

/** App-only token for the Fulfillment and Metering APIs, cached until a minute before expiry. */
export async function publisherToken() {
	const cfg = publisherConfig();
	if (!cfg) throw new MarketplaceError('not_configured', 'the Microsoft Marketplace publisher app is not configured', 501);
	if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;
	const res = await fetchUpstream(
		`${LOGIN_BASE}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: cfg.clientId,
				client_secret: cfg.clientSecret,
				scope: `${MARKETPLACE_APP_ID}/.default`,
			}).toString(),
		},
		{ name: 'ms-entra-token', timeoutMs: 10_000, attempts: 2, okWhen: () => true },
	);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		throw new MarketplaceError('publisher_auth_failed', body.error_description || body.error || `Entra answered ${res.status}`, 502);
	}
	cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
	return cachedToken.value;
}

// ── Fulfillment API v2 ──────────────────────────────────────────────────────

async function marketplaceCall(path, { method = 'GET', body = null, headers = {}, okStatuses = [200] } = {}) {
	const token = await publisherToken();
	const url = `${FULFILLMENT_BASE}${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;
	const res = await fetchUpstream(
		url,
		{
			method,
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				accept: 'application/json',
				'x-ms-requestid': crypto.randomUUID(),
				'x-ms-correlationid': crypto.randomUUID(),
				...headers,
			},
			body: body == null ? undefined : JSON.stringify(body),
		},
		{ name: 'ms-marketplace', timeoutMs: 15_000, attempts: method === 'GET' ? 2 : 1, okWhen: () => true },
	);
	const text = await res.text();
	let data = null;
	if (text) {
		try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
	}
	if (!okStatuses.includes(res.status)) {
		const message = data?.message || data?.error?.message || `Microsoft Marketplace answered ${res.status}`;
		const code = res.status === 400 && path.includes('/resolve') ? 'invalid_token'
			: res.status === 404 ? 'subscription_not_found'
			: res.status === 403 ? 'publisher_forbidden'
			: 'marketplace_error';
		throw new MarketplaceError(code, message, res.status >= 500 ? 502 : res.status, { upstreamStatus: res.status });
	}
	return data;
}

/** Turn the landing-page token into a subscription id and plan. */
export async function resolvePurchaseToken(token) {
	if (typeof token !== 'string' || token.length < 10 || token.length > 4096) {
		throw new MarketplaceError('invalid_token', 'the purchase token is missing or malformed');
	}
	return marketplaceCall('/saas/subscriptions/resolve', {
		method: 'POST',
		headers: { 'x-ms-marketplace-token': token },
	});
}

export async function getSubscription(subscriptionId) {
	return marketplaceCall(`/saas/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export async function activateSubscription(subscriptionId, { planId, quantity = null }) {
	const body = { planId };
	if (quantity != null) body.quantity = quantity;
	return marketplaceCall(`/saas/subscriptions/${encodeURIComponent(subscriptionId)}/activate`, { method: 'POST', body, okStatuses: [200, 202] });
}

export async function getOperation(subscriptionId, operationId) {
	return marketplaceCall(`/saas/subscriptions/${encodeURIComponent(subscriptionId)}/operations/${encodeURIComponent(operationId)}`);
}

/** Tell Microsoft whether a ChangePlan / ChangeQuantity / Reinstate succeeded on our side. */
export async function acknowledgeOperation(subscriptionId, operationId, status) {
	if (status !== 'Success' && status !== 'Failure') throw new Error(`invalid operation status ${status}`);
	return marketplaceCall(
		`/saas/subscriptions/${encodeURIComponent(subscriptionId)}/operations/${encodeURIComponent(operationId)}`,
		{ method: 'PATCH', body: { status }, okStatuses: [200, 202] },
	);
}

// ── Webhook authentication ──────────────────────────────────────────────────

let jwks = null;
function microsoftJwks() {
	if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
	return jwks;
}

/**
 * Check the claims of a webhook bearer token: issued by the publisher's own
 * tenant, for the publisher app, on behalf of the Microsoft Marketplace app.
 * Pure so the rule is unit-tested without a signed token.
 */
export function checkWebhookClaims(payload, { tenantId, clientId }) {
	const issuers = [`https://sts.windows.net/${tenantId}/`, `${LOGIN_BASE}/${tenantId}/v2.0`];
	if (!issuers.includes(payload?.iss)) throw new MarketplaceError('invalid_webhook_token', 'the webhook token was not issued by the publisher tenant', 401);
	if (payload.tid && payload.tid !== tenantId) throw new MarketplaceError('invalid_webhook_token', 'the webhook token names a different tenant', 401);
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audiences.includes(clientId) && !audiences.includes(`api://${clientId}`)) {
		throw new MarketplaceError('invalid_webhook_token', 'the webhook token is not for this publisher app', 401);
	}
	const caller = payload.appid || payload.azp;
	if (caller !== MARKETPLACE_APP_ID) throw new MarketplaceError('invalid_webhook_token', 'the webhook was not sent by Microsoft Marketplace', 401);
	return true;
}

/** Verify the bearer token Microsoft signs every webhook call with. */
export async function verifyWebhookToken(authorization) {
	const cfg = publisherConfig();
	if (!cfg) throw new MarketplaceError('not_configured', 'the Microsoft Marketplace publisher app is not configured', 501);
	const match = /^Bearer\s+(\S+)$/i.exec(authorization || '');
	if (!match) throw new MarketplaceError('invalid_webhook_token', 'missing bearer token', 401);
	let payload;
	try {
		({ payload } = await jwtVerify(match[1], microsoftJwks(), { clockTolerance: 300 }));
	} catch (err) {
		throw new MarketplaceError('invalid_webhook_token', `the webhook token did not verify: ${err?.code || err?.message}`, 401);
	}
	checkWebhookClaims(payload, cfg);
	return payload;
}

// ── Landing-page sign-in (Entra, multitenant, OIDC code + PKCE) ─────────────

/** Build the Entra authorize URL plus the secrets the callback needs. */
export async function buildSsoAuthorize({ loginHint = null } = {}) {
	const cfg = ssoConfig();
	if (!cfg) throw new MarketplaceError('not_configured', 'Microsoft sign-in is not configured', 501);
	const state = randomToken(16);
	const nonce = randomToken(16);
	const verifier = randomToken(32);
	const url = new URL(`${LOGIN_BASE}/organizations/oauth2/v2.0/authorize`);
	url.searchParams.set('client_id', cfg.clientId);
	url.searchParams.set('redirect_uri', ssoRedirectUri());
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('response_mode', 'query');
	url.searchParams.set('scope', 'openid profile email');
	url.searchParams.set('state', state);
	url.searchParams.set('nonce', nonce);
	url.searchParams.set('code_challenge', await sha256Base64Url(verifier));
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('prompt', 'select_account');
	if (loginHint) url.searchParams.set('login_hint', loginHint);
	return { url: url.toString(), state, nonce, verifier };
}

export async function exchangeSsoCode({ code, verifier }) {
	const cfg = ssoConfig();
	if (!cfg) throw new MarketplaceError('not_configured', 'Microsoft sign-in is not configured', 501);
	const res = await fetchUpstream(
		`${LOGIN_BASE}/organizations/oauth2/v2.0/token`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: cfg.clientId,
				client_secret: cfg.clientSecret,
				code,
				redirect_uri: ssoRedirectUri(),
				code_verifier: verifier,
				scope: 'openid profile email',
			}).toString(),
		},
		{ name: 'ms-entra-sso', timeoutMs: 10_000, attempts: 1, okWhen: () => true },
	);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.id_token) {
		throw new MarketplaceError('sso_exchange_failed', body.error_description || body.error || `Entra answered ${res.status}`, 502);
	}
	return body.id_token;
}

/**
 * Normalize verified Entra ID token claims. The subject is tenant-scoped
 * (`<tid>:<oid>`) because an object id is only unique inside its tenant.
 */
export function ssoClaimsFromPayload(payload, { nonce, clientId }) {
	if (!payload?.oid || !payload?.tid) throw new MarketplaceError('sso_invalid_token', 'the Microsoft token has no tenant or object id');
	if (payload.aud !== clientId) throw new MarketplaceError('sso_invalid_token', 'the Microsoft token is for a different app');
	if (payload.iss !== `${LOGIN_BASE}/${payload.tid}/v2.0`) throw new MarketplaceError('sso_invalid_token', 'the Microsoft token issuer does not match its tenant');
	if (nonce && payload.nonce !== nonce) throw new MarketplaceError('sso_invalid_token', 'the Microsoft token was issued for a different sign-in');
	const rawEmail = typeof payload.email === 'string' ? payload.email
		: typeof payload.preferred_username === 'string' && payload.preferred_username.includes('@') ? payload.preferred_username
		: null;
	return {
		subject: `${payload.tid}:${payload.oid}`,
		tenant_id: payload.tid,
		object_id: payload.oid,
		email: rawEmail ? rawEmail.toLowerCase() : null,
		// Entra does not attest mailbox ownership in a way three.ws can rely on
		// across tenants, so the address never counts as verified here.
		email_verified: false,
		display_name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null,
		avatar_url: null,
	};
}

export async function verifySsoIdToken(idToken, { nonce }) {
	const cfg = ssoConfig();
	if (!cfg) throw new MarketplaceError('not_configured', 'Microsoft sign-in is not configured', 501);
	let payload;
	try {
		({ payload } = await jwtVerify(idToken, microsoftJwks(), { audience: cfg.clientId, clockTolerance: 300 }));
	} catch (err) {
		throw new MarketplaceError('sso_invalid_token', `the Microsoft token did not verify: ${err?.code || err?.message}`, 401);
	}
	return ssoClaimsFromPayload(payload, { nonce, clientId: cfg.clientId });
}

/**
 * Whether the person who signed in belongs to the subscription: same tenant as
 * the beneficiary or the purchaser. Microsoft's guidance is to match the
 * signed-in identity to the subscription before activating it.
 */
export function identityMatchesSubscription(claims, row) {
	return [row.beneficiary_tenant_id, row.purchaser_tenant_id].filter(Boolean).includes(claims.tenant_id);
}

// ── Persistence ─────────────────────────────────────────────────────────────

/** Map a Fulfillment API subscription object onto our columns. */
export function subscriptionColumns(sub) {
	return {
		id: sub.id,
		name: typeof sub.name === 'string' ? sub.name.slice(0, 200) : null,
		offer_id: sub.offerId || null,
		plan_id: sub.planId || null,
		// Flat-rate plans carry no seat count; Microsoft sends it absent, null or 0.
		// Store null so activation never echoes a quantity of 0 back to the API.
		quantity: Number(sub.quantity) > 0 && Number.isFinite(Number(sub.quantity)) ? Number(sub.quantity) : null,
		saas_status: SAAS_STATUSES.includes(sub.saasSubscriptionStatus) ? sub.saasSubscriptionStatus : 'PendingFulfillmentStart',
		purchaser_email: sub.purchaser?.emailId || null,
		purchaser_oid: sub.purchaser?.objectId || null,
		purchaser_tenant_id: sub.purchaser?.tenantId || null,
		beneficiary_email: sub.beneficiary?.emailId || null,
		beneficiary_oid: sub.beneficiary?.objectId || null,
		beneficiary_tenant_id: sub.beneficiary?.tenantId || null,
		term_start: sub.term?.startDate || null,
		term_end: sub.term?.endDate || null,
		auto_renew: sub.autoRenew === true,
		is_test: sub.isTest === true,
	};
}

/** Insert or refresh a subscription from Microsoft's authoritative copy. Never touches user_id. */
export async function upsertSubscription(sub) {
	const c = subscriptionColumns(sub);
	const [row] = await sql`
		insert into microsoft_saas_subscriptions
			(id, name, offer_id, plan_id, quantity, saas_status, purchaser_email, purchaser_oid, purchaser_tenant_id,
			 beneficiary_email, beneficiary_oid, beneficiary_tenant_id, term_start, term_end, auto_renew, is_test, raw)
		values
			(${c.id}, ${c.name}, ${c.offer_id}, ${c.plan_id}, ${c.quantity}, ${c.saas_status}, ${c.purchaser_email},
			 ${c.purchaser_oid}, ${c.purchaser_tenant_id}, ${c.beneficiary_email}, ${c.beneficiary_oid},
			 ${c.beneficiary_tenant_id}, ${c.term_start}, ${c.term_end}, ${c.auto_renew}, ${c.is_test},
			 ${JSON.stringify(sub)}::jsonb)
		on conflict (id) do update set
			name = excluded.name, offer_id = excluded.offer_id, plan_id = excluded.plan_id,
			quantity = excluded.quantity, saas_status = excluded.saas_status,
			purchaser_email = excluded.purchaser_email, purchaser_oid = excluded.purchaser_oid,
			purchaser_tenant_id = excluded.purchaser_tenant_id, beneficiary_email = excluded.beneficiary_email,
			beneficiary_oid = excluded.beneficiary_oid, beneficiary_tenant_id = excluded.beneficiary_tenant_id,
			term_start = excluded.term_start, term_end = excluded.term_end, auto_renew = excluded.auto_renew,
			is_test = excluded.is_test, raw = excluded.raw, updated_at = now()
		returning *
	`;
	return row;
}

export async function findSubscription(id) {
	const [row] = await sql`select * from microsoft_saas_subscriptions where id = ${id} limit 1`;
	return row || null;
}

/**
 * Recompute users.plan from every entitlement the user holds: active on-chain
 * subscriptions and Subscribed Microsoft subscriptions. Returns the new plan.
 */
export async function recomputeUserPlan(userId) {
	const [chain, ms] = await Promise.all([
		sql`select plan from subscriptions where user_id = ${userId} and status = 'active' and active_until > now()`,
		sql`select plan_id, saas_status from microsoft_saas_subscriptions where user_id = ${userId}`,
	]);
	const plan = highestPlan([
		...chain.map((r) => r.plan),
		...ms.filter((r) => entitles(r.saas_status)).map((r) => planForMicrosoftPlan(r.plan_id)),
	]);
	await sql`update users set plan = ${plan} where id = ${userId} and plan is distinct from ${plan}`;
	return plan;
}

/** Shape a stored subscription for the landing page. Never exposes raw Microsoft payloads. */
export function publicSubscription(row) {
	const plan = planForMicrosoftPlan(row.plan_id);
	return {
		id: row.id,
		name: row.name,
		plan_id: row.plan_id,
		plan,
		quantity: row.quantity,
		status: row.saas_status,
		entitled: entitles(row.saas_status) && Boolean(plan),
		linked: Boolean(row.user_id),
		beneficiary_email: row.beneficiary_email,
		term_end: row.term_end,
		auto_renew: row.auto_renew,
		is_test: row.is_test,
		activated_at: row.activated_at,
	};
}

// ── Metering (pure helpers; the cron does the IO) ───────────────────────────

const HOUR_MS = 3_600_000;
/** Microsoft rejects usage older than 24 hours. Stay inside that with margin. */
export const METERING_LOOKBACK_HOURS = 23;
export const METERING_BATCH_MAX = 25;

export function floorHour(date) {
	return new Date(Math.floor(new Date(date).getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * The completed hours still to meter for one subscription: from the hour after
 * metered_through (or the activation hour) up to the last fully elapsed hour,
 * never further back than the lookback window.
 */
export function hoursToMeter({ meteredThrough, activatedAt, now = new Date() }) {
	const lastComplete = floorHour(new Date(new Date(now).getTime() - HOUR_MS));
	const floor = floorHour(new Date(new Date(now).getTime() - METERING_LOOKBACK_HOURS * HOUR_MS));
	let start = meteredThrough
		? new Date(floorHour(meteredThrough).getTime() + HOUR_MS)
		: activatedAt ? floorHour(activatedAt) : lastComplete;
	if (start < floor) start = floor;
	const hours = [];
	for (let t = start.getTime(); t <= lastComplete.getTime(); t += HOUR_MS) hours.push(new Date(t));
	return hours;
}

// Per-event verdicts Microsoft documents as transient: a server-side error and a
// subscription that is not active yet (activation still in flight). Both stay
// pending so the next tick resubmits while the hour is inside the window.
const TRANSIENT_USAGE_STATUSES = new Set(['Error', 'ResourceNotActive']);

/** How a Metering API per-event status settles our stored row. */
export function settleUsageStatus(status) {
	if (status === 'Accepted' || status === 'Duplicate') return 'accepted';
	if (status === 'Expired') return 'expired';
	if (TRANSIENT_USAGE_STATUSES.has(status)) return 'pending';
	return 'rejected';
}

export function chunk(list, size) {
	const out = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/** Post one batch (at most 25 events) to the Metering API. */
export async function postUsageBatch(events) {
	if (!events.length) return { result: [] };
	if (events.length > METERING_BATCH_MAX) throw new Error(`metering batch over ${METERING_BATCH_MAX}`);
	return marketplaceCall('/batchUsageEvent', { method: 'POST', body: { request: events } });
}
