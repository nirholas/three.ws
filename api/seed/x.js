// GET /api/seed/x?handle=<user>
//
// Public X (formerly Twitter) footprint connector for the three.ws
// memory-seeding demo. Uses twitter-api-v2 in app-only (bearer) mode so
// we can look up any public profile without OAuth on the visitor side.
//
// When TWITTER_BEARER_TOKEN is not configured (typical in local dev) we
// return { ok: false, reason } with a 200 status so the demo UI can
// render a graceful "connector not configured" state instead of erroring.

import { TwitterApi } from 'twitter-api-v2';
import { cors, json, method, wrap, error } from '../_lib/http.js';

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

// Compact English stopword list — pure JS so we don't pull in an NLP dep.
const STOPWORDS = new Set([
	'the','a','an','and','or','but','if','then','else','of','to','in','on','for',
	'with','at','by','from','up','down','is','am','are','was','were','be','been',
	'being','have','has','had','having','do','does','did','doing','this','that',
	'these','those','i','you','he','she','it','we','they','my','your','his','her',
	'its','our','their','me','him','us','them','myself','yourself','as','about',
	'into','like','through','after','before','between','out','off','over','under',
	'just','only','own','same','so','than','too','very','can','will','would','should',
	'could','may','might','must','here','there','when','where','why','how','all','any',
	'both','each','few','more','most','other','some','such','no','not','nor','one','two',
	'rt','via','amp','http','https','com','www','also','still','really','get','got','go',
	'going','went','let','lets','make','made','use','using','used','new','old','today',
	'tomorrow','yesterday','now','day','days','time','week','year','years','people','thing',
	'things','way','ways','good','great','best','better','well','vs','etc','ok','okay',
]);

function extractTopTopics(tweets, limit = 8) {
	const counts = new Map();
	for (const text of tweets) {
		if (!text) continue;
		const tokens = text
			.toLowerCase()
			.replace(/https?:\/\/\S+/g, '')
			.replace(/[@#]?[\w-]+/g, (m) => (m.startsWith('#') || m.startsWith('@') ? m : m))
			.replace(/[^a-z0-9#@_\s-]/g, ' ')
			.split(/\s+/)
			.filter(Boolean);
		for (const tok of tokens) {
			if (tok.length < 3 || tok.length > 30) continue;
			if (STOPWORDS.has(tok)) continue;
			if (/^\d+$/.test(tok)) continue;
			counts.set(tok, (counts.get(tok) || 0) + 1);
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([tok, n]) => ({ topic: tok, count: n }));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	let handle = (url.searchParams.get('handle') || '').trim().replace(/^@/, '');
	if (!handle) return error(res, 400, 'invalid_request', 'handle query param required');
	if (!HANDLE_RE.test(handle))
		return error(res, 400, 'invalid_handle', 'X handle has invalid characters');

	const bearer = process.env.TWITTER_BEARER_TOKEN;
	if (!bearer) {
		res.setHeader('cache-control', 'no-store');
		return json(res, 200, {
			ok: false,
			reason: 'X connector not configured',
			detail: 'Set TWITTER_BEARER_TOKEN in the environment to enable this connector.',
		});
	}

	const client = new TwitterApi(bearer).readOnly;

	let userData;
	try {
		userData = await client.v2.userByUsername(handle, {
			'user.fields': ['description', 'profile_image_url', 'public_metrics', 'location', 'created_at', 'verified'],
		});
	} catch (err) {
		// Rate-limited or upstream issue. Surface gracefully so the demo can show the X card greyed out.
		const status = err?.code || err?.data?.status || 502;
		const msg = err?.data?.detail || err?.data?.title || err.message || 'X profile fetch failed';
		if (status === 404 || /not.?found/i.test(msg))
			return error(res, 404, 'not_found', `no X user named "@${handle}"`);
		res.setHeader('cache-control', 'no-store');
		return json(res, 200, { ok: false, reason: 'X upstream error', detail: msg });
	}

	const user = userData?.data;
	if (!user) return error(res, 404, 'not_found', `no X user named "@${handle}"`);

	let tweets = [];
	try {
		const tl = await client.v2.userTimeline(user.id, {
			max_results: 20,
			exclude: ['retweets', 'replies'],
			'tweet.fields': ['text', 'public_metrics', 'created_at'],
		});
		tweets = (tl?.data?.data || []).map((t) => ({
			text: t.text,
			created_at: t.created_at,
			likes: t.public_metrics?.like_count ?? 0,
			retweets: t.public_metrics?.retweet_count ?? 0,
			replies: t.public_metrics?.reply_count ?? 0,
		}));
	} catch (err) {
		// Timeline rate limits are aggressive on free tier; keep the user payload.
		console.warn('[seed/x] timeline fetch failed', err.message || err);
	}

	const topTopics = extractTopTopics(tweets.map((t) => t.text));

	res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600');
	return json(res, 200, {
		ok: true,
		handle: user.username,
		name: user.name || null,
		avatar_url: user.profile_image_url || null,
		bio: user.description || '',
		location: user.location || null,
		verified: !!user.verified,
		follower_count: user.public_metrics?.followers_count ?? 0,
		following_count: user.public_metrics?.following_count ?? 0,
		tweet_count: user.public_metrics?.tweet_count ?? 0,
		created_at: user.created_at || null,
		recent_tweets: tweets,
		top_topics: topTopics,
	});
});
