// /api/oracle/stats must not publish a win rate it cannot know.
//
// Bug (2026-11-12): the outcome labeler's only verdict source, the pump.fun coin
// API, started answering 403. Every non-graduated coin was labeled 'unknown',
// and only our own graduation index still produced verdicts. The stats query
// counted "resolved" rows only (graduated, rugged, or with an ATH), so the
// resolved set became exactly the graduations and the endpoint served
// `win_rate: 100` and `market_base_rate: 100` to the oracle hero and to every
// agent calling the `oracle_stats` MCP tool. A survivorship sample is not a
// rate. When most labels are unknown the rates are null and the response says
// why, so a reader can tell "degraded labels" from "no calls resolved yet".

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/http.js', async () => {
	const actual = await vi.importActual('../../api/_lib/http.js');
	return {
		...actual,
		wrap: (fn) => fn,
		cors: () => false,
		method: () => true,
		rateLimited: (res) => { res._rateLimited = true; },
		json: (res, status, body) => { res._json = { status, body }; return res; },
	};
});

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '1.2.3.4',
}));

// The handler runs five reads in a fixed Promise.all order: conviction summary,
// open actions, outcomes, armed agents, lifetime counter. Each test queues the
// rows those reads resolve with, in that order.
let queue = [];
vi.mock('../../api/_lib/db.js', async () => {
	const actual = await vi.importActual('../../api/_lib/db.js');
	return {
		...actual,
		sql: () => Promise.resolve(queue.shift() ?? [{}]),
	};
});

const { default: handler } = await import('../../api/oracle/stats.js');

function call() {
	const req = { method: 'GET', url: '/api/oracle/stats?network=mainnet', headers: { host: 'x' } };
	const res = {};
	return Promise.resolve(handler(req, res)).then(() => res._json);
}

function rows(outcome) {
	return [
		[{ scored_total: 10, scored_24h: 5, prime_count: 1, strong_count: 2 }],
		[{ open_actions: 0 }],
		[outcome],
		[{ agents_armed: 0 }],
		[{ scored_lifetime: 10 }],
	];
}

beforeEach(() => { queue = []; });

describe('/api/oracle/stats label coverage', () => {
	it('withholds both rates when the labeler could not judge most coins', async () => {
		// The live 2026-11-13 shape: 4,308 graduations judged, 139,947 unknown.
		queue = rows({
			total_resolved: 1207, total_wins: 1207,
			market_resolved: 4308, market_wins: 4308,
			labels_unknown: 139947,
		});
		const { status, body } = await call();
		expect(status).toBe(200);
		expect(body.win_rate).toBeNull();
		expect(body.market_base_rate).toBeNull();
		expect(body.labels.status).toBe('degraded');
		expect(body.labels.unknown).toBe(139947);
		expect(body.labels.judged).toBe(4308);
	});

	it('reports both rates when labels are healthy', async () => {
		queue = rows({
			total_resolved: 200, total_wins: 50,
			market_resolved: 4000, market_wins: 480,
			labels_unknown: 40,
		});
		const { body } = await call();
		expect(body.win_rate).toBe(25);
		expect(body.market_base_rate).toBe(12);
		expect(body.labels.status).toBe('ok');
	});

	it('still distinguishes "nothing resolved yet" from degraded labels', async () => {
		queue = rows({ total_resolved: 0, total_wins: 0, market_resolved: 0, market_wins: 0, labels_unknown: 0 });
		const { body } = await call();
		expect(body.win_rate).toBeNull();
		expect(body.labels.status).toBe('ok');
	});
});
