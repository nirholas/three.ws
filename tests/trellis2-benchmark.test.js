// The TRELLIS.2 lab's benchmark math and the worker-stats persistence it reads:
// nearest-rank percentiles return real samples, unrecorded fields say "not
// measured" instead of zero, presets group by the resolution the worker
// reported, and only finite worker numbers ever reach the database.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(), isDbUnavailableError: () => false }));

import { percentile, summarize, buildReport } from '../scripts/trellis2-benchmark.mjs';
import { workerStatsColumns } from '../api/_lib/forge-store.js';

const WINDOW = { from: '2026-10-12T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z', days: 30 };

describe('percentile (nearest rank)', () => {
	it('returns an actual sample', () => {
		const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		expect(percentile(s, 50)).toBe(5);
		expect(percentile(s, 90)).toBe(9);
		expect(percentile(s, 99)).toBe(10);
	});
	it('is null for no samples and the sample for one', () => {
		expect(percentile([], 50)).toBeNull();
		expect(percentile([42], 99)).toBe(42);
	});
});

describe('summarize', () => {
	it('counts outcomes and excludes in-flight rows from the failure rate', () => {
		const s = summarize([
			{ status: 'done', e2e_s: 10, size_bytes: 100 },
			{ status: 'done', e2e_s: 20, size_bytes: 300 },
			{ status: 'failed' },
			{ status: 'generating' },
		]);
		expect(s).toMatchObject({ rows: 4, done: 2, failed: 1, in_flight: 1 });
		expect(s.failure_rate).toBeCloseTo(1 / 3, 4);
		expect(s.e2e_seconds).toEqual({ n: 2, p50: 10, p90: 20, p99: 20 });
		expect(s.output_bytes).toEqual({ n: 2, p50: 100, p90: 300, p99: 300 });
	});
	it('reports unrecorded queue and GPU time as not measured, never zero', () => {
		const s = summarize([{ status: 'done', e2e_s: 5, size_bytes: 1 }]);
		expect(s.queue_seconds).toBe('not measured');
		expect(s.gpu_seconds).toBe('not measured');
	});
	it('does not count a done row without completed_at as a time sample', () => {
		const s = summarize([{ status: 'done', e2e_s: null, size_bytes: 9 }]);
		expect(s.e2e_seconds).toBe('not measured');
		expect(s.e2e_missing).toBe(1);
		expect(s.output_bytes.n).toBe(1);
	});
	it('converts worker milliseconds to seconds', () => {
		const s = summarize([{ status: 'done', e2e_s: 50, queue_ms: 1500, gpu_ms: 42_250 }]);
		expect(s.queue_seconds).toEqual({ n: 1, p50: 1.5, p90: 1.5, p99: 1.5 });
		expect(s.gpu_seconds.p50).toBe(42.3);
	});
	it('has no failure rate when nothing settled', () => {
		expect(summarize([{ status: 'generating' }]).failure_rate).toBe('not measured');
	});
});

describe('buildReport', () => {
	it('records the window and row counts, and keys presets by reported resolution', () => {
		const rows = [
			{ backend: 'trellis2', tier: 'draft', status: 'done', e2e_s: 40, voxel_resolution: 512, gpu_ms: 30_000 },
			{ backend: 'trellis2', tier: 'standard', status: 'done', e2e_s: 140, voxel_resolution: 1536, gpu_ms: 120_000 },
			{ backend: 'trellis_selfhost', tier: 'standard', status: 'failed' },
			{ backend: null, tier: null, status: 'done', e2e_s: 3 },
		];
		const r = buildReport(rows, WINDOW);
		expect(r.window).toEqual(WINDOW);
		expect(r.row_count).toBe(4);
		expect(r.trellis2_rows).toBe(2);
		expect(r.lanes.map((l) => l.lane).sort()).toEqual(['trellis2', 'trellis_selfhost', 'unrecorded']);
		expect(r.presets.fast_draft.e2e_seconds.p50).toBe(40);
		expect(r.presets.maximum_detail.gpu_seconds.p50).toBe(120);
		expect(r.presets.balanced).toMatchObject({ resolution: 1024, rows: 0, e2e_seconds: 'not measured' });
	});
	it('says not measured for every preset when the lane has no rows', () => {
		const r = buildReport([], WINDOW);
		expect(r.trellis2_rows).toBe(0);
		for (const p of Object.values(r.presets)) expect(p.e2e_seconds).toBe('not measured');
	});
});

describe('workerStatsColumns', () => {
	it('maps the worker reply onto the three columns', () => {
		expect(workerStatsColumns({ queue_ms: 12.4, gpu_ms: 61_000, resolution: 1024, resolution_served: 1536 }))
			.toEqual({ voxel_resolution: 1536, queue_ms: 12, gpu_ms: 61_000 });
	});
	it('leaves unreported values null and writes nothing when none are reported', () => {
		expect(workerStatsColumns({ gpu_ms: 5 })).toEqual({ voxel_resolution: null, queue_ms: null, gpu_ms: 5 });
		expect(workerStatsColumns({ params: { seed: 1 } })).toBeNull();
		expect(workerStatsColumns(null)).toBeNull();
	});
	it('drops non-finite and negative values', () => {
		expect(workerStatsColumns({ queue_ms: -1, gpu_ms: Number.NaN, resolution: '1024' })).toBeNull();
	});
});
