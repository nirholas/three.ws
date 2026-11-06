// Measured 2026-11-06: 92 launched coins, 20 refreshed in the past week, 43 with no
// stats row at all, the oldest from May. `order by id limit 20` picked the same 20
// coins every run, so graduation detection never reached the rest.

import { describe, it, expect, vi } from 'vitest';

const db = vi.hoisted(() => ({ selects: [] }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const text = strings.join('?');
		if (text.includes('pump_agent_mints')) db.selects.push(text);
		return [];
	}),
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
	it('picks the stalest coins first, never-refreshed ones ahead of all', async () => {
		await call();
		expect(db.selects[0]).toMatch(/left join pump_agent_stats/i);
		expect(db.selects[0]).toMatch(/order by\s+\S*refreshed_at asc nulls first/i);
	});
});
