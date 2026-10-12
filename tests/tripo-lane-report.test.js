// Tripo-lane report (work order 084-partners-01-tripo-v3-house-lane.md, task
// 6): completion rate and median latency by day, scoped to backend = 'tripo'.
// summarizeTripoLaneDays is pure (tested without a database); gatherTripoLaneReport
// is covered against a mocked sql so the query's day/done/failed/median shape
// is pinned without a live Postgres instance.

import { describe, it, expect, vi } from 'vitest';
import {
	clampTripoLaneDays,
	summarizeTripoLaneDays,
	gatherTripoLaneReport,
	TRIPO_LANE_DEFAULT_DAYS,
} from '../api/_lib/tripo-lane-report.js';

describe('clampTripoLaneDays', () => {
	it('defaults an absent or empty value', () => {
		expect(clampTripoLaneDays(undefined)).toBe(TRIPO_LANE_DEFAULT_DAYS);
		expect(clampTripoLaneDays('')).toBe(TRIPO_LANE_DEFAULT_DAYS);
	});

	it('clamps out-of-range and non-numeric values', () => {
		expect(clampTripoLaneDays(0)).toBe(1);
		expect(clampTripoLaneDays(-5)).toBe(1);
		expect(clampTripoLaneDays(10_000)).toBe(365);
		expect(clampTripoLaneDays('not a number')).toBe(TRIPO_LANE_DEFAULT_DAYS);
	});

	it('accepts a valid whole number of days', () => {
		expect(clampTripoLaneDays(7)).toBe(7);
		expect(clampTripoLaneDays('14')).toBe(14);
	});
});

describe('summarizeTripoLaneDays', () => {
	it('computes completion rate from done/failed and leaves in-flight out of it', () => {
		const [row] = summarizeTripoLaneDays([
			{ day: '2026-10-10', total: 10, done: 7, failed: 1, median_seconds: 42.4 },
		]);
		expect(row).toMatchObject({
			day: '2026-10-10',
			total: 10,
			done: 7,
			failed: 1,
			in_flight: 2,
			completion_rate: 0.875,
			median_latency_seconds: 42.4,
		});
	});

	it('reports null completion rate and latency for a day with no terminal rows', () => {
		const [row] = summarizeTripoLaneDays([{ day: '2026-10-11', total: 3, done: 0, failed: 0, median_seconds: null }]);
		expect(row.completion_rate).toBeNull();
		expect(row.median_latency_seconds).toBeNull();
		expect(row.in_flight).toBe(3);
	});

	it('normalizes a Date-typed day to YYYY-MM-DD', () => {
		const [row] = summarizeTripoLaneDays([
			{ day: new Date('2026-10-12T00:00:00Z'), total: 1, done: 1, failed: 0, median_seconds: 10 },
		]);
		expect(row.day).toBe('2026-10-12');
	});
});

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(),
}));

describe('gatherTripoLaneReport', () => {
	it('summarizes multi-day rows and fails open on a query error', async () => {
		const { sql } = await import('../api/_lib/db.js');
		sql.mockResolvedValueOnce([
			{ day: new Date('2026-10-11T00:00:00Z'), total: 5, done: 4, failed: 1, median_seconds: 30 },
			{ day: new Date('2026-10-10T00:00:00Z'), total: 8, done: 8, failed: 0, median_seconds: 50 },
		]);
		const report = await gatherTripoLaneReport({ days: 7 });
		expect(report.ok).toBe(true);
		expect(report.window_days).toBe(7);
		expect(report.total).toBe(13);
		expect(report.done).toBe(12);
		expect(report.failed).toBe(1);
		expect(report.completion_rate).toBeCloseTo(12 / 13, 3);
		expect(report.by_day).toHaveLength(2);

		sql.mockRejectedValueOnce(new Error('relation forge_creations does not exist'));
		const failed = await gatherTripoLaneReport({ days: 7 });
		expect(failed.ok).toBe(false);
		expect(failed.error).toMatch(/forge_creations/);
		expect(failed.by_day).toEqual([]);
	});

	it('answers an empty, ok report when there are no rows', async () => {
		const { sql } = await import('../api/_lib/db.js');
		sql.mockResolvedValueOnce([]);
		const report = await gatherTripoLaneReport({});
		expect(report.ok).toBe(true);
		expect(report.total).toBe(0);
		expect(report.completion_rate).toBeNull();
		expect(report.median_latency_seconds).toBeNull();
		expect(report.by_day).toEqual([]);
	});
});
