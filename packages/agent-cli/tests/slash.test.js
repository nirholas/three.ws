// The slash registry: dispatch, Tab autocomplete, /help rendering every
// command, and the session/cron/model/subagent commands run against a real
// context (SQLite store, local model server, subagent pool).

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createSession } from '../src/session.js';
import { createSubagentPool } from '../src/subagent.js';
import { COMMANDS, complete, completions, helpText, isSlash, runSlash, splitArgs } from '../src/tui/slash.js';
import { modelServer, tempEnv, testContext, waitFor } from './helpers.js';

const REQUIRED = ['model', 'agent', 'wallet', 'skills', 'runs', 'new', 'sessions', 'search', 'resume', 'export', 'cron', 'subagent', 'clear', 'help', 'exit'];

describe('registry', () => {
	it('has every command the TUI documents, each with a description', () => {
		const names = COMMANDS.map((c) => c.name);
		for (const n of REQUIRED) expect(names).toContain(n);
		for (const c of COMMANDS) expect(c.description.length).toBeGreaterThan(5);
	});

	it('renders every command in /help', () => {
		const text = helpText();
		for (const c of COMMANDS) expect(text).toContain(`/${c.name}`);
		expect(text).toMatch(/Enter approves, Esc denies/);
	});

	it('splits quoted arguments', () => {
		expect(splitArgs('/cron add "every day at 9am" \'say hi\' --server')).toEqual(['/cron', 'add', 'every day at 9am', 'say hi', '--server']);
		expect(splitArgs('/search "a \\"quoted\\" word"')).toEqual(['/search', 'a "quoted" word']);
	});

	it('autocompletes a unique prefix with a trailing space and stops at the shared prefix of several', () => {
		expect(complete('/he')).toBe('/help ');
		expect(complete('/sub')).toBe('/subagent ');
		expect(completions('/s').map((c) => c.name).sort()).toEqual(['search', 'sessions', 'skills', 'subagent']);
		expect(complete('/se')).toBe('/se');
		expect(complete('/ses')).toBe('/sessions ');
		expect(complete('/r')).toBe('/r');
		expect(completions('/re').map((c) => c.name)).toEqual(['resume']);
		expect(complete('/zzz')).toBe('/zzz');
		expect(completions('/help me')).toEqual([]);
		expect(complete('plain text')).toBe('plain text');
	});

	it('tells a slash command from a message', () => {
		expect(isSlash('/help')).toBe(true);
		expect(isSlash('  /new')).toBe(true);
		expect(isSlash('/ not a command')).toBe(false);
		expect(isSlash('hello /help')).toBe(false);
	});
});

describe('commands against a real context', () => {
	let t;
	let srv;
	let ctx;
	let api;
	let session;

	beforeEach(async () => {
		t = tempEnv();
		srv = await modelServer(() => ({ content: 'Subagent report: the folder holds one README.' }));
		ctx = testContext(t.env, srv.baseUrl);
		session = createSession(ctx);
		const pool = createSubagentPool(ctx, { maxConcurrent: 2 });
		const host = { cleared: 0, exited: 0, reloaded: [] };
		api = {
			ctx,
			get session() {
				return session;
			},
			pool,
			approve: async () => ({ ok: false }),
			onSubagentEvent: null,
			newSession() {
				session = createSession(ctx);
				return session;
			},
			resumeSession(id) {
				session = createSession(ctx, { resume: id });
				return session;
			},
			reload(key) {
				host.reloaded.push(key);
				ctx.reload({});
			},
			clear() {
				host.cleared++;
			},
			exit() {
				host.exited++;
			},
			host,
		};
	});

	afterEach(async () => {
		await api.pool.cancelAll();
		await ctx.close();
		await srv.close();
		t.cleanup();
	});

	it('/help, /clear, /exit and the aliases', async () => {
		expect((await runSlash('/help', api)).text).toBe(helpText());
		expect((await runSlash('/?', api)).text).toBe(helpText());
		await runSlash('/clear', api);
		expect(api.host.cleared).toBe(1);
		await runSlash('/quit', api);
		await runSlash('/exit', api);
		expect(api.host.exited).toBe(2);
	});

	it('names close matches for an unknown command', async () => {
		const r = await runSlash('/sesions', api);
		expect(r.error).toMatch(/Unknown command \/sesions/);
		expect(r.error).toContain('/sessions');
	});

	it('/model lists the endpoint models and switches the model in agent.json', async () => {
		const list = await runSlash('/model', api);
		expect(list.text).toContain('* test-model');
		const r = await runSlash('/model other-model', api);
		expect(r.error).toBeUndefined();
		expect(loadConfig(t.env).model.model).toBe('other-model');
		expect(api.host.reloaded).toContain('model');
		const bad = await runSlash('/model openai not-a-url m', api);
		expect(bad.error).toMatch(/not a URL/);
	});

	it('/new, /sessions, /search, /resume and /export work on the saved store', async () => {
		const first = session.id;
		ctx.store.appendMessages(first, [{ role: 'user', content: 'Plan the lighthouse restoration budget.' }]);
		ctx.store.setTitle(first, 'Lighthouse');
		const created = await runSlash('/new', api);
		expect(created.text).toMatch(/^New session /);
		expect(session.id).not.toBe(first);

		expect((await runSlash('/sessions', api)).text).toContain(first);
		const found = await runSlash('/search lighthouse', api);
		expect(found.text).toContain(first);
		expect((await runSlash('/search', api)).error).toMatch(/Usage/);

		const resumed = await runSlash(`/resume ${first.slice(0, first.length - 2)}`, api);
		expect(resumed.text).toBe(`Resumed ${first}: Lighthouse.`);
		expect(session.id).toBe(first);

		const exp = await runSlash('/export', api);
		const file = path.join(t.cwd, `three-ws-session-${first}.json`);
		expect(exp.text).toContain(file);
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).session.id).toBe(first);
	});

	it('/cron adds, pauses, resumes and removes a local schedule', async () => {
		const empty = await runSlash('/cron', api);
		expect(empty.text).toMatch(/No schedules yet/);
		expect(empty.text).toContain('every minute');

		const added = await runSlash('/cron add "every weekday at 9am" "summarize the inbox" --local', api);
		expect(added.error).toBeUndefined();
		const [cron] = ctx.store.listCrons();
		expect(cron).toMatchObject({ cron: '0 9 * * 1-5', mode: 'local', prompt: 'summarize the inbox', enabled: 1 });
		expect((await runSlash(`/cron off ${cron.id}`, api)).text).toMatch(/^Paused/);
		expect(ctx.store.getCron(cron.id).enabled).toBe(0);
		expect((await runSlash(`/cron on ${cron.id}`, api)).text).toMatch(/^Resumed/);
		expect((await runSlash(`/cron rm ${cron.id}`, api)).text).toMatch(/^Removed/);
		expect(ctx.store.listCrons()).toEqual([]);

		const refused = await runSlash('/cron add "every blue moon" "x"', api);
		expect(refused.error).toMatch(/Could not read the schedule "every blue moon"/);
		const server = await runSlash('/cron add "every hour" "x" --server', api);
		expect(server.error).toMatch(/sign-in/);
	});

	it('/subagent runs a child session whose report lands in the parent', async () => {
		const r = await runSlash('/subagent "describe this folder"', api);
		expect(r.text).toMatch(/^Subagent sa_\w+ started: describe this folder/);
		const [job] = api.pool.list();
		await waitFor(() => api.pool.list()[0].status === 'done');
		const list = await runSlash('/subagent list', api);
		expect(list.text).toContain(job.id);
		expect(list.text).toContain('done');
		const note = session.messages.at(-1);
		expect(note.role).toBe('user');
		expect(note.content).toContain(`Subagent ${job.id} finished`);
		expect(note.content).toContain('Subagent report: the folder holds one README.');
		expect((await runSlash(`/subagent cancel ${job.id}`, api)).error).toMatch(/No queued or running/);
	});

	it('/wallet and /agent explain the sign-in they need', async () => {
		expect((await runSlash('/wallet', api)).error).toMatch(/sign in|three\.ws tool/i);
		expect((await runSlash('/agent', api)).error).toMatch(/sign-in/);
	});
});
