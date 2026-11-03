// The live event's config, read from the repo's own public/event.json.
//
// public/event.json is the single source of truth for the platform event: the
// countdown pill, the in-world meetup layer, the game server's quest gate
// (multiplayer/src/event-window.js, which reads the same file over HTTP because its
// container ships without public/) and now the leaderboard endpoints. The API
// process serves that file from disk, so it reads it from disk, no HTTP hop to
// itself, and no second copy of the times anywhere.
//
// Parsing is delegated to parseEventWindow so the API and the game server agree on
// what "the event" is down to the millisecond, including the "missing endsAt means
// six hours" default.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEventWindow, isEventLive } from '../../multiplayer/src/event-window.js';
import { applyOverride, loadOverrideRow } from './event-override.js';

// The live override (api/_lib/event-override.js) is held in a stale-while-revalidate
// cache so eventConfig() stays synchronous: a read never waits on the database, and
// a refresh runs in the background at most every OVERRIDE_TTL_MS. A failed refresh
// keeps the last good override (and starts from none, i.e. the static file).
const OVERRIDE_TTL_MS = 15_000;
const FILE_TTL_MS = 60_000;

let _file = null;
let _fileAt = 0;
let _override = null;
let _overrideAt = 0;
let _inFlight = null;
let _loader = loadOverrideRow;

/** The parsed public/event.json document, or null when unreadable. */
export function staticEventDoc(now = Date.now()) {
	if (_file !== null && (_fileAt === Number.MAX_SAFE_INTEGER || now - _fileAt < FILE_TTL_MS)) return _file.doc;
	let doc = null;
	try {
		doc = JSON.parse(readFileSync(resolve(process.cwd(), 'public/event.json'), 'utf8'));
	} catch (err) {
		console.warn('[event-config] public/event.json unreadable:', err?.message || err);
	}
	_file = { doc };
	_fileAt = now;
	return doc;
}

/**
 * Re-read the override from app_settings. Never rejects: a failure is logged and
 * the previous override stays in force. Resolves to the override row in force.
 */
export function refreshEventOverride() {
	if (_inFlight) return _inFlight;
	_inFlight = Promise.resolve()
		.then(() => _loader())
		.then((row) => { _override = row; })
		.catch((err) => {
			console.warn('[event-config] override read failed, keeping the last good one:', err?.message || err);
		})
		.finally(() => {
			_overrideAt = Date.now();
			_inFlight = null;
		})
		.then(() => _override);
	return _inFlight;
}

/** The effective event document: the static file with a valid live override merged over it. */
export function effectiveEventDoc(now = Date.now()) {
	if (now - _overrideAt >= OVERRIDE_TTL_MS) refreshEventOverride();
	const doc = staticEventDoc(now);
	const { doc: effective, applied, reason } = applyOverride(doc, _override);
	return { doc: effective, override: _override, applied, ignoredReason: applied ? null : reason || null };
}

/**
 * The current event window ({ id, name, startsAt, endsAt }) or null when the config
 * is absent or malformed. The file is cached a minute and the override at most 15
 * seconds old, so an operator change lands everywhere within about a minute.
 */
export function eventConfig(now = Date.now()) {
	return parseEventWindow(effectiveEventDoc(now).doc);
}

/** Drop the cached override so the next read re-fetches it (called after an operator write). */
export function invalidateEventOverride() {
	_override = null;
	_overrideAt = 0;
}

/** Test seam: replace the override source and reset every cache. */
export function __resetEventConfig(loader = loadOverrideRow, staticDoc) {
	_file = staticDoc === undefined ? null : { doc: staticDoc };
	_fileAt = staticDoc === undefined ? 0 : Number.MAX_SAFE_INTEGER;
	_override = null; _overrideAt = 0; _inFlight = null; _loader = loader;
}

/** Is the configured event running right now? */
export function eventLiveNow(now = Date.now()) {
	return isEventLive(eventConfig(now), now);
}

/** The configured event's id, or null. The leaderboard is keyed by it. */
export function eventId(now = Date.now()) {
	return eventConfig(now)?.id || null;
}
