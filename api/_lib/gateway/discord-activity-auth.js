// Auth for the Discord Activity (work order 088-partners-05): the OAuth2
// authorization-code exchange the Embedded App SDK's `authorize()` hands off
// to a server (Discord never lets the client hold the client secret), plus a
// short-lived HMAC-signed session that maps a verified Discord identity to one
// Activity instance. Mirrors forge-job-token.js's `f1.<payload>.<sig>` codec
// and signing key (server JWT_SECRET) rather than inventing a second scheme.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';
const SESSION_TTL_S = 4 * 3600;

export function discordActivityConfigured() {
	return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export class DiscordActivityAuthError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

/**
 * Exchange the authorization code the client got from `discordSdk.commands.authorize()`
 * for an access token. Discord's own documented Activity flow: the client never
 * sees the client secret, so this round trip has to happen on a server.
 */
export async function exchangeActivityCode(code) {
	const clientId = process.env.DISCORD_CLIENT_ID;
	const clientSecret = process.env.DISCORD_CLIENT_SECRET;
	if (!clientId || !clientSecret) throw new DiscordActivityAuthError('not_configured', 'the Discord Activity is not configured', 503);
	if (typeof code !== 'string' || !code) throw new DiscordActivityAuthError('bad_code', 'code is required', 400);

	const resp = await fetch(DISCORD_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code }),
		signal: AbortSignal.timeout(8000),
	});
	const data = await resp.json().catch(() => null);
	if (!resp.ok || !data?.access_token) {
		throw new DiscordActivityAuthError('token_exchange_failed', data?.error_description || data?.error || 'Discord rejected the authorization code', 502);
	}
	return { accessToken: data.access_token, scope: data.scope || null };
}

/** Verify an access token is real by asking Discord who it belongs to. */
export async function fetchDiscordUser(accessToken) {
	if (typeof accessToken !== 'string' || !accessToken) throw new DiscordActivityAuthError('bad_token', 'access_token is required', 400);
	const resp = await fetch(DISCORD_USER_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) });
	const data = await resp.json().catch(() => null);
	if (!resp.ok || !data?.id) {
		throw new DiscordActivityAuthError('user_fetch_failed', data?.message || 'Discord rejected the access token', 502);
	}
	return { id: String(data.id), username: data.username, globalName: data.global_name || null, avatar: data.avatar || null };
}

function sign(payload) {
	return createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

/** `da1.<payload>.<sig>`, same shape family as forge-job-token.js's `f1.*`. */
export function signActivitySession({ discordUserId, username, globalName, roomId, guildId, channelId }) {
	const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
	const payload = Buffer.from(JSON.stringify({ u: discordUserId, n: username, g: globalName, r: roomId, gid: guildId, cid: channelId, exp }), 'utf8').toString('base64url');
	return `da1.${payload}.${sign(payload)}`;
}

export function verifyActivitySession(token) {
	if (typeof token !== 'string' || !token.startsWith('da1.')) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [, payload, sig] = parts;
	if (!payload || !sig) return null;
	try {
		const expected = Buffer.from(sign(payload), 'utf8');
		const actual = Buffer.from(sig, 'utf8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
		const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		if (!obj?.u || !obj?.r || !obj?.exp) return null;
		if (obj.exp < Math.floor(Date.now() / 1000)) return null;
		return { discordUserId: obj.u, username: obj.n, globalName: obj.g || null, roomId: obj.r, guildId: obj.gid, channelId: obj.cid };
	} catch {
		return null;
	}
}
