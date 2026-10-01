// Which approved post goes out next: always the highest-priority one that is
// ready, never simply the oldest. Pacing (schedule.js) decides *when* a slot
// opens; this module decides *what* fills it.
//
// A score is a sum of named, explainable parts, so `npm run x:content -- plan`
// can show exactly why one post outranks another:
//
//   volume      the chance the post is followed by a volume response on the
//               $THREE pool, relative to the average post, from the model in
//               data/x-content/volume-model.json. Pool volume is what pays the
//               platform, so it outranks attention: it replaces the engagement
//               part whenever the model file is present
//   learned     how posts shaped like this one did on the live account, read
//               back through the X API (outcomes.js): likes, bookmarks, and
//               reposts of posts with the same media, length, link, thread,
//               mentions, cashtag, lane, and pattern, against posts without.
//               Added beside volume once LEARNED_MIN_SAMPLE posts have matured,
//               and held between -15 and +15 so it informs the order without
//               overruling the owner's boost
//   engagement  the fallback when there is neither a volume model nor a learned
//               sample: predicted lift from the scraped archive
//               (data/x-archive/analysis), using the same format, length, and
//               topic classifiers that produced the report. The scrape lost the
//               like counts of the account's biggest posts, so it is never used
//               once the measured outcomes are there
//   timely      a post with `expiresAt` rises as its window closes, and is
//               dropped once it has passed (stale news is worse than none)
//   boost       the owner's explicit `priority` on the item, -50 to +50
//   waiting     +1 per day an item has been ready, so nothing starves
//   review      the AI editor's average score above or below 4
//   variety     a penalty when the post would repeat the last lane or pattern
//               more times in a row than the queue allows
//
// Small samples are shrunk toward no effect: the archive measured "names
// $THREE" at 13.3x over only four posts, and one lucky post should not decide
// the whole queue.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FORMAT_DIMENSIONS, LENGTH_BUCKETS, TOPICS } from '../../../scripts/x-archive-lib.mjs';
import { weightedLength } from './quality.js';
import { LEARNED_MIN_SAMPLE, learnedScore } from './outcomes.js';

const DAY = 24 * 60 * 60_000;
// Prior strength for shrinkage: a signal measured on n posts keeps n / (n + K)
// of its log-lift.
const SHRINK_K = 10;
const TIMELY_WINDOW_MS = 2 * DAY;

export const ENGAGEMENT_REPORT = 'data/x-archive/analysis/trythreews-engagement.json';
export const VOLUME_MODEL = 'data/x-content/volume-model.json';

// The model is fitted elsewhere (a logistic regression over every original post
// moment against 1-minute pool candles) and shipped as plain JSON: an intercept,
// a base rate, and one weight per attribute a draft can be checked for before it
// is posted. Text attributes carry their own pattern, so a refit never needs a
// code change here.
export function loadVolumeModel(root) {
	const path = resolve(root, VOLUME_MODEL);
	if (!existsSync(path)) return null;
	const model = JSON.parse(readFileSync(path, 'utf8'));
	if (!Array.isArray(model.features) || !Number.isFinite(model.intercept) || !(model.baseRate > 0)) return null;
	return { ...model, features: model.features.map((row) => ({ ...row, regex: row.pattern ? new RegExp(row.pattern.source, row.pattern.flags) : null })) };
}

// The attributes that are not a text pattern. Every slot in the queue's cadence
// sits inside the hours the model calls `usHours` (12:00 to 20:00 UTC), and the
// queue only ever posts from the company account, so both are true for every
// queued post: they move every score by the same amount and are kept so the
// reported chance is an honest one. A cadence with a slot outside that window
// would make `usHours` untrue; keep the slots inside it.
const VOLUME_CHECKS = {
	video: (item) => (item.posts?.[0]?.media || []).some((row) => /\.(mp4|mov)$/i.test(row.path || '')),
	thread: (item) => (item.posts?.length || 0) >= 2,
	long: (item) => String(item.posts?.[0]?.text || '').length > 180,
	usHours: () => true,
	company: () => true,
};

// Chance that the post is followed by a volume response, and which attributes
// the model found on it.
export function volumeScore(item, model) {
	if (!model) return null;
	const head = item.posts?.[0] || {};
	const text = String(item.kind === 'article' ? `${item.article?.title || ''}\n${head.text || ''}` : head.text || '');
	let z = model.intercept;
	const found = [];
	for (const row of model.features) {
		const has = row.regex ? row.regex.test(text) : Boolean(VOLUME_CHECKS[row.key]?.(item));
		if (!has) continue;
		z += row.weight;
		found.push(row.key);
	}
	return { chance: 1 / (1 + Math.exp(-z)), found };
}

// Synchronous and file based. The learned lifts come from the database, so the
// caller attaches them afterwards as `lifts.learned` (see runTick).
export function loadLifts(root) {
	const path = resolve(root, ENGAGEMENT_REPORT);
	// The volume model rides along on the lifts map so every caller that already
	// passes `lifts` into the ranking gets it without a new parameter.
	const volumeModel = loadVolumeModel(root);
	if (!existsSync(path)) return volumeModel ? Object.assign(new Map(), { volumeModel }) : null;
	const report = JSON.parse(readFileSync(path, 'utf8')).report || {};
	const lifts = Object.assign(new Map(), { volumeModel });
	const add = (group, row) => {
		const lift = row.lift ?? row.with?.lift;
		const count = row.count ?? row.with?.count ?? 0;
		if (lift > 0 && count > 0) lifts.set(`${group}:${row.key}`, { lift, count });
	};
	for (const row of report.formats || []) add('format', row);
	for (const row of report.lengths || []) add('length', row);
	for (const row of report.topics || []) add('topic', row);
	return lifts;
}

const shrunkLog = ({ lift, count }) => (count / (count + SHRINK_K)) * Math.log(lift);

// The head post, described the way the archive classifiers describe a scraped
// post, so the signals line up with the ones the report measured.
function asArchivePost(item) {
	const head = item.posts?.[0] || {};
	const media = head.media || [];
	const text = String(item.kind === 'article' ? `${item.article?.title || ''}\n${head.text || ''}` : head.text || '');
	return {
		text,
		hasImage: media.some((row) => /\.(png|jpe?g|webp|gif)$/i.test(row.path)) || Boolean(item.article?.cover),
		hasVideo: media.some((row) => /\.(mp4|mov)$/i.test(row.path)),
		hasCard: false,
		mentions: text.match(/(?<![\w@])@\w{1,15}/g) || [],
		urls: [],
		isReply: false,
	};
}

export function engagementSignals(item, lifts) {
	if (!lifts) return [];
	const post = asArchivePost(item);
	const keys = [];
	for (const dimension of FORMAT_DIMENSIONS) if (dimension.test(post)) keys.push(`format:${dimension.key}`);
	const length = weightedLength(item.posts?.[0]?.text || '');
	const bucket = LENGTH_BUCKETS.find((row) => length >= row.min && length <= row.max);
	if (bucket) keys.push(`length:${bucket.key}`);
	const topics = TOPICS.filter((topic) => topic.patterns.some((pattern) => pattern.test(post.text))).map((topic) => topic.key);
	for (const topic of topics.length ? topics : ['other']) keys.push(`topic:${topic}`);
	return keys.filter((key) => lifts.has(key)).map((key) => ({ key, ...lifts.get(key), weight: shrunkLog(lifts.get(key)) }));
}

// The signals overlap (a post that tags a partner usually also carries an
// image and a link), so summing them would count one good post several times.
// The estimate is the strongest topic signal plus the average of the format
// and length signals.
function combinedLog(signals) {
	const topics = signals.filter((row) => row.key.startsWith('topic:')).map((row) => row.weight);
	const shape = signals.filter((row) => !row.key.startsWith('topic:')).map((row) => row.weight);
	const topic = topics.length ? Math.max(...topics) : 0;
	const form = shape.length ? shape.reduce((a, b) => a + b, 0) / shape.length : 0;
	return topic + form;
}

function trailingRun(published, field, value) {
	let run = 0;
	for (let index = published.length - 1; index >= 0; index--) {
		if (published[index][field] !== value) break;
		run++;
	}
	return run;
}

// Returns { score, parts } or { expired: true } when a timely post has passed.
export function scoreItem(item, { lifts, published = [], quality = {}, review = null, now = Date.now() }) {
	const parts = {};

	const signals = engagementSignals(item, lifts);
	const predicted = Math.exp(combinedLog(signals));
	const volume = volumeScore(item, lifts?.volumeModel);
	const learned = lifts?.learned?.sample >= LEARNED_MIN_SAMPLE ? learnedScore(item, lifts.learned) : null;
	// Same scale as the engagement part it replaces: 10 points per doubling against
	// the average post, so the other parts keep their relative weight.
	if (volume) parts.volume = Math.round(10 * Math.log2(volume.chance / lifts.volumeModel.baseRate) * 10) / 10;
	else if (!learned) parts.engagement = Math.round(10 * Math.log2(predicted) * 10) / 10;
	if (learned) parts.learned = learned.points;

	if (item.expiresAt) {
		const left = Date.parse(item.expiresAt) - now;
		if (left <= 0) return { expired: true, score: -Infinity, parts, signals };
		parts.timely = left < TIMELY_WINDOW_MS ? Math.round(20 * (1 - left / TIMELY_WINDOW_MS)) : 0;
	}

	const boost = Number(item.priority || 0);
	if (boost) parts.boost = Math.max(-50, Math.min(50, boost));

	const ready = Date.parse(item.notBefore);
	if (Number.isFinite(ready) && now > ready) parts.waiting = Math.min(10, Math.floor((now - ready) / DAY));

	const scores = review?.editor?.scores;
	if (scores) {
		const values = Object.values(scores).map(Number).filter(Number.isFinite);
		if (values.length) parts.review = Math.round((values.reduce((a, b) => a + b, 0) / values.length - 4) * 5 * 10) / 10;
	}

	const sorted = [...published].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
	const maxLane = Number(quality.maximumSameLaneInARow ?? Infinity);
	const maxPattern = Number(quality.maximumSamePatternInARow ?? Infinity);
	if (trailingRun(sorted, 'lane', item.lane) >= maxLane || trailingRun(sorted, 'pattern', item.pattern) >= maxPattern) {
		parts.variety = -25;
	}

	const score = Math.round(Object.values(parts).reduce((sum, value) => sum + value, 0) * 10) / 10;
	return {
		score,
		parts,
		signals,
		predictedLift: Math.round(predicted * 100) / 100,
		volumeChance: volume ? Math.round(volume.chance * 1000) / 1000 : null,
		volumeSignals: volume?.found || [],
		learnedSignals: learned?.found || [],
	};
}

// Every ready candidate, best first. Ties go to the item that has been ready
// longest, then to id order, so the ranking is deterministic.
export function rankItems(items, context) {
	return items
		.map((item) => ({ item, ...scoreItem(item, { ...context, review: context.reviews?.get?.(item.id) || null }) }))
		.filter((row) => !row.expired)
		.sort((a, b) => b.score - a.score || Date.parse(a.item.notBefore) - Date.parse(b.item.notBefore) || a.item.id.localeCompare(b.item.id));
}
