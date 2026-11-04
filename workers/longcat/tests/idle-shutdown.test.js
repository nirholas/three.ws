import { describe, it, expect } from 'vitest';
import { decide, appendSample, sampleFromHealth, DEFAULTS } from '../scripts/idle-shutdown.mjs';

const MIN = 60_000;
const BOOT = Date.UTC(2026, 10, 4, 12, 0, 0);

// A recorded task log: one sample a minute from the worker's /health.
function recorded(rows) {
	return rows.map(([minute, activeJobs, reachable = true]) => ({ t: BOOT + minute * MIN, reachable, activeJobs }));
}

describe('idle shutdown decision', () => {
	it('holds the host up during the boot grace window even with no jobs', () => {
		const log = recorded([[1, 0], [5, 0], [10, 0]]);
		const v = decide({ log, bootAt: BOOT, now: BOOT + 10 * MIN });
		expect(v).toMatchObject({ action: 'keep', reason: 'boot_grace' });
	});

	it('never shuts down while a job is active', () => {
		const log = recorded([[16, 1], [60, 1], [120, 2]]);
		const v = decide({ log, bootAt: BOOT, now: BOOT + 120 * MIN });
		expect(v).toMatchObject({ action: 'keep', reason: 'job_active' });
	});

	it('keeps the host until the idle window has fully elapsed since the last busy sample', () => {
		const log = recorded([[20, 1], [30, 1], [31, 0], [45, 0]]);
		const v = decide({ log, bootAt: BOOT, now: BOOT + 45 * MIN });
		expect(v.action).toBe('keep');
		expect(v.reason).toBe('recently_busy');
		expect(v.idleMs).toBe(15 * MIN);
	});

	it('shuts down once idle for the configured window', () => {
		const log = recorded([[20, 1], [30, 1], [31, 0], [50, 0]]);
		const v = decide({ log, bootAt: BOOT, now: BOOT + 50 * MIN });
		expect(v).toMatchObject({ action: 'shutdown', reason: 'idle_timeout' });
		expect(v.idleMs).toBe(20 * MIN);
	});

	it('shuts down a host that was woken and never used, measured from the end of grace', () => {
		const log = recorded([[16, 0], [30, 0], [35, 0]]);
		expect(decide({ log, bootAt: BOOT, now: BOOT + 34 * MIN }).action).toBe('keep');
		expect(decide({ log, bootAt: BOOT, now: BOOT + 35 * MIN })).toMatchObject({ action: 'shutdown', reason: 'idle_timeout' });
	});

	it('treats an unreachable worker as idle so a crashed container cannot bill a GPU', () => {
		const log = recorded([[20, 1], [21, 0, false], [60, 0, false]]);
		const v = decide({ log, bootAt: BOOT, now: BOOT + 60 * MIN });
		expect(v.action).toBe('shutdown');
	});

	it('honours a custom idle window', () => {
		const log = recorded([[20, 1], [21, 0]]);
		const v = decide({ log, bootAt: BOOT, now: BOOT + 26 * MIN, idleMinutes: 5 });
		expect(v.action).toBe('shutdown');
	});

	it('rejects non-numeric clocks instead of guessing', () => {
		expect(() => decide({ log: [], bootAt: NaN, now: 1 })).toThrow(TypeError);
	});

	it('uses the documented defaults', () => {
		expect(DEFAULTS).toMatchObject({ idleMinutes: 20, graceMinutes: 15 });
	});
});

describe('task log handling', () => {
	it('bounds the log', () => {
		let log = [];
		for (let i = 0; i < 300; i++) log = appendSample(log, { t: i, reachable: true, activeJobs: 0 }, 240);
		expect(log).toHaveLength(240);
		expect(log[0].t).toBe(60);
	});

	it('turns a /health body into a sample and a failure into an unreachable one', () => {
		expect(sampleFromHealth({ active_jobs: 2 }, 5)).toEqual({ t: 5, reachable: true, activeJobs: 2 });
		expect(sampleFromHealth({ ok: true }, 6)).toEqual({ t: 6, reachable: true, activeJobs: 0 });
		expect(sampleFromHealth(null, 7)).toEqual({ t: 7, reachable: false, activeJobs: 0 });
	});
});
