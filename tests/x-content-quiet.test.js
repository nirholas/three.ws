import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { QUIET_ALERT_HOURS, quietHours, runTick } from '../api/_lib/x-content/runner.js';
import { memoryStore } from '../api/_lib/x-content/state.js';
import { previewClient } from '../api/_lib/x-content/publisher.js';

const HOUR = 3_600_000;
const now = Date.parse('2026-11-15T15:00:00Z');
const at = (hoursAgo) => new Date(now - hoursAgo * HOUR).toISOString();

describe('quiet account', () => {
	it('counts the hours since the last post or since posting was switched on, whichever is later', () => {
		expect(quietHours({ liveSince: at(72), published: [{ publishedAt: at(30) }, { publishedAt: at(50) }] }, now)).toBe(30);
		expect(quietHours({ liveSince: at(5), published: [{ publishedAt: at(300) }] }, now)).toBe(5);
		expect(quietHours({ liveSince: at(40), published: [] }, now)).toBe(40);
	});

	it('does not count time while posting was off', () => {
		expect(quietHours({ published: [{ publishedAt: at(300) }] }, now)).toBe(0);
	});

	it('raises a critical alert once a day when a live account has posted nothing for a day, even when the tick throws', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'x-quiet-'));
		mkdirSync(join(dir, 'data/x-content'), { recursive: true });
		writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ account: 'trythreews', cadence: { slots: [{ tier: 2, at: '12:00' }] }, items: [] }));
		const store = memoryStore();
		await store.save({ liveSince: at(72), published: [{ id: 'old', publishedAt: at(QUIET_ALERT_HOURS + 6) }] });
		const result = await runTick({ root: dir, store, dryRun: false, now, env: {}, client: previewClient(), checks: async () => [], outcomes: null });
		expect(result.quiet).toBe(QUIET_ALERT_HOURS + 6);
		expect((await store.load()).quietAlertedOn).toBe('2026-11-15');
		const again = await runTick({ root: dir, store, dryRun: false, now: now + HOUR, env: {}, client: previewClient(), checks: async () => [], outcomes: null });
		expect(again.quiet).toBeNull();
	});

	it('starts the clock on the first live tick and stops it in preview mode', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'x-quiet-'));
		mkdirSync(join(dir, 'data/x-content'), { recursive: true });
		writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ account: 'trythreews', cadence: { slots: [{ tier: 2, at: '12:00' }] }, items: [] }));
		const store = memoryStore();
		await store.save({ published: [{ id: 'old', publishedAt: at(300) }] });
		const first = await runTick({ root: dir, store, dryRun: false, now, env: {}, client: previewClient(), checks: async () => [], outcomes: null });
		expect(first.quiet).toBeNull();
		expect((await store.load()).liveSince).toBe(new Date(now).toISOString());
		await runTick({ root: dir, store, dryRun: true, now, env: {}, outcomes: null });
		expect((await store.load()).liveSince).toBeUndefined();
	});
});
