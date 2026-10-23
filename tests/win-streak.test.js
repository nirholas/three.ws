import { describe, it, expect } from 'vitest';
import { currentWinStreak, winStreaksByAgent, HOT_STREAK_MIN } from '../api/_lib/win-streak.js';

const w = (n = '1000') => ({ realized_pnl_lamports: n });
const l = (n = '-500') => ({ realized_pnl_lamports: n });

describe('currentWinStreak', () => {
	it('is 0 for no trades', () => {
		expect(currentWinStreak([])).toBe(0);
		expect(currentWinStreak(undefined)).toBe(0);
	});
	it('counts consecutive wins from the newest close', () => {
		expect(currentWinStreak([w(), w(), w(), l(), w()])).toBe(3);
	});
	it('is 0 when the newest close lost or was flat', () => {
		expect(currentWinStreak([l(), w(), w()])).toBe(0);
		expect(currentWinStreak([w('0'), w()])).toBe(0);
	});
	it('stops at an unrecorded pnl rather than counting through it', () => {
		expect(currentWinStreak([w(), { realized_pnl_lamports: null }, w()])).toBe(1);
	});
	it('handles bigint and numeric lamports', () => {
		expect(currentWinStreak([{ realized_pnl_lamports: 5n }, { realized_pnl_lamports: 7 }])).toBe(2);
	});
});

describe('winStreaksByAgent', () => {
	it('computes per-agent streaks from interleaved newest-first rows', () => {
		const rows = [
			{ agent_id: 'a', ...w() },
			{ agent_id: 'b', ...l() },
			{ agent_id: 'a', ...w() },
			{ agent_id: 'b', ...w() },
			{ agent_id: 'a', ...l() },
		];
		const m = winStreaksByAgent(rows);
		expect(m.get('a')).toBe(2);
		expect(m.get('b')).toBe(0);
	});
	it('exposes the hot threshold', () => {
		expect(HOT_STREAK_MIN).toBe(3);
	});
});
