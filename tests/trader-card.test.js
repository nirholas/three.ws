/**
 * The embeddable trader card: model, links and snippet.
 *
 * This card renders on other people's pages, so the things worth pinning are the
 * ones that would be invisible to us and wrong for them: the payload must stay
 * small, every link must be absolute (a relative href on a stranger's domain
 * goes to their site, not ours), a referral code must survive into every link,
 * the return multiple must come from the realized percentage rather than exit
 * over entry, and the snippet handed to a leader must be paste-ready with no
 * placeholder left in it.
 */

import { describe, it, expect } from 'vitest';
import { buildTraderCard, cardLinks, multipleFromPct } from '../api/_lib/trader-card.js';
import { embedSnippet } from '../src/shared/trader-embed.js';

const AGENT = '6287faf3-d41b-43cb-97bb-d305c1ac6e45';

/** A `getTraderStats` result, trimmed to what the card projection reads. */
function stats({ closed = [], open = [], verified = true, name = 'Crosshair' } = {}) {
	return {
		agent: { id: AGENT, name, image: null, is_public: true, wallet: 'W', copiers: 4 },
		network: 'mainnet',
		window: '30d',
		sol_usd: 100,
		metrics: {
			score: 61, verified, closed_count: closed.length, wins: 1, losses: 1, win_rate: 0.5,
			realized_pnl_lamports: '0', realized_pnl_sol: 1.234567891, realized_pnl_usd: 123.4567,
			roi_pct: 12.3, best_pnl_pct: 237.38, max_drawdown_pct: 9.1, open_count: open.length,
			last_active_at: '2026-09-09T12:00:00.000Z',
		},
		closed,
		open,
		oracle: { total: 99 },
		projection: { anything: true },
	};
}

const closedTrade = (i, pct) => ({
	id: `c${i}`, mint: `MINT${i}`, symbol: `SYM${i}`, name: `Coin ${i}`,
	entry_sol: 0.5, exit_sol: 0.6, pnl_sol: 0.1, pnl_pct: pct,
	exit_reason: 'take_profit', opened_at: '2026-09-09T10:00:00.000Z', closed_at: '2026-09-09T11:00:00.000Z',
	buy_url: 'https://solscan.io/tx/buy', sell_url: 'https://solscan.io/tx/sell', moonbag_held: false,
});

describe('multipleFromPct', () => {
	it('derives the multiple from the realized percentage, not exit over entry', () => {
		expect(multipleFromPct(0)).toBe(1);
		expect(multipleFromPct(620)).toBe(7.2);
		expect(multipleFromPct(-100)).toBe(0);
	});

	it('returns null rather than 1 when there is no percentage', () => {
		expect(multipleFromPct(null)).toBeNull();
		expect(multipleFromPct('nope')).toBeNull();
	});
});

describe('cardLinks', () => {
	it('is absolute on every link, because the card runs on someone else origin', () => {
		const l = cardLinks({ agentId: AGENT, mint: 'MINT1', size: 0.5 });
		for (const url of Object.values(l)) {
			if (url) expect(url.startsWith('https://three.ws')).toBe(true);
		}
	});

	it('carries a referral code into every link it makes', () => {
		const l = cardLinks({ agentId: AGENT, mint: 'MINT1', ref: 'abc_123' });
		expect(l.profile).toContain('ref=abc_123');
		expect(l.ghost_copy).toContain('ref=abc_123');
		expect(l.fork).toContain('ref=abc_123');
		expect(l.site).toContain('ref=abc_123');
	});

	it('has no fork link without a mint to fork', () => {
		expect(cardLinks({ agentId: AGENT }).fork).toBeNull();
	});

	it('points ghost-copy at this leader and this window', () => {
		expect(cardLinks({ agentId: AGENT, window: '7d' }).ghost_copy)
			.toBe(`https://three.ws/ghost-copy?leader=${AGENT}&window=7d`);
	});
});

describe('buildTraderCard', () => {
	it('caps the payload at a few trades however long the record is', () => {
		const many = Array.from({ length: 400 }, (_, i) => closedTrade(i, 10));
		const card = buildTraderCard(stats({ closed: many }));
		expect(card.recent).toHaveLength(3);
		expect(card.stats.closed).toBe(400);
		expect(JSON.stringify(card).length).toBeLessThan(4000);
	});

	it('drops the heavy sections the profile carries', () => {
		const card = buildTraderCard(stats({ closed: [closedTrade(1, 10)] }));
		expect(card.oracle).toBeUndefined();
		expect(card.projection).toBeUndefined();
		expect(card.closed).toBeUndefined();
	});

	it('gives every listed trade a fork link', () => {
		const card = buildTraderCard(stats({
			closed: [closedTrade(1, 10)],
			open: [{ id: 'o1', mint: 'OPEN1', symbol: 'OPN', entry_sol: 0.25, current_sol: 0.5, unrealized_pct: 100, opened_at: '2026-09-09T11:30:00.000Z', buy_url: null }],
		}));
		expect(card.recent[0].fork_url).toContain('fork=MINT1');
		expect(card.open[0].fork_url).toContain('fork=OPEN1');
		expect(card.open[0].fork_url).toContain('fork_size=0.25');
	});

	it('reports the record from the shared metrics rather than recomputing it', () => {
		const card = buildTraderCard(stats({ closed: [closedTrade(1, 10)] }));
		expect(card.stats.score).toBe(61);
		expect(card.stats.win_rate).toBe(0.5);
		expect(card.stats.realized_pnl_sol).toBe(1.234568);
		expect(card.agent.verified).toBe(true);
		expect(card.agent.copiers).toBe(4);
	});

	it('keeps an unmeasured number null instead of rendering it as zero', () => {
		const s = stats({ closed: [] });
		s.metrics.realized_pnl_usd = null;
		s.metrics.win_rate = null;
		const card = buildTraderCard(s);
		expect(card.stats.realized_pnl_usd).toBeNull();
		expect(card.stats.win_rate).toBeNull();
		expect(card.recent).toEqual([]);
	});

	it('returns null for a missing trader rather than an empty card', () => {
		expect(buildTraderCard(null)).toBeNull();
		expect(buildTraderCard({})).toBeNull();
	});
});

describe('embedSnippet', () => {
	it('is paste-ready with no placeholder left in it', () => {
		const out = embedSnippet({ agentId: AGENT });
		expect(out).toContain('src="https://three.ws/trader-card/element.js"');
		expect(out).toContain(`<trader-card agent="${AGENT}"></trader-card>`);
		expect(out).not.toMatch(/YOUR|<uuid>|\.\.\./);
	});

	it('writes only the attributes that are not already the default', () => {
		expect(embedSnippet({ agentId: AGENT, window: '30d' })).not.toContain('window=');
		expect(embedSnippet({ agentId: AGENT, window: 'all' })).toContain('window="all"');
	});

	it('carries a referral code and refuses one that is not a code', () => {
		expect(embedSnippet({ agentId: AGENT, ref: 'ab-1_2' })).toContain('ref="ab-1_2"');
		expect(embedSnippet({ agentId: AGENT, ref: '"onerror=alert(1)' })).not.toContain('ref=');
	});

	it('returns null rather than a snippet nobody should paste', () => {
		expect(embedSnippet({ agentId: 'not-a-uuid' })).toBeNull();
		expect(embedSnippet({})).toBeNull();
	});

	it('honours a self-hosted origin without doubling the slash', () => {
		expect(embedSnippet({ agentId: AGENT, origin: 'https://example.test/' }))
			.toContain('src="https://example.test/trader-card/element.js"');
	});
});
