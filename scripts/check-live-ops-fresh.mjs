#!/usr/bin/env node
// Assert docs/event-readiness/LIVE-OPS.md describes the event that is actually
// configured and the build that is actually serving.
//
// The live-ops sheet is the one page an operator keeps open during an event:
// rollback revisions, scale values, health commands, the release SHA. It is
// written by hand before each event, and the failure it guards against is quiet:
// the sheet from the previous event is still in the repo, still looks
// authoritative, and points the operator at the wrong revisions and the wrong
// window. That happened once already (a sheet for "Community Day" survived into
// the next meetup's prep).
//
// The sheet carries three machine-read lines near the top:
//
//   **Event id:** `three-community-meetup-3`
//   **Starts:** `2026-11-06T16:00:00Z`
//   **Live release:** `0a913e8a7` on revision `three-ws-api-00521-hxr`
//
// Failures (exit 1):
//   1. Any of the three lines is missing or malformed.
//   2. The event id or the start instant disagrees with public/event.json.
//   3. The sheet's H1 does not carry the event name from public/event.json.
//   4. The sheet names some other event id anywhere (a leftover line).
//   5. The release SHA is not the commit /api/version reports. After every deploy
//      the operator updates the line; until then the sheet is stale on purpose.
//
// Between events (public/event.json carries the no-event sentinel) there is
// nothing to be fresh against, so the check passes with a note.
//
// Run: node scripts/check-live-ops-fresh.mjs        (wired as `npm run check:live-ops`)
//      --offline            skip the /api/version comparison
//      --server <origin>    read /api/version from another origin (default https://three.ws)
//      --version-sha <sha>  compare against this commit instead of fetching
//      --sheet <path>       check another file (default docs/event-readiness/LIVE-OPS.md)
//      --event <path>       compare against another event config (default public/event.json)

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNoEventSentinel } from './check-event-window.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHEET_PATH = path.join(root, 'docs/event-readiness/LIVE-OPS.md');
export const EVENT_PATH = path.join(root, 'public/event.json');

const FIELD = {
	id: /^\*\*Event id:\*\*\s*`([^`]+)`/m,
	startsAt: /^\*\*Starts:\*\*\s*`([^`]+)`/m,
	sha: /^\*\*Live release:\*\*\s*`([^`]+)`/m,
};
// Event ids on this platform are kebab-case slugs that start with `three-`
// (three-first-meetup, three-community-day, three-community-meetup-3). Any such
// slug in the sheet that is not the configured id is a leftover from another event.
const EVENT_ID_TOKEN = /\bthree-(?:community|first|holders)[a-z0-9-]*\b/g;

/** Pull the machine-read fields and the H1 out of the sheet's markdown. */
export function parseLiveOps(md) {
	const pick = (re) => (md.match(re)?.[1] ?? '').trim() || null;
	const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? '').trim() || null;
	const eventIds = [...new Set(md.match(EVENT_ID_TOKEN) ?? [])];
	return { title, id: pick(FIELD.id), startsAt: pick(FIELD.startsAt), sha: pick(FIELD.sha), eventIds };
}

/**
 * Compare a parsed sheet against the event config and, when known, the live commit.
 * Returns the list of human-readable failures (empty = fresh).
 */
export function compareLiveOps(sheet, event, liveCommit = null) {
	const failures = [];
	if (!sheet.id) failures.push('missing the "**Event id:** `<id>`" line');
	else if (sheet.id !== event.id) failures.push(`names event id "${sheet.id}" but public/event.json is "${event.id}"`);

	if (!sheet.startsAt) failures.push('missing the "**Starts:** `<ISO instant>`" line');
	else {
		const a = Date.parse(sheet.startsAt);
		const b = Date.parse(event.startsAt);
		if (!Number.isFinite(a)) failures.push(`start "${sheet.startsAt}" is not an ISO-8601 instant`);
		else if (a !== b) failures.push(`says the event starts ${sheet.startsAt} but public/event.json says ${event.startsAt}`);
	}

	if (!sheet.title) failures.push('has no "# " title line');
	else if (event.name && !sheet.title.includes(event.name)) failures.push(`title "${sheet.title}" does not name the configured event "${event.name}"`);

	for (const other of sheet.eventIds) {
		if (other !== event.id) failures.push(`mentions another event id "${other}" (a leftover from a previous sheet)`);
	}

	if (!sheet.sha) failures.push('missing the "**Live release:** `<sha>`" line');
	else if (!/^[0-9a-f]{7,40}$/i.test(sheet.sha)) failures.push(`release "${sheet.sha}" is not a git SHA`);
	else if (liveCommit && !liveCommit.toLowerCase().startsWith(sheet.sha.toLowerCase())) {
		failures.push(`records release ${sheet.sha} but production serves ${liveCommit.slice(0, 9)}; update the release line (and the rollback revisions) after the deploy`);
	}
	return failures;
}

async function fetchLiveCommit(server) {
	const res = await fetch(`${server}/api/version`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`/api/version answered ${res.status}`);
	const body = await res.json();
	if (typeof body?.commit !== 'string' || !body.commit) throw new Error('/api/version carried no commit');
	return body.commit;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const arg = (name) => {
		const i = process.argv.indexOf(name);
		return i >= 0 ? process.argv[i + 1] : null;
	};
	const sheetPath = path.resolve(arg('--sheet') ?? SHEET_PATH);
	const eventPath = path.resolve(arg('--event') ?? EVENT_PATH);
	const rel = (p) => path.relative(root, p) || p;

	let event;
	try {
		event = JSON.parse(readFileSync(eventPath, 'utf8'));
	} catch (err) {
		console.error(`[check-live-ops] cannot read ${rel(eventPath)}: ${err?.message || err}. Run npm run check:event first.`);
		process.exit(1);
	}
	if (isNoEventSentinel(event)) {
		console.log('[check-live-ops] OK: no event is configured, so the live-ops sheet has nothing to be fresh against');
		process.exit(0);
	}
	if (!existsSync(sheetPath)) {
		console.error(`[check-live-ops] ${rel(sheetPath)} is missing but event "${event.id}" is configured. Write the sheet before the event.`);
		process.exit(1);
	}

	const sheet = parseLiveOps(readFileSync(sheetPath, 'utf8'));
	let liveCommit = arg('--version-sha');
	if (!liveCommit && !process.argv.includes('--offline')) {
		const server = (arg('--server') ?? 'https://three.ws').replace(/\/$/, '');
		try {
			liveCommit = await fetchLiveCommit(server);
		} catch (err) {
			// Unreachable is not a disagreement: say so loudly and judge the rest.
			console.warn(`[check-live-ops] WARNING: could not read ${server}/api/version (${err?.message || err}); release SHA not compared`);
		}
	}

	const failures = compareLiveOps(sheet, event, liveCommit);
	if (failures.length) {
		console.error(`[check-live-ops] ${rel(sheetPath)} is stale (${failures.length} problem(s)):`);
		for (const f of failures) console.error(`[check-live-ops]   ${f}`);
		process.exit(1);
	}
	const shaNote = liveCommit ? `, release ${sheet.sha} is what production serves` : ', release SHA not compared';
	console.log(`[check-live-ops] OK: ${rel(sheetPath)} matches event "${event.id}" starting ${event.startsAt}${shaNote}`);
}
