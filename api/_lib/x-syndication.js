// X (Twitter) post reader for the price-impact tools: text, author, engagement
// metrics, media summary and timestamps for one public post.
//
// Reads go through the official X API v2 client (api/_lib/x-api.js) with this
// deployment's own credentials. There is no keyless or scraped fallback: when
// X_BEARER_TOKEN is unset the reader throws a 503 XPostError saying so, and the
// callers surface that message instead of a guess.

import { fetchXPostById, XApiUnavailable } from './x-api.js';

const TWEET_URL_RE =
	/^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/(\w+)\/status(?:es)?\/(\d+)/i;

const TWITTER_EPOCH_MS = 1288834974657;

/**
 * Reader failure carrying the HTTP status an API surface should answer with.
 * 400 = bad input, 404 = post unavailable, 502 = X unreachable,
 * 503 = X API credentials not configured.
 */
export class XPostError extends Error {
	constructor(message, status = 502, details = []) {
		super(message);
		this.name = 'XPostError';
		this.status = status;
		this.details = details;
	}
}

export class PostUnavailableError extends XPostError {
	constructor(message = 'Post unavailable: it was deleted, is private, or does not exist.', details = []) {
		super(message, 404, details);
		this.name = 'PostUnavailableError';
	}
}

/** @returns {{ handle: string, id: string } | null} */
export function parsePostUrl(url) {
	if (typeof url !== 'string') return null;
	const m = url.trim().match(TWEET_URL_RE);
	return m ? { handle: m[1], id: m[2] } : null;
}

export function snowflakeToMs(id) {
	try {
		return Number(BigInt(id) >> 22n) + TWITTER_EPOCH_MS;
	} catch {
		return null;
	}
}

/**
 * Read one public X post.
 *
 * @param {string} postUrl x.com / twitter.com status URL
 * @param {{ fetchImpl?: typeof fetch, env?: object }} [opts]
 * @returns {Promise<{ id, url, ts, createdAt, author, text, metrics, media, source }>}
 * @throws {XPostError} 400 bad URL, 404 PostUnavailableError, 502 X unreachable, 503 not configured
 */
export async function readXPost(postUrl, { fetchImpl = fetch, env = process.env } = {}) {
	const parsed = parsePostUrl(postUrl);
	if (!parsed) {
		throw new XPostError('Invalid URL. Expected a post link like https://x.com/user/status/123.', 400);
	}
	const { id, handle } = parsed;
	let post;
	try {
		post = await fetchXPostById(id, { env, fetchImpl });
	} catch (err) {
		if (!(err instanceof XApiUnavailable)) throw err;
		if (err.reason === 'not_found') throw new PostUnavailableError(undefined, [err.message]);
		if (err.reason === 'not_configured') {
			throw new XPostError('Reading X posts is unavailable: this deployment has no X API credentials configured.', 503, [err.message]);
		}
		throw new XPostError(
			'Could not reach X to read this post. It may be rate-limited right now, so try again in a minute.',
			502,
			[`${err.reason}: ${err.message}`],
		);
	}
	const ts = post.createdAt ? Date.parse(post.createdAt) : snowflakeToMs(id);
	return {
		id,
		url: `https://x.com/${post.author.handle || handle}/status/${id}`,
		ts: Number.isFinite(ts) ? ts : null,
		createdAt: post.createdAt,
		author: { ...post.author, handle: post.author.handle || handle },
		text: post.text,
		metrics: post.metrics,
		media: post.media,
		source: 'x-api',
	};
}

/**
 * Compact post shape for impact analysis: the fields the price-correlation
 * tools report, with engagement metrics and a media summary.
 */
export function summarizeXPost(post) {
	return {
		id: post.id,
		ts: post.ts,
		author: post.author.name,
		handle: post.author.handle,
		text: post.text,
		metrics: post.metrics,
		media: post.media.map((m) => ({
			type: m.type,
			thumbnail: m.thumbnail,
			durationMs: m.durationMs,
		})),
		source: post.source,
	};
}
