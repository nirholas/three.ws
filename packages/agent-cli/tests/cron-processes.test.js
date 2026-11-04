// Two real `three-ws-agent cron run --once` processes on one database file,
// started together while a schedule is due: the model endpoint must see the
// prompt exactly once, and the store must record exactly one run.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { saveConfig } from '../src/config.js';
import { databasePath } from '../src/paths.js';
import { addSchedule } from '../src/scheduler.js';
import { openStore } from '../src/store.js';
import { modelServer, tempEnv } from './helpers.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'three-ws-agent.js');

function runCli(args, t) {
	const env = { PATH: process.env.PATH, HOME: t.home, ...t.env.vars };
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [BIN, ...args], { cwd: t.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		child.stdout.on('data', (c) => {
			out += c;
		});
		child.stderr.on('data', (c) => {
			err += c;
		});
		child.on('close', (code) => resolve({ code, out, err }));
	});
}

const cleanups = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()();
});

describe('cron run --once in two processes', () => {
	it('fires a due schedule exactly once', async () => {
		const t = tempEnv();
		cleanups.push(t.cleanup);
		const srv = await modelServer(() => ({ content: 'Queue checked: nothing waiting.', hold: new Promise((r) => setTimeout(r, 400)) }));
		cleanups.push(srv.close);
		saveConfig({ model: { provider: 'openai', baseUrl: srv.baseUrl, model: 'test-model' } }, t.env);

		const store = openStore(databasePath(t.env));
		const cron = await addSchedule({ store, when: 'every minute', prompt: 'check the queue', tz: 'UTC', now: new Date(Date.now() - 120_000) });
		store.close();

		const [a, b] = await Promise.all([runCli(['cron', 'run', '--once'], t), runCli(['cron', 'run', '--once'], t)]);
		expect(a.err + b.err).toBe('');
		expect([a.code, b.code]).toEqual([0, 0]);
		const outputs = [a.out, b.out];
		expect(outputs.filter((o) => o.includes('Nothing was due.'))).toHaveLength(1);
		expect(outputs.join('\n')).toContain(cron.id);
		expect(srv.requests).toHaveLength(1);
		expect(srv.requests[0].messages.at(-1)).toEqual({ role: 'user', content: 'check the queue' });

		const after = openStore(databasePath(t.env));
		const row = after.getCron(cron.id);
		expect(row.last_status).toBe('done');
		expect(Date.parse(row.next_run_at)).toBeGreaterThan(Date.now());
		const runs = after.listRuns({ limit: 10 });
		expect(runs.filter((r) => r.kind === 'cron')).toHaveLength(1);
		after.close();
	});
});
