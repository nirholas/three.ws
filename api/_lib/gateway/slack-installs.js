// Slack workspaces that installed the three.ws app, and the bot token for each.
//
// A distributed Slack app gets one bot token per workspace from OAuth v2 (Add to
// Slack). Each is sealed with the secret box before it is stored in
// gateway_slack_installs, and opened only in memory to make an API call. A
// deployment that serves one workspace can skip OAuth and set SLACK_BOT_TOKEN,
// which answers for any workspace without an install row.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { encryptSecret, decryptSecret } from '../secret-box.js';
import { appOrigin } from './format.js';

export const SLACK_BOT_SCOPES = ['app_mentions:read', 'chat:write', 'commands', 'files:read', 'files:write', 'im:history', 'im:read', 'im:write'];
const STATE_TTL_S = 15 * 60;
const TOKEN_CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

export function slackOAuthConfigured(env = process.env) {
	return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET);
}

export function slackRedirectUri() {
	return `${appOrigin()}/api/gateway/slack?leg=oauth`;
}

function stateKey(env) {
	return `three-ws-slack-install:${env.SLACK_CLIENT_SECRET}`;
}

// An install can start from Connections (signed in), from the public /slack page
// or from the Slack Marketplace's direct install link (often signed out). Either
// way the state carries a random nonce that is also set in a short-lived
// HttpOnly cookie, and the OAuth callback is only honoured in the browser that
// holds it, so nobody can finish an install they did not start.
export const INSTALL_COOKIE = 'tws_slack_install';
const ANON = '-';

export function newInstallNonce() {
	return randomBytes(18).toString('base64url');
}

function mac(env, body) {
	return createHmac('sha256', stateKey(env)).update(body).digest('base64url');
}

/** A signed, expiring OAuth state: the installing account (or none) and the browser nonce. */
export function signInstallState({ userId = null, nonce }, { env = process.env, now = Date.now() } = {}) {
	const body = `${userId || ANON}.${nonce}.${Math.floor(now / 1000)}`;
	return `${body}.${mac(env, body)}`;
}

/**
 * @returns {{ userId: string|null, nonce: string }|null} what the state was signed
 *   for, or null when forged, malformed or expired. The caller still has to match
 *   the nonce against the install cookie.
 */
export function verifyInstallState(state, { env = process.env, now = Date.now() } = {}) {
	const m = /^([0-9a-f-]{36}|-)\.([\w-]{16,64})\.(\d{1,12})\.([\w-]{43})$/i.exec(String(state || ''));
	if (!m) return null;
	const a = Buffer.from(m[4]);
	const b = Buffer.from(mac(env, `${m[1]}.${m[2]}.${m[3]}`));
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	if (now / 1000 - Number(m[3]) > STATE_TTL_S) return null;
	return { userId: m[1] === ANON ? null : m[1], nonce: m[2] };
}

/** True when the state is genuine and the cookie the browser sent holds its nonce. */
export function installNonceMatches(verified, cookieNonce) {
	if (!verified || !cookieNonce) return false;
	const a = Buffer.from(String(cookieNonce));
	const b = Buffer.from(verified.nonce);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function installCookie(nonce, { clear = false } = {}) {
	const value = clear ? '' : nonce;
	return `${INSTALL_COOKIE}=${value}; Path=/api/gateway/slack; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : STATE_TTL_S}`;
}

export function slackInstallUrl({ userId = null, nonce }, env = process.env) {
	const q = new URLSearchParams({
		client_id: env.SLACK_CLIENT_ID,
		scope: SLACK_BOT_SCOPES.join(','),
		redirect_uri: slackRedirectUri(),
		state: signInstallState({ userId, nonce }, { env }),
	});
	return `https://slack.com/oauth/v2/authorize?${q.toString()}`;
}

/** Exchange an OAuth code for the workspace's bot token. Throws with Slack's error code. */
export async function exchangeSlackCode(code, { env = process.env, fetchImpl = fetch } = {}) {
	const r = await fetchImpl('https://slack.com/api/oauth.v2.access', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ code, client_id: env.SLACK_CLIENT_ID, client_secret: env.SLACK_CLIENT_SECRET, redirect_uri: slackRedirectUri() }),
		signal: AbortSignal.timeout(10_000),
	});
	const j = await r.json().catch(() => ({}));
	if (!j.ok || !j.access_token || !j.team?.id) throw Object.assign(new Error(`slack oauth: ${j.error || r.status}`), { code: j.error || 'oauth_failed' });
	return { teamId: j.team.id, teamName: j.team.name || null, botUserId: j.bot_user_id || null, botToken: j.access_token, appId: j.app_id || null };
}

export async function saveSlackInstall({ teamId, teamName, botUserId, botToken, userId }) {
	const sealed = await encryptSecret(botToken);
	await sql`
		INSERT INTO gateway_slack_installs (team_id, team_name, bot_user_id, bot_token, installed_by)
		VALUES (${teamId}, ${teamName}, ${botUserId}, ${sealed}, ${userId})
		ON CONFLICT (team_id) DO UPDATE SET team_name = EXCLUDED.team_name, bot_user_id = EXCLUDED.bot_user_id,
			bot_token = EXCLUDED.bot_token, installed_by = EXCLUDED.installed_by, updated_at = now(), revoked_at = NULL`;
	cache.delete(teamId);
}

/**
 * Slack told us the app was uninstalled or its tokens revoked. The token is
 * dead at Slack either way, so the sealed copy is erased rather than kept; a
 * reinstall stores a fresh one.
 */
export async function revokeSlackInstall(teamId) {
	await sql`UPDATE gateway_slack_installs SET revoked_at = COALESCE(revoked_at, now()), bot_token = '' WHERE team_id = ${teamId}`;
	cache.delete(teamId);
}

export async function countSlackInstalls() {
	const [row] = await sql`SELECT count(*)::int AS n FROM gateway_slack_installs WHERE revoked_at IS NULL`;
	return row?.n || 0;
}

/**
 * The bot token for a workspace: its install row, else SLACK_BOT_TOKEN.
 * @returns {Promise<string|null>}
 */
export async function slackTokenFor(teamId, env = process.env) {
	if (teamId) {
		const hit = cache.get(teamId);
		if (hit && hit.until > Date.now()) return hit.token || env.SLACK_BOT_TOKEN || null;
		const [row] = await sql`SELECT bot_token FROM gateway_slack_installs WHERE team_id = ${teamId} AND revoked_at IS NULL LIMIT 1`;
		const token = row ? await decryptSecret(row.bot_token) : null;
		cache.set(teamId, { token, until: Date.now() + TOKEN_CACHE_MS });
		if (token) return token;
	}
	return env.SLACK_BOT_TOKEN || null;
}
