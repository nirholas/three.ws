// @vitest-environment jsdom
//
// Forge wait estimates (src/forge-eta.js). The estimate range must come from the
// measured lane timings that /api/nvidia/stats publishes, fall back sanely when
// that request fails or the lane has too little history, and never move on its
// own: every phrase is a pure read of (elapsed seconds, timing).

import { describe, it, expect, vi } from 'vitest';
import {
	MIN_SAMPLE,
	pickLaneTiming,
	formatDuration,
	formatClock,
	describeRange,
	describeWait,
	announceFor,
	createLaneTimings,
} from '../src/forge-eta.js';

// The shape /api/nvidia/stats returns for the lanes that run GPU jobs. The
// numbers are the production figures read on 2026-11-27.
const STATS = {
	lanes: [
		{ id: 'nim_chat', jobs: null },
		{
			id: 'trellis_selfhost',
			jobs: {
				'7d': { done: 913, failed: 41, p50_ms: 149233, p95_ms: 447907 },
				'30d': { done: 5284, failed: 2560, p50_ms: 170282, p95_ms: 1368187 },
			},
		},
		{
			id: 'hunyuan3d',
			jobs: {
				'7d': { done: 0, failed: 0, note: 'no jobs in the last 7 days' },
				'30d': { done: 8, failed: 0, p50_ms: 57561, p95_ms: 140776 },
			},
		},
		{
			id: 'pixal3d',
			jobs: {
				'7d': { done: 3, failed: 8, p50_ms: 984785, p95_ms: 1029770 },
				'30d': { done: 3, failed: 92, p50_ms: 984785, p95_ms: 1029770 },
			},
		},
	],
};

describe('pickLaneTiming', () => {
	it('reads the typical and slow durations of the lane from the stats, not from the catalog', () => {
		const t = pickLaneTiming(STATS, 'trellis_selfhost');
		expect(t).toMatchObject({ laneId: 'trellis_selfhost', window: '7d', jobs: 913, typicalS: 149, slowS: 448 });
	});

	it('falls back to the 30 day window when the week has too few finished jobs', () => {
		const t = pickLaneTiming(STATS, 'hunyuan3d');
		expect(t).toMatchObject({ window: '30d', jobs: 8, typicalS: 58, slowS: 141 });
	});

	it('quotes nothing for a lane whose history is thinner than the minimum sample', () => {
		expect(MIN_SAMPLE).toBeGreaterThan(3);
		expect(pickLaneTiming(STATS, 'pixal3d')).toBeNull();
	});

	it('returns null for a lane the stats do not list, a lane with no job stats, or no stats at all', () => {
		expect(pickLaneTiming(STATS, 'meshy')).toBeNull();
		expect(pickLaneTiming(STATS, 'nim_chat')).toBeNull();
		expect(pickLaneTiming(null, 'trellis_selfhost')).toBeNull();
		expect(pickLaneTiming({}, 'trellis_selfhost')).toBeNull();
	});

	it('keeps the slow mark above the typical time when the two percentiles coincide', () => {
		const flat = { lanes: [{ id: 'x', jobs: { '7d': { done: 10, p50_ms: 100000, p95_ms: 100000 } } }] };
		const t = pickLaneTiming(flat, 'x');
		expect(t.slowS).toBeGreaterThan(t.typicalS);
	});
});

describe('formatting', () => {
	it('rounds a duration to something a person would say', () => {
		expect(formatDuration(45)).toBe('45 s');
		expect(formatDuration(90)).toBe('1 min 30 s');
		expect(formatDuration(149)).toBe('2 min 30 s');
		expect(formatDuration(448)).toBe('7 min 30 s');
		expect(formatDuration(510)).toBe('8 min 30 s');
		expect(formatDuration(600)).toBe('10 min');
	});

	it('formats the elapsed clock as m:ss', () => {
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(75)).toBe('1:15');
		expect(formatClock(3725)).toBe('62:05');
	});
});

describe('describeRange (the line under the Generate button)', () => {
	it('states a measured range as a range', () => {
		const text = describeRange({ timing: pickLaneTiming(STATS, 'trellis_selfhost'), catalogEtaS: 60 });
		expect(text).toBe('typically 2 min 30 s, slower runs up to 7 min 30 s');
	});

	it('uses the catalog figure, worded as an estimate, when nothing is measured', () => {
		expect(describeRange({ timing: null, catalogEtaS: 60 })).toBe('estimated 1 min');
	});

	it('says nothing rather than invent a number', () => {
		expect(describeRange({ timing: null, catalogEtaS: null })).toBe('');
	});
});

describe('describeWait', () => {
	const timing = pickLaneTiming(STATS, 'trellis_selfhost');

	it('gives the measured range while the job is inside the typical time', () => {
		const w = describeWait({ elapsedS: 20, timing });
		expect(w).toMatchObject({ phase: 'typical', over: false });
		expect(w.text).toContain('2 min 30 s');
		expect(w.text).toContain('7 min 30 s');
		expect(w.text).not.toMatch(/left/);
	});

	it('says a job past the typical time is still inside the slow range, and still running', () => {
		const w = describeWait({ elapsedS: 200, timing });
		expect(w).toMatchObject({ phase: 'slower', over: true });
		expect(w.text).toContain('Still running');
	});

	it('says a job past the slow mark is slower than the recent runs, and still running', () => {
		const w = describeWait({ elapsedS: 500, timing });
		expect(w).toMatchObject({ phase: 'slowest', over: true });
		expect(w.text).toContain('Slower than 19 in 20 recent runs');
		expect(w.text).toContain('Still running');
	});

	it('mentions the cold start allowance only while the lane is booting', () => {
		expect(describeWait({ elapsedS: 5, timing, cold: true, coldAllowanceS: 510 }).text).toContain('up to 8 min 30 s');
		expect(describeWait({ elapsedS: 5, timing, cold: false, coldAllowanceS: 510 }).text).not.toContain('cold start');
	});

	it('falls back to the catalog estimate, worded as one, then admits it ran past it', () => {
		const early = describeWait({ elapsedS: 10, timing: null, catalogEtaS: 60 });
		expect(early).toMatchObject({ phase: 'typical', over: false });
		expect(early.text).toContain('Estimated 1 min');
		const late = describeWait({ elapsedS: 120, timing: null, catalogEtaS: 60 });
		expect(late).toMatchObject({ phase: 'slowest', over: true });
		expect(late.text).toContain('Still running');
	});

	it('is silent when the lane has no known duration', () => {
		expect(describeWait({ elapsedS: 400, timing: null, catalogEtaS: null })).toEqual({ phase: 'unknown', over: false, text: '' });
	});

	it('is a pure function of elapsed time: the same inputs give the same answer, nothing advances on a clock', () => {
		vi.useFakeTimers();
		const a = describeWait({ elapsedS: 100, timing });
		vi.advanceTimersByTime(600000);
		expect(describeWait({ elapsedS: 100, timing })).toEqual(a);
		vi.useRealTimers();
	});
});

describe('announceFor', () => {
	it('speaks only when the phase changes into a slower one', () => {
		expect(announceFor('typical', 'typical')).toBe('');
		expect(announceFor('slower', 'typical')).toContain('longer than typical');
		expect(announceFor('slower', 'slower')).toBe('');
		expect(announceFor('slowest', 'slower')).toContain('longer than most runs');
		expect(announceFor('typical', undefined)).toBe('');
	});
});

describe('createLaneTimings', () => {
	const ok = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

	it('has no timing until the stats arrive, then answers per lane', async () => {
		const fetchImpl = ok(STATS);
		const timings = createLaneTimings({ fetchImpl });
		expect(timings.timing('trellis_selfhost')).toBeNull();
		await timings.load();
		expect(timings.timing('trellis_selfhost').typicalS).toBe(149);
		expect(fetchImpl).toHaveBeenCalledWith('/api/nvidia/stats', expect.objectContaining({ headers: { accept: 'application/json' } }));
	});

	it('asks once for concurrent callers and reuses the answer while it is fresh', async () => {
		const fetchImpl = ok(STATS);
		let t = 1000;
		const timings = createLaneTimings({ fetchImpl, now: () => t });
		await Promise.all([timings.load(), timings.load(), timings.load()]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		t += 60000;
		await timings.load();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		t += 6 * 60 * 1000;
		await timings.load();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('falls back to no timing when the stats request fails, and does not hammer a broken endpoint', async () => {
		const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
		let t = 1000;
		const timings = createLaneTimings({ fetchImpl, now: () => t });
		await timings.load();
		expect(timings.timing('trellis_selfhost')).toBeNull();
		await timings.load();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		t += 31000;
		await timings.load();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		// With no timing, the wait still reads from the catalog estimate.
		const w = describeWait({ elapsedS: 10, timing: timings.timing('trellis_selfhost'), catalogEtaS: 60 });
		expect(w.text).toContain('Estimated 1 min');
	});

	it('falls back on a network error and on a payload that is not lane stats', async () => {
		const down = createLaneTimings({ fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
		await expect(down.load()).resolves.toBeNull();
		const junk = createLaneTimings({ fetchImpl: ok({ hello: 'world' }) });
		await junk.load();
		expect(junk.timing('trellis_selfhost')).toBeNull();
	});

	it('keeps the older stats when a refresh fails, and tells listeners when fresh stats land', async () => {
		let t = 1000;
		const fetchImpl = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => STATS })
			.mockRejectedValueOnce(new TypeError('offline'));
		const timings = createLaneTimings({ fetchImpl, now: () => t });
		const seen = vi.fn();
		timings.onChange(seen);
		await timings.load();
		expect(seen).toHaveBeenCalledTimes(1);
		t += 6 * 60 * 1000;
		await timings.load();
		expect(timings.timing('trellis_selfhost').typicalS).toBe(149);
		expect(seen).toHaveBeenCalledTimes(1);
	});
});
