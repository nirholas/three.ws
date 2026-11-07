import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLiveOps, compareLiveOps, SHEET_PATH } from '../scripts/check-live-ops-fresh.mjs';
import { NO_EVENT_DOC } from '../scripts/check-event-window.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/check-live-ops-fresh.mjs', import.meta.url));

const EVENT = {
	id: 'three-community-meetup-3',
	name: '$THREE Community Meetup #3',
	startsAt: '2026-11-06T16:00:00Z',
	endsAt: '2026-11-06T17:00:00Z',
};

const SHEET = [
	'# LIVE-OPS: $THREE Community Meetup #3',
	'',
	'**Event id:** `three-community-meetup-3`',
	'**Starts:** `2026-11-06T16:00:00Z` (ends `2026-11-06T17:00:00Z`)',
	'**Live release:** `0a913e8a7` on revision `three-ws-api-00521-hxr`',
	'',
	'Rollback: gcloud run services update-traffic three-ws-api --to-revisions=three-ws-api-00521-hxr=100',
].join('\n');

const LIVE = '0a913e8a7b3dd4120459faaac21fd53379853c84';

function run(args) {
	return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('parseLiveOps', () => {
	it('reads the title, the three machine-read lines and every event-id token', () => {
		expect(parseLiveOps(SHEET)).toEqual({
			title: 'LIVE-OPS: $THREE Community Meetup #3',
			id: 'three-community-meetup-3',
			startsAt: '2026-11-06T16:00:00Z',
			sha: '0a913e8a7',
			eventIds: ['three-community-meetup-3'],
		});
	});

	it('does not mistake service names like three-ws-api for event ids', () => {
		expect(parseLiveOps('three-ws-api three-ws-multiplayer three-ws-redis-proxy').eventIds).toEqual([]);
	});

	it('reports absent lines as null rather than guessing', () => {
		const p = parseLiveOps('# Something\n\nno fields here');
		expect([p.id, p.startsAt, p.sha]).toEqual([null, null, null]);
	});
});

describe('compareLiveOps', () => {
	it('passes a sheet that matches the config and the live commit', () => {
		expect(compareLiveOps(parseLiveOps(SHEET), EVENT, LIVE)).toEqual([]);
	});

	it('fails a sheet whose event id was altered', () => {
		const f = compareLiveOps(parseLiveOps(SHEET.replace('`three-community-meetup-3`', '`three-community-meetup-2`')), EVENT, LIVE);
		expect(f.some((m) => m.includes('names event id "three-community-meetup-2"'))).toBe(true);
	});

	it('fails a sheet whose start time disagrees, comparing instants not strings', () => {
		expect(compareLiveOps(parseLiveOps(SHEET.replace('2026-11-06T16:00:00Z`', '2026-11-06T16:00:00.000Z`')), EVENT, LIVE)).toEqual([]);
		const f = compareLiveOps(parseLiveOps(SHEET.replace('`2026-11-06T16:00:00Z`', '`2026-11-06T17:00:00Z`')), EVENT, LIVE);
		expect(f.some((m) => m.includes('starts 2026-11-06T17:00:00Z'))).toBe(true);
	});

	it('fails a sheet recording a release that production no longer serves', () => {
		const f = compareLiveOps(parseLiveOps(SHEET), EVENT, 'ffffffffff00000000000000000000000000000');
		expect(f.some((m) => m.includes('production serves fffffffff'))).toBe(true);
	});

	it('skips only the SHA comparison when the live commit is unknown', () => {
		expect(compareLiveOps(parseLiveOps(SHEET), EVENT, null)).toEqual([]);
	});

	it('fails a previous event title and a leftover event id elsewhere in the sheet', () => {
		const stale = SHEET.replace('# LIVE-OPS: $THREE Community Meetup #3', '# LIVE-OPS: $THREE Community Day') + '\nOld window for three-community-day.';
		const f = compareLiveOps(parseLiveOps(stale), EVENT, LIVE);
		expect(f.some((m) => m.includes('does not name the configured event'))).toBe(true);
		expect(f.some((m) => m.includes('another event id "three-community-day"'))).toBe(true);
	});

	it('fails a sheet missing the machine-read lines', () => {
		expect(compareLiveOps(parseLiveOps('# LIVE-OPS: $THREE Community Meetup #3'), EVENT, LIVE)).toHaveLength(3);
	});
});

describe('check-live-ops-fresh CLI', () => {
	// Fixture files, not the committed config: public/event.json rests in the
	// no-event state between events, and these cases must hold either way.
	function fixtures(sheetText = SHEET) {
		const dir = mkdtempSync(path.join(tmpdir(), 'live-ops-'));
		const sheet = path.join(dir, 'LIVE-OPS.md');
		const event = path.join(dir, 'event.json');
		writeFileSync(sheet, sheetText);
		writeFileSync(event, JSON.stringify(EVENT));
		return { sheet, event };
	}

	it('exits 0 when the sheet matches the configured event', () => {
		const f = fixtures();
		const r = run(['--sheet', f.sheet, '--event', f.event, '--version-sha', LIVE]);
		expect(r.stderr).toBe('');
		expect(r.status).toBe(0);
		expect(r.stdout).toContain(`matches event "${EVENT.id}"`);
	});

	it('exits non-zero when the sheet carries an altered event id', () => {
		const f = fixtures(SHEET.replace(`\`${EVENT.id}\``, '`three-community-meetup-99`'));
		const r = run(['--sheet', f.sheet, '--event', f.event, '--version-sha', LIVE]);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('names event id "three-community-meetup-99"');
	});

	it('exits 0 on the committed sheet against the committed config', () => {
		const r = run(['--version-sha', parseLiveOps(readFileSync(SHEET_PATH, 'utf8')).sha]);
		expect(r.stderr).toBe('');
		expect(r.status).toBe(0);
	});

	it('exits 0 with a note between events', () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'live-ops-'));
		const none = path.join(dir, 'event.json');
		writeFileSync(none, JSON.stringify(NO_EVENT_DOC));
		const r = run(['--event', none, '--offline']);
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('no event is configured');
	});
});
