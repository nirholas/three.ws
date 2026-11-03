// The live override for the platform event's config.
//
// public/event.json is baked into the container image, so changing the window
// mid-event used to mean a full production deploy. This module holds the one
// small, validated, operator-writable layer on top of that file: a JSON row in
// `app_settings` (key `event_override`) that the API merges over the static file.
// Every other reader (the browser, the game server) consumes the merged result
// through GET /api/event-config, so there is still exactly one place the window
// is computed.
//
// What an override can do, and nothing more:
//   * patch startsAt, endsAt, name, tagline, link of the file's current event
//   * end the event now (endsAt = now), or cancel one that has not started
//     (the explicit no-event document)
// It can never change the event `id`, so the leaderboard (keyed by id) is never
// orphaned, and it is bound to the id of the file it was written against
// (`base_id`): after the next deploy ships a different event the stale override
// is ignored instead of bending the new event.
//
// Every write is validated with validateEventConfig, the same rules that gate
// the deploy. A bad stored row is ignored at read time (the static file wins).

import { validateEventConfig, NO_EVENT_DOC, isNoEventSentinel, isoOf } from '../../scripts/check-event-window.mjs';
import { parseEventWindow } from '../../multiplayer/src/event-window.js';

export const OVERRIDE_KEY = 'event_override';

const PATCH_FIELDS = ['startsAt', 'endsAt', 'name', 'tagline', 'link'];
const TEXT_LIMITS = { name: 120, tagline: 280, link: 500 };

/**
 * Failures the merged document adds on top of the static file's own. Judged at
 * the event's start so an override that ends the event now is not rejected for
 * being "over", and with agenda-past-the-window notes dropped: shortening an
 * event deliberately leaves later beats unfired, which is the point.
 */
function newFailures(staticDoc, mergedDoc) {
	const judge = (doc) => {
		const win = parseEventWindow(doc);
		const at = win ? win.startsAt : Date.now();
		return validateEventConfig(doc, at).failures.filter((f) => !/past the \d+min window/.test(f));
	};
	const before = new Set(judge(staticDoc));
	return judge(mergedDoc).filter((f) => !before.has(f));
}

/** Copy the whitelisted, well-typed fields of a raw patch. Unknown keys are dropped. */
function cleanPatch(raw) {
	const out = {};
	const failures = [];
	for (const key of PATCH_FIELDS) {
		if (raw?.[key] === undefined) continue;
		const v = raw[key];
		if (key === 'startsAt' || key === 'endsAt') {
			if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) {
				failures.push(`${key} must be an ISO-8601 timestamp`);
				continue;
			}
			out[key] = isoOf(Date.parse(v));
		} else {
			if (typeof v !== 'string' || !v.trim()) {
				failures.push(`${key} must be a non-empty string`);
				continue;
			}
			if (v.length > TEXT_LIMITS[key]) {
				failures.push(`${key} is longer than ${TEXT_LIMITS[key]} characters`);
				continue;
			}
			if (key === 'link' && !/^(\/(?!\/)|https:\/\/)/.test(v)) {
				failures.push('link must be a site path starting with / or an https:// URL');
				continue;
			}
			out[key] = v.trim();
		}
	}
	return { patch: out, failures };
}

/**
 * Merge a stored override over the static document.
 *
 * @param {object|null} staticDoc  the parsed public/event.json
 * @param {object|null} stored     the app_settings value, or null
 * @returns {{ doc: object|null, applied: boolean, reason?: string }}
 *   `doc` is the effective document (the static one when the override is absent
 *   or unusable). `reason` says why an override was ignored.
 */
export function applyOverride(staticDoc, stored) {
	if (!stored || typeof stored !== 'object') return { doc: staticDoc, applied: false };
	if (!staticDoc || isNoEventSentinel(staticDoc)) {
		return { doc: staticDoc, applied: false, reason: 'no event in the static file to override' };
	}
	if (stored.base_id !== staticDoc.id) {
		return { doc: staticDoc, applied: false, reason: 'override was written for a different event' };
	}
	if (stored.cancelled === true) return { doc: { ...NO_EVENT_DOC }, applied: true };

	const { patch, failures } = cleanPatch(stored.patch);
	if (failures.length || Object.keys(patch).length === 0) {
		return { doc: staticDoc, applied: false, reason: failures[0] || 'override carries no changes' };
	}
	const merged = { ...staticDoc, ...patch };
	const bad = newFailures(staticDoc, merged);
	if (bad.length) return { doc: staticDoc, applied: false, reason: bad[0] };
	return { doc: merged, applied: true };
}

/**
 * Turn an operator request into the value to store, or a refusal.
 *
 * @param {object} args
 * @param {object|null} args.staticDoc  the parsed public/event.json
 * @param {object|null} args.current    the override row now in force, or null
 * @param {object} args.input           { startsAt?, endsAt?, name?, tagline?, link? } | { end: true } | { clear: true }
 * @param {number} args.now
 * @returns {{ ok: true, clear: boolean, value: object|null, doc: object|null } | { ok: false, failures: string[] }}
 */
export function buildOverride({ staticDoc, current, input, now = Date.now() }) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return { ok: false, failures: ['request body must be a JSON object'] };
	}
	if (input.clear === true) return { ok: true, clear: true, value: null, doc: staticDoc };

	if (!staticDoc || isNoEventSentinel(staticDoc) || !staticDoc.id) {
		return { ok: false, failures: ['public/event.json carries no event, so there is nothing to override. Schedule one with npm run event:schedule'] };
	}

	const base = current && current.base_id === staticDoc.id && current.cancelled !== true ? cleanPatch(current.patch).patch : {};

	if (input.end === true) {
		const startsAt = Date.parse(base.startsAt || staticDoc.startsAt);
		if (now <= startsAt) {
			return { ok: true, clear: false, value: { base_id: staticDoc.id, cancelled: true }, doc: { ...NO_EVENT_DOC } };
		}
		const patch = { ...base, endsAt: isoOf(now) };
		const merged = { ...staticDoc, ...patch };
		const bad = newFailures(staticDoc, merged);
		if (bad.length) return { ok: false, failures: bad };
		return { ok: true, clear: false, value: { base_id: staticDoc.id, patch }, doc: merged };
	}

	const { patch: incoming, failures } = cleanPatch(input);
	if (failures.length) return { ok: false, failures };
	if (Object.keys(incoming).length === 0) {
		return { ok: false, failures: ['nothing to change: send startsAt, endsAt, name, tagline or link, or { end: true } or { clear: true }'] };
	}
	const patch = { ...base, ...incoming };
	const merged = { ...staticDoc, ...patch };
	const bad = newFailures(staticDoc, merged);
	if (bad.length) return { ok: false, failures: bad };
	return { ok: true, clear: false, value: { base_id: staticDoc.id, patch }, doc: merged };
}

async function getSql() {
	return (await import('./db.js')).sql;
}

/** The override row, or null when none is stored. Throws on a database error. */
export async function loadOverrideRow() {
	const sql = await getSql();
	const [row] = await sql`SELECT value, updated_at FROM app_settings WHERE key = ${OVERRIDE_KEY}`;
	if (!row) return null;
	return { ...row.value, updated_at: row.updated_at };
}

/** Persist an override value with who wrote it. */
export async function saveOverrideRow(value, actor) {
	const sql = await getSql();
	const stored = { ...value, updated_by: actor };
	await sql`
		INSERT INTO app_settings (key, value, updated_at)
		VALUES (${OVERRIDE_KEY}, ${JSON.stringify(stored)}::jsonb, now())
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
	`;
}

/** Remove the override so the static file governs again. */
export async function clearOverrideRow() {
	const sql = await getSql();
	await sql`DELETE FROM app_settings WHERE key = ${OVERRIDE_KEY}`;
}
