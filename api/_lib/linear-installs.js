// Linear workspaces that installed the three.ws agent, and the token for each.
//
// The app installs with actor=app OAuth (https://linear.app/developers/agents),
// so it acts in Linear as its own user: people mention @three.ws on an issue or
// delegate an issue to it. Each install yields an access token (24 hours) and a
// refresh token (30 days); every refresh rotates both, so the pair is sealed
// with the secret box, stored in linear_installs, and replaced on each refresh
// under a lock so two instances never spend the same refresh token.
//
// An install always starts from a signed-in three.ws account: the models the
// agent makes are owned by that account. The OAuth state names it and carries a
// nonce that is also set in a short-lived HttpOnly cookie, so the callback is
// only honoured in the browser that started the install.
//
//   linearConfigured      whether Add to Linear can work (client + webhook secret)
//   linearAuthorizeUrl    the consent URL, with a signed state
//   exchangeLinearCode    code -> token pair, then the workspace it belongs to
//   saveLinearInstall     upsert the workspace row, tokens sealed
//   linearTokenFor        a live access token for a workspace, refreshed when due
//   linearGraphql         one GraphQL call against api.linear.app
//   verifyLinearWebhook   Linear-Signature (hex HMAC-SHA256 of the raw body) + freshness

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from './db.js';
import { encryptSecret, decryptSecret } from './secret-box.js';
import { cacheSetIfAbsent, cacheDel } from './cache.js';
import { appOrigin } from './gateway/format.js';

export const LINEAR_SCOPES = ['read', 'write', 'app:mentionable', 'app:assignable'];
export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
export const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
export const INSTALL_COOKIE = 'tws_linear_install';
export const WEBHOOK_MAX_SKEW_MS = 60_000;

const STATE_TTL_S = 15 * 60;
const REFRESH_AHEAD_MS = 5 * 60_000;
const REFRESH_LOCK_S = 30;
const REFRESH_WAIT_STEPS = 12;
const REFRESH_WAIT_MS = 500;
const TOKEN_CACHE_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 10_000;
const UA = 'three.ws-linear-agent (+https://three.ws/integrations/linear)';
const cache = new Map();

export class LinearApiError extends Error {
	constructor(message, { code = 'linear_error', status = 0 } = {}) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export function linearConfigured(env = process.env) {
	return Boolean(env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET && env.LINEAR_WEBHOOK_SECRET);
}

export function linearRedirectUri() {
	return `${appOrigin()}/api/linear/oauth`;
}

// ---------------------------------------------------------------------------
// OAuth state

export function newInstallNonce() {
	return randomBytes(18).toString('base64url');
}

function mac(env, body) {
	return createHmac('sha256', `three-ws-linear-install:${env.LINEAR_CLIENT_SECRET}`).update(body).digest('base64url');
}

/** A signed, expiring OAuth state naming the installing account and the browser nonce. */
export function signInstallState({ userId, nonce }, { env = process.env, now = Date.now() } = {}) {
	const body = `${userId}.${nonce}.${Math.floor(now / 1000)}`;
	return `${body}.${mac(env, body)}`;
}

/** `{ userId, nonce }` for a genuine, unexpired state, else null. */
export function verifyInstallState(state, { env = process.env, now = Date.now() } = {}) {
	const m = /^([0-9a-f-]{36})\.([\w-]{16,64})\.(\d{1,12})\.([\w-]{43})$/i.exec(String(state || ''));
	if (!m || !env.LINEAR_CLIENT_SECRET) return null;
	const a = Buffer.from(m[4]);
	const b = Buffer.from(mac(env, `${m[1]}.${m[2]}.${m[3]}`));
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	const age = now / 1000 - Number(m[3]);
	if (age > STATE_TTL_S || age < -60) return null;
	return { userId: m[1], nonce: m[2] };
}

export function installNonceMatches(verified, cookieNonce) {
	if (!verified || !cookieNonce) return false;
	const a = Buffer.from(String(cookieNonce));
	const b = Buffer.from(verified.nonce);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function installCookie(nonce, { clear = false } = {}) {
	return `${INSTALL_COOKIE}=${clear ? '' : nonce}; Path=/api/linear; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : STATE_TTL_S}`;
}

export function linearAuthorizeUrl({ userId, nonce }, env = process.env) {
	const q = new URLSearchParams({
		client_id: env.LINEAR_CLIENT_ID,
		redirect_uri: linearRedirectUri(),
		response_type: 'code',
		scope: LINEAR_SCOPES.join(','),
		actor: 'app',
		state: signInstallState({ userId, nonce }, { env }),
	});
	return `${LINEAR_AUTHORIZE_URL}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// HTTP

async function postForm(url, fields, { fetchImpl = fetch } = {}) {
	let res;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
			body: new URLSearchParams(fields),
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
	} catch (err) {
		throw new LinearApiError(`Linear could not be reached: ${err?.message || err}`, { code: 'network' });
	}
	const body = await res.json().catch(() => ({}));
	return { status: res.status, body };
}

function tokenFields(body) {
	const expiresIn = Number(body.expires_in);
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token || null,
		expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
		scope: Array.isArray(body.scope) ? body.scope.join(',') : body.scope || null,
	};
}

/**
 * One GraphQL request. Resolves to `data`; throws LinearApiError with
 * code `unauthenticated` (token rejected), `ratelimited`, `graphql` (the
 * operation failed) or `network`.
 */
export async function linearGraphql(token, query, variables = {}, { fetchImpl = fetch } = {}) {
	let res;
	try {
		res = await fetchImpl(LINEAR_GRAPHQL_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
		});
	} catch (err) {
		throw new LinearApiError(`Linear could not be reached: ${err?.message || err}`, { code: 'network' });
	}
	const body = await res.json().catch(() => ({}));
	const first = body?.errors?.[0];
	const extCode = String(first?.extensions?.code || '').toUpperCase();
	if (res.status === 401 || extCode === 'AUTHENTICATION_ERROR') {
		throw new LinearApiError('Linear rejected the access token', { code: 'unauthenticated', status: res.status });
	}
	if (res.status === 429 || extCode === 'RATELIMITED') throw new LinearApiError('Linear rate limit reached', { code: 'ratelimited', status: res.status });
	if (first || !res.ok) {
		throw new LinearApiError(`Linear API: ${first?.message || `HTTP ${res.status}`}`, { code: 'graphql', status: res.status });
	}
	return body.data;
}

const WORKSPACE_QUERY = 'query ThreeWsInstall { viewer { id } organization { id name urlKey } }';

/** Trade an OAuth code for tokens and look up the workspace and app user they belong to. */
export async function exchangeLinearCode(code, { env = process.env, fetchImpl = fetch } = {}) {
	const { status, body } = await postForm(
		LINEAR_TOKEN_URL,
		{ code, redirect_uri: linearRedirectUri(), client_id: env.LINEAR_CLIENT_ID, client_secret: env.LINEAR_CLIENT_SECRET, grant_type: 'authorization_code' },
		{ fetchImpl },
	);
	if (status !== 200 || !body.access_token) {
		throw new LinearApiError(`Linear token exchange failed: ${body.error || status}`, { code: body.error || 'oauth_failed', status });
	}
	const tokens = tokenFields(body);
	const data = await linearGraphql(tokens.accessToken, WORKSPACE_QUERY, {}, { fetchImpl });
	if (!data?.viewer?.id || !data?.organization?.id) throw new LinearApiError('Linear did not say which workspace the install is for', { code: 'oauth_failed' });
	return {
		...tokens,
		appUserId: data.viewer.id,
		organizationId: data.organization.id,
		organizationName: data.organization.name || null,
		organizationKey: data.organization.urlKey || null,
	};
}

/** Spend a refresh token. Linear returns a new access token and a new refresh token. */
export async function refreshLinearToken(refreshToken, { env = process.env, fetchImpl = fetch } = {}) {
	const { status, body } = await postForm(
		LINEAR_TOKEN_URL,
		{ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.LINEAR_CLIENT_ID, client_secret: env.LINEAR_CLIENT_SECRET },
		{ fetchImpl },
	);
	if (status !== 200 || !body.access_token) {
		throw new LinearApiError(`Linear token refresh failed: ${body.error || status}`, { code: body.error || 'refresh_failed', status });
	}
	return tokenFields(body);
}

// ---------------------------------------------------------------------------
// Storage

export async function saveLinearInstall(install, userId) {
	const access = await encryptSecret(install.accessToken);
	const refresh = install.refreshToken ? await encryptSecret(install.refreshToken) : null;
	await sql`
		insert into linear_installs (organization_id, organization_name, organization_key, app_user_id, access_token, refresh_token, expires_at, scope, installed_by)
		values (${install.organizationId}, ${install.organizationName}, ${install.organizationKey}, ${install.appUserId}, ${access}, ${refresh},
			${install.expiresAt}, ${install.scope}, ${userId})
		on conflict (organization_id) do update set
			organization_name = excluded.organization_name, organization_key = excluded.organization_key,
			app_user_id = excluded.app_user_id, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
			expires_at = excluded.expires_at, scope = excluded.scope, installed_by = excluded.installed_by,
			updated_at = now(), revoked_at = null`;
	cache.delete(install.organizationId);
}

async function loadRow(organizationId) {
	const [row] = await sql`
		select l.* from linear_installs l
		join users u on u.id = l.installed_by and u.deleted_at is null
		where l.organization_id = ${organizationId} and l.revoked_at is null
		limit 1`;
	return row || null;
}

async function storeRefreshed(organizationId, tokens) {
	const access = await encryptSecret(tokens.accessToken);
	const refresh = tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : null;
	await sql`
		update linear_installs set access_token = ${access}, refresh_token = coalesce(${refresh}, refresh_token),
			expires_at = ${tokens.expiresAt}, updated_at = now()
		where organization_id = ${organizationId}`;
}

function due(row, now) {
	return row.expires_at && new Date(row.expires_at).getTime() - now < REFRESH_AHEAD_MS;
}

function present(row, token) {
	return { organizationId: row.organization_id, appUserId: row.app_user_id, installedBy: row.installed_by, token };
}

/**
 * A usable install for a workspace: `{ organizationId, appUserId, installedBy, token }`,
 * or null when the workspace has no live install. A token that is about to
 * expire is refreshed first; a refresh token Linear refuses revokes the row,
 * since nothing can act in that workspace until someone installs again.
 */
export async function linearTokenFor(organizationId, { env = process.env, fetchImpl = fetch, now = Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	if (!organizationId) return null;
	const hit = cache.get(organizationId);
	if (hit && hit.until > now) return hit.install;
	let row = await loadRow(organizationId);
	if (!row) return null;
	if (due(row, now) && row.refresh_token) {
		const lock = `linear:refresh:${organizationId}`;
		if (await cacheSetIfAbsent(lock, now, REFRESH_LOCK_S)) {
			try {
				const tokens = await refreshLinearToken(await decryptSecret(row.refresh_token), { env, fetchImpl });
				await storeRefreshed(organizationId, tokens);
				row = { ...row, expires_at: tokens.expiresAt };
				return remember(row, tokens.accessToken, now);
			} catch (err) {
				if (err.code === 'invalid_grant') {
					console.warn(`[linear] refresh token for ${organizationId} was refused; marking the install revoked`);
					await revokeLinearInstall(organizationId);
					return null;
				}
				throw err;
			} finally {
				await cacheDel(lock).catch(() => {});
			}
		}
		// Another instance is refreshing: wait for its new token to land.
		for (let i = 0; i < REFRESH_WAIT_STEPS; i++) {
			await sleep(REFRESH_WAIT_MS);
			row = await loadRow(organizationId);
			if (!row) return null;
			if (!due(row, now)) break;
		}
	}
	return remember(row, await decryptSecret(row.access_token), now);
}

function remember(row, token, now) {
	const install = present(row, token);
	const expires = row.expires_at ? new Date(row.expires_at).getTime() - REFRESH_AHEAD_MS : Infinity;
	cache.set(row.organization_id, { install, until: Math.min(now + TOKEN_CACHE_MS, expires) });
	return install;
}

/** Forget a cached token (Linear rejected it). */
export function dropCachedToken(organizationId) {
	cache.delete(organizationId);
}

/** Linear de-authorized the app in a workspace, or its refresh token died. */
export async function revokeLinearInstall(organizationId) {
	await sql`update linear_installs set revoked_at = now() where organization_id = ${organizationId} and revoked_at is null`;
	cache.delete(organizationId);
}

/**
 * The owner removes an install from three.ws: revoke the grant at Linear (the
 * refresh token revokes the whole pair), then mark the row. True when a live
 * install of theirs was removed.
 */
export async function disconnectLinearInstall(userId, organizationId, { fetchImpl = fetch } = {}) {
	const [row] = await sql`
		select access_token, refresh_token from linear_installs
		where organization_id = ${organizationId} and installed_by = ${userId} and revoked_at is null`;
	if (!row) return false;
	const token = await decryptSecret(row.refresh_token || row.access_token).catch(() => null);
	if (token) {
		const hint = row.refresh_token ? 'refresh_token' : 'access_token';
		await postForm(LINEAR_REVOKE_URL, { token, token_type_hint: hint }, { fetchImpl }).catch((err) =>
			console.warn(`[linear] revoke at Linear failed for ${organizationId}: ${err?.message || err}`),
		);
	}
	await revokeLinearInstall(organizationId);
	return true;
}

/** The workspaces an account installed the agent into, newest first, removed ones included. */
export async function listLinearInstalls(userId) {
	const rows = await sql`
		select organization_id, organization_name, organization_key, session_count, last_session_at, created_at, updated_at, revoked_at
		from linear_installs where installed_by = ${userId} order by created_at desc limit 50`;
	return rows.map((r) => ({
		organization_id: r.organization_id,
		organization_name: r.organization_name,
		organization_key: r.organization_key,
		session_count: Number(r.session_count) || 0,
		last_session_at: r.last_session_at,
		created_at: r.created_at,
		revoked_at: r.revoked_at,
	}));
}

export async function countLinearInstalls() {
	const [row] = await sql`select count(*)::int as n from linear_installs where revoked_at is null`;
	return row?.n || 0;
}

/** Count an agent session against its workspace, for the "last used" line. */
export async function recordLinearSession(organizationId) {
	await sql`update linear_installs set session_count = session_count + 1, last_session_at = now() where organization_id = ${organizationId}`;
}

// ---------------------------------------------------------------------------
// Webhooks

/**
 * True when `signature` (the Linear-Signature header) is the hex HMAC-SHA256 of
 * the exact raw body under the webhook signing secret, and the payload's
 * webhookTimestamp is within a minute of now, so a captured delivery cannot be
 * replayed later.
 */
export function verifyLinearWebhook({ rawBody, signature, secret, now = Date.now() }) {
	if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
	const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
	const expected = createHmac('sha256', secret).update(raw).digest();
	const given = Buffer.from(signature, 'hex');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
	let ts;
	try {
		ts = Number(JSON.parse(raw.toString('utf8'))?.webhookTimestamp);
	} catch {
		return false;
	}
	return Number.isFinite(ts) && Math.abs(now - ts) <= WEBHOOK_MAX_SKEW_MS;
}
