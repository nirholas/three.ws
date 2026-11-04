// Subagents: an isolated child run with its own transcript and budget that
// reports back into the parent session.
//
// Each child gets a fresh session (kind `subagent`, parent_id set) whose only
// context is the goal, runs under `config.subagent` (8 tool rounds, 24 steps
// by default) and is recorded as a `subagent` run with its token usage and
// billed USD. At most `config.subagent.maxConcurrent` run at once; extra ones
// wait in order. They run in parallel with the parent's own turns, and every
// one can be cancelled. When a child ends, its summary is posted into the
// parent session as a message the parent model reads on its next turn.

import { InterruptedError } from './loop.js';
import { createSession } from './session.js';
import { newId } from './store.js';

/**
 * @param {ReturnType<import('./session.js').createAgentContext>} ctx
 * @param {{ maxConcurrent?: number }} [o]
 */
export function createSubagentPool(ctx, { maxConcurrent } = {}) {
	const limit = Math.max(1, Number(maxConcurrent || ctx.config.subagent?.maxConcurrent || 4));
	const jobs = new Map();
	const waiting = [];
	let active = 0;
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn(list());
	};

	function list() {
		return [...jobs.values()].map(({ id, goal, status, sessionId, runId, startedAt, finishedAt, summary, error, usage, billedUsd }) => ({
			id, goal, status, sessionId, runId, startedAt, finishedAt, summary, error, usage, billedUsd,
		}));
	}

	function acquire(job) {
		if (active < limit) {
			active++;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			waiting.push({ job, resolve, reject });
		});
	}

	function release() {
		const next = waiting.shift();
		if (next) next.resolve();
		else active--;
	}

	/**
	 * Spawn a subagent. Returns the job immediately; `job.done` resolves with the final state.
	 * @param {object} o
	 * @param {string} o.goal
	 * @param {object} [o.parent]   the parent session (createSession); its id is recorded and it gets the report
	 * @param {Function} [o.approve] the parent's approver, so a child's write or payment still asks the person
	 * @param {Function} [o.onEvent]
	 */
	function spawn({ goal, parent = null, approve = null, onEvent }) {
		const text = String(goal || '').trim();
		if (!text) throw new Error('A subagent needs a goal: /subagent <what it should do>.');
		const controller = new AbortController();
		const job = {
			id: null,
			goal: text,
			status: 'queued',
			sessionId: null,
			runId: null,
			startedAt: null,
			finishedAt: null,
			summary: null,
			error: null,
			usage: { prompt_tokens: 0, completion_tokens: 0 },
			billedUsd: 0,
			controller,
		};
		job.id = newId('sa');
		jobs.set(job.id, job);
		notify();

		job.done = (async () => {
			try {
				await acquire(job);
			} catch (err) {
				job.status = 'cancelled';
				job.error = String(err?.message || err);
				job.finishedAt = new Date().toISOString();
				notify();
				return job;
			}
			if (controller.signal.aborted) {
				release();
				job.status = 'cancelled';
				job.finishedAt = new Date().toISOString();
				notify();
				return job;
			}
			job.status = 'running';
			job.startedAt = new Date().toISOString();
			const child = createSession(ctx, { kind: 'subagent', parentId: parent?.id || null, title: text.slice(0, 80), budget: ctx.config.subagent });
			job.sessionId = child.id;
			job.runId = ctx.store.startRun({ kind: 'subagent', sessionId: child.id, parentSessionId: parent?.id || null, goal: text });
			notify();
			try {
				const result = await child.send(text, {
					approve: approve ? (req) => approve({ ...req, subagent: job.id }) : null,
					signal: controller.signal,
					onEvent: (e) => onEvent?.({ ...e, subagent: job.id }),
				});
				job.status = 'done';
				job.summary = result.answer;
				job.usage = result.usage;
				job.billedUsd = result.billedUsd;
				ctx.store.finishRun(job.runId, { status: 'done', result: result.answer, usage: result.usage, billedUsd: result.billedUsd });
			} catch (err) {
				job.status = err instanceof InterruptedError ? 'cancelled' : 'error';
				job.error = err instanceof InterruptedError ? 'cancelled' : String(err?.message || err);
				ctx.store.finishRun(job.runId, { status: job.status, error: job.error });
			} finally {
				release();
				job.finishedAt = new Date().toISOString();
			}
			if (parent) {
				const body =
					job.status === 'done'
						? `Subagent ${job.id} finished (session ${child.id}). This is its report, not a message from the owner.\nGoal: ${text}\n\n${job.summary}`
						: `Subagent ${job.id} ${job.status === 'cancelled' ? 'was cancelled' : `failed: ${job.error}`} (goal: ${text}). This is a status note, not a message from the owner.`;
				parent.note(body);
			}
			notify();
			return job;
		})();
		return job;
	}

	function cancel(id) {
		const job = jobs.get(id);
		if (!job || !['queued', 'running'].includes(job.status)) return false;
		job.controller.abort();
		const i = waiting.findIndex((w) => w.job === job);
		if (i >= 0) waiting.splice(i, 1)[0].reject(new Error('cancelled before it started'));
		return true;
	}

	return {
		limit,
		spawn,
		cancel,
		list,
		get running() {
			return [...jobs.values()].filter((j) => j.status === 'running').length;
		},
		get queued() {
			return waiting.length;
		},
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		async cancelAll() {
			for (const id of jobs.keys()) cancel(id);
			await Promise.all([...jobs.values()].map((j) => j.done));
		},
	};
}

/** One-shot helper: run a single subagent and wait for it. */
export async function runSubagent(ctx, { goal, parent = null, approve = null, onEvent } = {}) {
	const pool = createSubagentPool(ctx);
	return pool.spawn({ goal, parent, approve, onEvent }).done;
}
