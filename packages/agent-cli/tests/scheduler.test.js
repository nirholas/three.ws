// Natural-language schedules: the phrase grammar (accepted and refused forms),
// UTC conversion for server mode, two schedulers on one SQLite file never
// double-firing, and the exact /api/v1/automations body server mode sends.

import { afterEach, describe, expect, it } from 'vitest';
import { createPlatform } from '../src/platform.js';
import { addSchedule, minGapMs, parseSchedule, removeSchedule, runDue, ScheduleError, setScheduleMode, startScheduler, toUtcCron } from '../src/scheduler.js';
import { openStore } from '../src/store.js';
import { listen, readBody, tempEnv } from './helpers.js';
import path from 'node:path';

const NOW = new Date('2026-11-04T12:00:00Z');

describe('parseSchedule grammar', () => {
	it.each([
		['every minute', '* * * * *'],
		['every 1 minute', '* * * * *'],
		['every 15 minutes', '*/15 * * * *'],
		['every 5 mins', '*/5 * * * *'],
		['every hour', '0 * * * *'],
		['hourly', '0 * * * *'],
		['every 2 hours', '0 */2 * * *'],
		['every day at 9am', '0 9 * * *'],
		['daily at 18:30', '30 18 * * *'],
		['every day at noon', '0 12 * * *'],
		['every day at midnight', '0 0 * * *'],
		['at 7:15pm', '15 19 * * *'],
		['every weekday 9am', '0 9 * * 1-5'],
		['weekdays at 8:45 am', '45 8 * * 1-5'],
		['every monday to friday at 9am', '0 9 * * 1-5'],
		['every weekend at 10:00', '0 10 * * 0,6'],
		['every monday at 8am', '0 8 * * 1'],
		['every mon, wed and fri at 7:30pm', '30 19 * * 1,3,5'],
		['every tuesday and thursday at 12pm', '0 12 * * 2,4'],
		['weekly', '0 0 * * 0'],
		['monthly', '0 0 1 * *'],
		['every month on the 1st at 9am', '0 9 1 * *'],
		['on the 15th at 8:30', '30 8 15 * *'],
		['at 9am and 5pm every weekday', '0 9,17 * * 1-5'],
		['every day at 9am and 5pm', '0 9,17 * * *'],
		['Every Weekday At 9AM.', '0 9 * * 1-5'],
		['run every 30 minutes', '*/30 * * * *'],
		['0 9 * * 1-5', '0 9 * * 1-5'],
		['*/10 * * * *', '*/10 * * * *'],
	])('%s -> %s', (text, cron) => {
		const r = parseSchedule(text, { tz: 'America/New_York', now: NOW });
		expect(r.cron).toBe(cron);
		expect(r.tz).toBe('America/New_York');
		expect(Date.parse(r.next)).toBeGreaterThan(NOW.getTime());
		expect(r.description.length).toBeGreaterThan(3);
	});

	it('reads a trailing "utc" as UTC', () => {
		const r = parseSchedule('every day at 13:00 utc', { tz: 'Europe/Berlin', now: NOW });
		expect(r).toMatchObject({ cron: '0 13 * * *', tz: 'UTC', next: '2026-11-04T13:00:00.000Z' });
	});

	it.each([
		['', /it is empty/],
		['whenever you like', /Could not read the schedule/],
		['every blue moon', /"blue" is not a day of the week/],
		['every 90 minutes', /minutes must be between 1 and 59/],
		['every 0 minutes', /minutes must be between 1 and 59/],
		['every 30 hours', /hours must be between 1 and 23/],
		['every 15 minutes at 9am', /interval schedule cannot also take a time of day/],
		['every day at 9am and 5:30pm', /must share the same minute/],
		['on the 40th', /"40th" is not a day of the month/],
		['every day at 25:00', /Could not read the schedule|is not a day of the week/],
		['61 * * * *', /not a valid cron expression/],
	])('refuses %j', (text, why) => {
		expect(() => parseSchedule(text, { tz: 'UTC', now: NOW })).toThrow(ScheduleError);
		expect(() => parseSchedule(text, { tz: 'UTC', now: NOW })).toThrow(why);
	});

	it('lists the accepted forms when it refuses', () => {
		try {
			parseSchedule('sometimes', { tz: 'UTC' });
			throw new Error('expected a refusal');
		} catch (err) {
			expect(err.message).toContain('every weekday 9am');
			expect(err.message).toContain('raw 5-field cron expression');
		}
	});
});

describe('server-mode UTC conversion', () => {
	it('moves fixed times, and weekdays across midnight', () => {
		const at = new Date('2026-07-01T12:00:00Z');
		expect(toUtcCron('0 9 * * 1-5', 'America/New_York', at)).toBe('0 13 * * 1-5');
		expect(toUtcCron('30 1 * * 1', 'Europe/Berlin', at)).toBe('30 23 * * 0');
		expect(toUtcCron('*/15 * * * *', 'Asia/Tokyo', at)).toBe('*/15 * * * *');
		expect(toUtcCron('0 9 * * *', 'UTC', at)).toBe('0 9 * * *');
	});

	it('refuses what cannot move exactly', () => {
		const at = new Date('2026-07-01T12:00:00Z');
		expect(() => toUtcCron('0 * * * *', 'Asia/Kolkata', at)).toThrow(/cannot be moved to UTC exactly/);
		expect(() => toUtcCron('0 22 15 * *', 'America/New_York', at)).toThrow(/cannot be moved to UTC exactly/);
	});

	it('measures the gap between fires', () => {
		expect(minGapMs('* * * * *')).toBe(60_000);
		expect(minGapMs('*/5 * * * *')).toBe(300_000);
	});
});

const temps = [];
afterEach(() => {
	while (temps.length) temps.pop()();
});

function sharedDb() {
	const t = tempEnv();
	const file = path.join(t.home, 'agent.db');
	const stores = [openStore(file), openStore(file)];
	temps.push(() => {
		for (const s of stores) s.close();
		t.cleanup();
	});
	return stores;
}

describe('local scheduler', () => {
	it('two schedulers on one database fire a due job exactly once', async () => {
		const [a, b] = sharedDb();
		const cron = await addSchedule({ store: a, when: 'every minute', prompt: 'check the queue', tz: 'UTC', now: new Date('2026-11-04T11:59:30Z') });
		expect(cron.next_run_at).toBe('2026-11-04T12:00:00.000Z');

		const fired = [];
		let release;
		const gate = new Promise((r) => {
			release = r;
		});
		const runPrompt = (who) => async (c) => {
			fired.push({ who, id: c.id });
			await gate;
			return { status: 'done', runId: `run-${who}` };
		};
		const at = new Date('2026-11-04T12:00:05Z');
		const first = runDue({ store: a, runPrompt: runPrompt('a'), now: at });
		const second = runDue({ store: b, runPrompt: runPrompt('b'), now: at });
		await new Promise((r) => setTimeout(r, 20));
		release();
		const [ra, rb] = await Promise.all([first, second]);
		expect(fired).toHaveLength(1);
		expect(ra.length + rb.length).toBe(1);

		const after = b.getCron(cron.id);
		expect(after.last_status).toBe('done');
		expect(after.next_run_at).toBe('2026-11-04T12:01:00.000Z');
		expect(after.running_since).toBeNull();

		const again = await Promise.all([runDue({ store: a, runPrompt: runPrompt('a'), now: at }), runDue({ store: b, runPrompt: runPrompt('b'), now: at })]);
		expect(again.flat()).toEqual([]);
		expect(fired).toHaveLength(1);
	});

	it('two running scheduler loops over many ticks never double-fire', async () => {
		const [a, b] = sharedDb();
		await addSchedule({ store: a, when: 'every minute', prompt: 'tick', tz: 'UTC', now: new Date('2026-11-04T11:59:30Z') });
		let minute = 0;
		const clock = () => new Date(Date.parse('2026-11-04T12:00:01Z') + minute * 60_000);
		const fires = [];
		const runPrompt = (who) => async () => {
			fires.push({ who, minute });
			await new Promise((r) => setTimeout(r, 5));
			return { status: 'done' };
		};
		const sa = startScheduler({ store: a, runPrompt: runPrompt('a'), intervalMs: 2, clock });
		const sb = startScheduler({ store: b, runPrompt: runPrompt('b'), intervalMs: 3, clock });
		for (let i = 0; i < 5; i++) {
			await new Promise((r) => setTimeout(r, 40));
			minute++;
		}
		await new Promise((r) => setTimeout(r, 40));
		await sa.stop();
		await sb.stop();
		const perMinute = new Map();
		for (const f of fires) perMinute.set(f.minute, (perMinute.get(f.minute) || 0) + 1);
		expect(fires.length).toBeGreaterThanOrEqual(5);
		for (const n of perMinute.values()) expect(n).toBe(1);
	});

	it('skips a long-missed slot when catch-up is off, and records a failed run', async () => {
		const [a] = sharedDb();
		const c = await addSchedule({ store: a, when: 'every hour', prompt: 'p', tz: 'UTC', now: new Date('2026-11-04T08:30:00Z') });
		const events = [];
		const skipped = await runDue({ store: a, runPrompt: async () => ({ status: 'done' }), now: new Date('2026-11-04T12:30:00Z'), catchUp: false, onEvent: (e) => events.push(e.kind) });
		expect(skipped).toEqual([]);
		expect(events).toEqual(['cron_skipped']);
		expect(a.getCron(c.id).next_run_at).toBe('2026-11-04T13:00:00.000Z');

		const failed = await runDue({ store: a, runPrompt: async () => { throw new Error('model offline'); }, now: new Date('2026-11-04T13:00:10Z') });
		expect(failed).toEqual([{ id: c.id, status: 'error', error: 'model offline' }]);
		expect(a.getCron(c.id).last_status).toBe('error');
	});
});

describe('server mode', () => {
	it('POSTs the exact automation body, switches back to local, and deletes it', async () => {
		const [store] = sharedDb();
		const seen = [];
		const srv = await listen(async (req, res) => {
			const body = req.method === 'POST' ? await readBody(req) : null;
			seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
			res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ data: req.method === 'POST' ? { id: 'auto_1', ...body } : { deleted: true } }));
		});
		temps.push(() => srv.close());
		const platform = createPlatform({ origin: srv.url, credential: { token: 'sk_test_local', source: 'test' } });

		const cron = await addSchedule({ store, when: 'every weekday at 9am', prompt: 'post the  portfolio\nsummary', mode: 'server', platform, agentId: 'agent_123', tz: 'America/New_York', now: new Date('2026-07-01T12:00:00Z') });
		expect(seen[0]).toEqual({
			method: 'POST',
			url: '/api/v1/automations',
			auth: 'Bearer sk_test_local',
			body: {
				agentId: 'agent_123',
				title: 'three-ws-agent: post the portfolio summary',
				trigger: { type: 'schedule', cron: '0 13 * * 1-5' },
				action: { type: 'agent_prompt', prompt: 'post the  portfolio\nsummary' },
			},
		});
		expect(cron).toMatchObject({ mode: 'server', server_automation_id: 'auto_1', tz: 'UTC', cron: '0 13 * * 1-5', next_run_at: null });

		const local = await setScheduleMode({ store, id: cron.id, mode: 'local', platform, tz: 'America/New_York', now: new Date('2026-07-01T12:00:00Z') });
		expect(seen[1]).toMatchObject({ method: 'DELETE', url: '/api/v1/automations/auto_1' });
		expect(local).toMatchObject({ mode: 'local', cron: '0 9 * * 1-5', tz: 'America/New_York', server_automation_id: null });

		const back = await setScheduleMode({ store, id: cron.id, mode: 'server', platform, tz: 'America/New_York', now: new Date('2026-07-01T12:00:00Z') });
		expect(seen[2].body.trigger.cron).toBe('0 13 * * 1-5');
		expect(back.mode).toBe('server');

		await removeSchedule({ store, id: cron.id, platform });
		expect(seen[3]).toMatchObject({ method: 'DELETE', url: '/api/v1/automations/auto_1' });
		expect(store.listCrons()).toEqual([]);
	});

	it('refuses server schedules faster than every 5 minutes, or without an agent or sign-in', async () => {
		const [store] = sharedDb();
		const platform = createPlatform({ origin: 'http://127.0.0.1:9', credential: { token: 'sk_test_local' } });
		await expect(addSchedule({ store, when: 'every minute', prompt: 'p', mode: 'server', platform, agentId: 'a', tz: 'UTC' })).rejects.toThrow(/at most once every 5 minutes/);
		await expect(addSchedule({ store, when: 'every hour', prompt: 'p', mode: 'server', platform, agentId: null, tz: 'UTC' })).rejects.toThrow(/Pick one with `\/agent <id>`/);
		await expect(addSchedule({ store, when: 'every hour', prompt: 'p', mode: 'server', platform: null, agentId: 'a', tz: 'UTC' })).rejects.toThrow(/sign-in/);
		expect(store.listCrons()).toEqual([]);
	});
});
