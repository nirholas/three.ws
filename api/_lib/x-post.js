// Internal helper: publish a tweet on behalf of a three.ws user whose X
// account is connected. Handles token refresh, quota check, dedup, and logging.
// Used by api/x/post.js (manual) and the scheduled-posts cron job.

import { sql } from './db.js';
import { env } from './env.js';
import { encryptToken, decryptToken } from '../auth/x/[action].js';

export const FREE_MONTHLY_QUOTA = 5;
export const MAX_TWEET_LEN = 280;
export const DEDUP_WINDOW_DAYS = 7;

class XPostError extends Error {
	constructor(code, message, status = 400, extra = {}) {
		super(message);
		this.code = code;
		this.status = status;
		this.extra = extra;
	}
}

async function refreshIfNeeded(conn) {
	const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
	if (expiresAt - Date.now() > 60_000) return decryptToken(conn.access_token);
	if (!conn.refresh_token) throw new XPostError('reauth_required', 'refresh_token missing — reconnect X account', 401);

	const refreshToken = decryptToken(conn.refresh_token);
	const creds = Buffer.from(`${env.X_OAUTH_CLIENT_ID}:${env.X_OAUTH_CLIENT_SECRET}`).toString('base64');
	const r = await fetch('https://api.twitter.com/2/oauth2/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${creds}` },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.X_OAUTH_CLIENT_ID }).toString(),
	});
	if (!r.ok) throw new XPostError('reauth_required', `X token refresh failed: ${await r.text()}`, 401);
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

export async function publishTweet({ userId, agentId = null, text }) {
	if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET) {
		throw new XPostError('not_configured', 'X OAuth is not configured', 501);
	}
	const trimmed = String(text || '').trim();
	if (!trimmed) throw new XPostError('validation_error', 'text required', 400);
	if (trimmed.length > MAX_TWEET_LEN) throw new XPostError('validation_error', `text exceeds ${MAX_TWEET_LEN} chars`, 400);

	const rows = await sql`
		select * from social_connections
		where user_id = ${userId} and provider = 'x' and disconnected_at is null
		limit 1
	`;
	const conn = rows[0];
	if (!conn) throw new XPostError('not_connected', 'X account not connected', 400);

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
		throw new XPostError('quota_exceeded', `free tier limit of ${FREE_MONTHLY_QUOTA} posts/month reached`, 402, {
			posts_used: conn.posts_this_month,
			quota: FREE_MONTHLY_QUOTA,
			month_resets_at: conn.month_resets_at,
			upgrade_url: '/pricing',
		});
	}

	// Dedup — refuse identical text within the window. Prevents X suspension
	// from repetitive content patterns.
	const dup = await sql`
		select 1 from x_posts
		where user_id = ${userId} and text = ${trimmed}
		  and created_at > now() - ${`${DEDUP_WINDOW_DAYS} days`}::interval
		limit 1
	`;
	if (dup.length) throw new XPostError('duplicate', `same text posted within the last ${DEDUP_WINDOW_DAYS} days`, 409);

	const accessToken = await refreshIfNeeded(conn);

	const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
		body: JSON.stringify({ text: trimmed }),
	});
	if (!tweetRes.ok) {
		const detail = await tweetRes.text();
		throw new XPostError('tweet_failed', `X API error: ${detail.slice(0, 200)}`, 502);
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
		values (${userId}, ${agentId}, ${data.id}, ${trimmed})
	`;

	return {
		tweet_id: data.id,
		url: `https://x.com/${conn.username}/status/${data.id}`,
		username: conn.username,
		posts_used: conn.posts_this_month + 1,
		quota: FREE_MONTHLY_QUOTA,
	};
}

export { XPostError };
