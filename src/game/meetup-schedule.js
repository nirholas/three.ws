// Meetup event schedule: the pure logic behind /play's live community events.
//
// A meetup is a scheduled window in wall-clock time with an ordered agenda of
// segments (welcome, totem showdown, wheel hour, dance-off, fireworks finale...).
// Every client derives the SAME phase from the same config and the same wall
// clock, with no server round-trip and no per-client state: two holders standing
// in the plaza always agree on what is happening and what comes next, the same
// trick src/shared/world-clock.js uses for the shared sky.
//
// Kept free of DOM/three imports so it is unit-testable and reusable by any
// surface that wants to render the event (HUD, landing page, jumbotron).

// Phases, in chronological order.
export const PHASE = {
	FAR: 'far',           // more than SOON_MS before start: chip hidden
	UPCOMING: 'upcoming', // countdown chip visible
	PRESHOW: 'preshow',   // final PRESHOW_MS: chip pulses, stage lights up
	LIVE: 'live',         // event window: agenda runs
	AFTERGLOW: 'afterglow', // just ended: thanks + photo prompt linger
	ENDED: 'ended',       // all trace gone
};

export const SOON_MS = 24 * 60 * 60 * 1000;   // chip appears a day out
export const PRESHOW_MS = 30 * 60 * 1000;     // stage powers up 30 min early
export const AFTERGLOW_MS = 20 * 60 * 1000;   // linger 20 min after the end

// Parse the event out of /event.json (the same file src/game/event-countdown.js
// reads, so the pill and the in-world experience can never disagree). Returns
// null when there is nothing valid to run, so callers can treat "no event" and
// "bad config" identically (the world simply stays normal).
export function parseEvent(doc) {
	if (!doc || typeof doc !== 'object') return null;
	const startsAt = Date.parse(doc.startsAt);
	if (!Number.isFinite(startsAt)) return null;
	const rawEnd = Date.parse(doc.endsAt);
	// Same default event-countdown.js uses: a missing end keeps it live 6 hours.
	const endsAt = Number.isFinite(rawEnd) && rawEnd > startsAt ? rawEnd : startsAt + 6 * 3600 * 1000;
	const agenda = (Array.isArray(doc.agenda) ? doc.agenda : [])
		.map((seg) => ({
			atMin: Number(seg?.atMin),
			title: String(seg?.title || '').slice(0, 80),
			detail: String(seg?.detail || '').slice(0, 200),
			icon: String(seg?.icon || '').slice(0, 8),
		}))
		.filter((seg) => Number.isFinite(seg.atMin) && seg.atMin >= 0 && seg.title)
		.sort((a, b) => a.atMin - b.atMin);
	return {
		id: String(doc.id || 'event').slice(0, 64),
		title: String(doc.name || 'Community meetup').slice(0, 120),
		subtitle: String(doc.tagline || '').slice(0, 160),
		startsAt,
		endsAt,
		agenda,
		groupPhoto: parseGroupPhoto(doc.groupPhoto, endsAt - startsAt),
	};
}

// The synchronized group photo: `"groupPhoto": { "atMin": 58, "emote": "wave" }`
// in /event.json. Kept relative to the start (like agenda beats) so the
// ?meetup= preview shift moves it with the rest of the schedule. A shutter
// outside the live window, or a missing block, means no group photo.
// The pose has to still be playing when the shutter fires, on this client and on
// every neighbour that receives it a network hop later. av-cheering runs 6.8 s,
// comfortably past the PHOTO_POSE_MS lead; a short clip such as wave (1 s) or
// celebrate (1.9 s) is back to idle before the photo is taken.
const DEFAULT_PHOTO_EMOTE = 'av-cheering';

function parseGroupPhoto(raw, durationMs) {
	if (!raw || typeof raw !== 'object') return null;
	const atMin = Number(raw.atMin);
	if (!Number.isFinite(atMin) || atMin < 0 || atMin * 60000 >= durationMs) return null;
	const emote = typeof raw.emote === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.emote) ? raw.emote : DEFAULT_PHOTO_EMOTE;
	return { atMin, emote };
}

// Group photo stages, in order. GATHER is the one-minute warning, COUNTDOWN the
// on-screen 10..1, SHUTTER a short grace after the instant so a frame that
// lands a little late still fires, DONE everything after.
export const PHOTO_STAGE = {
	NONE: 'none',
	GATHER: 'gather',
	COUNTDOWN: 'countdown',
	SHUTTER: 'shutter',
	DONE: 'done',
};

export const PHOTO_GATHER_MS = 60 * 1000;
export const PHOTO_COUNTDOWN_MS = 10 * 1000;
export const PHOTO_POSE_MS = 3000;          // avatars strike the pose this long before the shutter
export const PHOTO_SHUTTER_GRACE_MS = 2000;
// How late the first frame after the instant may land and still take the shot
// for a client that watched the countdown. Covers a stalled frame (a GLB load,
// a GC pause, a throttled laptop) without photographing a moment long gone.
export const PHOTO_LATE_MS = 15 * 1000;

// Where the shared shutter stands at `now`. Every client derives the same answer
// from the same config and wall clock, so the whole plaza counts down and fires
// together without a packet, the same trick fireworkPlan uses.
export function groupPhotoState(event, now) {
	const gp = event?.groupPhoto;
	if (!gp) return { stage: PHOTO_STAGE.NONE, shutterAt: 0, msToShutter: 0, emote: null };
	const t = Number(now) || 0;
	const shutterAt = event.startsAt + gp.atMin * 60000;
	const msToShutter = shutterAt - t;
	let stage;
	if (msToShutter > PHOTO_GATHER_MS) stage = PHOTO_STAGE.NONE;
	else if (msToShutter > PHOTO_COUNTDOWN_MS) stage = PHOTO_STAGE.GATHER;
	else if (msToShutter > 0) stage = PHOTO_STAGE.COUNTDOWN;
	else if (msToShutter > -PHOTO_SHUTTER_GRACE_MS) stage = PHOTO_STAGE.SHUTTER;
	else stage = PHOTO_STAGE.DONE;
	return { stage, shutterAt, msToShutter: Math.max(0, msToShutter), emote: gp.emote };
}

// The full derived state for a moment in time. Everything the UI needs in one
// pure call: phase, countdown, the active + next agenda segments, and progress.
export function eventState(event, now) {
	if (!event) return { phase: PHASE.ENDED, event: null };
	const t = Number(now) || 0;
	const { startsAt, endsAt } = event;
	let phase;
	if (t < startsAt - SOON_MS) phase = PHASE.FAR;
	else if (t < startsAt - PRESHOW_MS) phase = PHASE.UPCOMING;
	else if (t < startsAt) phase = PHASE.PRESHOW;
	else if (t < endsAt) phase = PHASE.LIVE;
	else if (t < endsAt + AFTERGLOW_MS) phase = PHASE.AFTERGLOW;
	else phase = PHASE.ENDED;

	const minsIn = (t - startsAt) / 60000;
	let active = null;
	let next = null;
	if (phase === PHASE.LIVE) {
		for (const seg of event.agenda) {
			if (seg.atMin <= minsIn) active = seg;
			else { next = seg; break; }
		}
	} else if (phase === PHASE.UPCOMING || phase === PHASE.PRESHOW || phase === PHASE.FAR) {
		next = event.agenda[0] || null;
	}

	return {
		phase,
		event,
		msToStart: Math.max(0, startsAt - t),
		msToEnd: Math.max(0, endsAt - t),
		progress: phase === PHASE.LIVE ? Math.min(1, Math.max(0, (t - startsAt) / (endsAt - startsAt))) : 0,
		active,
		next,
		msToNext: next ? Math.max(0, startsAt + next.atMin * 60000 - t) : 0,
	};
}

// Local preview: `?meetup=now` shifts the window to start 20 seconds from the
// given clock, `?meetup=<ISO>` shifts it to that instant. Duration and agenda
// are preserved, so every surface that reads the event (the in-world layer, the
// photo-mode stamp) previews the SAME shifted schedule instead of each one
// re-implementing the shift and drifting. Pure so it is unit-testable: callers
// pass the query string, not `location`.
export function applyPreviewOverride(event, search, now = Date.now()) {
	if (!event || !search) return event;
	let want = null;
	try {
		want = new URLSearchParams(search).get('meetup');
	} catch {
		return event;
	}
	if (!want) return event;
	const start = want === 'now' ? now + 20_000 : Date.parse(want);
	if (!Number.isFinite(start)) return event;
	return { ...event, startsAt: start, endsAt: start + (event.endsAt - event.startsAt) };
}

// "2h 14m", "14m 09s", "0:07": a countdown that reads naturally at every
// distance instead of one fixed format that is wrong at most of them.
export function formatCountdown(ms) {
	const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
	if (m >= 10) return `${m}m`;
	if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
	return `0:${String(sec).padStart(2, '0')}`;
}

// Deterministic firework schedule. Time is cut into fixed buckets; each bucket
// hashes (with the event id as seed) into the same launch plan on every client,
// so the whole plaza watches one synchronized show without a single packet.
// Returns launches due within the bucket as offsets, positions on a ring, and
// palette indexes. `rate` bursts per bucket on average; finale cranks it.
const BUCKET_MS = 4000;

function hash32(str) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function fireworkPlan(eventId, bucketStartMs, { intensity = 1 } = {}) {
	const bucket = Math.floor(bucketStartMs / BUCKET_MS);
	const rand = mulberry32(hash32(`${eventId}:${bucket}`));
	const count = Math.max(intensity >= 1 ? 1 : 0, Math.round(rand() * 2 * intensity));
	const launches = [];
	for (let i = 0; i < count; i++) {
		launches.push({
			atMs: bucket * BUCKET_MS + Math.floor(rand() * BUCKET_MS),
			angle: rand() * Math.PI * 2, // position on the launch ring
			radius: 0.55 + rand() * 0.45, // fraction of the ring radius
			palette: Math.floor(rand() * 6),
			apex: 16 + rand() * 10,       // burst height in meters
		});
	}
	return launches;
}

export { BUCKET_MS };
