// What actually happened to the posts @trythreews sent, read back through the X
// API, and what that says about the next one. This closes the loop the queue was
// missing: priority.js used to rank on a scraped archive that had lost the like
// counts of the account's biggest posts, so it believed a video does worse than
// a still when the live numbers say the opposite.
//
// Three steps, each usable on its own:
//
//   collectOutcomes  pages the account's own timeline and keeps one compact row
//                    per head post: its public metrics and the attributes a
//                    draft can be checked for before it is sent
//   learnLifts       for every attribute value, how much better or worse posts
//                    with it did than posts without it, weighted toward recent
//                    posts and shrunk toward no effect on small samples
//   learnedScore     describes a queued item in the same vocabulary and turns
//                    the lifts that apply to it into ranking points
//
// Rows hold numbers and attributes only, never the copy, so the stored record
// stays small enough to load on every tick.
//
// Everything is pure except the store and collectOutcomes.

import { urlsIn, weightedLength } from './quality.js';

export const OUTCOMES_KEY = 'x_content_outcomes';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

// How far back the timeline is read, and the most posts one refresh will page
// through (replies included, because they are how a thread is recognised).
export const OUTCOMES_WINDOW_DAYS = 90;
export const OUTCOMES_LIMIT = 800;
// A stored record older than this is read again on the next publishing tick.
export const OUTCOMES_REFRESH_HOURS = 6;
// X bills every post a read returns, so a refresh only reads back as far as
// metrics can still be moving. A post's likes and bookmarks settle within a few
// days, so anything older than this is kept from the stored record instead of
// being read, and paid for, again. The first read, or one after a long gap,
// still reads the whole window.
export const OUTCOMES_SETTLE_DAYS = 7;
// X answers 503 on a timeline page often enough that one failed page should not
// cost the whole read. The wait grows with each try.
export const READ_ATTEMPTS = 3;
export const READ_RETRY_MS = 2000;
// Likes keep arriving for about two days; a younger post would be measured low.
export const MIN_AGE_HOURS = 48;
// A post this old counts half as much as one sent today, so the lifts follow
// the audience the account has now.
export const HALF_LIFE_DAYS = 45;
// Prior strength for shrinkage: a value seen on n posts keeps n / (n + K) of
// its measured difference.
export const SHRINK_K = 8;
// Below this many posts a value is reported but moves no score.
export const MIN_VALUE_COUNT = 3;
// The ranking ignores the learned lifts until this many posts have matured.
export const LEARNED_MIN_SAMPLE = 20;
export const CALIBRATION_TEXT_CHARS = 400;
export const LEARNED_POINTS_PER_UNIT = 10;
export const LEARNED_POINTS_LIMIT = 15;

// Weighted length (quality.js) at which a post leaves each bucket. `long` is a
// post over the standard limit, which X only allows on a Premium account.
export const LENGTH_BANDS = [
	{ key: 'short', below: 100 },
	{ key: 'band', below: 180 },
	{ key: 'standard', below: 281 },
	{ key: 'long', below: Infinity },
];

export const TIMELINE_FIELDS = {
	'tweet.fields': ['public_metrics', 'created_at', 'referenced_tweets', 'attachments', 'entities', 'note_tweet', 'conversation_id', 'in_reply_to_user_id', 'article'],
	expansions: ['attachments.media_keys'],
	'media.fields': ['type'],
};

const emptyOutcomes = () => ({ fetchedAt: null, posts: [] });

export function outcomesStore() {
	const db = () => import('../db.js').then((module) => module.sql);
	return {
		label: 'database',
		async load() {
			const sql = await db();
			const [row] = await sql`SELECT value FROM app_settings WHERE key = ${OUTCOMES_KEY}`;
			return { ...emptyOutcomes(), ...(row?.value || {}) };
		},
		async save(outcomes) {
			const sql = await db();
			await sql`
				INSERT INTO app_settings (key, value) VALUES (${OUTCOMES_KEY}, ${JSON.stringify(outcomes)}::jsonb)
				ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
			`;
		},
	};
}

// For a machine without DATABASE_URL: starts empty, keeps nothing past the run.
export function memoryOutcomesStore(initial = emptyOutcomes()) {
	let outcomes = structuredClone(initial);
	return {
		label: 'memory (no DATABASE_URL, so nothing learned is kept)',
		async load() {
			return structuredClone(outcomes);
		},
		async save(next) {
			outcomes = structuredClone(next);
		},
	};
}

// ── Describing a post ───────────────────────────────────────────────────────

const X_HOSTS = /(^|\.)(x\.com|twitter\.com|t\.co)$/i;

function hostOf(url) {
	try {
		return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
	} catch {
		return '';
	}
}

// X appends its own link for attached media and for a quoted post. Neither is a
// link the author wrote, and neither takes the reader anywhere off the post.
const isOwnLink = (url) => X_HOSTS.test(hostOf(url));

const lengthBand = (length) => LENGTH_BANDS.find((band) => length < band.below).key;

const mentionsIn = (text) => (String(text).match(/(?<![\w@])@\w{1,15}/g) || []).length;

const hasCashtag = (text) => /\$THREE\b/i.test(String(text));

const MEDIA_RANK = ['video', 'gif', 'photo'];
const API_MEDIA_KIND = { video: 'video', animated_gif: 'gif', photo: 'photo' };

// One kind per post: X allows a video or a GIF alone, so the moving kind wins
// the rare time a row carries both.
const mediaKind = (kinds) => MEDIA_RANK.find((kind) => kinds.includes(kind)) || 'none';

function pathMediaKind(path) {
	if (/\.(mp4|mov)$/i.test(path || '')) return 'video';
	if (/\.gif$/i.test(path || '')) return 'gif';
	if (/\.(png|jpe?g|webp)$/i.test(path || '')) return 'photo';
	return null;
}

// The API escapes these three in post text; the reader never sees them.
const unescapeText = (text) => String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// A head post starts its own conversation: not a reply, and not a repost.
//
// The reference list alone is not proof. On 2026-09-29 X answered a timeline
// read with ten replies in a row whose `referenced_tweets` were missing (it
// returned 503 a minute later), and all ten were learned from as if they were
// short, bare head posts. A head is therefore also required to carry its own id
// as its conversation, so a post X did not fully describe is left out.
export function isHeadPost(tweet) {
	if ((tweet.referenced_tweets || []).some((ref) => ref.type === 'replied_to' || ref.type === 'retweeted')) return false;
	if (tweet.in_reply_to_user_id) return false;
	return String(tweet.conversation_id || '') === String(tweet.id);
}

// The lead post id of a ledger row, read from the URL the publisher recorded
// (for an Article that is the Article's own post, which `postIds` does not hold).
export function leadPostId(row) {
	return String(row?.url || '').match(/\/status\/(\d+)/)?.[1] || row?.postIds?.[0] || null;
}

export function describePost(tweet, { mediaByKey = new Map(), threadSizes = new Map(), pipelineById = new Map() } = {}) {
	const metrics = tweet.public_metrics || {};
	// A post over 280 characters arrives truncated in `text`, whole in `note_tweet`.
	// An Article's own post arrives as nothing but X's link to the Article, while
	// the feed shows its title over its cover, so that is what gets described.
	const raw = tweet.article?.title || tweet.note_tweet?.text || tweet.text || '';
	const links = [...(tweet.entities?.urls || []), ...(tweet.note_tweet?.entities?.urls || [])];
	const resolved = links.length ? links : urlsIn(raw).map((url) => ({ url, expanded_url: url }));
	const own = resolved.filter((row) => row.media_key || isOwnLink(row.expanded_url || row.url));
	const written = resolved.filter((row) => !own.includes(row));
	// X's own links are not part of what the author typed, so they are taken out
	// before the copy is measured.
	const text = unescapeText(own.reduce((copy, row) => copy.split(row.url).join(''), raw)).trim();

	const kinds = (tweet.attachments?.media_keys || []).map((key) => API_MEDIA_KIND[mediaByKey.get(key)?.type]).filter(Boolean);
	if (tweet.article?.cover_media) kinds.push('photo');
	const published = pipelineById.get(String(tweet.id));
	const row = {
		id: String(tweet.id),
		at: tweet.created_at,
		impressions: Number(metrics.impression_count || 0),
		likes: Number(metrics.like_count || 0),
		// The count X shows under a post: plain reposts plus quotes.
		reposts: Number(metrics.retweet_count || 0) + Number(metrics.quote_count || 0),
		replies: Number(metrics.reply_count || 0),
		bookmarks: Number(metrics.bookmark_count || 0),
		media: mediaKind(kinds),
		length: lengthBand(weightedLength(text)),
		link: written.length ? 'head' : 'none',
		thread: (threadSizes.get(String(tweet.conversation_id || tweet.id)) || 0) > 0,
		mentions: mentionsIn(text),
		cashtag: hasCashtag(text),
		source: published ? 'pipeline' : 'hand',
		// The opening of the post, so the editor can be calibrated against what
		// the account's best posts actually said (bestPosts).
		text: text.slice(0, CALIBRATION_TEXT_CHARS),
	};
	if (published) {
		row.lane = published.lane;
		row.pattern = published.pattern;
	}
	return row;
}

// A queued item in the same vocabulary, from what is known before it is sent.
// An Article is described as its own post, title over cover, because that post
// is the one the ledger records and the one that gets measured. The posts that
// follow an Article quote it; they do not reply to it, so it is never a thread.
export function describeItem(item) {
	const isArticle = item.kind === 'article';
	const head = item.posts?.[0] || {};
	const text = String(isArticle ? item.article?.title || '' : head.text || '').trim();
	const kinds = isArticle ? [] : (head.media || []).map((row) => pathMediaKind(row.path)).filter(Boolean);
	if (isArticle && item.article?.cover) kinds.push('photo');
	return {
		media: mediaKind(kinds),
		length: lengthBand(weightedLength(text)),
		// A link that sits in a reply is not in front of the reader of the head.
		link: urlsIn(text).some((url) => !isOwnLink(url)) ? 'head' : 'none',
		thread: !isArticle && (item.posts?.length || 0) > 1,
		mentions: mentionsIn(text),
		cashtag: hasCashtag(text),
		source: 'pipeline',
		lane: item.lane,
		pattern: item.pattern,
	};
}

// The attribute values a row carries, as the keys the lifts are stored under.
export function attributeKeys(row) {
	const keys = [
		`media:${row.media}`,
		`length:${row.length}`,
		`link:${row.link}`,
		`thread:${Boolean(row.thread)}`,
		`mentions:${row.mentions >= 2 ? '2+' : row.mentions || 0}`,
		`cashtag:${Boolean(row.cashtag)}`,
	];
	if (row.source === 'pipeline') {
		if (row.lane) keys.push(`lane:${row.lane}`);
		if (row.pattern) keys.push(`pattern:${row.pattern}`);
	}
	return keys;
}

// ── Collecting ──────────────────────────────────────────────────────────────

async function readTimeline({ client, now, days, limit }) {
	const { data: me } = await client.me();
	const timeline = await client.userTimeline(me.id, {
		max_results: 100,
		exclude: ['retweets'],
		// X documents whole seconds for this parameter.
		start_time: new Date(now - days * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z'),
		...TIMELINE_FIELDS,
	});

	const tweets = [];
	for await (const tweet of timeline) {
		tweets.push(tweet);
		if (tweets.length >= limit) break;
	}
	// Read after paging: the paginator adds each page's media as it fetches it.
	return { me, tweets, media: timeline.includes?.media || [] };
}

// X having a bad minute, as opposed to X refusing us (401, 403, 429), which no
// second try would change.
const isTransient = (err) => Number(err?.code ?? err?.status) >= 500;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// How far back this refresh has to read: the whole window the first time, and
// otherwise only from just before the last read, less the days a post's
// metrics can still move.
export function readDaysFor(previous, { now = Date.now(), days = OUTCOMES_WINDOW_DAYS, settleDays = OUTCOMES_SETTLE_DAYS } = {}) {
	const fetched = Date.parse(previous?.fetchedAt || '');
	if (!previous?.posts?.length || !Number.isFinite(fetched) || fetched > now) return days;
	return Math.min(days, (now - fetched) / DAY + settleDays);
}

export async function collectOutcomes({
	client,
	ledger = null,
	now = Date.now(),
	days = OUTCOMES_WINDOW_DAYS,
	limit = OUTCOMES_LIMIT,
	attempts = READ_ATTEMPTS,
	retryDelayMs = READ_RETRY_MS,
	previous = null,
	settleDays = OUTCOMES_SETTLE_DAYS,
}) {
	const readDays = readDaysFor(previous, { now, days, settleDays });
	// A read that fails part way is started again from the top: half a timeline
	// would measure the recent posts against nothing.
	let read = null;
	for (let attempt = 1; !read; attempt++) {
		try {
			read = await readTimeline({ client, now, days: readDays, limit });
		} catch (err) {
			if (attempt >= attempts || !isTransient(err)) throw err;
			await wait(retryDelayMs * attempt);
		}
	}
	const { me, tweets } = read;
	const mediaByKey = new Map(read.media.map((row) => [row.media_key, row]));

	const heads = tweets.filter(isHeadPost);
	const headIds = new Set(heads.map((tweet) => String(tweet.id)));
	// A thread is the account answering itself under its own head. An answer to
	// somebody else in the same conversation is a reply, not a second part.
	const threadSizes = new Map();
	for (const tweet of tweets) {
		const conversation = String(tweet.conversation_id || '');
		const toSelf = String(tweet.in_reply_to_user_id || '') === String(me.id);
		if (isHeadPost(tweet) || !headIds.has(conversation) || !toSelf) continue;
		threadSizes.set(conversation, (threadSizes.get(conversation) || 0) + 1);
	}

	// Matched on the lead post. The other ids are kept too: for a thread they are
	// replies and never become rows, but the post that quotes an Article is a head
	// of its own, and it is the queue's post as much as the Article is.
	const pipelineById = new Map();
	for (const row of ledger?.published || []) {
		for (const id of [leadPostId(row), ...(row.postIds || [])]) if (id) pipelineById.set(String(id), row);
	}

	const fresh = heads.map((tweet) => describePost(tweet, { mediaByKey, threadSizes, pipelineById }));
	// Settled rows come from the stored record. A stored row inside the window
	// just read that the read did not return was deleted, so it is dropped.
	const readFrom = now - readDays * DAY;
	const windowFrom = now - days * DAY;
	const kept = (previous?.posts || []).filter((row) => {
		const at = Date.parse(row.at);
		return at >= windowFrom && at < readFrom;
	});
	return {
		fetchedAt: new Date(now).toISOString(),
		readDays: Math.round(readDays * 10) / 10,
		posts: [...fresh, ...kept].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
	};
}

// A failed read counts as a read for pacing: retrying every fifteen minutes
// would only repeat the refusal (a 402 stays a 402 until the account is topped
// up) and log it each time.
export function outcomesAreStale(outcomes, now = Date.now(), hours = OUTCOMES_REFRESH_HOURS) {
	const last = Math.max(Date.parse(outcomes?.fetchedAt || '') || 0, Date.parse(outcomes?.attemptedAt || '') || 0);
	return !last || now - last > hours * HOUR;
}

// ── Learning ────────────────────────────────────────────────────────────────

// One number per post. Logs, because a post with 400 likes is not 100 times the
// post with 4. Replies are left out on purpose: on this account they are mostly
// "$three @grok" farming spam, so they measure nothing about the post.
// The account's strongest matured head posts by outcome, newest regime first:
// what "good" has meant on this account lately, in its own words.
export function bestPosts(rows, { now = Date.now(), count = 6 } = {}) {
	return (rows || [])
		.filter((row) => row.text && isMature(row, now))
		.sort((a, b) => outcomeOf(b) - outcomeOf(a))
		.slice(0, count)
		.map((row) => ({ text: row.text.replace(/\s+/g, ' ').trim(), likes: row.likes, reposts: row.reposts, bookmarks: row.bookmarks, views: row.impressions, media: row.media, posted: row.at.slice(0, 10) }));
}

export function outcomeOf(row) {
	return Math.log1p(row.likes || 0) + 0.5 * Math.log1p(row.bookmarks || 0) + 0.25 * Math.log1p(row.reposts || 0);
}

export const isMature = (row, now = Date.now(), minAgeHours = MIN_AGE_HOURS) => now - Date.parse(row.at) >= minAgeHours * HOUR;

// Adding zero turns a rounded -0 into 0, so a report never prints "-0".
const round = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places + 0;

export function learnLifts(rows, { now = Date.now(), minAgeHours = MIN_AGE_HOURS, halfLifeDays = HALF_LIFE_DAYS, shrinkK = SHRINK_K } = {}) {
	const matured = (rows || []).filter((row) => isMature(row, now, minAgeHours));
	let weight = 0;
	let sum = 0;
	const groups = new Map();
	for (const row of matured) {
		const w = 0.5 ** ((now - Date.parse(row.at)) / DAY / halfLifeDays);
		const outcome = outcomeOf(row);
		weight += w;
		sum += w * outcome;
		for (const key of attributeKeys(row)) {
			const group = groups.get(key) || { weight: 0, sum: 0, n: 0 };
			group.weight += w;
			group.sum += w * outcome;
			group.n += 1;
			groups.set(key, group);
		}
	}

	const lifts = {};
	for (const key of [...groups.keys()].sort()) {
		const group = groups.get(key);
		const rest = weight - group.weight;
		// A value every post carries has nothing to be compared against.
		const delta = group.weight > 0 && rest > 1e-12 ? group.sum / group.weight - (sum - group.sum) / rest : 0;
		const shrunk = group.n < MIN_VALUE_COUNT ? 0 : delta * (group.n / (group.n + shrinkK));
		lifts[key] = { delta: round(delta), n: group.n, shrunk: round(shrunk) };
	}
	return {
		learnedAt: new Date(now).toISOString(),
		sample: matured.length,
		baseline: round(weight > 0 ? sum / weight : 0),
		lifts,
	};
}

// ── Scoring a queued item ───────────────────────────────────────────────────

// The attributes overlap (a partner post is usually long and carries video), so
// adding them up would count one good post several times. The estimate is the
// strongest reason for the post, the strongest reason against it, and the
// average of whatever else was measured.
export function learnedScore(item, learned) {
	const found = attributeKeys(describeItem(item))
		.filter((key) => learned?.lifts?.[key])
		.map((key) => ({ key, shrunk: learned.lifts[key].shrunk, n: learned.lifts[key].n }));
	// A value seen on too few posts says nothing either way. Averaging its zero in
	// would pull every other signal toward no effect.
	const measured = found.filter((row) => row.n >= MIN_VALUE_COUNT).map((row) => row.shrunk);
	const best = Math.max(0, ...measured);
	const worst = Math.min(0, ...measured);
	const rest = [...measured];
	if (best > 0) rest.splice(rest.indexOf(best), 1);
	if (worst < 0) rest.splice(rest.indexOf(worst), 1);
	const mean = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : 0;
	const points = LEARNED_POINTS_PER_UNIT * (best + worst + mean);
	return {
		points: round(Math.max(-LEARNED_POINTS_LIMIT, Math.min(LEARNED_POINTS_LIMIT, points)), 1),
		found: found.map(({ key, shrunk }) => ({ key, shrunk })),
	};
}
