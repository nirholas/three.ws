// Forge Workflows: the pure graph core.
//
// Adapted from Modly (https://github.com/lightningpixel/modly), MIT License,
// Copyright (c) 2026 Lightning Pixel. The preflight checks mirror Modly's
// src/areas/workflows/preflight.ts (typed ports, required inputs, one issue per
// key) and the For Each body rule mirrors workflowRunStore.ts (a loop's body is
// every executable node reachable downstream of the iterator, replayed once per
// item). Rewritten for a browser graph of three.ws endpoints.
//
// Nothing in this module touches the DOM or the network, so every rule the
// editor and the runner rely on is unit-tested in tests/forge-workflows-graph.test.js.
//
// A workflow is plain JSON:
//   { kind, version, name, nodes: [{ id, type, x, y, params }],
//     edges: [{ id, from: { node, port }, to: { node, port } }] }
// Port data types are 'image', 'text' and 'mesh'. Node definitions live in
// node-types.js; every function here takes the registry as an argument so the
// core stays independent of which endpoints back the nodes.

export const WORKFLOW_KIND = 'three.ws/forge-workflow';
export const WORKFLOW_VERSION = 1;
export const PORT_TYPES = ['image', 'text', 'mesh'];

const MAX_NODES = 200;
const MAX_EDGES = 600;

/** Resolve a node's input ports (a definition may derive them from params). */
export function inputPorts(def, params = {}) {
	if (!def) return [];
	return typeof def.inputs === 'function' ? def.inputs(params) : def.inputs || [];
}

/** Resolve a node's output ports. */
export function outputPorts(def, params = {}) {
	if (!def) return [];
	return typeof def.outputs === 'function' ? def.outputs(params) : def.outputs || [];
}

export function findPort(types, node, portId, direction) {
	const def = types[node?.type];
	const ports = direction === 'in' ? inputPorts(def, node?.params) : outputPorts(def, node?.params);
	return ports.find((p) => p.id === portId) || null;
}

/** Default params for a node type, from each param's `default`. */
export function defaultParams(def) {
	const out = {};
	for (const p of def?.params || []) {
		if (p.default !== undefined) out[p.id] = structuredCloneSafe(p.default);
	}
	return out;
}

function structuredCloneSafe(v) {
	if (v === null || typeof v !== 'object') return v;
	return JSON.parse(JSON.stringify(v));
}

let idCounter = 0;
/** Short unique id, stable enough for a graph and readable in exported JSON. */
export function makeId(prefix = 'n') {
	idCounter = (idCounter + 1) % 1e6;
	const rand = Math.random().toString(36).slice(2, 7);
	return `${prefix}_${Date.now().toString(36).slice(-4)}${rand}${idCounter.toString(36)}`;
}

export function createNode(types, type, position = {}, params = {}) {
	const def = types[type];
	if (!def) throw new Error(`Unknown node type "${type}"`);
	return {
		id: makeId('n'),
		type,
		x: Math.round(position.x ?? 0),
		y: Math.round(position.y ?? 0),
		params: { ...defaultParams(def), ...params },
	};
}

export function emptyWorkflow(name = 'Untitled workflow') {
	return { kind: WORKFLOW_KIND, version: WORKFLOW_VERSION, name, nodes: [], edges: [] };
}

// ── Adjacency ─────────────────────────────────────────────────────────────────

function liveEdges(workflow) {
	const ids = new Set(workflow.nodes.map((n) => n.id));
	return workflow.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node));
}

export function incomingEdges(workflow, nodeId) {
	return workflow.edges.filter((e) => e.to.node === nodeId);
}

export function outgoingEdges(workflow, nodeId) {
	return workflow.edges.filter((e) => e.from.node === nodeId);
}

/** Every node id reachable downstream of `startId` (excluding it). */
export function downstreamOf(workflow, startId) {
	const out = new Set();
	const stack = [startId];
	while (stack.length) {
		const id = stack.pop();
		for (const e of workflow.edges) {
			if (e.from.node !== id || out.has(e.to.node)) continue;
			out.add(e.to.node);
			stack.push(e.to.node);
		}
	}
	return out;
}

/** Every node id reachable upstream of `startId` (excluding it). */
export function upstreamOf(workflow, startId) {
	const out = new Set();
	const stack = [startId];
	while (stack.length) {
		const id = stack.pop();
		for (const e of workflow.edges) {
			if (e.to.node !== id || out.has(e.from.node)) continue;
			out.add(e.from.node);
			stack.push(e.from.node);
		}
	}
	return out;
}

/** True when adding from -> to would close a directed cycle. */
export function wouldCreateCycle(workflow, fromNodeId, toNodeId) {
	if (fromNodeId === toNodeId) return true;
	return downstreamOf(workflow, toNodeId).has(fromNodeId);
}

// ── Topological order ─────────────────────────────────────────────────────────

/**
 * Kahn's algorithm with a stable tie-break (canvas position: left to right, then
 * top to bottom, then insertion order) so the run order matches what the user
 * reads on the canvas. Returns { order, cycle } where `cycle` lists the node ids
 * that could not be ordered (empty when the graph is a DAG).
 */
export function topoSort(workflow) {
	const nodes = workflow.nodes;
	const index = new Map(nodes.map((n, i) => [n.id, i]));
	const inDeg = new Map(nodes.map((n) => [n.id, 0]));
	const adj = new Map(nodes.map((n) => [n.id, []]));
	for (const e of liveEdges(workflow)) {
		adj.get(e.from.node).push(e.to.node);
		inDeg.set(e.to.node, inDeg.get(e.to.node) + 1);
	}
	const byCanvas = (a, b) => {
		const na = nodes[index.get(a)];
		const nb = nodes[index.get(b)];
		return (na.x - nb.x) || (na.y - nb.y) || (index.get(a) - index.get(b));
	};
	const ready = nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id).sort(byCanvas);
	const order = [];
	while (ready.length) {
		const id = ready.shift();
		order.push(id);
		for (const next of adj.get(id)) {
			inDeg.set(next, inDeg.get(next) - 1);
			if (inDeg.get(next) === 0) {
				ready.push(next);
				ready.sort(byCanvas);
			}
		}
	}
	const placed = new Set(order);
	const cycle = nodes.filter((n) => !placed.has(n.id)).map((n) => n.id);
	return { order, cycle };
}

// ── Loops (For Each) ─────────────────────────────────────────────────────────

/** Node ids whose definition marks them as an iterator. */
export function iteratorIds(workflow, types) {
	return workflow.nodes.filter((n) => types[n.type]?.iterator).map((n) => n.id);
}

/**
 * The body of each iterator: every node reachable downstream of it. Mirrors
 * Modly's reachableExecutable(): the body re-runs once per item, and nothing
 * needs a back-edge to express the loop.
 */
export function loopBodies(workflow, types) {
	const bodies = new Map();
	for (const id of iteratorIds(workflow, types)) bodies.set(id, downstreamOf(workflow, id));
	return bodies;
}

/** The items an iterator node will emit, read from its params by its definition. */
export function iteratorItems(types, node) {
	const def = types[node.type];
	if (!def?.iterator) return [];
	return def.items ? def.items(node.params || {}) : [];
}

/**
 * The run plan: an ordered list of steps { nodeId, iter } where `iter` is the
 * item index for loop-body steps and null otherwise.
 *
 * Each loop is emitted as one block (the iterator, then its body in topological
 * order, once per item) at the position of its LAST body node in the global
 * order. Every external input of a body node sorts before that body node, and
 * therefore before the block, so a body never runs ahead of a non-loop input
 * such as a shared text prompt.
 */
export function buildPlan(workflow, types, { order: givenOrder } = {}) {
	const order = givenOrder || topoSort(workflow).order;
	const bodies = loopBodies(workflow, types);
	const position = new Map(order.map((id, i) => [id, i]));
	const owner = new Map();
	for (const [iterId, body] of bodies) for (const id of body) if (!owner.has(id)) owner.set(id, iterId);

	const anchor = new Map();
	for (const [iterId, body] of bodies) {
		let last = iterId;
		for (const id of body) if (position.get(id) > position.get(last)) last = id;
		anchor.set(last, iterId);
	}

	const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
	const steps = [];
	for (const id of order) {
		const isIterator = bodies.has(id);
		if (!owner.has(id) && !isIterator) steps.push({ nodeId: id, iter: null });
		const iterId = anchor.get(id);
		if (iterId === undefined) continue;
		const body = bodies.get(iterId);
		const bodyOrder = order.filter((x) => body.has(x));
		const count = iteratorItems(types, nodeById.get(iterId)).length;
		for (let i = 0; i < count; i++) {
			steps.push({ nodeId: iterId, iter: i });
			for (const b of bodyOrder) steps.push({ nodeId: b, iter: i });
		}
	}
	return { steps, bodies, owner };
}

// ── Connection rules ─────────────────────────────────────────────────────────

/**
 * Can an edge go from (fromNode, fromPort) to (toNode, toPort)? Returns
 * { ok: true } or { ok: false, reason } with a sentence the editor shows as-is.
 */
export function canConnect(workflow, types, from, to) {
	const fromNode = workflow.nodes.find((n) => n.id === from.node);
	const toNode = workflow.nodes.find((n) => n.id === to.node);
	if (!fromNode || !toNode) return { ok: false, reason: 'That node no longer exists.' };
	if (fromNode.id === toNode.id) return { ok: false, reason: 'A node cannot feed itself.' };
	const out = findPort(types, fromNode, from.port, 'out');
	const inp = findPort(types, toNode, to.port, 'in');
	if (!out || !inp) return { ok: false, reason: 'Connect an output dot to an input dot.' };
	if (out.type !== inp.type) {
		return {
			ok: false,
			reason: `${types[toNode.type].label} ${inp.label || inp.id} takes ${article(inp.type)}, not ${article(out.type)}.`,
		};
	}
	if (wouldCreateCycle(workflow, fromNode.id, toNode.id)) {
		return { ok: false, reason: 'That link would loop back on itself. Use a For Each node to repeat steps.' };
	}
	return { ok: true };
}

function article(type) {
	return type === 'image' ? 'an image' : type === 'mesh' ? 'a 3D model' : 'text';
}

/**
 * Add an edge, replacing whatever already feeds the target input (every input
 * port takes exactly one link). Returns a new workflow; the input is untouched.
 */
export function connect(workflow, types, from, to) {
	const check = canConnect(workflow, types, from, to);
	if (!check.ok) return { workflow, error: check.reason };
	const edges = workflow.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port));
	edges.push({ id: makeId('e'), from: { ...from }, to: { ...to } });
	return { workflow: { ...workflow, edges }, error: null };
}

export function removeNodes(workflow, ids) {
	const drop = new Set(ids);
	return {
		...workflow,
		nodes: workflow.nodes.filter((n) => !drop.has(n.id)),
		edges: workflow.edges.filter((e) => !drop.has(e.from.node) && !drop.has(e.to.node)),
	};
}

/** Drop edges whose ports no longer exist (a param change can retype a port). */
export function pruneInvalidEdges(workflow, types) {
	const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
	const edges = workflow.edges.filter((e) => {
		const a = nodeById.get(e.from.node);
		const b = nodeById.get(e.to.node);
		if (!a || !b) return false;
		const out = findPort(types, a, e.from.port, 'out');
		const inp = findPort(types, b, e.to.port, 'in');
		return !!out && !!inp && out.type === inp.type;
	});
	return edges.length === workflow.edges.length ? workflow : { ...workflow, edges };
}

// ── Preflight ─────────────────────────────────────────────────────────────────

/**
 * Validate a workflow before a run. Returns a list of issues
 * { key, nodeId?, message, level } where level is 'error' (blocks the run) or
 * 'warning' (runs anyway). Keys are unique so one problem is reported once.
 *
 * `ctx` is forwarded to each definition's validate(node, ctx) hook, which is
 * where node-specific checks live (an empty prompt, no uploaded image, an engine
 * the live catalog marks as down).
 */
export function preflight(workflow, types, ctx = {}) {
	const issues = [];
	const push = (issue) => {
		if (!issues.some((x) => x.key === issue.key)) issues.push({ level: 'error', ...issue });
	};
	if (!workflow.nodes.length) {
		push({ key: 'empty', message: 'The canvas is empty. Add a node from the palette or start from a template.' });
		return issues;
	}
	const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
	const label = (n) => n?.params?.title?.trim() || types[n?.type]?.label || 'Node';

	for (const n of workflow.nodes) {
		if (!types[n.type]) push({ key: `${n.id}:unknown`, nodeId: n.id, message: `Unknown node type "${n.type}". Remove it.` });
	}

	const { cycle } = topoSort(workflow);
	if (cycle.length) {
		push({
			key: 'cycle',
			nodeId: cycle[0],
			message: 'These steps form a loop. Remove one of the links; use a For Each node to repeat steps.',
		});
	}

	for (const e of workflow.edges) {
		const a = nodeById.get(e.from.node);
		const b = nodeById.get(e.to.node);
		if (!a || !b) {
			push({ key: `${e.id}:dangling`, nodeId: a?.id || b?.id, message: 'A link points at a node that no longer exists.' });
			continue;
		}
		if (!types[a.type] || !types[b.type]) continue;
		const out = findPort(types, a, e.from.port, 'out');
		const inp = findPort(types, b, e.to.port, 'in');
		if (!out || !inp) {
			push({ key: `${e.id}:port`, nodeId: b.id, message: `${label(b)} has a link to an input it no longer has.` });
		} else if (out.type !== inp.type) {
			push({
				key: `${e.id}:type`,
				nodeId: b.id,
				message: `${label(b)} expects ${article(inp.type)} on ${inp.label || inp.id}, but ${label(a)} outputs ${article(out.type)}.`,
			});
		}
	}

	for (const n of workflow.nodes) {
		const def = types[n.type];
		if (!def) continue;
		const params = n.params || {};
		const incoming = incomingEdges(workflow, n.id);
		const required = typeof def.required === 'function' ? def.required(params) : inputPorts(def, params).filter((p) => !p.optional).map((p) => p.id);
		for (const portId of required) {
			if (incoming.some((e) => e.to.port === portId)) continue;
			const port = findPort(types, n, portId, 'in');
			push({
				key: `${n.id}:missing:${portId}`,
				nodeId: n.id,
				message: `${label(n)} needs ${article(port?.type || 'text')} connected to ${port?.label || portId}.`,
			});
		}
		for (const message of def.validate ? def.validate(n, ctx) || [] : []) {
			const text = typeof message === 'string' ? message : message.message;
			const level = typeof message === 'string' ? 'error' : message.level || 'error';
			push({ key: `${n.id}:v:${text}`, nodeId: n.id, message: `${label(n)}: ${text}`, level });
		}
	}

	const bodies = loopBodies(workflow, types);
	const seenIn = new Map();
	for (const [iterId, body] of bodies) {
		if (!body.size) {
			push({
				key: `${iterId}:empty-body`,
				nodeId: iterId,
				level: 'warning',
				message: `${label(nodeById.get(iterId))} has nothing connected after it, so it will not do anything.`,
			});
		}
		for (const id of body) {
			if (bodies.has(id)) {
				push({
					key: `${id}:nested-loop`,
					nodeId: id,
					message: `${label(nodeById.get(id))} sits inside another For Each. Nested loops are not supported; use one For Each per chain.`,
				});
			}
			if (seenIn.has(id) && seenIn.get(id) !== iterId) {
				push({
					key: `${id}:two-loops`,
					nodeId: id,
					message: `${label(nodeById.get(id))} is fed by two For Each nodes. Give each loop its own chain.`,
				});
			}
			seenIn.set(id, iterId);
		}
	}

	return issues;
}

export function blockingIssues(issues) {
	return issues.filter((i) => i.level !== 'warning');
}

// ── Serialization ─────────────────────────────────────────────────────────────

/** A workflow as portable JSON text, with runtime-only params stripped. */
export function serializeWorkflow(workflow, types) {
	const nodes = workflow.nodes.map((n) => {
		const def = types[n.type];
		const params = { ...(n.params || {}) };
		for (const p of def?.params || []) if (p.transient) delete params[p.id];
		return { id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y), params };
	});
	const out = {
		kind: WORKFLOW_KIND,
		version: WORKFLOW_VERSION,
		name: String(workflow.name || 'Untitled workflow').slice(0, 120),
		nodes,
		edges: workflow.edges.map((e) => ({ id: e.id, from: { ...e.from }, to: { ...e.to } })),
	};
	return JSON.stringify(out, null, 2);
}

/**
 * Parse workflow JSON from an import or from storage. Throws an Error whose
 * message is safe to show the user when the input is not a usable workflow.
 * Unknown node types are rejected rather than silently dropped, so a file made
 * by a newer version says so instead of loading half a graph.
 */
export function parseWorkflow(input, types) {
	let data = input;
	if (typeof input === 'string') {
		try {
			data = JSON.parse(input);
		} catch {
			throw new Error('That file is not valid JSON.');
		}
	}
	if (!data || typeof data !== 'object') throw new Error('That file does not contain a workflow.');
	if (data.kind !== WORKFLOW_KIND) throw new Error('That file is not a three.ws Forge workflow.');
	if (typeof data.version !== 'number' || data.version > WORKFLOW_VERSION) {
		throw new Error('That workflow was saved by a newer version of the builder. Reload the page and try again.');
	}
	if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('The workflow is missing its nodes or links.');
	if (data.nodes.length > MAX_NODES) throw new Error(`Workflows are limited to ${MAX_NODES} nodes.`);
	if (data.edges.length > MAX_EDGES) throw new Error(`Workflows are limited to ${MAX_EDGES} links.`);

	const ids = new Set();
	const nodes = data.nodes.map((raw, i) => {
		if (!raw || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) throw new Error(`Node ${i + 1} has a missing or duplicate id.`);
		const def = types[raw.type];
		if (!def) throw new Error(`Node ${i + 1} uses an unknown type "${String(raw.type).slice(0, 40)}".`);
		ids.add(raw.id);
		const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params) ? raw.params : {};
		return {
			id: raw.id,
			type: raw.type,
			x: Number.isFinite(raw.x) ? raw.x : 0,
			y: Number.isFinite(raw.y) ? raw.y : 0,
			params: { ...defaultParams(def), ...structuredCloneSafe(params) },
		};
	});
	const edgeIds = new Set();
	const edges = [];
	for (const raw of data.edges) {
		if (!raw?.from || !raw?.to) continue;
		if (!ids.has(raw.from.node) || !ids.has(raw.to.node)) continue;
		const id = typeof raw.id === 'string' && raw.id && !edgeIds.has(raw.id) ? raw.id : makeId('e');
		edgeIds.add(id);
		edges.push({
			id,
			from: { node: raw.from.node, port: String(raw.from.port) },
			to: { node: raw.to.node, port: String(raw.to.port) },
		});
	}
	return {
		kind: WORKFLOW_KIND,
		version: WORKFLOW_VERSION,
		name: typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 120) : 'Imported workflow',
		nodes,
		edges,
	};
}

/** Deep copy with fresh ids (used when a template is instantiated). */
export function cloneWithFreshIds(workflow) {
	const map = new Map();
	const nodes = workflow.nodes.map((n) => {
		const id = makeId('n');
		map.set(n.id, id);
		return { ...n, id, params: structuredCloneSafe(n.params || {}) };
	});
	const edges = workflow.edges.map((e) => ({
		id: makeId('e'),
		from: { node: map.get(e.from.node), port: e.from.port },
		to: { node: map.get(e.to.node), port: e.to.port },
	}));
	return { ...workflow, nodes, edges };
}

/**
 * The signature of a node's work for a given item: its type, its params, the
 * item it is processing, and the signatures of everything feeding it. The
 * runner reuses a cached output only when this matches, so editing a node
 * invalidates it and everything downstream, and nothing else.
 */
export function stepSignature(workflow, types, nodeId, iter, plan, memo = new Map()) {
	const key = `${nodeId}#${iter ?? ''}`;
	if (memo.has(key)) return memo.get(key);
	const node = workflow.nodes.find((n) => n.id === nodeId);
	const def = types[node?.type];
	const params = { ...(node?.params || {}) };
	for (const p of def?.params || []) if (p.signatureExclude) delete params[p.id];
	const parts = [node?.type, stableStringify(params)];
	if (def?.iterator && iter != null) parts.push(stableStringify(iteratorItems(types, node)[iter] ?? null));
	const sameLoop = (src) => iter != null && (plan.owner.get(src) === plan.owner.get(nodeId) || src === plan.owner.get(nodeId));
	for (const e of incomingEdges(workflow, nodeId).sort((a, b) => (a.to.port < b.to.port ? -1 : 1))) {
		const srcIter = sameLoop(e.from.node) ? iter : null;
		parts.push(`${e.to.port}<${e.from.port}:${stepSignature(workflow, types, e.from.node, srcIter, plan, memo)}`);
	}
	const sig = hash(parts.join('|'));
	memo.set(key, sig);
	return sig;
}

export function stableStringify(v) {
	if (v === null || typeof v !== 'object') return JSON.stringify(v);
	if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
	return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** FNV-1a 32-bit: a compact, deterministic fingerprint (not a security hash). */
function hash(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}
