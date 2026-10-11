// Forge Workflows runner: scheduling, partial failure, cancel, reuse and
// re-run from a failed node. Executors are injected, so these tests exercise
// the real scheduling code without the network.

import { describe, expect, it } from 'vitest';
import { WORKFLOW_KIND } from '../src/forge-workflows/graph.js';
import { NODE_TYPES } from '../src/forge-workflows/node-types.js';
import { StepError, createRunner, summarizeNode } from '../src/forge-workflows/runner.js';

const T = NODE_TYPES;

function wf(nodes, edges = []) {
	return {
		kind: WORKFLOW_KIND,
		version: 1,
		name: 'Test',
		nodes: nodes.map(([id, type, x = 0, y = 0, params = {}]) => ({ id, type, x, y, params })),
		edges: edges.map(([from, fromPort, to, toPort], i) => ({ id: `e${i}`, from: { node: from, port: fromPort }, to: { node: to, port: toPort } })),
	};
}

/** Executors that record calls and pass a mesh label down the chain. */
function recorder({ failOn = () => false } = {}) {
	const calls = [];
	const executors = {
		prompt: async ({ node }) => ({ outputs: { text: node.params.text } }),
		generate: async ({ node, inputs, iter, progress }) => {
			calls.push(`${node.id}${iter ?? ''}:${inputs.prompt}`);
			progress({ pct: 50, stage: 'meshing' });
			if (failOn(node.id, iter, inputs)) throw new StepError(`could not build ${inputs.prompt}`, { code: 'engine_down', action: { label: 'Status', href: '/status' } });
			return { outputs: { mesh: { url: `mesh:${inputs.prompt}` } } };
		},
		rig: async ({ node, inputs, iter }) => {
			calls.push(`${node.id}${iter ?? ''}:${inputs.mesh.url}`);
			if (failOn(node.id, iter, inputs)) throw new StepError('rig failed');
			return { outputs: { mesh: { url: `${inputs.mesh.url}+rig` } } };
		},
		export: async ({ node, inputs, iter }) => {
			calls.push(`${node.id}${iter ?? ''}:${inputs.mesh.url}`);
			return { outputs: {}, result: { note: inputs.mesh.url } };
		},
	};
	return { calls, executors };
}

const chain = (text = 'chair') =>
	wf(
		[
			['p', 'prompt', 0, 0, { text }],
			['g', 'generate', 200, 0, { mode: 'text', engine: 'auto', tier: 'draft' }],
			['r', 'rig', 400],
			['x', 'export', 600, 0, { filename: 'a' }],
		],
		[
			['p', 'text', 'g', 'prompt'],
			['g', 'mesh', 'r', 'mesh'],
			['r', 'mesh', 'x', 'mesh'],
		],
	);

const status = (runner, id) => runner.stepsFor(id).map((s) => s.status);

describe('runner scheduling', () => {
	it('runs steps in dependency order and passes outputs downstream', async () => {
		const { calls, executors } = recorder();
		const seen = [];
		const runner = createRunner({ types: T, executors, onChange: (s) => s.activeKey && seen.push(s.activeKey) });
		const final = await runner.run(chain());
		expect(final.status).toBe('done');
		expect(calls).toEqual(['g:chair', 'r:mesh:chair', 'x:mesh:chair+rig']);
		expect(runner.stepsFor('x')[0].result).toEqual({ note: 'mesh:chair+rig' });
		expect(seen).toContain('g#');
	});

	it('reports executor progress on the running step', async () => {
		const { executors } = recorder();
		const progress = [];
		const runner = createRunner({
			types: T,
			executors,
			onChange: (s) => {
				const g = s.steps.get('g#');
				if (g?.progress) progress.push(g.progress.pct);
			},
		});
		await runner.run(chain());
		expect(progress).toContain(50);
	});

	it('expands a For Each and keeps going after one item fails', async () => {
		const { calls, executors } = recorder({ failOn: (id, iter) => id === 'g' && iter === 1 });
		const w = wf(
			[
				['f', 'forEach', 0, 0, { mode: 'text', prompts: 'chair\ntable\nlamp' }],
				['g', 'generate', 200, 0, { mode: 'text', engine: 'auto', tier: 'draft' }],
				['x', 'export', 400, 0, { filename: 'a' }],
			],
			[
				['f', 'item', 'g', 'prompt'],
				['g', 'mesh', 'x', 'mesh'],
			],
		);
		const runner = createRunner({ types: T, executors });
		const final = await runner.run(w);
		expect(final.status).toBe('failed');
		expect(calls).toEqual(['g0:chair', 'x0:mesh:chair', 'g1:table', 'g2:lamp', 'x2:mesh:lamp']);
		expect(status(runner, 'g')).toEqual(['done', 'failed', 'done']);
		expect(status(runner, 'x')).toEqual(['done', 'skipped', 'done']);
		expect(summarizeNode(runner.stepsFor('g'))).toMatchObject({ status: 'failed', done: 2, failed: 1, total: 3 });
		const err = runner.stepsFor('g')[1].error;
		expect(err).toMatchObject({ message: 'could not build table', code: 'engine_down', actions: [{ label: 'Status', href: '/status' }] });
	});

	it('runs independent branches even when one branch fails', async () => {
		const { executors } = recorder({ failOn: (id) => id === 'r' });
		const w = wf(
			[
				['p', 'prompt', 0, 0, { text: 'chair' }],
				['g', 'generate', 200, 0, { mode: 'text', engine: 'auto', tier: 'draft' }],
				['r', 'rig', 400, 0],
				['x', 'export', 400, 200, { filename: 'a' }],
				['x2', 'export', 600, 0, { filename: 'b' }],
			],
			[
				['p', 'text', 'g', 'prompt'],
				['g', 'mesh', 'r', 'mesh'],
				['g', 'mesh', 'x', 'mesh'],
				['r', 'mesh', 'x2', 'mesh'],
			],
		);
		const runner = createRunner({ types: T, executors });
		await runner.run(w);
		expect(status(runner, 'r')).toEqual(['failed']);
		expect(status(runner, 'x')).toEqual(['done']);
		expect(status(runner, 'x2')).toEqual(['skipped']);
	});

	it('fails a step whose type has no executor, with a readable message', async () => {
		const runner = createRunner({ types: T, executors: { prompt: async ({ node }) => ({ outputs: { text: node.params.text } }) } });
		await runner.run(chain());
		expect(runner.stepsFor('g')[0].error.message).toMatch(/No runner for Generate 3D/);
	});

	it('refuses to run a graph with a cycle', async () => {
		const runner = createRunner({ types: T, executors: {} });
		const w = wf(
			[
				['a', 'rig'],
				['b', 'rig'],
			],
			[
				['a', 'mesh', 'b', 'mesh'],
				['b', 'mesh', 'a', 'mesh'],
			],
		);
		await expect(runner.run(w)).rejects.toThrow(/loop/);
	});
});

describe('cancel', () => {
	it('cancels the running step and every step after it', async () => {
		const executors = {
			...recorder().executors,
			generate: ({ signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
				}),
		};
		const runner = createRunner({ types: T, executors });
		const pending = runner.run(chain());
		await new Promise((r) => setTimeout(r, 0));
		expect(runner.state.status).toBe('running');
		expect(status(runner, 'g')).toEqual(['running']);
		await expect(runner.run(chain())).rejects.toThrow(/already in progress/);
		runner.cancel();
		const final = await pending;
		expect(final.status).toBe('cancelled');
		expect(status(runner, 'g')).toEqual(['cancelled']);
		expect(status(runner, 'r')).toEqual(['cancelled']);
		expect(status(runner, 'x')).toEqual(['cancelled']);
	});
});

describe('reuse and re-run', () => {
	it('reuses unchanged steps and re-runs only what an edit touched', async () => {
		const { calls, executors } = recorder();
		const runner = createRunner({ types: T, executors });
		await runner.run(chain());
		calls.length = 0;
		await runner.run(chain());
		expect(calls).toEqual([]);
		expect(runner.stepsFor('g')[0].reused).toBe(true);

		const renamed = chain();
		renamed.nodes.find((n) => n.id === 'x').params.filename = 'renamed';
		await runner.run(renamed);
		expect(calls).toEqual([]);

		await runner.run(chain('table'));
		expect(calls).toEqual(['g:table', 'r:mesh:table', 'x:mesh:table+rig']);
	});

	it('fresh mode ignores the cache', async () => {
		const { calls, executors } = recorder();
		const runner = createRunner({ types: T, executors });
		await runner.run(chain());
		calls.length = 0;
		await runner.run(chain(), { mode: 'fresh' });
		expect(calls).toHaveLength(3);
	});

	it('re-runs from a failed node, reusing everything upstream of it', async () => {
		let failRig = true;
		const { calls, executors } = recorder({ failOn: (id) => id === 'r' && failRig });
		const runner = createRunner({ types: T, executors });
		const first = await runner.run(chain());
		expect(first.status).toBe('failed');
		expect(status(runner, 'x')).toEqual(['skipped']);

		failRig = false;
		calls.length = 0;
		const second = await runner.run(chain(), { fromNodeId: 'r' });
		expect(second.status).toBe('done');
		expect(calls).toEqual(['r:mesh:chair', 'x:mesh:chair+rig']);
		expect(runner.stepsFor('g')[0].reused).toBe(true);
	});

	it('retries only the failed loop item', async () => {
		let failing = true;
		const { calls, executors } = recorder({ failOn: (id, iter) => failing && id === 'g' && iter === 1 });
		const w = wf(
			[
				['f', 'forEach', 0, 0, { mode: 'text', prompts: 'chair\ntable' }],
				['g', 'generate', 200, 0, { mode: 'text', engine: 'auto', tier: 'draft' }],
			],
			[['f', 'item', 'g', 'prompt']],
		);
		const runner = createRunner({ types: T, executors });
		await runner.run(w);
		failing = false;
		calls.length = 0;
		const final = await runner.run(w);
		expect(final.status).toBe('done');
		expect(calls).toEqual(['g1:table']);
	});

	it('invalidate drops a node and its downstream from the cache', async () => {
		const { executors } = recorder();
		const runner = createRunner({ types: T, executors });
		await runner.run(chain());
		const before = runner.cacheSize;
		runner.invalidate(chain(), 'r');
		expect(runner.cacheSize).toBe(before - 2);
	});
});
