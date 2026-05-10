/**
 * POST /api/social/post
 *
 * Unified social media posting endpoint. Supports X (Twitter), Farcaster, Reddit.
 * Posts immediately or schedules for future delivery.
 *
 * Request body:
 *   platform     'x' | 'farcaster' | 'reddit'
 *   content      Post text (required)
 *   media_urls   Array of image/video URLs to attach (optional)
 *   reply_to     Platform-specific post ID to reply to (optional)
 *   schedule_at  ISO timestamp for future posting (optional — omit to post now)
 *   settings     Platform-specific: { subreddit, title, channel_id, parent_url, ... }
 *   credentials  Platform auth (see below — never stored unless schedule_at is set)
 *
 * credentials by platform:
 *   x:          { consumer_key, consumer_secret, access_token, access_secret }
 *   farcaster:  { neynar_key, signer_uuid }
 *   reddit:     { access_token, user_agent? }
 *
 * Response (immediate):
 *   { ok, id, platform, url, status: 'published', published_at }
 *
 * Response (scheduled):
 *   { ok, id, platform, status: 'scheduled', schedule_at }
 */

import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { dispatchPost, encryptCredentials } from '../_lib/social-post.js';
import { z } from 'zod';

const credentialsSchema = z.object({
	// X (Twitter)
	consumer_key: z.string().optional(),
	consumer_secret: z.string().optional(),
	access_token: z.string().optional(),
	access_secret: z.string().optional(),
	// Farcaster
	neynar_key: z.string().optional(),
	signer_uuid: z.string().optional(),
	// Reddit
	user_agent: z.string().optional(),
}).passthrough();

const bodySchema = z.object({
	platform: z.enum(['x', 'twitter', 'farcaster', 'warpcast', 'reddit']),
	content: z.string().min(1).max(10000),
	media_urls: z.array(z.string().url()).max(4).optional().default([]),
	reply_to: z.string().optional(),
	schedule_at: z.string().datetime().optional(),
	settings: z.record(z.unknown()).optional().default({}),
	credentials: credentialsSchema,
	agent_id: z.string().optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.mcpIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let raw;
	try {
		raw = await readJson(req);
	} catch {
		return error(res, 400, 'invalid_json', 'request body must be application/json');
	}

	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues[0]?.message ?? 'invalid body');
	}

	const { platform, content, media_urls, reply_to, schedule_at, settings, credentials, agent_id } = parsed.data;

	// Validate credentials are present for the platform
	const credErr = validateCredentials(platform, credentials);
	if (credErr) return error(res, 400, 'missing_credentials', credErr);

	// Scheduled post — encrypt credentials, store in DB
	if (schedule_at) {
		const scheduleTime = new Date(schedule_at);
		if (scheduleTime <= new Date()) {
			return error(res, 400, 'invalid_schedule', 'schedule_at must be in the future');
		}

		const credEnc = encryptCredentials(credentials);
		const [row] = await sql`
			insert into social_posts
				(platform, content, media_urls, reply_to, settings, credentials_enc,
				 schedule_at, status, agent_id, requester_ip)
			values
				(${platform}, ${content}, ${JSON.stringify(media_urls)}, ${reply_to ?? null},
				 ${JSON.stringify(settings)}, ${credEnc},
				 ${scheduleTime.toISOString()}, 'scheduled', ${agent_id ?? null}, ${ip})
			returning id, schedule_at
		`;

		return json(res, 202, {
			ok: true,
			id: row.id,
			platform,
			status: 'scheduled',
			schedule_at: row.schedule_at,
		});
	}

	// Immediate post
	let result;
	try {
		result = await dispatchPost(platform, content, credentials, { media_urls, reply_to, settings });
	} catch (err) {
		// Store failed attempt
		await sql`
			insert into social_posts
				(platform, content, media_urls, reply_to, settings, status, error_message, agent_id, requester_ip)
			values
				(${platform}, ${content}, ${JSON.stringify(media_urls)}, ${reply_to ?? null},
				 ${JSON.stringify(settings)}, 'failed', ${err.message}, ${agent_id ?? null}, ${ip})
		`.catch(() => {}); // don't fail the response on DB error

		return error(res, 502, 'post_failed', err.message);
	}

	// Store successful post
	await sql`
		insert into social_posts
			(platform, content, media_urls, reply_to, settings, status,
			 platform_post_id, platform_url, published_at, agent_id, requester_ip)
		values
			(${platform}, ${content}, ${JSON.stringify(media_urls)}, ${reply_to ?? null},
			 ${JSON.stringify(settings)}, 'published',
			 ${result.id ?? null}, ${result.url ?? null}, ${result.published_at},
			 ${agent_id ?? null}, ${ip})
		returning id
	`.catch(() => {});

	return json(res, 200, {
		ok: true,
		id: result.id,
		platform: result.platform,
		url: result.url,
		status: 'published',
		published_at: result.published_at,
	});
});

function validateCredentials(platform, creds) {
	const p = platform.replace('twitter', 'x').replace('warpcast', 'farcaster');
	if (p === 'x') {
		const missing = ['consumer_key', 'consumer_secret', 'access_token', 'access_secret']
			.filter((k) => !creds[k]);
		if (missing.length) return `X credentials missing: ${missing.join(', ')}`;
	}
	if (p === 'farcaster') {
		const missing = ['neynar_key', 'signer_uuid'].filter((k) => !creds[k]);
		if (missing.length) return `Farcaster credentials missing: ${missing.join(', ')}`;
	}
	if (p === 'reddit') {
		if (!creds.access_token) return 'Reddit credentials missing: access_token';
	}
	return null;
}
