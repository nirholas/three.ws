// Subagents against a local streaming chat-completions server: the pool never
// runs more than maxConcurrent children at once, a child stops offering tools
// once its own tool-round budget is spent, usage lands on its run row, and a
// queued child can be cancelled before it starts.

import { afterEach, describe, expect, it } from 'vitest';
import { createSession } from '../src/session.js';
import { createSubagentPool } from '../src/subagent.js';
import { modelServer, tempEnv, testContext } from './helpers.js';

const cleanups = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()();
});

async function setup(reply, extra) {
	const t = tempEnv();
	const srv = await modelServer(reply);
	const ctx = testContext(t.env, srv.baseUrl, extra);
	cleanups.push(t.cleanup, srv.close, () => ctx.close());
	return { t, srv, ctx };
}

describe('subagent pool', () => {
	it('runs at most maxConcurrent children at once and reports each into the parent', async () => {
		const { srv, ctx } = await setup(() => ({ content: 'Done with my part.', hold: new Promise((r) => setTimeout(r, 150)) }));
		const parent = createSession(ctx);
		const pool = createSubagentPool(ctx, { maxConcurrent: 2 });
		const snapshots = [];
		pool.subscribe((list) => snapshots.push(list.filter((j) => j.status === 'running').length));

		const jobs = ['one', 'two', 'three', 'four', 'five'].map((g) => pool.spawn({ goal: `count to ${g}`, parent }));
		expect(pool.running).toBe(0);
		expect(jobs.map((j) => j.status)).toEqual(['queued', 'queued', 'queued', 'queued', 'queued']);
		const done = await Promise.all(jobs.map((j) => j.done));

		expect(done.map((j) => j.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
		expect(srv.requests).toHaveLength(5);
		expect(srv.peak).toBe(2);
		expect(Math.max(...snapshots)).toBe(2);

		const notes = parent.messages.filter((m) => m.role === 'user' && m.content.startsWith('Subagent '));
		expect(notes).toHaveLength(5);
		for (const j of done) {
			const child = ctx.store.getSession(j.sessionId);
			expect(child).toMatchObject({ kind: 'subagent', parent_id: parent.id });
			const run = ctx.store.getRun(j.runId);
			expect(run).toMatchObject({ kind: 'subagent', status: 'done', result: 'Done with my part.', prompt_tokens: 10, completion_tokens: 5 });
		}
	});

	it('stops offering tools once the child budget of tool rounds is spent', async () => {
		const { srv, ctx } = await setup(() => ({ toolCalls: [{ name: 'list_dir', args: { path: '.' } }] }), { subagent: { maxToolRounds: 2, maxSteps: 24, maxConcurrent: 1 } });
		const pool = createSubagentPool(ctx);
		const job = await pool.spawn({ goal: 'look around forever' }).done;

		expect(job.status).toBe('done');
		expect(srv.requests).toHaveLength(3);
		expect(srv.requests[0].tools.map((t) => t.function.name)).toContain('list_dir');
		expect(srv.requests[1].tools.length).toBeGreaterThan(0);
		expect(srv.requests[2].tools ?? []).toEqual([]);
		const toolResults = srv.requests[2].messages.filter((m) => m.role === 'tool');
		expect(toolResults).toHaveLength(2);
		expect(JSON.parse(toolResults[0].content)).toHaveProperty('entries');
		expect(job.usage).toEqual({ prompt_tokens: 30, completion_tokens: 15 });
	});

	it('cancels a queued child before it starts and a running one mid-stream', async () => {
		let release;
		const hold = new Promise((r) => {
			release = r;
		});
		const { srv, ctx } = await setup(() => ({ content: 'still going', hold }));
		const pool = createSubagentPool(ctx, { maxConcurrent: 1 });
		const running = pool.spawn({ goal: 'long task' });
		const queued = pool.spawn({ goal: 'waiting task' });
		while (srv.requests.length < 1) await new Promise((r) => setTimeout(r, 5));

		expect(pool.cancel(queued.id)).toBe(true);
		expect((await queued.done).status).toBe('cancelled');
		expect(pool.cancel(running.id)).toBe(true);
		const r = await running.done;
		release();
		expect(r.status).toBe('cancelled');
		expect(ctx.store.getRun(r.runId).status).toBe('cancelled');
		expect(srv.requests).toHaveLength(1);
		expect(pool.cancel('sa_missing')).toBe(false);
	});

	it('refuses an empty goal', async () => {
		const { ctx } = await setup(() => ({ content: 'x' }));
		expect(() => createSubagentPool(ctx).spawn({ goal: '  ' })).toThrow(/needs a goal/);
	});
});
