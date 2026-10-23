// Oracle: turn tracked X timelines into the batch /api/oracle/social ingests.
//
// Pure helpers plus one orchestrator (collectSocialBatch) whose reader is
// injected, so the cron and the tests share the same code path.

import { fetchGuestTimeline } from '../x-guest/index.js';

const DAY_MS = 86_400_000;
const CASHTAG_RE = /\$[A-Za-z]{2,10}\b/;
export const MAX_TWEETS_PER_BATCH = 500;
export const MAX_HANDLES_PER_RUN = 25;

/** XActions tweet shape the social endpoint documents. */
export function toSocialTweet(tweet, handle) {
	return {
		id: tweet.id,
		text: tweet.text,
		createdAt: tweet.createdAt,
		url: tweet.url || `https://x.com/${handle}/status/${tweet.id}`,
		author: { username: tweet.author?.username || handle },
		metrics: {
			views: Number(tweet.metrics?.views) || 0,
			likes: Number(tweet.metrics?.likes) || 0,
			retweets: Number(tweet.metrics?.retweets) || 0,
		},
	};
}

/** Tweets worth sending: a cashtag in the text and posted within `maxAgeMs`. */
export function relevantTweets(tweets, handle, { now = Date.now(), maxAgeMs = DAY_MS } = {}) {
	const out = [];
	for (const t of tweets) {
		if (!t?.id || !t.text || !CASHTAG_RE.test(t.text)) continue;
		const at = Date.parse(t.createdAt);
		if (!Number.isFinite(at) || now - at > maxAgeMs) continue;
		out.push(toSocialTweet(t, handle));
	}
	return out;
}

/** Lower-cased unique handles, in first-seen order, capped. */
export function uniqueHandles(lists, cap = MAX_HANDLES_PER_RUN) {
	const seen = new Set();
	for (const list of lists) {
		for (const raw of list) {
			const h = String(raw || '').replace(/^@/, '').toLowerCase();
			if (/^[a-z0-9_]{1,15}$/.test(h)) seen.add(h);
			if (seen.size >= cap) return [...seen];
		}
	}
	return [...seen];
}

/**
 * Read each handle's timeline and collect the cashtag tweets.
 * Stops reading once the reader reports a rate limit; the remaining handles are
 * reported as skipped so the next run picks them up.
 */
export async function collectSocialBatch(handles, { reader = fetchGuestTimeline, now = Date.now } = {}) {
	const tweets = [];
	const failures = {};
	const skipped = [];
	let read = 0;
	for (let i = 0; i < handles.length; i++) {
		const handle = handles[i];
		try {
			const { tweets: timeline } = await reader(handle, { limit: 20 });
			read++;
			tweets.push(...relevantTweets(timeline, handle, { now: now() }));
		} catch (err) {
			failures[handle] = `${err?.reason || 'error'}: ${String(err?.message || err).slice(0, 120)}`;
			if (err?.reason === 'rate_limited') {
				skipped.push(...handles.slice(i + 1));
				break;
			}
		}
	}
	return { tweets: tweets.slice(0, MAX_TWEETS_PER_BATCH), read, failures, skipped };
}
