// Forge Workflows graph core: preflight, topological scheduling, For Each
// expansion, connection rules, signatures and the portable JSON format.

import { describe, expect, it } from 'vitest';
import {
	WORKFLOW_KIND,
	blockingIssues,
	buildPlan,
	canConnect,
	connect,
	parseWorkflow,
	preflight,
	pruneInvalidEdges,
	removeNodes,
	serializeWorkflow,
	stepSignature,
	topoSort,
} from '../src/forge-workflows/graph.js';
import { NODE_TYPES } from '../src/forge-workflows/node-types.js';
import { TEMPLATES, instantiateTemplate } from '../src/forge-workflows/templates.js';

const T = NODE_TYPES;
const img = (n) => ({ url: `https://three.ws/forge-uploads/test-${n}.png`, name: `photo-${n}.png` });

function wf(nodes, edges = []) {
	return {
		kind: WORKFLOW_KIND,
		version: 1,
		name: 'Test',
		nodes: nodes.map(([id, type, x = 0, y = 0, params = {}]) => ({ id, type, x, y, params: { ...defaults(type), ...params } })),
		edges: edges.map(([from, fromPort, to, toPort], i) => ({ id: `e${i}`, from: { node: from, port: fromPort }, to: { node: to, port: toPort } })),
	};
}

function defaults(type) {
	const out = {};
	for (const p of T[type].params || []) if (p.default !== undefined) out[p.id] = JSON.parse(JSON.stringify(p.default));
	return out;
}

const keys = (issues) => issues.map((i) => i.key);

describe('preflight', () => {
	it('reports an empty canvas and nothing else', () => {
		const issues = preflight(wf([]), T);
		expect(keys(issues)).toEqual(['empty']);
	});

	it('passes a complete text to rig to export chain', () => {
		const w = wf(
			[
				['p', 'prompt', 0, 0, { text: 'a brass lantern' }],
				['g', 'generate', 200],
				['r', 'rig', 400],
				['x', 'export', 600],
			],
			[
				['p', 'text', 'g', 'prompt'],
				['g', 'mesh', 'r', 'mesh'],
				['r', 'mesh', 'x', 'mesh'],
			],
		);
		expect(blockingIssues(preflight(w, T))).toEqual([]);
	});

	it('flags a missing required input once, naming the port', () => {
		const w = wf([['g', 'generate'], ['x', 'export']], [['g', 'mesh', 'x', 'mesh']]);
		const issues = preflight(w, T);
		const missing = issues.filter((i) => i.key.includes(':missing:'));
		expect(missing).toHaveLength(1);
		expect(missing[0]).toMatchObject({ nodeId: 'g', level: 'error' });
		expect(missing[0].message).toMatch(/Prompt/);
	});

	it('treats the optional hint port on image generation as optional', () => {
		const w = wf(
			[
				['i', 'image', 0, 0, { images: [img(1)] }],
				['g', 'generate', 200, 0, { mode: 'image' }],
				['v', 'preview', 400],
			],
			[
				['i', 'image', 'g', 'image'],
				['g', 'mesh', 'v', 'mesh'],
			],
		);
		expect(blockingIssues(preflight(w, T))).toEqual([]);
	});

	it('runs node validators: empty prompt, missing photo, bad GLB link', () => {
		const w = wf([
			['p', 'prompt'],
			['i', 'image'],
			['m', 'loadMesh', 0, 0, { url: 'http://insecure.example/model.glb' }],
		]);
		const msgs = preflight(w, T).map((i) => i.message).join('\n');
		expect(msgs).toMatch(/write a prompt/);
		expect(msgs).toMatch(/upload a photo/);
		expect(msgs).toMatch(/https:\/\//);
	});

	it('flags a type mismatch on an imported edge', () => {
		const w = wf(
			[
				['i', 'image', 0, 0, { images: [img(1)] }],
				['r', 'rig'],
			],
			[['i', 'image', 'r', 'mesh']],
		);
		expect(keys(preflight(w, T))).toContain('e0:type');
	});

	it('detects a cycle', () => {
		const w = wf(
			[
				['a', 'remesh'],
				['b', 'rig'],
			],
			[
				['a', 'mesh', 'b', 'mesh'],
				['b', 'mesh', 'a', 'mesh'],
			],
		);
		expect(keys(preflight(w, T))).toContain('cycle');
	});

	it('warns (does not block) when a For Each has nothing after it', () => {
		const w = wf([['f', 'forEach', 0, 0, { images: [img(1)] }]]);
		const issues = preflight(w, T);
		expect(issues.find((i) => i.key === 'f:empty-body')?.level).toBe('warning');
		expect(blockingIssues(issues)).toEqual([]);
	});

	it('rejects a nested For Each and a node fed by two loops', () => {
		const nested = wf(
			[
				['f1', 'forEach', 0, 0, { mode: 'text', prompts: 'a\nb' }],
				['f2', 'forEach', 0, 0, { mode: 'text', prompts: 'c' }],
				['g', 'generate'],
			],
			[
				['f1', 'item', 'g', 'prompt'],
				['f2', 'item', 'g', 'prompt'],
			],
		);
		expect(keys(preflight(nested, T))).toContain('g:two-loops');
	});

	it('uses live context: an unconfigured engine blocks, a down engine warns', () => {
		const catalog = { backends: [{ id: 'eng-a', label: 'Engine A', configured: false }, { id: 'eng-b', label: 'Engine B', configured: true, user_images: true }] };
		const make = (engine) =>
			wf(
				[
					['p', 'prompt', 0, 0, { text: 'chair' }],
					['g', 'generate', 200, 0, { engine }],
				],
				[['p', 'text', 'g', 'prompt']],
			);
		expect(blockingIssues(preflight(make('eng-a'), T, { catalog })).map((i) => i.nodeId)).toContain('g');
		const down = preflight(make('eng-b'), T, { catalog, health: { 'eng-b': { status: 'down' } } });
		expect(blockingIssues(down)).toEqual([]);
		expect(down.some((i) => i.level === 'warning' && /down/.test(i.message))).toBe(true);
	});

	it('blocks a Modly engine until Modly is connected with a downloaded model', () => {
		const w = wf(
			[
				['i', 'image', 0, 0, { images: [img(1)] }],
				['g', 'generate', 200, 0, { mode: 'image', engine: 'modly', modlyModel: 'm1' }],
			],
			[['i', 'image', 'g', 'image']],
		);
		expect(blockingIssues(preflight(w, T, {})).length).toBe(1);
		expect(blockingIssues(preflight(w, T, { modly: { models: [{ id: 'm1', name: 'M1', downloaded: false }] } })).length).toBe(1);
		expect(blockingIssues(preflight(w, T, { modly: { models: [{ id: 'm1', name: 'M1', downloaded: true }] } }))).toEqual([]);
	});

	it('every template passes preflight once its inputs are filled', () => {
		for (const t of TEMPLATES) {
			const w = instantiateTemplate(t.id);
			for (const n of w.nodes) {
				if (n.type === 'image') n.params.images = [img(1)];
				if (n.type === 'forEach') n.params.images = [img(1), img(2)];
			}
			expect(blockingIssues(preflight(w, T, { signedIn: true })), t.id).toEqual([]);
		}
	});
});

describe('topoSort', () => {
	it('orders dependencies first and breaks ties by canvas position', () => {
		const w = wf(
			[
				['x', 'export', 600, 200],
				['v', 'preview', 600, 0],
				['g', 'generate', 200],
				['p', 'prompt', 0],
			],
			[
				['p', 'text', 'g', 'prompt'],
				['g', 'mesh', 'v', 'mesh'],
				['g', 'mesh', 'x', 'mesh'],
			],
		);
		expect(topoSort(w)).toEqual({ order: ['p', 'g', 'v', 'x'], cycle: [] });
	});

	it('returns the nodes it could not place when there is a cycle', () => {
		const w = wf(
			[
				['p', 'prompt'],
				['a', 'remesh'],
				['b', 'rig'],
			],
			[
				['a', 'mesh', 'b', 'mesh'],
				['b', 'mesh', 'a', 'mesh'],
			],
		);
		const { order, cycle } = topoSort(w);
		expect(order).toEqual(['p']);
		expect(cycle.sort()).toEqual(['a', 'b']);
	});
});

describe('buildPlan and For Each expansion', () => {
	const batch = () =>
		wf(
			[
				['f', 'forEach', 0, 0, { mode: 'text', prompts: 'chair\ntable\n\nlamp' }],
				['g', 'generate', 200],
				['v', 'preview', 400, 0],
				['s', 'save', 400, 200],
			],
			[
				['f', 'item', 'g', 'prompt'],
				['g', 'mesh', 'v', 'mesh'],
				['g', 'mesh', 's', 'mesh'],
			],
		);

	it('replays the loop body once per item, skipping blank prompt lines', () => {
		const { steps } = buildPlan(batch(), T);
		expect(steps.map((s) => `${s.nodeId}${s.iter}`)).toEqual(['f0', 'g0', 'v0', 's0', 'f1', 'g1', 'v1', 's1', 'f2', 'g2', 'v2', 's2']);
	});

	it('runs a shared non-loop input before the loop block', () => {
		const w = wf(
			[
				['f', 'forEach', 0, 0, { images: [img(1), img(2)] }],
				['hint', 'prompt', 0, 300, { text: 'clean studio lighting' }],
				['g', 'generate', 200, 0, { mode: 'image' }],
			],
			[
				['f', 'item', 'g', 'image'],
				['hint', 'text', 'g', 'prompt'],
			],
		);
		const { steps, owner } = buildPlan(w, T);
		expect(steps[0]).toEqual({ nodeId: 'hint', iter: null });
		expect(steps.slice(1).map((s) => `${s.nodeId}${s.iter}`)).toEqual(['f0', 'g0', 'f1', 'g1']);
		expect(owner.get('g')).toBe('f');
		expect(owner.has('hint')).toBe(false);
	});

	it('emits no body steps for a loop with zero items', () => {
		const w = wf(
			[
				['f', 'forEach', 0, 0, { mode: 'text', prompts: '' }],
				['g', 'generate', 200],
			],
			[['f', 'item', 'g', 'prompt']],
		);
		expect(buildPlan(w, T).steps).toEqual([]);
	});
});

describe('connection rules', () => {
	const base = () =>
		wf([
			['p', 'prompt', 0, 0, { text: 'x' }],
			['i', 'image', 0, 200, { images: [img(1)] }],
			['g', 'generate', 200],
			['r', 'rig', 400],
		]);

	it('rejects mismatched types with a readable reason', () => {
		const res = canConnect(base(), T, { node: 'i', port: 'image' }, { node: 'r', port: 'mesh' });
		expect(res.ok).toBe(false);
		expect(res.reason).toMatch(/takes a 3D model, not an image/);
	});

	it('rejects self links and cycles', () => {
		let w = base();
		w = connect(w, T, { node: 'g', port: 'mesh' }, { node: 'r', port: 'mesh' }).workflow;
		expect(canConnect(w, T, { node: 'r', port: 'mesh' }, { node: 'r', port: 'mesh' }).ok).toBe(false);
		const loop = wf(
			[
				['a', 'remesh'],
				['b', 'rig'],
			],
			[['a', 'mesh', 'b', 'mesh']],
		);
		expect(canConnect(loop, T, { node: 'b', port: 'mesh' }, { node: 'a', port: 'mesh' }).reason).toMatch(/For Each/);
	});

	it('replaces an existing link into the same input', () => {
		let w = base();
		w = connect(w, T, { node: 'p', port: 'text' }, { node: 'g', port: 'prompt' }).workflow;
		const p2 = { id: 'p2', type: 'prompt', x: 0, y: 400, params: { text: 'y' } };
		w = { ...w, nodes: [...w.nodes, p2] };
		w = connect(w, T, { node: 'p2', port: 'text' }, { node: 'g', port: 'prompt' }).workflow;
		const into = w.edges.filter((e) => e.to.node === 'g' && e.to.port === 'prompt');
		expect(into).toHaveLength(1);
		expect(into[0].from.node).toBe('p2');
	});

	it('prunes links whose port changed type after a param edit', () => {
		let w = base();
		w = connect(w, T, { node: 'p', port: 'text' }, { node: 'g', port: 'prompt' }).workflow;
		w = connect(w, T, { node: 'i', port: 'image' }, { node: 'g', port: 'prompt' }).workflow;
		expect(w.edges).toHaveLength(1);
		const imageMode = { ...w, nodes: w.nodes.map((n) => (n.id === 'g' ? { ...n, params: { ...n.params, mode: 'image' } } : n)) };
		const linked = connect(imageMode, T, { node: 'i', port: 'image' }, { node: 'g', port: 'image' }).workflow;
		expect(pruneInvalidEdges(linked, T).edges).toHaveLength(2);
		const backToText = { ...linked, nodes: linked.nodes.map((n) => (n.id === 'g' ? { ...n, params: { ...n.params, mode: 'text' } } : n)) };
		expect(pruneInvalidEdges(backToText, T).edges.map((e) => e.to.port)).toEqual(['prompt']);
	});

	it('removing nodes removes their links', () => {
		let w = base();
		w = connect(w, T, { node: 'p', port: 'text' }, { node: 'g', port: 'prompt' }).workflow;
		w = connect(w, T, { node: 'g', port: 'mesh' }, { node: 'r', port: 'mesh' }).workflow;
		expect(removeNodes(w, ['g']).edges).toEqual([]);
	});
});

describe('stepSignature', () => {
	const chain = (text, filename = 'a') =>
		wf(
			[
				['p', 'prompt', 0, 0, { text }],
				['g', 'generate', 200],
				['x', 'export', 400, 0, { filename }],
			],
			[
				['p', 'text', 'g', 'prompt'],
				['g', 'mesh', 'x', 'mesh'],
			],
		);
	const sig = (w, id, iter = null) => stepSignature(w, T, id, iter, buildPlan(w, T));

	it('changes downstream when an upstream param changes', () => {
		expect(sig(chain('chair'), 'g')).not.toBe(sig(chain('table'), 'g'));
		expect(sig(chain('chair'), 'x')).not.toBe(sig(chain('table'), 'x'));
	});

	it('ignores params marked signatureExclude', () => {
		expect(sig(chain('chair', 'one'), 'x')).toBe(sig(chain('chair', 'two'), 'x'));
	});

	it('differs per loop item', () => {
		const w = wf(
			[
				['f', 'forEach', 0, 0, { mode: 'text', prompts: 'chair\ntable' }],
				['g', 'generate', 200],
			],
			[['f', 'item', 'g', 'prompt']],
		);
		expect(sig(w, 'g', 0)).not.toBe(sig(w, 'g', 1));
	});
});

describe('serialization', () => {
	it('round-trips a template through JSON', () => {
		const w = instantiateTemplate('text-rig-export');
		const back = parseWorkflow(serializeWorkflow(w, T), T);
		expect(back.nodes).toEqual(w.nodes.map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) })));
		expect(back.edges).toEqual(w.edges);
		expect(back.name).toBe(w.name);
	});

	it('gives every template instance fresh ids', () => {
		const a = instantiateTemplate('batch-save');
		const b = instantiateTemplate('batch-save');
		const ids = new Set(a.nodes.map((n) => n.id));
		expect(b.nodes.some((n) => ids.has(n.id))).toBe(false);
	});

	it('rejects files that are not workflows with a readable error', () => {
		expect(() => parseWorkflow('{nope', T)).toThrow(/not valid JSON/);
		expect(() => parseWorkflow({ kind: 'other' }, T)).toThrow(/not a three.ws Forge workflow/);
		expect(() => parseWorkflow({ kind: WORKFLOW_KIND, version: 99, nodes: [], edges: [] }, T)).toThrow(/newer version/);
		expect(() => parseWorkflow({ kind: WORKFLOW_KIND, version: 1, nodes: [{ id: 'a', type: 'teleport' }], edges: [] }, T)).toThrow(/unknown type/);
		expect(() => parseWorkflow({ kind: WORKFLOW_KIND, version: 1, nodes: [{ id: 'a', type: 'rig' }, { id: 'a', type: 'rig' }], edges: [] }, T)).toThrow(/duplicate id/);
	});

	it('fills defaults and drops links to missing nodes on import', () => {
		const w = parseWorkflow(
			{
				kind: WORKFLOW_KIND,
				version: 1,
				name: '  ',
				nodes: [{ id: 'g', type: 'generate', x: 'left' }],
				edges: [{ id: 'e', from: { node: 'ghost', port: 'text' }, to: { node: 'g', port: 'prompt' } }],
			},
			T,
		);
		expect(w.name).toBe('Imported workflow');
		expect(w.nodes[0]).toMatchObject({ x: 0, y: 0, params: { mode: 'text', engine: 'auto', tier: 'draft' } });
		expect(w.edges).toEqual([]);
	});
});
