// What the venue projector's broadcast overlay says, as a pure function of the
// event config, the clock and the room. No DOM, so the three states the screen
// must get right (upcoming, live, and the explicit no-event state) are covered
// by tests/director-overlay-state.test.js instead of by eyeballing a projector.
//
// The event comes from the same /event.json every other surface reads, parsed by
// the same meetup-schedule.js helpers, so the big screen can never disagree with
// the lobby banner or the in-world chip about when the event is.

import {
	PHASE, PHOTO_STAGE, parseEvent, applyPreviewOverride, eventState, groupPhotoState, formatCountdown,
} from './meetup-schedule.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MODE = { NONE: 'none', UPCOMING: 'upcoming', LIVE: 'live', AFTERGLOW: 'afterglow' };

/**
 * Parse the raw /event.json document for the overlay. `id: null` is the file's
 * explicit "no event scheduled" state (the file ships that way between events),
 * and a missing or unparseable start means the same thing: null, never an error.
 * @param {unknown} doc
 * @param {string} [search] location.search, so ?meetup= previews shift the window
 * @param {number} [now]
 */
export function parseDirectorEvent(doc, search = '', now = Date.now()) {
	if (!doc || typeof doc !== 'object' || doc.id == null) return null;
	const ev = parseEvent(doc);
	if (!ev) return null;
	return applyPreviewOverride(ev, search, now);
}

/** "5d 03h" for far-off events, otherwise the shared formatCountdown wording. */
export function formatLead(ms) {
	if (ms >= DAY_MS) {
		const d = Math.floor(ms / DAY_MS);
		const h = Math.floor((ms % DAY_MS) / 3_600_000);
		return `${d}d ${String(h).padStart(2, '0')}h`;
	}
	return formatCountdown(ms);
}

function worldLine(world) {
	const name = String(world?.name || '').trim();
	const symbol = String(world?.symbol || '').trim().replace(/^\$/, '');
	return { name: name || 'three.ws', symbol: symbol ? `$${symbol.toUpperCase()}` : '' };
}

/**
 * @param {object} input
 * @param {object|null} input.event parsed event (parseDirectorEvent) or null
 * @param {number} input.now
 * @param {{name?:string,symbol?:string}} input.world
 * @param {number} input.online people in the world right now (spectators excluded)
 * @returns {object} everything the overlay paints
 */
export function overlayModel({ event, now, world, online }) {
	const w = worldLine(world);
	const count = Math.max(0, Math.floor(Number(online) || 0));
	const base = {
		world: w.name, symbol: w.symbol, online: count,
		onlineLabel: count === 1 ? '1 online' : `${count} online`,
		eventName: '', tagline: '', badge: '', clock: '', segment: null, next: null, photo: null, progress: 0,
	};

	if (!event) return { ...base, mode: MODE.NONE, key: keyOf({ ...base, mode: MODE.NONE }) };

	const st = eventState(event, now);
	if (st.phase === PHASE.ENDED) return { ...base, mode: MODE.NONE, key: keyOf({ ...base, mode: MODE.NONE }) };

	const common = { ...base, eventName: event.title, tagline: event.subtitle };
	let m;
	if (st.phase === PHASE.LIVE) {
		m = {
			...common, mode: MODE.LIVE, badge: 'LIVE', clock: `${formatCountdown(st.msToEnd)} left`,
			segment: st.active ? { title: st.active.title, detail: st.active.detail, icon: st.active.icon } : null,
			next: st.next ? { title: st.next.title, in: formatCountdown(st.msToNext) } : null,
			progress: Math.round(st.progress * 1000) / 1000,
		};
	} else if (st.phase === PHASE.AFTERGLOW) {
		m = { ...common, mode: MODE.AFTERGLOW, badge: 'THANKS FOR COMING', clock: '' };
	} else {
		m = {
			...common, mode: MODE.UPCOMING, badge: st.phase === PHASE.PRESHOW ? 'STARTING SOON' : 'STARTS IN',
			clock: formatLead(st.msToStart),
			next: st.next ? { title: st.next.title, in: '' } : null,
		};
	}

	const gp = groupPhotoState(event, now);
	if (gp.stage !== PHOTO_STAGE.NONE && gp.stage !== PHOTO_STAGE.DONE) {
		m.photo = {
			stage: gp.stage,
			seconds: gp.stage === PHOTO_STAGE.COUNTDOWN ? Math.max(1, Math.ceil(gp.msToShutter / 1000)) : null,
			caption: gp.stage === PHOTO_STAGE.GATHER ? 'Group photo in 1 minute. Gather at the totem' : 'Group photo. Face the crowd',
		};
	}
	return { ...m, key: keyOf(m) };
}

// A string that changes exactly when something visible changes, so the overlay
// writes the DOM only on a real change and never on a quiet second.
function keyOf(m) {
	return JSON.stringify([
		m.mode, m.eventName, m.tagline, m.badge, m.clock, m.world, m.symbol, m.onlineLabel,
		m.segment && [m.segment.title, m.segment.detail, m.segment.icon],
		m.next && [m.next.title, m.next.in],
		m.photo && [m.photo.stage, m.photo.seconds, m.photo.caption],
		m.progress,
	]);
}
