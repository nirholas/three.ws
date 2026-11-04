import { describe, it, expect } from 'vitest';
import { hoursUsedToday, capDecision, upsertInterval, pruneLedger, utcDayStart } from '../scripts/gpu-ledger.mjs';
import { reconcile } from '../scripts/host.mjs';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
const DAY = utcDayStart(NOW);

describe('gpu-hour ledger', () => {
	it('sums closed intervals on the current UTC day and counts an open one up to now', () => {
		const ledger = [
			{ start: DAY + 1 * H, stop: DAY + 3 * H },
			{ start: DAY + 12 * H, stop: null },
		];
		expect(hoursUsedToday(ledger, NOW)).toBe(5);
	});

	it('clips an interval that began yesterday to midnight UTC', () => {
		const ledger = [{ start: DAY - 2 * H, stop: DAY + 1 * H }];
		expect(hoursUsedToday(ledger, NOW)).toBe(1);
	});

	it('refuses a start when less than a useful session remains', () => {
		const ledger = [{ start: DAY, stop: DAY + 5.75 * H }];
		const d = capDecision({ ledger, now: NOW, capHours: 6 });
		expect(d).toMatchObject({ allowed: false, reason: 'gpu_hour_cap_reached' });
		expect(capDecision({ ledger: [], now: NOW, capHours: 6 }).allowed).toBe(true);
	});

	it('upserts by start time so repeated reconciliation never double counts', () => {
		let ledger = upsertInterval([], { start: DAY + H, stop: null });
		ledger = upsertInterval(ledger, { start: DAY + H, stop: DAY + 2 * H });
		expect(ledger).toEqual([{ start: DAY + H, stop: DAY + 2 * H }]);
	});

	it('prunes old intervals', () => {
		const ledger = [{ start: DAY - 30 * 24 * H, stop: DAY - 30 * 24 * H + H }, { start: DAY, stop: DAY + H }];
		expect(pruneLedger(ledger, NOW, 14)).toHaveLength(1);
	});
});

describe('reconcile from instance timestamps', () => {
	it('records a running host as an open interval and a stopped one as closed', () => {
		const running = reconcile([], { state: 'RUNNING', lastStart: DAY + H, lastStop: null }, NOW);
		expect(running).toEqual([{ start: DAY + H, stop: null }]);
		const stopped = reconcile(running, { state: 'TERMINATED', lastStart: DAY + H, lastStop: DAY + 2 * H }, NOW);
		expect(stopped).toEqual([{ start: DAY + H, stop: DAY + 2 * H }]);
	});

	it('ignores an instance that has never started', () => {
		expect(reconcile([], { state: 'TERMINATED', lastStart: null, lastStop: null }, NOW)).toEqual([]);
	});
});
