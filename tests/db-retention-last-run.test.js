// The db-retention last-run summary feeds the database_storage health sensor.
// Production showed "0 archived, 0 pruned" with the DB at 82% of its mark and
// nothing said WHY: a table skipped on the time budget, an archive outage and a
// table with nothing past its window all looked identical. The summary must keep
// the per-table skip reasons, and the sensor must surface them.
import { describe, it, expect } from 'vitest';
import { summarizeArchiveRun } from '../api/cron/db-retention.js';
import { classifyDatabaseStorage } from '../api/_lib/ops/database-storage-health.js';

describe('summarizeArchiveRun', () => {
	it('totals rows and separates ran, idle and skipped tables', () => {
		const s = summarizeArchiveRun([
			{ table: 'a', archived: 100, deleted: 100, skipped: null },
			{ table: 'b', archived: 0, deleted: 0, skipped: null },
			{ table: 'c', skipped: 'time_budget' },
			{ table: 'd', skipped: 'gcs upload 403: denied' },
		]);
		expect(s.archived).toBe(100);
		expect(s.deleted).toBe(100);
		expect(s.skipped).toEqual([
			{ table: 'c', reason: 'time_budget' },
			{ table: 'd', reason: 'gcs upload 403: denied' },
		]);
		expect(s.idle).toEqual(['b']);
	});

	it('flags starvation when every table was skipped on the time budget', () => {
		const s = summarizeArchiveRun([
			{ table: 'a', skipped: 'time_budget' },
			{ table: 'b', skipped: 'time_budget' },
		]);
		expect(s.starved).toBe(true);
		expect(summarizeArchiveRun([{ table: 'a', archived: 0, deleted: 0 }]).starved).toBe(false);
		expect(summarizeArchiveRun([]).starved).toBe(false);
	});
});

describe('classifyDatabaseStorage last-run detail', () => {
	const base = { sizeMb: 17219, markMb: 20992, topTables: [{ table: 'x', mb: 1 }] };
	it('names the skipped tables when nothing was archived', () => {
		const r = classifyDatabaseStorage({
			...base,
			lastRun: {
				at: '2026-11-25T16:01:19.299Z',
				size_before_mb: 17217,
				size_after_mb: 17218,
				archived: 0,
				deleted: 0,
				skipped: [{ table: 'agent_onchain_events', reason: 'time_budget' }],
				idle: [],
			},
		});
		expect(r.detail).toContain('agent_onchain_events (time_budget)');
	});

	it('says the tables were idle when none were skipped', () => {
		const r = classifyDatabaseStorage({
			...base,
			lastRun: { at: 't', size_before_mb: 1, size_after_mb: 1, archived: 0, deleted: 0, skipped: [], idle: ['a', 'b'] },
		});
		expect(r.detail).toContain('nothing past its window');
	});
});
