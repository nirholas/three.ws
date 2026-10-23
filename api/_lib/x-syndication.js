// Keyless X (Twitter) post reader: text, author, engagement metrics, media variants, timestamps.
//
// One reader for every three.ws feature that needs to look at a public post
// without an X API key. It tries three rungs in order and returns the first
// that answers:
//
//   1. X's public syndication endpoint (cdn.syndication.twimg.com), the one the
//      official embed widget uses. No auth, widest mp4 quality ladder.
//   2. fxtwitter (api.fxtwitter.com), an independent third party that stays up
//      when syndication rate-limits. Adds reposts, views and bookmarks.
//   3. Guest-token GraphQL (api.x.com), richest metadata. Needs a bearer token,
//      so it only runs when X_BEARER_TOKEN is set (or one is passed in).
//
// A rung that cannot answer (HTTP error, rate limit, malformed body, tombstone)
// falls through to the next. Only when every rung reports the post gone does the
// caller get PostUnavailableError; when none could be reached it gets a 502.
//
// Video extraction approach adapted from nirholas/download-x-twitter-videos
// (Apache-2.0, src/edgeExtractor.js).

const TWEET_URL_RE =
	/^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/(\w+)\/status(?:es)?\/(\d+)/i;

const BROWSER_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
	Accept: 'application/json',
	'Accept-Language': 'en-US,en;q=0.9',
};

const RUNG_TIMEOUT_MS = 8_000;
const TWITTER_EPOCH_MS = 1288834974657;
const GRAPHQL_TWEET_RESULT =
	'https://api.x.com/graphql/GZsN2Pc4knAoit6pXa4HSA/TweetResultByRestId';

/** Hosts the download proxy may stream from. */
export const ALLOWED_MEDIA_HOSTS = ['video.twimg.com', 'pbs.twimg.com'];

/**
 * Reader failure carrying the HTTP status an API surface should answer with.
 * 400 = bad input, 404 = post unavailable, 502 = every rung failed upstream.
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

export function qualityLabel(width, height) {
	const maxDim = Math.max(width || 0, height || 0);
	if (maxDim >= 3840) return '4K';
	if (maxDim >= 2560) return '1440p';
	if (maxDim >= 1920) return '1080p';
	if (maxDim >= 1280) return '720p';
	if (maxDim >= 640) return '480p';
	if (maxDim >= 480) return '360p';
	if (maxDim > 0) return `${maxDim}p`;
	return 'unknown';
}

/** X derives the syndication token from the post id with this exact expression. */
export function syndicationToken(id) {
	return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function isMp4Url(url) {
	try {
		return new URL(url).pathname.toLowerCase().endsWith('.mp4');
	} catch {
		return false;
	}
}

function toVariant(url, { width, height, bitrate } = {}) {
	const derived = url.match(/\/(\d+)x(\d+)\//);
	const w = width || (derived ? parseInt(derived[1], 10) : 0);
	const h = height || (derived ? parseInt(derived[2], 10) : 0);
	return { url, quality: qualityLabel(w, h), width: w, height: h, bitrate: bitrate || 0, contentType: 'video/mp4' };
}

/** Drop duplicate variants (ignoring query strings), best quality first. */
function rankVariants(variants) {
	const seen = new Set();
	const unique = [];
	for (const v of variants) {
		const base = v.url.split('?')[0];
		if (seen.has(base)) continue;
		seen.add(base);
		unique.push(v);
	}
	unique.sort((a, b) => b.width * b.height - a.width * a.height || b.bitrate - a.bitrate);
	return unique;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);

async function fetchJson(url, { headers = {}, method = 'GET', label, fetchImpl = fetch } = {}) {
	const res = await fetchImpl(url, {
		method,
		headers: { ...BROWSER_HEADERS, ...headers },
		signal: AbortSignal.timeout(RUNG_TIMEOUT_MS),
	});
	if (!res.ok) {
		const err = new Error(`${label} responded HTTP ${res.status}`);
		err.upstreamStatus = res.status;
		throw err;
	}
	const body = await res.text();
	if (!body) throw new Error(`${label} returned an empty body`);
	try {
		return JSON.parse(body);
	} catch {
		throw new Error(`${label} returned a non-JSON body`);
	}
}

/** Trim the trailing media t.co link X appends, using the post's own display range. */
function displayText(text, range) {
	if (typeof text !== 'string') return null;
	if (Array.isArray(range) && range.length === 2) {
		const chars = Array.from(text);
		return chars.slice(range[0], range[1]).join('').trim() || text.trim();
	}
	return text.trim();
}

function finish(partial, id, handle, source) {
	const createdMs = partial.createdAt ? Date.parse(partial.createdAt) : NaN;
	const ts = Number.isFinite(createdMs) ? createdMs : snowflakeToMs(id);
	const media = partial.media || [];
	return {
		id,
		url: `https://x.com/${partial.author?.handle || handle}/status/${id}`,
		ts,
		createdAt: ts ? new Date(ts).toISOString() : null,
		author: {
			name: partial.author?.name || handle,
			handle: partial.author?.handle || handle,
			avatar: partial.author?.avatar || null,
			verified: Boolean(partial.author?.verified),
		},
		text: partial.text ?? null,
		metrics: {
			likes: num(partial.metrics?.likes),
			replies: num(partial.metrics?.replies),
			reposts: num(partial.metrics?.reposts),
			quotes: num(partial.metrics?.quotes),
			views: num(partial.metrics?.views),
			bookmarks: num(partial.metrics?.bookmarks),
		},
		media: media.map((m) => ({ ...m, variants: rankVariants(m.variants || []) })),
		source,
	};
}

// Rung 1: syndication

async function readViaSyndication(id, handle, { fetchImpl }) {
	let data;
	try {
		data = await fetchJson(
			`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=en`,
			{ headers: { Referer: 'https://platform.twitter.com/' }, label: 'syndication', fetchImpl },
		);
	} catch (err) {
		if (err.upstreamStatus === 404) throw new PostUnavailableError();
		throw err;
	}
	if (data.__typename === 'TweetTombstone' || !data.user) throw new PostUnavailableError();

	const media = [];
	for (const item of data.mediaDetails || []) {
		if (item.type === 'photo') {
			media.push({ type: 'photo', thumbnail: item.media_url_https || null, durationMs: null, variants: [] });
		} else if (item.type === 'video' || item.type === 'animated_gif') {
			const variants = (item.video_info?.variants || [])
				.filter((v) => v.content_type === 'video/mp4' && isMp4Url(v.url))
				.map((v) => toVariant(v.url, { bitrate: v.bitrate }));
			media.push({
				type: item.type === 'animated_gif' ? 'gif' : 'video',
				thumbnail: item.media_url_https || null,
				durationMs: item.video_info?.duration_millis ?? null,
				variants,
			});
		}
	}
	return finish(
		{
			createdAt: data.created_at,
			text: displayText(data.text, data.display_text_range),
			author: {
				name: data.user.name,
				handle: data.user.screen_name,
				avatar: data.user.profile_image_url_https,
				verified: data.user.is_blue_verified || data.user.verified,
			},
			metrics: { likes: data.favorite_count, replies: data.conversation_count },
			media,
		},
		id,
		handle,
		'syndication',
	);
}

// Rung 2: fxtwitter

async function readViaFxTwitter(id, handle, { fetchImpl }) {
	let data;
	try {
		data = await fetchJson(`https://api.fxtwitter.com/${handle}/status/${id}`, {
			headers: { 'User-Agent': 'three.ws/1.0 (+https://three.ws)' },
			label: 'fxtwitter',
			fetchImpl,
		});
	} catch (err) {
		if (err.upstreamStatus === 404) throw new PostUnavailableError();
		throw err;
	}
	const t = data?.tweet;
	if (!t) throw new PostUnavailableError();

	const media = [];
	for (const item of t.media?.all || []) {
		if (item.type === 'photo') {
			media.push({ type: 'photo', thumbnail: item.url || null, durationMs: null, variants: [] });
		} else if (item.type === 'video' || item.type === 'gif') {
			const variants = [...(item.formats || item.variants || []), item]
				.filter((v) => v?.url && isMp4Url(v.url))
				.map((v) => toVariant(v.url, { width: v.width, height: v.height, bitrate: v.bitrate }));
			media.push({
				type: item.type,
				thumbnail: item.thumbnail_url || null,
				durationMs: item.duration ? Math.round(item.duration * 1000) : null,
				variants,
			});
		}
	}
	return finish(
		{
			createdAt: t.created_at ? new Date(t.created_at).toISOString() : t.created_timestamp ? new Date(t.created_timestamp * 1000).toISOString() : null,
			text: t.text?.trim() ?? null,
			author: {
				name: t.author?.name,
				handle: t.author?.screen_name,
				avatar: t.author?.avatar_url,
				verified: false,
			},
			metrics: {
				likes: t.likes,
				replies: t.replies,
				reposts: t.retweets,
				quotes: t.quotes,
				views: t.views,
				bookmarks: t.bookmarks,
			},
			media,
		},
		id,
		handle,
		'fxtwitter',
	);
}

// Rung 3: guest-token GraphQL

const GRAPHQL_FEATURES = {
	creator_subscriptions_tweet_preview_api_enabled: true,
	premium_content_api_read_enabled: false,
	communities_web_enable_tweet_community_results_fetch: true,
	c9s_tweet_anatomy_moderator_badge_enabled: true,
	responsive_web_jetfuel_frame: false,
	articles_preview_enabled: true,
	responsive_web_edit_tweet_api_enabled: true,
	graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
	view_counts_everywhere_api_enabled: true,
	longform_notetweets_consumption_enabled: true,
	responsive_web_twitter_article_tweet_consumption_enabled: true,
	freedom_of_speech_not_reach_fetch_enabled: true,
	standardized_nudges_misinfo: true,
	tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
	longform_notetweets_rich_text_read_enabled: true,
	longform_notetweets_inline_media_enabled: true,
	rweb_tipjar_consumption_enabled: true,
	responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
	responsive_web_graphql_timeline_navigation_enabled: true,
	responsive_web_enhance_cards_enabled: false,
};

let guest = { token: null, bearer: null, expiresAt: 0 };

async function guestToken(bearer, fetchImpl) {
	if (guest.token && guest.bearer === bearer && guest.expiresAt > Date.now()) return guest.token;
	const data = await fetchJson('https://api.x.com/1.1/guest/activate.json', {
		method: 'POST',
		headers: { Authorization: `Bearer ${bearer}`, Referer: 'https://x.com/', Origin: 'https://x.com' },
		label: 'guest activation',
		fetchImpl,
	});
	if (!data.guest_token) throw new Error('guest activation returned no guest_token');
	guest = { token: data.guest_token, bearer, expiresAt: Date.now() + 2 * 3600_000 };
	return guest.token;
}

async function readViaGraphQL(id, handle, { fetchImpl, bearerToken }) {
	if (!bearerToken) throw new Error('graphql rung needs X_BEARER_TOKEN');
	const token = await guestToken(bearerToken, fetchImpl);
	const variables = JSON.stringify({ tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false });
	const url =
		`${GRAPHQL_TWEET_RESULT}?variables=${encodeURIComponent(variables)}` +
		`&features=${encodeURIComponent(JSON.stringify(GRAPHQL_FEATURES))}` +
		`&fieldToggles=${encodeURIComponent(JSON.stringify({ withArticleRichContentState: true }))}`;
	const data = await fetchJson(url, {
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			Referer: 'https://x.com/',
			Origin: 'https://x.com',
			'x-guest-token': token,
			'x-twitter-active-user': 'yes',
		},
		label: 'graphql',
		fetchImpl,
	});
	const result = data?.data?.tweetResult?.result;
	if (!result || result.__typename === 'TweetTombstone') throw new PostUnavailableError();

	const tweet = result.tweet || result;
	const legacy = tweet.legacy || {};
	const user = tweet.core?.user_results?.result || {};
	const ul = user.legacy || {};
	const uc = user.core || {};

	const media = [];
	for (const item of legacy.extended_entities?.media || legacy.entities?.media || []) {
		if (item.type === 'photo') {
			media.push({ type: 'photo', thumbnail: item.media_url_https || null, durationMs: null, variants: [] });
		} else if (item.type === 'video' || item.type === 'animated_gif') {
			const variants = (item.video_info?.variants || [])
				.filter((v) => v.content_type === 'video/mp4' && isMp4Url(v.url))
				.map((v) => toVariant(v.url, { bitrate: v.bitrate }));
			media.push({
				type: item.type === 'animated_gif' ? 'gif' : 'video',
				thumbnail: item.media_url_https || null,
				durationMs: item.video_info?.duration_millis ?? null,
				variants,
			});
		}
	}
	return finish(
		{
			createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
			text: displayText(tweet.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text, tweet.note_tweet ? null : legacy.display_text_range),
			author: {
				name: uc.name || ul.name,
				handle: uc.screen_name || ul.screen_name,
				avatar: user.avatar?.image_url || ul.profile_image_url_https,
				verified: user.is_blue_verified,
			},
			metrics: {
				likes: legacy.favorite_count,
				replies: legacy.reply_count,
				reposts: legacy.retweet_count,
				quotes: legacy.quote_count,
				views: tweet.views?.count,
				bookmarks: legacy.bookmark_count,
			},
			media,
		},
		id,
		handle,
		'graphql',
	);
}

/**
 * Read one public X post.
 *
 * @param {string} postUrl x.com / twitter.com status URL
 * @param {{ fetchImpl?: typeof fetch, bearerToken?: string }} [opts]
 * @returns {Promise<{ id, url, ts, createdAt, author, text, metrics, media, source }>}
 * @throws {XPostError} 400 bad URL, 404 PostUnavailableError, 502 every rung unreachable
 */
export async function readXPost(postUrl, { fetchImpl = fetch, bearerToken = process.env?.X_BEARER_TOKEN } = {}) {
	const parsed = parsePostUrl(postUrl);
	if (!parsed) {
		throw new XPostError('Invalid URL. Expected a post link like https://x.com/user/status/123.', 400);
	}
	const { id, handle } = parsed;
	const ctx = { fetchImpl, bearerToken };
	const rungs = [
		['syndication', readViaSyndication],
		['fxtwitter', readViaFxTwitter],
	];
	if (bearerToken) rungs.push(['graphql', readViaGraphQL]);

	const failures = [];
	let gone = 0;
	for (const [name, run] of rungs) {
		try {
			return await run(id, handle, ctx);
		} catch (err) {
			if (err instanceof PostUnavailableError) gone += 1;
			failures.push(`${name}: ${err.message}`);
		}
	}
	if (gone > 0) throw new PostUnavailableError(undefined, failures);
	throw new XPostError(
		'Could not reach X to read this post. It may be rate-limited right now, so try again in a minute.',
		502,
		failures,
	);
}

/** Flat, best-first mp4 list across every video in a post. */
export function postVideoVariants(post) {
	return rankVariants((post?.media || []).flatMap((m) => m.variants || []));
}

/**
 * Validate a media URL before proxying it so the download endpoint can never
 * act as an open proxy.
 * @throws {XPostError} 400
 */
export function assertMediaUrl(rawUrl) {
	let parsed;
	try {
		parsed = new URL(String(rawUrl));
	} catch {
		throw new XPostError('Invalid URL format.', 400);
	}
	if (parsed.protocol !== 'https:') throw new XPostError('Only HTTPS URLs are allowed.', 400);
	if (parsed.username || parsed.password || parsed.port) throw new XPostError('Invalid media URL.', 400);
	if (!ALLOWED_MEDIA_HOSTS.includes(parsed.hostname)) {
		throw new XPostError('Invalid media URL. Must be an X video or image CDN URL.', 400);
	}
	return parsed;
}

export function downloadFilename(handle, id, ext = 'mp4') {
	const h = String(handle || 'video').replace(/[^\w-]/g, '_').slice(0, 50);
	const i = String(id || 'post').replace(/[^\w-]/g, '_').slice(0, 30);
	const e = String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4';
	return `${h}_${i}.${e}`;
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
			bestVariantUrl: m.variants[0]?.url ?? null,
		})),
		source: post.source,
	};
}
