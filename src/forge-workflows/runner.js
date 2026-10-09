// Forge Workflows: the run engine.
//
// Adapted from Modly (https://github.com/lightningpixel/modly), MIT License,
// Copyright (c) 2026 Lightning Pixel. The run model follows Modly's
// workflowRunStore.ts: steps execute one at a time in topological order, a For
// Each replays its downstream body once per item, the active step reports live
// progress, and a cancel flag stops the run between and during steps. Unlike
// Modly, a failed step does not pause the whole run: independent branches and
// the remaining loop items carry on, and the failure can be retried later
// without redoing the steps that already succeeded.
//
// The runner is network-free. Each node type's work is an executor function
// passed in by the caller (executors.js in the browser), which keeps the
// scheduling, reuse and cancel logic unit-testable.

import { buildPlan, incomingEdges, iteratorItems, downstreamOf, stepSignature, topoSort } from './graph.js';

/** Terminal step states. 'skipped' means an upstream step failed or was cancelled. */
export const STEP_STATES = ['pending', 'running', 'done', 'failed', 'cancelled', 'skipped'];

export class StepError extends Error {
	/**
	 * @param {string} message  shown to the user as-is
	 * @param {{ code?: string, action?: {label:string, href:string}, actions?: Array<{label:string, href:string}>, retryAfter?: number }} [info]
	 */
	constructor(message, info = {}) {
		super(message);
		this.name = 'StepError';
		this.code = info.code || 'failed';
		this.actions = info.actions || (info.action ? [info.action] : []);
		this.retryAfter = info.retryAfter || 0;
	}
}

function isAbort(err, signal) {
	return signal?.aborted || err?.name === 'AbortError' || err?.code === 'CANCELLED';
}

function key(nodeId, iter) {
	return `${nodeId}#${iter ?? ''}`;
}

/**
 * Aggregate a node's per-item step states into one card state.
 * A loop node with 3 items, 2 done and 1 failed reads as 'failed' with done=2.
 */
export function summarizeNode(steps) {
	const list = steps || [];
	const total = list.length;
	const count = (s) => list.filter((x) => x.status === s).length;
	const done = count('done');
	const failed = count('failed');
	const running = list.find((x) => x.status === 'running');
	let status = 'pending';
	if (running) status = 'running';
	else if (failed) status = 'failed';
	else if (total && done === total) status = 'done';
	else if (count('cancelled')) status = 'cancelled';
	else if (count('skipped') && count('skipped') + done === total) status = 'skipped';
	else if (done) status = 'partial';
	return { status, total, done, failed, running: running || null };
}

/**
 * Create a runner bound to a node registry and its executors.
 *
 * @param {object} opts
 * @param {object} opts.types       the node registry (node-types.js)
 * @param {object} opts.executors   { [type]: async (ctx) => ({ outputs, result }) }
 * @param {(state:object)=>void} [opts.onChange]  called after every state change
 */
export function createRunner({ types, executors, onChange = () => {} }) {
	// Results that survive between runs, keyed by node and item, each tagged with
	// the signature of the work that produced it.
	const cache = new Map();
	let controller = null;
	let state = idleState();

	function idleState() {
		return { status: 'idle', steps: new Map(), startedAt: 0, finishedAt: 0, plan: null, activeKey: null };
	}

	function emit() {
		try {
			onChange(state);
		} catch (err) {
			// A rendering error must not break the run; surface it for debugging.
			console.error('[forge-workflows] state listener failed', err);
		}
	}

	function setStep(nodeId, iter, patch) {
		const k = key(nodeId, iter);
		const prev = state.steps.get(k) || { nodeId, iter, status: 'pending' };
		state.steps.set(k, { ...prev, ...patch });
		if (patch.status === 'running') state.activeKey = k;
		else if (state.activeKey === k && patch.status) state.activeKey = null;
		emit();
	}

	/** Every step for a node, in item order. */
	function stepsFor(nodeId) {
		return [...state.steps.values()].filter((s) => s.nodeId === nodeId).sort((a, b) => (a.iter ?? -1) - (b.iter ?? -1));
	}

	function sourceIter(plan, srcId, nodeId, iter) {
		if (iter == null) return null;
		const loop = plan.owner.get(nodeId);
		return srcId === loop || plan.owner.get(srcId) === loop ? iter : null;
	}

	function resolveInputs(workflow, plan, nodeId, iter) {
		const inputs = {};
		for (const e of incomingEdges(workflow, nodeId)) {
			const src = state.steps.get(key(e.from.node, sourceIter(plan, e.from.node, nodeId, iter)));
			if (!src || src.status !== 'done') return { blocked: src?.status || 'pending' };
			inputs[e.to.port] = src.outputs?.[e.from.port];
		}
		return { inputs };
	}

	async function runStep(workflow, plan, step, ctxBase, sigMemo) {
		const node = workflow.nodes.find((n) => n.id === step.nodeId);
		const def = types[node.type];
		const { nodeId, iter } = step;
		const sig = stepSignature(workflow, types, nodeId, iter, plan, sigMemo);

		const { inputs, blocked } = resolveInputs(workflow, plan, nodeId, iter);
		if (blocked) {
			setStep(nodeId, iter, { status: blocked === 'cancelled' ? 'cancelled' : 'skipped', error: null });
			return;
		}

		const hit = cache.get(key(nodeId, iter));
		if (hit && hit.sig === sig) {
			setStep(nodeId, iter, { status: 'done', outputs: hit.outputs, result: hit.result, reused: true, error: null, progress: null });
			return;
		}

		const startedAt = Date.now();
		setStep(nodeId, iter, { status: 'running', startedAt, progress: null, error: null, reused: false, outputs: null, result: null });

		if (def.iterator) {
			const item = iteratorItems(types, node)[iter];
			const outputs = { item };
			cache.set(key(nodeId, iter), { sig, outputs, result: null });
			setStep(nodeId, iter, { status: 'done', outputs, finishedAt: Date.now() });
			return;
		}

		const execute = executors[node.type];
		if (!execute) {
			setStep(nodeId, iter, { status: 'failed', error: { message: `No runner for ${def.label}.`, actions: [] } });
			return;
		}
		const signal = controller.signal;
		const progress = (info) => {
			if (signal.aborted) return;
			const cur = state.steps.get(key(nodeId, iter));
			if (cur?.status !== 'running') return;
			setStep(nodeId, iter, { progress: { ...info, at: Date.now() } });
		};
		try {
			const res = (await execute({ node, params: node.params || {}, inputs, iter, signal, progress, ...ctxBase })) || {};
			if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
			const outputs = res.outputs || {};
			cache.set(key(nodeId, iter), { sig, outputs, result: res.result || null });
			setStep(nodeId, iter, { status: 'done', outputs, result: res.result || null, finishedAt: Date.now(), progress: null });
		} catch (err) {
			if (isAbort(err, signal)) {
				setStep(nodeId, iter, { status: 'cancelled', progress: null, finishedAt: Date.now() });
				return;
			}
			setStep(nodeId, iter, {
				status: 'failed',
				progress: null,
				finishedAt: Date.now(),
				error: {
					message: err?.message || 'This step failed.',
					code: err?.code || 'failed',
					actions: Array.isArray(err?.actions) ? err.actions : [],
					retryAfter: err?.retryAfter || 0,
				},
			});
		}
	}

	/**
	 * Run a workflow.
	 * @param {object} workflow
	 * @param {object} [opts]
	 * @param {'reuse'|'fresh'} [opts.mode]  'reuse' keeps unchanged results from the last run
	 * @param {string} [opts.fromNodeId]     invalidate this node and everything after it first
	 * @param {object} [opts.context]        extra fields passed to every executor
	 * @returns {Promise<object>} the final state
	 */
	async function run(workflow, { mode = 'reuse', fromNodeId = null, context = {} } = {}) {
		if (state.status === 'running') throw new Error('A run is already in progress.');
		if (mode === 'fresh') cache.clear();
		if (fromNodeId) invalidate(workflow, fromNodeId);

		const { order, cycle } = topoSort(workflow);
		if (cycle.length) throw new Error('The workflow has a loop. Remove one of the links first.');
		const plan = buildPlan(workflow, types, { order });

		controller = new AbortController();
		state = { status: 'running', steps: new Map(), startedAt: Date.now(), finishedAt: 0, plan, activeKey: null };
		for (const s of plan.steps) state.steps.set(key(s.nodeId, s.iter), { nodeId: s.nodeId, iter: s.iter, status: 'pending' });
		emit();

		const sigMemo = new Map();
		const ctxBase = { workflow, ...context };
		for (const step of plan.steps) {
			if (controller.signal.aborted) {
				const cur = state.steps.get(key(step.nodeId, step.iter));
				if (cur.status === 'pending') setStep(step.nodeId, step.iter, { status: 'cancelled' });
				continue;
			}
			await runStep(workflow, plan, step, ctxBase, sigMemo);
		}

		const all = [...state.steps.values()];
		const anyFailed = all.some((s) => s.status === 'failed');
		const anyCancelled = all.some((s) => s.status === 'cancelled');
		state.status = controller.signal.aborted || (anyCancelled && !anyFailed) ? 'cancelled' : anyFailed ? 'failed' : 'done';
		state.finishedAt = Date.now();
		state.activeKey = null;
		controller = null;
		emit();
		return state;
	}

	/** Forget cached results for a node and everything downstream of it. */
	function invalidate(workflow, nodeId) {
		const ids = downstreamOf(workflow, nodeId);
		ids.add(nodeId);
		for (const k of [...cache.keys()]) if (ids.has(k.slice(0, k.lastIndexOf('#')))) cache.delete(k);
	}

	function cancel() {
		if (controller && !controller.signal.aborted) controller.abort();
	}

	/** Drop the visible run state (keeps reusable results). */
	function reset() {
		if (state.status === 'running') return;
		state = idleState();
		emit();
	}

	return {
		run,
		cancel,
		reset,
		invalidate,
		clearCache: () => cache.clear(),
		stepsFor,
		get state() {
			return state;
		},
		get cacheSize() {
			return cache.size;
		},
	};
}
