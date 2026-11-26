// api/_lib/cron-tick.js: the one-minute clock that replaced one Cloud Scheduler
// job per cron. If its due-minute math is off by one, a cron either never fires
// or fires twice, and some of these crons move money, so the math is pinned
// against every expression shape vercel.json uses, and the fan-out is exercised
// against a real HTTP server.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import {
	TICK_PATH,
	tickMinute,
	isDue,
	dueCrons,
	childOrigin,
	childHeaders,
	runDue,
} from '../api/_lib/cron-tick.js';

const at = (iso) => new Date(iso);

describe('tickMinute', () => {
	it('uses the scheduler header and floors it to the minute', () => {
		expect(tickMinute('2026-11-26T10:05:03.120Z').toISOString()).toBe('2026-11-26T10:05:00.000Z');
	});

	it('falls back to the clock when the header is missing or garbage', () => {
		const now = at('2026-11-26T10:07:59.999Z');
		expect(tickMinute(undefined, now).toISOString()).toBe('2026-11-26T10:07:00.000Z');
		expect(tickMinute('not a date', now).toISOString()).toBe('2026-11-26T10:07:00.000Z');
	});
});

describe('isDue', () => {
	it('fires every-N-minute steps on their minute only', () => {
		expect(isDue('*/5 * * * *', at('2026-11-26T10:05:00Z'))).toBe(true);
		expect(isDue('*/5 * * * *', at('2026-11-26T10:06:00Z'))).toBe(false);
		expect(isDue('* * * * *', at('2026-11-26T10:06:00Z'))).toBe(true);
	});

	it('honours offset steps', () => {
		expect(isDue('1-59/5 * * * *', at('2026-11-26T10:01:00Z'))).toBe(true);
		expect(isDue('1-59/5 * * * *', at('2026-11-26T10:05:00Z'))).toBe(false);
		expect(isDue('2-59/5 * * * *', at('2026-11-26T10:57:00Z'))).toBe(true);
	});

	it('honours lists, hour ranges and wrapped hour lists in UTC', () => {
		expect(isDue('11,41 * * * *', at('2026-11-26T03:41:00Z'))).toBe(true);
		expect(isDue('*/10 14-23,0-4 * * *', at('2026-11-26T03:10:00Z'))).toBe(true);
		expect(isDue('*/10 14-23,0-4 * * *', at('2026-11-26T05:10:00Z'))).toBe(false);
		expect(isDue('0 */6 * * *', at('2026-11-26T18:00:00Z'))).toBe(true);
		expect(isDue('0 */6 * * *', at('2026-11-26T19:00:00Z'))).toBe(false);
	});

	it('honours weekdays (2026-11-23 is a Monday)', () => {
		expect(isDue('0 15 * * 1,3,5', at('2026-11-23T15:00:00Z'))).toBe(true);
		expect(isDue('0 15 * * 1,3,5', at('2026-11-24T15:00:00Z'))).toBe(false);
		expect(isDue('7 0 * * 1', at('2026-11-23T00:07:00Z'))).toBe(true);
	});
});

describe('dueCrons', () => {
	it('fires each path once, skips itself, and reports bad expressions without throwing', () => {
		const { due, invalid } = dueCrons(
			[
				{ path: '/api/cron/a', schedule: '*/5 * * * *' },
				{ path: '/api/cron/a', schedule: '* * * * *' },
				{ path: '/api/cron/b', schedule: '7 * * * *' },
				{ path: TICK_PATH, schedule: '* * * * *' },
				{ path: '/api/cron/broken', schedule: 'every tuesday' },
			],
			at('2026-11-26T10:05:00Z'),
		);
		expect(due.map((d) => d.path)).toEqual(['/api/cron/a']);
		expect(invalid.map((i) => i.path)).toEqual(['/api/cron/broken']);
	});

	it('reads every schedule in the real vercel.json and fires the every-minute set each minute', () => {
		const { crons } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
		const minute = at('2026-11-26T10:03:00Z');
		const { due, invalid } = dueCrons(crons, minute);
		expect(invalid).toEqual([]);
		const everyMinute = crons.filter((c) => c.schedule === '* * * * *').map((c) => c.path);
		for (const p of everyMinute) expect(due.map((d) => d.path)).toContain(p);
	});

	it('fires each declared cron exactly as often over a day as its own Scheduler job would', () => {
		const crons = [
			{ path: '/api/cron/five', schedule: '*/5 * * * *' },
			{ path: '/api/cron/hourly', schedule: '23 * * * *' },
			{ path: '/api/cron/daily', schedule: '17 6 * * *' },
			{ path: '/api/cron/window', schedule: '*/10 14-23,0-4 * * *' },
		];
		const counts = {};
		const start = Date.parse('2026-11-26T00:00:00Z');
		for (let m = 0; m < 1440; m++) {
			for (const d of dueCrons(crons, new Date(start + m * 60_000)).due) {
				counts[d.path] = (counts[d.path] || 0) + 1;
			}
		}
		expect(counts).toEqual({
			'/api/cron/five': 288,
			'/api/cron/hourly': 24,
			'/api/cron/daily': 1,
			'/api/cron/window': 15 * 6,
		});
	});
});

describe('childOrigin and childHeaders', () => {
	it('defaults to loopback on the container port, overridable', () => {
		expect(childOrigin({ PORT: '9090' })).toBe('http://127.0.0.1:9090');
		expect(childOrigin({})).toBe('http://127.0.0.1:8080');
		expect(childOrigin({ CRON_TICK_ORIGIN: 'https://other.example' })).toBe('https://other.example');
	});

	it('passes the service host through over loopback only', () => {
		const tick = at('2026-11-26T10:05:00Z');
		const loop = childHeaders({
			url: new URL('http://127.0.0.1:8080/api/cron/a'),
			secret: 's',
			tick,
			host: 'svc.run.app',
			proto: 'https',
		});
		expect(loop).toMatchObject({ authorization: 'Bearer s', host: 'svc.run.app', 'x-forwarded-proto': 'https' });

		const remote = childHeaders({
			url: new URL('https://other.example/api/cron/a'),
			secret: 's',
			tick,
			host: 'attacker.example',
		});
		expect(remote.host).toBeUndefined();
	});
});

describe('runDue against a real server', () => {
	let server;
	let origin;
	const seen = [];

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			seen.push({ url: req.url, headers: req.headers });
			if (req.url.startsWith('/api/cron/fails')) {
				res.statusCode = 500;
				return res.end('{"error":"boom"}');
			}
			if (req.url.startsWith('/api/cron/hangup')) return req.socket.destroy();
			res.statusCode = 200;
			res.end('{"ok":true}');
		});
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		origin = `http://127.0.0.1:${server.address().port}`;
	});

	afterAll(() => new Promise((r) => server.close(r)));

	it('fires every due cron with the secret and reports each outcome independently', async () => {
		const tick = at('2026-11-26T10:05:00Z');
		const results = await runDue(
			[{ path: '/api/cron/ok?x=1' }, { path: '/api/cron/fails' }, { path: '/api/cron/hangup' }],
			{ origin, secret: 'sekret', tick, host: 'svc.run.app', proto: 'https' },
		);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r]));
		expect(byPath['/api/cron/ok?x=1']).toMatchObject({ status: 200, ok: true });
		expect(byPath['/api/cron/fails']).toMatchObject({ status: 500, ok: false });
		expect(byPath['/api/cron/hangup'].ok).toBe(false);
		expect(byPath['/api/cron/hangup'].error).toBeTruthy();

		const okReq = seen.find((s) => s.url === '/api/cron/ok?x=1');
		expect(okReq.headers.authorization).toBe('Bearer sekret');
		expect(okReq.headers.host).toBe('svc.run.app');
		expect(okReq.headers['x-cron-tick']).toBe('2026-11-26T10:05:00.000Z');
	});
});
