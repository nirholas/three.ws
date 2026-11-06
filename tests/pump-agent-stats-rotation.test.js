// Measured 2026-11-06: 92 launched coins, 20 refreshed in the past week, 43 with no
// stats row at all, the oldest from May. `order by id limit 20` picked the same 20
// coins every run, so graduation detection never reached the rest.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ selects: [], mints: [], prior: [], signals: 0 }));
const feed = vi.hoisted(() => ({ events: [] }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const text = strings.join('?');
		if (text.includes('pump_agent_mints')) {
			db.selects.push(text);
			return db.mints;
		}
		if (text.includes('select graduated')) return db.prior;
		if (text.includes('insert into pumpfun_signals')) db.signals += 1;
		return [];
	}),
}));
vi.mock('../api/_lib/feed.js', () => ({ publishUserEvent: vi.fn((_, e) => feed.events.push(e)) }));
vi.mock('../api/_lib/pump.js', async (orig) => ({
	...(await orig()),
	getPumpSdk: async () => ({ sdk: { fetchBondingCurve: async () => ({ complete: true }) } }),
	getAmmPoolState: async () => { throw Object.assign(new Error('none'), { code: 'pool_not_found' }); },
	getRpcFallback: () => ({ withFallback: async () => [] }),
}));

const { default: handler } = await import('../api/cron/[name].js');

function call() {
	const req = { method: 'GET', url: '/api/cron/pump-agent-stats?name=pump-agent-stats', query: { name: 'pump-agent-stats' }, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
	};
	return handler(req, res).then(() => res);
}

describe('pump-agent-stats rotation', () => {
	beforeEach(() => {
		db.selects.length = 0;
		db.mints = [];
		db.prior = [];
		db.signals = 0;
		feed.events.length = 0;
	});

	it('picks the stalest coins first, never-refreshed ones ahead of all', async () => {
		await call();
		expect(db.selects[0]).toMatch(/left join pump_agent_stats/i);
		expect(db.selects[0]).toMatch(/order by\s+\S*refreshed_at asc nulls first/i);
	});

	const coin = { id: 7, mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump', network: 'mainnet', user_id: 'u1', name: 'THREE' };

	it('announces a graduation it watched happen', async () => {
		db.mints = [coin];
		db.prior = [{ graduated: false, recent: true }];
		const res = await call();
		expect(JSON.parse(res.body).graduations).toBe(1);
		expect(db.signals).toBe(1);
		expect(feed.events).toHaveLength(1);
	});

	// A stale row cannot prove the flip just happened: the coin may have graduated
	// months ago, and telling the owner so today would be a false "just filled".
	it('corrects a long-stale coin silently instead of announcing old news', async () => {
		db.mints = [coin];
		db.prior = [{ graduated: false, recent: false }];
		const res = await call();
		expect(JSON.parse(res.body).graduations).toBe(0);
		expect(db.signals).toBe(0);
		expect(feed.events).toHaveLength(0);
	});
});
