// POST /api/x/post — publish a tweet on behalf of the signed-in user's
// connected X account. Free tier: 5 posts per calendar month. When over the
// limit, returns 402 with an upgrade pointer.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, json } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { encryptToken, decryptToken } from '../auth/x/[action].js';

const FREE_MONTHLY_QUOTA = 5;
const MAX_TWEET_LEN = 280;

async function refreshIfNeeded(conn) {
	const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
	const stillValid = expiresAt - Date.now() > 60_000;
	if (stillValid) return decryptToken(conn.access_token);
	if (!conn.refresh_token) throw Object.assign(new Error('refresh_token missing — reconnect X account'), { status: 401, code: 'reauth_required' });

	const refreshToken = decryptToken(conn.refresh_token);
	const creds = Buffer.from(`${env.X_OAUTH_CLIENT_ID}:${env.X_OAUTH_CLIENT_SECRET}`).toString('base64');
	const r = await fetch('https://api.twitter.com/2/oauth2/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${creds}` },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.X_OAUTH_CLIENT_ID }).toString(),
	});
	if (!r.ok) throw Object.assign(new Error(`X token refresh failed: ${await r.text()}`), { status: 401, code: 'reauth_required' });
	const tok = await r.json();
	const newExpiresAt = new Date(Date.now() + (tok.expires_in ?? 7200) * 1000).toISOString();
	await sql`
		update social_connections
		set access_token = ${encryptToken(tok.access_token)},
		    refresh_token = ${tok.refresh_token ? encryptToken(tok.refresh_token) : conn.refresh_token},
		    expires_at = ${newExpiresAt},
		    updated_at = now()
		where id = ${conn.id}
	`;
	return tok.access_token;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET) {
		return error(res, 501, 'not_configured', 'X OAuth is not configured');
	}

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const body = await readJson(req);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	const agentId = typeof body?.agent_id === 'string' ? body.agent_id : null;
	if (!text) return error(res, 400, 'validation_error', 'text required');
	if (text.length > MAX_TWEET_LEN) return error(res, 400, 'validation_error', `text exceeds ${MAX_TWEET_LEN} chars`);

	const rows = await sql`
		select * from social_connections
		where user_id = ${user.id} and provider = 'x' and disconnected_at is null
		limit 1
	`;
	const conn = rows[0];
	if (!conn) return error(res, 400, 'not_connected', 'connect X account first at /api/auth/x/connect');

	// Reset monthly counter if we crossed the boundary.
	if (new Date(conn.month_resets_at) <= new Date()) {
		await sql`
			update social_connections
			set posts_this_month = 0,
			    month_resets_at = date_trunc('month', now()) + interval '1 month'
			where id = ${conn.id}
		`;
		conn.posts_this_month = 0;
	}

	if (conn.posts_this_month >= FREE_MONTHLY_QUOTA) {
		return error(res, 402, 'quota_exceeded', `free tier limit of ${FREE_MONTHLY_QUOTA} posts/month reached`, {
			posts_used: conn.posts_this_month,
			quota: FREE_MONTHLY_QUOTA,
			month_resets_at: conn.month_resets_at,
			upgrade_url: '/pricing',
		});
	}

	let accessToken;
	try {
		accessToken = await refreshIfNeeded(conn);
	} catch (err) {
		return error(res, err.status || 500, err.code || 'token_error', err.message);
	}

	const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
		body: JSON.stringify({ text }),
	});
	if (!tweetRes.ok) {
		const detail = await tweetRes.text();
		console.error('[x-post] tweet failed', tweetRes.status, detail);
		return error(res, 502, 'tweet_failed', `X API error: ${detail.slice(0, 200)}`);
	}
	const { data } = await tweetRes.json();

	await sql`
		update social_connections
		set posts_this_month = posts_this_month + 1,
		    updated_at = now()
		where id = ${conn.id}
	`;
	await sql`
		insert into x_posts (user_id, agent_id, tweet_id, text)
		values (${user.id}, ${agentId}, ${data.id}, ${text})
	`;

	return json(res, 200, {
		tweet_id: data.id,
		url: `https://x.com/${conn.username}/status/${data.id}`,
		posts_used: conn.posts_this_month + 1,
		quota: FREE_MONTHLY_QUOTA,
	});
});
