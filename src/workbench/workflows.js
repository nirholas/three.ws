// Workflow model for the Workbench: node types, the built-in templates, chain
// validation, and per-browser persistence.
//
// A workflow is a typed chain. Every node has at most one input and one output
// port, typed `image` or `mesh`, so a valid workflow is a single path from the
// Image source to Add to Scene in which every wire joins matching types.

export const NODE_TYPES = {
	image: {
		label: 'Image',
		in: null,
		out: 'image',
		locked: true,
		blurb: 'The photo to reconstruct, or a text prompt the server turns into a reference image.',
		params: [],
	},
	rembg: {
		label: 'Remove Background',
		in: 'image',
		out: 'image',
		blurb: 'Cuts the subject out on a GPU worker before reconstruction.',
		params: [
			{
				key: 'model',
				label: 'Model',
				type: 'select',
				default: 'birefnet',
				options: [
					['birefnet', 'BiRefNet'],
					['isnet', 'ISNet'],
					['u2net', 'U2-Net'],
					['u2net_human_seg', 'U2-Net human'],
				],
			},
		],
	},
	generate: {
		label: 'Generate Mesh',
		in: 'image',
		out: 'mesh',
		locked: true,
		blurb: 'Reconstructs a textured GLB on the platform GPU lanes.',
		params: [
			{ key: 'backend', label: 'Engine', type: 'lane', default: 'auto' },
			{
				key: 'tier',
				label: 'Quality',
				type: 'select',
				default: 'standard',
				options: [
					['draft', 'Draft (fast)'],
					['standard', 'Standard'],
					['high', 'High ($THREE holders)'],
				],
			},
			{
				key: 'resolution',
				label: 'Resolution',
				type: 'select',
				default: '',
				hint: 'TRELLIS.2 voxel grid',
				options: [
					['', 'Auto'],
					['512', '512'],
					['1024', '1024'],
					['1536', '1536'],
				],
			},
			{ key: 'target_polycount', label: 'Face budget', type: 'number', default: '', min: 100, max: 500000, step: 1000, placeholder: 'Auto' },
			{
				key: 'texture_size',
				label: 'Texture',
				type: 'select',
				default: '',
				options: [
					['', 'Auto'],
					['512', '512 px'],
					['1024', '1024 px'],
					['2048', '2048 px'],
					['4096', '4096 px'],
				],
			},
			{
				key: 'output_format',
				label: 'Compression',
				type: 'select',
				default: 'glb',
				options: [
					['glb', 'None'],
					['glb-meshopt', 'Meshopt'],
					['glb-draco', 'Draco'],
				],
			},
			{ key: 'seed', label: 'Seed', type: 'seed', default: '' },
		],
	},
	restyle: {
		label: 'Restyle Materials',
		in: 'mesh',
		out: 'mesh',
		blurb: 'Rewrites the PBR materials from a plain-language instruction.',
		params: [{ key: 'instruction', label: 'Look', type: 'text', default: 'brushed steel', maxLength: 300 }],
	},
	remesh: {
		label: 'Remesh',
		in: 'mesh',
		out: 'mesh',
		blurb: 'Server-side retopology to a clean triangle, quad or low-poly mesh.',
		params: [
			{
				key: 'mode',
				label: 'Topology',
				type: 'select',
				default: 'triangle',
				options: [
					['triangle', 'Triangles'],
					['quad', 'Quads'],
					['lowpoly', 'Low poly'],
				],
			},
			{ key: 'target_faces', label: 'Faces', type: 'number', default: 20000, min: 1000, max: 500000, step: 1000 },
		],
	},
	decimate: {
		label: 'Decimate',
		in: 'mesh',
		out: 'mesh',
		blurb: 'In-browser edge-collapse simplification. Instant, undoable.',
		params: [{ key: 'ratio', label: 'Keep', type: 'range', default: 0.5, min: 0.05, max: 0.95, step: 0.05, format: 'percent' }],
	},
	smooth: {
		label: 'Smooth',
		in: 'mesh',
		out: 'mesh',
		blurb: 'In-browser Taubin smoothing that does not shrink the mesh.',
		params: [{ key: 'iterations', label: 'Passes', type: 'range', default: 4, min: 1, max: 20, step: 1 }],
	},
	rig: {
		label: 'Auto-Rig',
		in: 'mesh',
		out: 'mesh',
		blurb: 'Adds a skeleton and skin weights so the model can animate.',
		params: [],
	},
	output: {
		label: 'Add to Scene',
		in: 'mesh',
		out: null,
		locked: true,
		blurb: 'Loads the result into the viewport and the history.',
		params: [],
	},
};

/** Node types offered in the editor palette, in display order. */
export const PALETTE = ['rembg', 'restyle', 'remesh', 'decimate', 'smooth', 'rig'];

export function defaultParams(type) {
	return Object.fromEntries(NODE_TYPES[type].params.map((p) => [p.key, p.default]));
}

let seq = 0;
export function newNodeId() {
	seq += 1;
	return `n${Date.now().toString(36)}${seq}`;
}

function chain(name, types, overrides = {}) {
	const nodes = types.map((type, i) => ({
		id: `${type}-${i}`,
		type,
		x: 40 + i * 236,
		y: 90 + (i % 2) * 44,
		enabled: true,
		collapsed: false,
		params: { ...defaultParams(type), ...(overrides[type] || {}) },
	}));
	const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
	return { name, nodes, edges };
}

export const TEMPLATES = [
	{ id: 'image-to-3d', ...chain('Image to 3D', ['image', 'generate', 'output']) },
	{
		id: 'game-ready',
		...chain('Game-ready prop', ['image', 'generate', 'decimate', 'smooth', 'output'], {
			generate: { tier: 'draft', output_format: 'glb-meshopt' },
			decimate: { ratio: 0.35 },
			smooth: { iterations: 2 },
		}),
	},
	{ id: 'rigged-character', ...chain('Rigged character', ['image', 'rembg', 'generate', 'rig', 'output']) },
	{ id: 'retopo', ...chain('Clean quad retopo', ['image', 'generate', 'remesh', 'output'], { remesh: { mode: 'quad', target_faces: 12000 } }) },
	{ id: 'restyled', ...chain('Restyled prop', ['image', 'generate', 'restyle', 'output'], { restyle: { instruction: 'polished gold' } }) },
];

/**
 * Validate a workflow and resolve its run order.
 * @returns {{ ok: boolean, order: object[], errors: {nodeId?: string, message: string}[] }}
 */
export function validate(flow) {
	const errors = [];
	const byId = new Map(flow.nodes.map((n) => [n.id, n]));
	const outgoing = new Map();
	const incoming = new Map();
	for (const e of flow.edges) {
		const a = byId.get(e.from);
		const b = byId.get(e.to);
		if (!a || !b) continue;
		if (outgoing.has(a.id)) errors.push({ nodeId: a.id, message: `${NODE_TYPES[a.type].label} feeds more than one node.` });
		if (incoming.has(b.id)) errors.push({ nodeId: b.id, message: `${NODE_TYPES[b.type].label} has more than one input.` });
		outgoing.set(a.id, b);
		incoming.set(b.id, a);
		const outT = NODE_TYPES[a.type].out;
		const inT = NODE_TYPES[b.type].in;
		if (outT !== inT) {
			errors.push({
				nodeId: b.id,
				message: `${NODE_TYPES[b.type].label} takes ${inT || 'no input'}, but ${NODE_TYPES[a.type].label} outputs ${outT}.`,
			});
		}
	}
	const sources = flow.nodes.filter((n) => n.type === 'image');
	const sinks = flow.nodes.filter((n) => n.type === 'output');
	if (sources.length !== 1) errors.push({ message: sources.length ? 'Use exactly one Image node.' : 'Add an Image node as the source.' });
	if (sinks.length !== 1) errors.push({ message: sinks.length ? 'Use exactly one Add to Scene node.' : 'Add an Add to Scene node as the output.' });
	if (!flow.nodes.some((n) => n.type === 'generate')) errors.push({ message: 'Add a Generate Mesh node to turn the image into a mesh.' });

	const order = [];
	if (sources.length === 1) {
		const seen = new Set();
		let cur = sources[0];
		while (cur && !seen.has(cur.id)) {
			seen.add(cur.id);
			order.push(cur);
			cur = outgoing.get(cur.id);
		}
		if (cur) errors.push({ nodeId: cur.id, message: 'The chain loops back on itself.' });
		if (sinks.length === 1 && !seen.has(sinks[0].id)) {
			errors.push({ nodeId: sinks[0].id, message: 'Add to Scene is not connected to the Image chain.' });
		}
		for (const n of flow.nodes) {
			if (!seen.has(n.id) && n.type !== 'output') {
				errors.push({ nodeId: n.id, message: `${NODE_TYPES[n.type].label} is not connected.` });
			}
		}
	}
	return { ok: errors.length === 0, order, errors };
}

/** Insert a new node into a valid chain just before Add to Scene, type permitting. */
export function insertNode(flow, type, at) {
	const node = { id: newNodeId(), type, x: at?.x ?? 60, y: at?.y ?? 260, enabled: true, collapsed: false, params: defaultParams(type) };
	flow.nodes.push(node);
	const { ok, order } = validate({ ...flow, nodes: flow.nodes.filter((n) => n !== node) });
	if (!ok) return node;
	const t = NODE_TYPES[type];
	for (let i = order.length - 1; i > 0; i--) {
		const prev = order[i - 1];
		const next = order[i];
		if (NODE_TYPES[prev.type].out === t.in && t.out === NODE_TYPES[next.type].in) {
			flow.edges = flow.edges.filter((e) => !(e.from === prev.id && e.to === next.id));
			flow.edges.push({ from: prev.id, to: node.id }, { from: node.id, to: next.id });
			if (at == null) {
				node.x = next.x;
				node.y = next.y + 150;
			}
			break;
		}
	}
	return node;
}

/** Remove a node and stitch its neighbours together when the types allow it. */
export function removeNode(flow, nodeId) {
	const into = flow.edges.find((e) => e.to === nodeId);
	const outOf = flow.edges.find((e) => e.from === nodeId);
	flow.nodes = flow.nodes.filter((n) => n.id !== nodeId);
	flow.edges = flow.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
	if (into && outOf) {
		const a = flow.nodes.find((n) => n.id === into.from);
		const b = flow.nodes.find((n) => n.id === outOf.to);
		if (a && b && NODE_TYPES[a.type].out === NODE_TYPES[b.type].in) flow.edges.push({ from: a.id, to: b.id });
	}
}

/** Lay a valid chain out left to right. */
export function tidy(flow) {
	const { order } = validate(flow);
	const placed = new Set();
	order.forEach((n, i) => {
		n.x = 40 + i * 236;
		n.y = 90 + (i % 2) * 44;
		placed.add(n.id);
	});
	flow.nodes
		.filter((n) => !placed.has(n.id))
		.forEach((n, i) => {
			n.x = 40 + i * 236;
			n.y = 300;
		});
}

const STORE_KEY = 'wb:workflows';
const ACTIVE_KEY = 'wb:active-workflow';

function clone(v) {
	return JSON.parse(JSON.stringify(v));
}

/** Fill params added in later releases so an older saved workflow still runs. */
function migrate(flow) {
	for (const n of flow.nodes) {
		if (!NODE_TYPES[n.type]) continue;
		n.params = { ...defaultParams(n.type), ...(n.params || {}) };
		n.enabled = n.enabled !== false;
	}
	flow.nodes = flow.nodes.filter((n) => NODE_TYPES[n.type]);
	return flow;
}

export function loadWorkflows() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
		if (Array.isArray(saved) && saved.length) return saved.map(migrate);
	} catch {
		// Unreadable storage falls through to the templates.
	}
	return TEMPLATES.map(clone);
}

export function saveWorkflows(flows) {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(flows));
	} catch {
		// Storage full or blocked: the session keeps working from memory.
	}
}

export function loadActiveId(flows) {
	let id = null;
	try {
		id = localStorage.getItem(ACTIVE_KEY);
	} catch {
		id = null;
	}
	return flows.some((f) => f.id === id) ? id : flows[0].id;
}

export function saveActiveId(id) {
	try {
		localStorage.setItem(ACTIVE_KEY, id);
	} catch {
		// Non-persistent session; selection still applies.
	}
}

export function resetWorkflows() {
	try {
		localStorage.removeItem(STORE_KEY);
		localStorage.removeItem(ACTIVE_KEY);
	} catch {
		// Nothing persisted to clear.
	}
	return TEMPLATES.map(clone);
}

export function duplicateWorkflow(flow, name) {
	const copy = clone(flow);
	copy.id = `wf-${Date.now().toString(36)}`;
	copy.name = name;
	return copy;
}
