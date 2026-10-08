import { describe, expect, it } from 'vitest';

import {
	BLOCKED_BAND,
	DENY_RULES,
	chooseLane,
	interpretResult,
	nextScoutNumber,
	parsePorcelainZ,
	runnableOrders,
} from '../scripts/evolve.mjs';

const config = { triageEveryHours: 8, scoutEveryHours: 24, queueFloor: 3 };
const HOUR = 3_600_000;

describe('evolve runnableOrders', () => {
	const files = [
		'919-parity-09-ship-and-publish.md',
		'017-parity-03-earnings-leaderboard.md',
		'015-parity-01-creator-earnings.md',
		'400-auto-fix-thing.md',
		'README.md',
	];

	it('keeps numbered orders below the owner-blocked band, in number order', () => {
		expect(runnableOrders(files)).toEqual([
			'015-parity-01-creator-earnings.md',
			'017-parity-03-earnings-leaderboard.md',
			'400-auto-fix-thing.md',
		]);
		expect(BLOCKED_BAND).toBe(900);
	});

	it('leaves alone an order someone touched recently', () => {
		const busy = new Set(['015-parity-01-creator-earnings.md']);
		expect(runnableOrders(files, {}, 2, busy)[0]).toBe('017-parity-03-earnings-leaderboard.md');
	});

	it('parks an order once it has used its attempts', () => {
		const attempts = { '015-parity-01-creator-earnings.md': 2 };
		expect(runnableOrders(files, attempts, 2)[0]).toBe('017-parity-03-earnings-leaderboard.md');
	});
});

describe('evolve nextScoutNumber', () => {
	it('returns the first free number in the scout band', () => {
		expect(nextScoutNumber(['015-a.md', '400-auto-a.md', '401-auto-b.md'])).toBe(402);
		expect(nextScoutNumber(['050-x-grok-28.md'])).toBe(400);
	});
});

describe('evolve chooseLane', () => {
	const now = 100 * HOUR;
	const fresh = { triage: now - HOUR, scout: now - HOUR };

	it('triages first when production has not been swept recently', () => {
		expect(chooseLane({ now, last: {}, runnable: ['a'], config })).toBe('triage');
	});

	it('scouts when the queue is empty', () => {
		expect(chooseLane({ now, last: fresh, runnable: [], config })).toBe('scout');
	});

	it('scouts a thin queue only after a quarter of the scout interval', () => {
		expect(chooseLane({ now, last: fresh, runnable: ['a'], config })).toBe('queue');
		expect(chooseLane({ now, last: { ...fresh, scout: now - 7 * HOUR }, runnable: ['a'], config })).toBe('scout');
	});

	it('works the queue when it is healthy and a scout is not overdue', () => {
		expect(chooseLane({ now, last: fresh, runnable: ['a', 'b', 'c'], config })).toBe('queue');
		expect(chooseLane({ now, last: { ...fresh, scout: now - 25 * HOUR }, runnable: ['a', 'b', 'c'], config })).toBe('scout');
	});
});

describe('evolve interpretResult', () => {
	it('reads the outcome line the session is told to end with', () => {
		const r = interpretResult({ is_error: false, result: 'Report...\nEVOLVE_RESULT: partial | earnings API shipped, migration pending' });
		expect(r).toEqual({ outcome: 'partial', summary: 'earnings API shipped, migration pending', limited: false });
	});

	it('recognises a subscription usage limit so the loop backs off instead of burning attempts', () => {
		expect(interpretResult({ is_error: true, api_error_status: 429, result: '' }).limited).toBe(true);
		expect(interpretResult({ is_error: true, result: '5-hour limit reached, resets at 3pm' }).outcome).toBe('limited');
	});

	it('does not mistake a normal report that mentions limits for a usage limit', () => {
		expect(interpretResult({ is_error: false, result: 'rate limit added to the endpoint' }).limited).toBe(false);
	});

	it('reports a crash when no result event arrived', () => {
		expect(interpretResult(null).outcome).toBe('crashed');
	});
});

describe('evolve parsePorcelainZ', () => {
	it('lists both sides of a rename', () => {
		expect(parsePorcelainZ(' M a.js\0R  new.js\0old.js\0?? c.md\0')).toEqual(['a.js', 'new.js', 'old.js', 'c.md']);
	});
});

describe('evolve DENY_RULES', () => {
	it('denies every owner-gated action an unattended session could reach', () => {
		for (const rule of [
			'Bash(git push:*)',
			'Bash(gcloud builds submit:*)',
			'Bash(npm run deploy:*)',
			'Bash(npm run db:migrate:*)',
			'Bash(*--set-env-vars*)',
			'Skill(send-usdc)',
			'Skill(trade)',
		]) {
			expect(DENY_RULES).toContain(rule);
		}
	});
});
