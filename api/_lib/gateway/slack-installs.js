// Slack workspaces that installed the three.ws app, and the bot token for each.
//
// A distributed Slack app gets one bot token per workspace from OAuth v2 (Add to
// Slack). Each is sealed with the secret box before it is stored in
// gateway_slack_installs, and opened only in memory to make an API call. A
// deployment that serves one workspace can skip OAuth and set SLACK_BOT_TOKEN,
// which answers for any workspace without an install row.

import { createHmac, timingSafeEqual } from 'node:crypto';
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

/** A signed, expiring OAuth state naming the three.ws account that started the install. */
export function signInstallState(userId, { env = process.env, now = Date.now() } = {}) {
	const body = `${userId}.${Math.floor(now / 1000)}`;
	const mac = createHmac('sha256', stateKey(env)).update(body).digest('base64url');
	return `${body}.${mac}`;
}

/** @returns {string|null} the user id the state was signed for, or null when forged or expired. */
export function verifyInstallState(state, { env = process.env, now = Date.now() } = {}) {
	const m = /^([0-9a-f-]{36})\.(\d{1,12})\.([\w-]{43})$/i.exec(String(state || ''));
	if (!m) return null;
	const expected = createHmac('sha256', stateKey(env)).update(`${m[1]}.${m[2]}`).digest('base64url');
	const a = Buffer.from(m[3]);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	if (now / 1000 - Number(m[2]) > STATE_TTL_S) return null;
	return m[1];
}

export function slackInstallUrl(userId, env = process.env) {
	const q = new URLSearchParams({
		client_id: env.SLACK_CLIENT_ID,
		scope: SLACK_BOT_SCOPES.join(','),
		redirect_uri: slackRedirectUri(),
		state: signInstallState(userId, { env }),
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
	return { teamId: j.team.id, teamName: j.team.name || null, botUserId: j.bot_user_id || null, botToken: j.access_token };
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

/** Slack told us the app was uninstalled or its tokens revoked. */
export async function revokeSlackInstall(teamId) {
	await sql`UPDATE gateway_slack_installs SET revoked_at = now() WHERE team_id = ${teamId} AND revoked_at IS NULL`;
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
