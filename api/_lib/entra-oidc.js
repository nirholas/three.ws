// Sign in with Microsoft for everyone: OpenID Connect against the Microsoft
// identity platform's `common` authority, so work, school and personal
// (Microsoft account) identities all reach /login through one multitenant app.
//
// The app is the same Entra registration the Microsoft Marketplace landing page
// uses (MS_ENTRA_SSO_CLIENT_ID / MS_ENTRA_SSO_CLIENT_SECRET). Its redirect URIs
// must include `${APP_ORIGIN}/api/auth/microsoft/callback` for this flow (the
// Marketplace callback stays registered for the purchase flow).
//
// Multitenant issuer validation. A token from `common` can come from any
// tenant, so no single issuer string is valid. The rule Microsoft documents is:
// read `tid` from the token, require it to be a tenant GUID, and require `iss`
// to equal exactly `https://login.microsoftonline.com/{tid}/v2.0`. A token
// whose issuer names a different tenant than its own `tid` is rejected, and so
// is a token from a tenant the caller pinned (tenant claim flows).
//
// Identity: the subject is `<tid>:<oid>`, the same tenant-scoped key the
// Marketplace flow writes to user_identities, so an identity a Marketplace
// purchase linked signs in here unchanged. `oid` is only unique inside its
// tenant, and personal accounts all live in the consumer tenant.
//
// Email. Microsoft documents the `email` claim as unverified and mutable. It
// only counts as verified when the token also carries `xms_edov: true` (the
// email's domain is verified by the tenant that owns the account), an optional
// claim the app registration must request alongside `email`. Without it the
// address is a display hint and never reaches an existing account.

import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import { env } from './env.js';
import { fetchUpstream } from './upstream-fetch.js';
import { randomToken, sha256Base64Url } from './crypto.js';

export const LOGIN_BASE = 'https://login.microsoftonline.com';
export const AUTHORITY = 'common';
export const JWKS_URL = `${LOGIN_BASE}/common/discovery/v2.0/keys`;
/** Tenant every personal Microsoft account (outlook.com, live.com, ...) signs in from. */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const SCOPES = 'openid profile email offline_access User.Read';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Built-in Entra directory roles whose holders may claim their tenant for a
 * team (role template ids, identical in every tenant). Each can already grant
 * an app tenant-wide consent, which is the right bar for "this organisation
 * belongs to this team".
 */
export const TENANT_ADMIN_ROLES = Object.freeze({
	'62e90394-69f5-4237-9190-012177145e10': 'Global Administrator',
	'e8611ab8-c189-46e8-94e1-60213ab1f814': 'Privileged Role Administrator',
	'9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3': 'Application Administrator',
	'158c047a-c907-4556-b7ef-446551a6b5f7': 'Cloud Application Administrator',
});

export class EntraError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

function envValue(name) {
	const v = process.env[name];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function entraConfig() {
	const clientId = envValue('MS_ENTRA_SSO_CLIENT_ID');
	const clientSecret = envValue('MS_ENTRA_SSO_CLIENT_SECRET');
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}

export function entraConfigured() {
	return entraConfig() !== null;
}

export function entraRedirectUri() {
	return `${env.APP_ORIGIN}/api/auth/microsoft/callback`;
}

export const isGuid = (s) => typeof s === 'string' && GUID.test(s);

/**
 * The authorize URL plus the per-flow secrets the callback needs.
 * @param {{ prompt?: string, maxAge?: number|null, loginHint?: string|null, domainHint?: string|null }} o
 */
export async function buildAuthorize({ prompt = 'select_account', maxAge = null, loginHint = null, domainHint = null } = {}) {
	const cfg = entraConfig();
	if (!cfg) throw new EntraError('unavailable', 'Microsoft sign-in is not configured', 501);
	const state = randomToken(16);
	const nonce = randomToken(16);
	const verifier = randomToken(32);
	const url = new URL(`${LOGIN_BASE}/${AUTHORITY}/oauth2/v2.0/authorize`);
	url.searchParams.set('client_id', cfg.clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', entraRedirectUri());
	url.searchParams.set('response_mode', 'query');
	url.searchParams.set('scope', SCOPES);
	url.searchParams.set('state', state);
	url.searchParams.set('nonce', nonce);
	url.searchParams.set('code_challenge', await sha256Base64Url(verifier));
	url.searchParams.set('code_challenge_method', 'S256');
	if (prompt) url.searchParams.set('prompt', prompt);
	if (maxAge != null) url.searchParams.set('max_age', String(maxAge));
	if (loginHint) url.searchParams.set('login_hint', loginHint);
	if (domainHint) url.searchParams.set('domain_hint', domainHint);
	return { url: url.toString(), state, nonce, verifier };
}

/** Swap the authorization code for tokens. Returns { idToken, accessToken }. */
export async function exchangeCode({ code, verifier }) {
	const cfg = entraConfig();
	if (!cfg) throw new EntraError('unavailable', 'Microsoft sign-in is not configured', 501);
	const res = await fetchUpstream(
		`${LOGIN_BASE}/${AUTHORITY}/oauth2/v2.0/token`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: cfg.clientId,
				client_secret: cfg.clientSecret,
				code,
				redirect_uri: entraRedirectUri(),
				code_verifier: verifier,
				scope: SCOPES,
			}).toString(),
		},
		{ name: 'ms-entra-login', timeoutMs: 10_000, attempts: 1, okWhen: () => true },
	);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.id_token) {
		const consent = /AADSTS65001|consent/i.test(String(body.error_description || ''));
		throw new EntraError(consent ? 'admin_consent_required' : 'exchange_failed',
			body.error_description || body.error || `Microsoft answered ${res.status}`, 502);
	}
	return { idToken: body.id_token, accessToken: typeof body.access_token === 'string' ? body.access_token : null };
}

/**
 * The multitenant issuer rule, pure. Throws unless `tid` is a tenant GUID and
 * `iss` is exactly that tenant's v2.0 issuer; with `expectedTenantId` the
 * token must also come from that tenant.
 */
export function checkIssuer(payload, { expectedTenantId = null } = {}) {
	const tid = payload?.tid;
	if (!isGuid(tid)) throw new EntraError('invalid_token', 'the Microsoft token names no tenant', 401);
	if (payload.iss !== `${LOGIN_BASE}/${tid}/v2.0`) {
		throw new EntraError('invalid_token', 'the Microsoft token issuer does not match its tenant', 401);
	}
	if (expectedTenantId && tid.toLowerCase() !== String(expectedTenantId).toLowerCase()) {
		throw new EntraError('wrong_tenant', 'that Microsoft account belongs to a different organisation', 403);
	}
	return tid.toLowerCase();
}

const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

/**
 * Normalize verified ID token claims, pure, so tests and the verifier agree on
 * which claims are required and which email counts as verified.
 */
export function claimsFromPayload(payload, { clientId, nonce = null, expectedTenantId = null, maxAuthAgeSec = null, now = Date.now() } = {}) {
	const tenantId = checkIssuer(payload, { expectedTenantId });
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!clientId || !audiences.includes(clientId)) throw new EntraError('invalid_token', 'the Microsoft token is for a different app', 401);
	if (!isGuid(payload.oid)) throw new EntraError('invalid_token', 'the Microsoft token has no object id', 401);
	if (nonce && payload.nonce !== nonce) throw new EntraError('invalid_token', 'the Microsoft token was issued for a different sign-in', 401);
	if (maxAuthAgeSec != null) {
		// auth_time is optional on Entra ID tokens; iat is when the token was
		// minted, and with prompt=login that is moments after credential entry.
		const at = Number(payload.auth_time ?? payload.iat);
		if (!Number.isFinite(at) || now / 1000 - at > maxAuthAgeSec) {
			throw new EntraError('reauth_stale', 'Microsoft did not ask for your credentials again; try once more', 401);
		}
	}
	const email = typeof payload.email === 'string' && payload.email.includes('@') ? payload.email.toLowerCase() : null;
	const verifiedList = Array.isArray(payload.verified_primary_email) ? payload.verified_primary_email.map((e) => String(e).toLowerCase()) : [];
	const emailVerified = Boolean(email) && (truthy(payload.xms_edov) || verifiedList.includes(email));
	const username = typeof payload.preferred_username === 'string' ? payload.preferred_username.toLowerCase().slice(0, 320) : null;
	return {
		subject: `${tenantId}:${payload.oid.toLowerCase()}`,
		tenant_id: tenantId,
		object_id: payload.oid.toLowerCase(),
		personal: tenantId === CONSUMER_TENANT_ID,
		// What the account is shown as; the email when there is one, else the
		// sign-in name. Stored on the identity row for display only.
		email: email || (username && username.includes('@') ? username : null),
		email_verified: emailVerified,
		username,
		display_name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : null,
		avatar_url: null,
		roles: Array.isArray(payload.wids) ? payload.wids.filter(isGuid).map((r) => r.toLowerCase()) : [],
	};
}

let jwks = null;
function microsoftJwks() {
	if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
	return jwks;
}

/** Verify an ID token's signature and claims. */
export async function verifyIdToken(idToken, opts = {}) {
	const cfg = entraConfig();
	if (!cfg) throw new EntraError('unavailable', 'Microsoft sign-in is not configured', 501);
	let payload;
	try {
		({ payload } = await jwtVerify(idToken, microsoftJwks(), { audience: cfg.clientId, clockTolerance: 300 }));
	} catch (err) {
		throw new EntraError('invalid_token', `the Microsoft token did not verify: ${err?.code || err?.message}`, 401);
	}
	return claimsFromPayload(payload, { ...opts, clientId: cfg.clientId });
}

/**
 * Directory roles of the signed-in user. The ID token carries `wids` when the
 * app registration sets groupMembershipClaims to include DirectoryRole; the
 * Microsoft Graph access token from the same back-channel exchange carries
 * them by default. That access token is not ours to signature-check (Graph
 * signs it for itself), but it arrived over TLS from the token endpoint in
 * response to our own client secret and code, which OpenID Connect Core 3.1.3.7
 * accepts as proof of origin. Its tenant and object id must match the verified
 * ID token's.
 */
export function directoryRoles(claims, accessToken) {
	const roles = new Set(claims.roles || []);
	if (accessToken) {
		try {
			const at = decodeJwt(accessToken);
			if (String(at.tid || '').toLowerCase() === claims.tenant_id && String(at.oid || '').toLowerCase() === claims.object_id && Array.isArray(at.wids)) {
				for (const r of at.wids) if (isGuid(r)) roles.add(r.toLowerCase());
			}
		} catch {
			// Not a JWT (an opaque token): the ID token's roles stand alone.
		}
	}
	return [...roles];
}

/** The first tenant-admin role the user holds, or null. */
export function tenantAdminRole(roles) {
	for (const r of roles) if (Object.hasOwn(TENANT_ADMIN_ROLES, r)) return TENANT_ADMIN_ROLES[r];
	return null;
}
