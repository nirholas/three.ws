/**
 * Social media platform posting clients.
 *
 * Supported platforms:
 *   x         — X (Twitter) via API v2 with OAuth 1.0a user context
 *   farcaster — Farcaster via Neynar REST API
 *   reddit    — Reddit via OAuth 2.0
 *
 * Each platform function accepts a credentials object and returns
 * { id, url, platform, published_at } on success, throws on failure.
 */

import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ─── OAuth 1.0a (Twitter) ─────────────────────────────────────────────────

function pct(s) {
	return encodeURIComponent(String(s))
		.replace(/!/g, '%21')
		.replace(/\*/g, '%2A')
		.replace(/'/g, '%27');
}

function buildOAuth1Header(method, url, oauthParams, consumerSecret, tokenSecret) {
	const sorted = Object.keys(oauthParams)
		.sort()
		.map((k) => `${pct(k)}=${pct(oauthParams[k])}`)
		.join('&');

	const base = [method.toUpperCase(), pct(url), pct(sorted)].join('&');
	const key = `${pct(consumerSecret)}&${pct(tokenSecret || '')}`;
	const sig = createHmac('sha1', key).update(base).digest('base64');

	const all = { ...oauthParams, oauth_signature: sig };
	return (
		'OAuth ' +
		Object.keys(all)
			.sort()
			.map((k) => `${pct(k)}="${pct(all[k])}"`)
			.join(', ')
	);
}

// ─── X (Twitter) ──────────────────────────────────────────────────────────

/**
 * Post a tweet to X (Twitter) using OAuth 1.0a.
 *
 * credentials: { consumer_key, consumer_secret, access_token, access_secret }
 * options: { reply_to_tweet_id?, media_ids? }
 */
export async function postToX(content, credentials, options = {}) {
	const { consumer_key, consumer_secret, access_token, access_secret } = credentials;
	if (!consumer_key || !consumer_secret || !access_token || !access_secret) {
		throw new Error('X credentials require consumer_key, consumer_secret, access_token, access_secret');
	}

	const url = 'https://api.twitter.com/2/tweets';
	const nonce = randomBytes(16).toString('hex');
	const ts = String(Math.floor(Date.now() / 1000));

	const oauthParams = {
		oauth_consumer_key: consumer_key,
		oauth_nonce: nonce,
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: ts,
		oauth_token: access_token,
		oauth_version: '1.0',
	};

	// JSON body — not included in OAuth 1.0a signature for Twitter v2 endpoints
	const authHeader = buildOAuth1Header('POST', url, oauthParams, consumer_secret, access_secret);

	const body = { text: content };
	if (options.reply_to_tweet_id) body.reply = { in_reply_to_tweet_id: options.reply_to_tweet_id };
	if (options.media_ids?.length) body.media = { media_ids: options.media_ids };

	const resp = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const data = await resp.json();
	if (!resp.ok) {
		throw new Error(data?.detail || data?.title || data?.errors?.[0]?.message || 'Twitter API error');
	}

	const tweetId = data?.data?.id;
	return {
		id: tweetId,
		platform: 'x',
		url: `https://x.com/i/web/status/${tweetId}`,
		published_at: new Date().toISOString(),
		raw: data,
	};
}

/**
 * Upload media to Twitter (v1.1 INIT → APPEND → FINALIZE).
 * Returns media_id_string to attach to a tweet.
 *
 * credentials: same OAuth 1.0a creds
 * mediaBuffer: Buffer of the image/video bytes
 * mediaType: MIME type e.g. 'image/jpeg'
 */
export async function uploadMediaToX(mediaBuffer, mediaType, credentials) {
	const { consumer_key, consumer_secret, access_token, access_secret } = credentials;

	async function callUpload(method, url, params, body, extraHeaders = {}) {
		const nonce = randomBytes(16).toString('hex');
		const ts = String(Math.floor(Date.now() / 1000));
		const oauthParams = {
			oauth_consumer_key: consumer_key,
			oauth_nonce: nonce,
			oauth_signature_method: 'HMAC-SHA1',
			oauth_timestamp: ts,
			oauth_token: access_token,
			oauth_version: '1.0',
		};
		// For form params, include them in signature
		const sigParams = { ...oauthParams, ...params };
		const authHeader = buildOAuth1Header(method, url, sigParams, consumer_secret, access_secret);
		const resp = await fetch(url, {
			method,
			headers: { Authorization: authHeader, ...extraHeaders },
			body,
		});
		return resp.json();
	}

	const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

	// INIT
	const init = await callUpload(
		'POST',
		UPLOAD_URL,
		{ command: 'INIT', total_bytes: String(mediaBuffer.length), media_type: mediaType },
		new URLSearchParams({ command: 'INIT', total_bytes: mediaBuffer.length, media_type: mediaType }),
		{ 'Content-Type': 'application/x-www-form-urlencoded' },
	);
	const mediaId = init.media_id_string;

	// APPEND
	const form = new FormData();
	form.append('command', 'APPEND');
	form.append('media_id', mediaId);
	form.append('segment_index', '0');
	form.append('media', new Blob([mediaBuffer], { type: mediaType }));
	await callUpload('POST', UPLOAD_URL, {}, form);

	// FINALIZE
	const fin = await callUpload(
		'POST',
		UPLOAD_URL,
		{ command: 'FINALIZE', media_id: mediaId },
		new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }),
		{ 'Content-Type': 'application/x-www-form-urlencoded' },
	);
	if (fin.error) throw new Error(fin.error);
	return fin.media_id_string;
}

// ─── Farcaster (Neynar) ───────────────────────────────────────────────────

/**
 * Post a cast to Farcaster via Neynar API.
 *
 * credentials: { neynar_key, signer_uuid }
 * options: { parent_url?, channel_id?, reply_to_hash?, embed_urls? }
 */
export async function postToFarcaster(content, credentials, options = {}) {
	const { neynar_key, signer_uuid } = credentials;
	if (!neynar_key || !signer_uuid) {
		throw new Error('Farcaster credentials require neynar_key and signer_uuid');
	}

	const body = { signer_uuid, text: content };
	if (options.embed_urls?.length) body.embeds = options.embed_urls.map((url) => ({ url }));
	if (options.parent_url) body.parent_url = options.parent_url;
	if (options.channel_id) body.channel_id = options.channel_id;
	if (options.reply_to_hash) body.parent = options.reply_to_hash;

	const resp = await fetch('https://api.neynar.com/v2/farcaster/cast', {
		method: 'POST',
		headers: {
			api_key: neynar_key,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	const data = await resp.json();
	if (!resp.ok) {
		throw new Error(data?.message || data?.error || 'Farcaster post failed');
	}

	const hash = data?.cast?.hash;
	return {
		id: hash,
		platform: 'farcaster',
		url: `https://warpcast.com/~/conversations/${hash}`,
		published_at: new Date().toISOString(),
		raw: data,
	};
}

// ─── Reddit ───────────────────────────────────────────────────────────────

/**
 * Post to Reddit via OAuth 2.0.
 *
 * credentials: { access_token, user_agent? }
 * options: { subreddit, title, kind?: 'self'|'link', url? }
 */
export async function postToReddit(content, credentials, options = {}) {
	const { access_token, user_agent = 'AgentSocial/1.0 (three.ws)' } = credentials;
	const { subreddit, title, kind = 'self', url: linkUrl } = options;

	if (!access_token) throw new Error('Reddit credentials require access_token');
	if (!subreddit) throw new Error('Reddit post requires settings.subreddit');
	if (!title) throw new Error('Reddit post requires settings.title');

	const params = new URLSearchParams({
		api_type: 'json',
		kind,
		sr: subreddit,
		title,
		...(kind === 'self' ? { text: content } : { url: linkUrl || content }),
	});

	const resp = await fetch('https://oauth.reddit.com/api/submit', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${access_token}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': user_agent,
		},
		body: params,
	});

	const data = await resp.json();
	if (data?.json?.errors?.length) {
		throw new Error(data.json.errors[0]?.[1] || 'Reddit post failed');
	}

	const postId = data?.json?.data?.id;
	const postUrl = data?.json?.data?.url;
	return {
		id: postId,
		platform: 'reddit',
		url: postUrl || `https://reddit.com/r/${subreddit}`,
		published_at: new Date().toISOString(),
		raw: data,
	};
}

// ─── Credential encryption (for scheduled posts) ──────────────────────────

function getEncryptKey() {
	const src = process.env.SOCIAL_ENCRYPT_KEY || process.env.JWT_SECRET || 'fallback-dev-key-32bytes!!!!!!!!';
	return Buffer.from(src.slice(0, 32).padEnd(32, '0'), 'utf8');
}

export function encryptCredentials(obj) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', getEncryptKey(), iv);
	const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}

export function decryptCredentials(token) {
	const parts = token.split('.');
	if (parts.length !== 3) throw new Error('invalid credential token');
	const [ivHex, tagHex, encHex] = parts;
	const decipher = createDecipheriv('aes-256-gcm', getEncryptKey(), Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
	return JSON.parse(dec.toString('utf8'));
}

// ─── Dispatcher ───────────────────────────────────────────────────────────

/**
 * Unified post dispatcher.
 *
 * @param {string} platform  'x' | 'farcaster' | 'reddit'
 * @param {string} content   Post text
 * @param {object} credentials  Platform-specific credentials
 * @param {object} options   Platform-specific options (media_urls, settings, reply_to, etc.)
 */
export async function dispatchPost(platform, content, credentials, options = {}) {
	switch (platform) {
		case 'x':
		case 'twitter': {
			const mediaIds = [];
			// Upload media if URLs provided — fetch bytes then upload
			for (const url of options.media_urls || []) {
				try {
					const resp = await fetch(url);
					const buf = Buffer.from(await resp.arrayBuffer());
					const ct = resp.headers.get('content-type') || 'image/jpeg';
					const id = await uploadMediaToX(buf, ct, credentials);
					mediaIds.push(id);
				} catch {
					// Media upload failure doesn't block text post
				}
			}
			return postToX(content, credentials, {
				reply_to_tweet_id: options.reply_to,
				media_ids: mediaIds.length ? mediaIds : undefined,
			});
		}

		case 'farcaster':
		case 'warpcast':
			return postToFarcaster(content, credentials, {
				embed_urls: options.media_urls,
				parent_url: options.settings?.parent_url,
				channel_id: options.settings?.channel_id,
				reply_to_hash: options.reply_to,
			});

		case 'reddit':
			return postToReddit(content, credentials, {
				subreddit: options.settings?.subreddit,
				title: options.settings?.title,
				kind: options.settings?.kind,
				url: options.settings?.url,
			});

		default:
			throw new Error(`unsupported platform: ${platform}`);
	}
}
