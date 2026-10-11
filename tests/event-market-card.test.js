import { describe, it, expect } from 'vitest';
import { cardSvg, fallbackSvg, titleSize, wrapTitle, timeLeft, timeLine, rankedEntrants, shareDescription, pctLabel, esc } from '../api/_lib/event-market-card.js';

const NOW = Date.parse('2026-10-10T12:00:00Z');

function view(over = {}, n = 3) {
	const outcomes = Array.from({ length: n }, (_, i) => ({
		id: `o${i}`, label: `Entrant ${i}`, position: i, picks: n - i, points: (n - i) * 10, percent: Math.round(100 / n), share: 1 / n, is_winner: false,
	}));
	return {
		slug: 'demo', title: 'Who wins the Demo Cup?', status: 'open', locks_at: new Date(NOW + 3 * 3600e3 + 12 * 60e3).toISOString(),
		pick_count: 6, odds: { even_prior: false }, winner: null, outcomes, ...over,
	};
}

describe('event market card', () => {
	it('renders a 1200x630 svg with the question and top entrants', () => {
		const svg = cardSvg(view(), { now: NOW });
		expect(svg).toContain('width="1200" height="630"');
		expect(svg).toContain('Who wins the Demo Cup?');
		expect(svg).toContain('Entrant 0');
		expect(svg).toContain('Picks lock in 3h 12m');
	});

	it('escapes hostile labels and titles', () => {
		const v = view({ title: '<script>alert(1)</script> & "x"' });
		v.outcomes[0].label = '"><img src=x onerror=1>';
		const svg = cardSvg(v, { now: NOW });
		expect(svg).not.toContain('<script>');
		expect(svg).not.toContain('<img');
		expect(svg).toContain('&lt;script&gt;');
	});

	it('shows only three rows for 50 entrants and counts the rest', () => {
		const svg = cardSvg(view({}, 50), { now: NOW });
		expect((svg.match(/font-size="28" font-weight="800"/g) || []).length).toBe(3);
		expect(svg).toContain('47 more entrants');
	});

	it('handles one entrant and zero entrants', () => {
		expect(cardSvg(view({}, 1), { now: NOW })).toContain('Entrant 0');
		expect(cardSvg(view({}, 0), { now: NOW })).toContain('No entrants yet.');
	});

	it('truncates very long labels and wraps long titles within two lines', () => {
		const long = 'A'.repeat(200);
		const v = view({ title: `${long} ${long}` });
		v.outcomes[0].label = long;
		const svg = cardSvg(v, { now: NOW });
		expect(svg).not.toContain(long);
		expect(wrapTitle('word '.repeat(80), 30).length).toBeLessThanOrEqual(2);
		expect(titleSize('x'.repeat(100))).toBeLessThan(titleSize('short'));
	});

	it('per-entrant variant leads with "Pick Name to win" and surfaces that entrant', () => {
		const v = view({}, 10);
		const svg = cardSvg(v, { pickId: 'o9', now: NOW });
		expect(svg).toContain('Pick Entrant 9 to win');
		expect(svg).toContain('Entrant 9');
	});

	it('does not show the pick headline once the market is closed', () => {
		const svg = cardSvg(view({ status: 'locked' }), { pickId: 'o1', now: NOW });
		expect(svg).not.toContain('Pick Entrant 1 to win');
		expect(svg).toContain('Picks are locked');
	});

	it('states the even prior when nobody has picked', () => {
		const svg = cardSvg(view({ pick_count: 0, odds: { even_prior: true } }), { now: NOW });
		expect(svg).toContain('Even odds until the crowd weighs in');
	});

	it('reports a winner on a resolved market', () => {
		const v = view({ status: 'resolved', winner: { outcome_id: 'o1', label: 'Entrant 1' } });
		expect(timeLine(v, NOW)).toBe('Entrant 1 won');
		expect(timeLeft(v, NOW)).toBeNull();
	});

	it('keeps slot colors stable regardless of rank', () => {
		const v = view();
		v.outcomes[2].percent = 90;
		const ranked = rankedEntrants(v);
		expect(ranked[0].id).toBe('o2');
		expect(ranked[0].color).toBe('#199e70');
		expect(new Set(ranked.map((o) => o.color)).size).toBe(3);
	});

	it('share description names the friend pick and the leader', () => {
		const d = shareDescription(view(), { pickId: 'o1', now: NOW });
		expect(d).toContain('A friend picked Entrant 1 to win');
		expect(d).toContain('Free-to-play');
	});

	it('formats percents and escapes', () => {
		expect(pctLabel(33.333)).toBe('33%');
		expect(pctLabel(4.25)).toBe('4.3%');
		expect(esc(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
	});

	it('fallback card is a valid branded svg', () => {
		expect(fallbackSvg()).toContain('Event Markets');
	});
});
