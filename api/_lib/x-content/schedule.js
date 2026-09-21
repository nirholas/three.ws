// Decides when the next post may go out, and hands the slot to the
// highest-priority ready post (priority.js). Which post and when are separate
// questions on purpose: the queue always spends a slot on the most valuable
// thing it has, and the slot itself follows a human cadence, not a cron one:
//   - a minimum gap between posts, stretched by a secret per-gap jitter, so the
//     account never posts on the hour and the next minute cannot be predicted;
//   - a rolling 24h cap and quiet hours;
//   - `notBefore` is an embargo: an item is not ready before it;
//   - a half-published item (thread cut off, Article drafted) always resumes
//     first, ahead of every pacing and priority rule.
// Pure: no I/O, so the rules are unit-tested and the CLI shows the same
// decision the cron will make.

import { createHash, createHmac } from 'node:crypto';
import { rankItems } from './priority.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const DEFAULT_CADENCE = {
	windowMinutes: 90,
	minimumMinutesApart: 240,
	dailyCap: 3,
	quietHoursUtc: null,
};

// ── Why the schedule carries a secret ────────────────────────────────────────
// The queue is a committed file in a public repository, so the day an item
// posts is public by construction. Without a seed the minute is public too:
// the jitter was a plain hash of the item's id, which anyone holding the repo
// can compute, and an announcement whose exact minute is knowable days ahead
// can be camped, front-run, or pre-empted.
//
// `X_CONTENT_SCHEDULE_SEED` (production env, never committed) turns that hash
// into an HMAC. Same properties for us (stable per item, so a preview, a retry
// and the real tick all agree), no properties at all for anyone without the
// seed. It also deals out the day's anchor times, so which of the day's posts
// goes first is unknowable as well. With no seed configured the behaviour is
// exactly what it was, which keeps local previews and the tests honest.

export function jitterMinutes(id, windowMinutes, seed = null) {
	const digest = seed
		? createHmac('sha256', String(seed)).update(String(id)).digest()
		: createHash('sha256').update(String(id)).digest();
	return digest.readUInt32BE(0) % Math.max(1, windowMinutes);
}

export function inQuietHours(now, quiet) {
	if (!Array.isArray(quiet) || quiet.length !== 2) return false;
	const minutes = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
	const [start, end] = quiet.map((value) => {
		const [h, m] = String(value).split(':').map(Number);
		return h * 60 + (m || 0);
	});
	return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

// ── The day plan ────────────────────────────────────────────────────────────
// Three slots a day, each owned by a tier:
//   T1 flagship         partner news, $THREE utility, major launches
//   T2 features         shipped features with proof
//   T3 proof of work    short demos, stats, build notes
// Slot times are the owner's cadence of 2026-09-20: three a day, eight hours
// apart, every day of the week. It replaced a window drawn from the volume
// study (an original post between 12:00 and 20:00 UTC is followed by a volume
// response on the $THREE pool about 1.7 times as often as one outside it),
// which could not hold three evenly spaced slots. Two of the three still land
// inside that window; the third takes the off-peak turn. Each slot opens at a
// jittered minute only the seed can reproduce, and stays open for three hours,
// so a missed tick (deploy, outage) still posts while a day never gets more
// than one post per slot.
//
// Filling a slot: the slot's own tier first, then lower tiers (T1 slot empty ->
// best T2), so the best available post always gets the best time. A higher tier
// only fills a lower slot when it has a surplus, so the last flagship post is
// kept for prime time instead of being spent off-peak. Nothing ready at all
// means nothing posts: 3 a day is a ceiling, not a quota.

export const TIERS = [1, 2, 3];

export const DEFAULT_SLOTS = [
	{ tier: 3, at: '04:00' },
	{ tier: 2, at: '12:00' },
	{ tier: 1, at: '20:00' },
];

const dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const atMinutes = (at) => {
	const [h, m] = String(at).split(':').map(Number);
	return h * 60 + (m || 0);
};

// Saturday and Sunday, by the UTC day a slot belongs to. `flagshipWeekdaysOnly`
// withholds the T1 slot on a weekend and keeps T1 posts out of the lower slots
// too, because the $THREE pool trades about two thirds of its weekday volume
// then and the hour after a post moves less than half the dollars. The queue no
// longer sets it: the owner's cadence of 2026-09-20 posts three a day every day,
// weekends included. The option stays because it is the only lever that reverses
// that, and `isWeekend` still answers the question it asks.
export const isWeekend = (timestamp) => [0, 6].includes(new Date(timestamp).getUTCDay());

// Every slot opening from yesterday through tomorrow, in time order, so the
// slot spanning midnight (22:00 until the next morning) is found too.
export function slotOpenings(now, cadence = DEFAULT_CADENCE, seed = null) {
	const slots = cadence.slots?.length ? cadence.slots : DEFAULT_SLOTS;
	const window = Number(cadence.windowMinutes ?? DEFAULT_CADENCE.windowMinutes);
	const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
	const openings = [];
	for (const offset of [-1, 0, 1]) {
		const day = today + offset * DAY;
		slots.forEach((slot, index) => {
			if (cadence.flagshipWeekdaysOnly && Number(slot.tier) === 1 && isWeekend(day)) return;
			const key = `${dayKey(day)}#${index}`;
			openings.push({ key, tier: Number(slot.tier), opensAt: day + (atMinutes(slot.at) + jitterMinutes(`slot:${key}`, window, seed)) * MINUTE });
		});
	}
	return openings.sort((a, b) => a.opensAt - b.opensAt);
}

// How long a slot stays open after it opens. Long enough that a missed run or
// a deploy does not lose the slot, short enough that an evening slot never
// spills into the small hours where nobody is reading.
export const SLOT_OPEN_MINUTES = 180;

// The slot that is open right now (the latest one that has opened, and has not
// yet closed), and when the next one opens.
export function currentSlot(now, cadence = DEFAULT_CADENCE, seed = null) {
	const openings = slotOpenings(now, cadence, seed);
	const index = openings.findLastIndex((slot) => slot.opensAt <= now);
	const latest = index >= 0 ? openings[index] : null;
	const openFor = Number(cadence.slotOpenMinutes ?? SLOT_OPEN_MINUTES) * MINUTE;
	const slot = latest && now < latest.opensAt + openFor ? latest : null;
	return { slot, next: openings[index + 1] || null };
}

// The order tiers are tried in for a slot: its own, then every lower tier,
// then higher tiers that have more than one post ready.
export function tierOrder(slotTier, readyByTier) {
	const lower = TIERS.filter((tier) => tier >= slotTier);
	const higher = TIERS.filter((tier) => tier < slotTier && (readyByTier.get(tier) || 0) > 1).reverse();
	return [...lower, ...higher];
}

export const tierOf = (item) => (TIERS.includes(Number(item.tier)) ? Number(item.tier) : 2);

// `requestedId` names one item and skips pacing and ranking; `anyStatus` lets a
// preview of that item run before it is approved. `exclude` holds ids this
// tick already tried and could not send, so the slot falls to the next best.
export function pickDue({
	items,
	state,
	now = Date.now(),
	cadence: rawCadence = {},
	quality = {},
	requestedId = null,
	anyStatus = false,
	seed = null,
	lifts = null,
	reviews = null,
	exclude = new Set(),
}) {
	const cadence = { ...DEFAULT_CADENCE, ...rawCadence };
	const published = [...(state?.published || [])].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
	const publishedIds = new Set(published.map((row) => row.id));
	const inflight = state?.inflight || {};

	const unpublished = items
		.filter((item) => (item.status === 'approved' || (anyStatus && requestedId)) && !publishedIds.has(item.id))
		.filter((item) => !requestedId || item.id === requestedId);

	if (requestedId) {
		return unpublished[0] ? { item: unpublished[0], forced: true } : { item: null, reason: `no ${anyStatus ? '' : 'approved '}unpublished item named ${requestedId}` };
	}

	const resuming = unpublished.find((item) => inflight[item.id] && !exclude.has(item.id));
	if (resuming) return { item: resuming, resuming: true };

	if (inQuietHours(now, cadence.quietHoursUtc)) return { item: null, reason: 'quiet hours' };
	const { slot, next } = currentSlot(now, cadence, seed);
	const nextAt = next ? new Date(next.opensAt).toISOString() : 'tomorrow';
	if (!slot) return { item: null, reason: `no slot is open; the next opens at ${nextAt}` };
	if (published.some((row) => row.slot === slot.key)) return { item: null, reason: `slot ${slot.key} (T${slot.tier}) is used; the next opens at ${nextAt}` };

	const last = published[published.length - 1];
	if (last && now < Date.parse(last.publishedAt) + cadence.minimumMinutesApart * MINUTE) {
		return { item: null, reason: `spacing: the last post went out at ${last.publishedAt}` };
	}
	// The cap governs the schedule, so it counts scheduled posts only. A post an
	// operator forces out by hand carries no slot, and counting those let one
	// afternoon of owner-requested posts (four between 17:43 and 19:49 UTC on
	// 2026-09-20) hold every scheduled slot shut for the next 24 hours, so the
	// account went quiet the morning after its busiest day. Slots already limit
	// the schedule to one post each, and the spacing check above still measures
	// from the last post of any kind, so a hand-sent post can never be followed by
	// a scheduled one minutes later.
	const scheduledLastDay = published.filter((row) => row.slot && now - Date.parse(row.publishedAt) < DAY).length;
	if (scheduledLastDay >= cadence.dailyCap) return { item: null, reason: `daily cap of ${cadence.dailyCap} scheduled posts reached` };

	// On a weekend a flagship post waits for Monday instead of filling a lower slot.
	const holdFlagship = Boolean(cadence.flagshipWeekdaysOnly) && isWeekend(slot.opensAt);
	const ready = unpublished.filter((item) => !exclude.has(item.id) && Date.parse(item.notBefore) <= now && !(holdFlagship && tierOf(item) === 1));
	const context = { lifts, published, quality, reviews, now };
	const readyByTier = new Map(TIERS.map((tier) => [tier, ready.filter((item) => tierOf(item) === tier).length]));
	for (const tier of tierOrder(slot.tier, readyByTier)) {
		const ranked = rankItems(ready.filter((item) => tierOf(item) === tier), context);
		if (!ranked.length) continue;
		const [top] = ranked;
		return {
			item: top.item,
			slot,
			tier,
			filledDown: tier !== slot.tier,
			score: top.score,
			parts: top.parts,
			ranking: ranked.map((row) => ({ id: row.item.id, score: row.score })),
		};
	}
	const embargoed = unpublished.filter((item) => !exclude.has(item.id) && Date.parse(item.notBefore) > now).sort((a, b) => a.notBefore.localeCompare(b.notBefore));
	if (embargoed[0]) return { item: null, slot, reason: `nothing is ready for slot ${slot.key}; ${embargoed[0].id} is embargoed until ${embargoed[0].notBefore}` };
	return { item: null, slot, reason: exclude.size ? `every ready post was held this tick; slot ${slot.key} stays open` : 'queue has no approved unpublished posts' };
}
