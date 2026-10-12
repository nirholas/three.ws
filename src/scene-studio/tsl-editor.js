// Scene Studio: Nodes tab, a TSL (Three.js Shading Language) material graph
// editor for the selected object.
//
// Sibling to the vendored r184 editor (never edits vendor/**). The vendored
// Project ▸ Renderer panel (Sidebar.Project.Renderer.js) already ships the
// WebGL ↔ WebGPU toggle this needs (`new WebGPURenderer(...); await
// renderer.init()`), so building a node material here needs no renderer work
// of its own, it only needs a WebGPU (or node-material-capable WebGL)
// renderer to actually light up, which the studio already has.
//
// The graph is dropdown-wired, not a freeform drag canvas: every node is a
// card in a list, and every input on a card is a <select> of the other
// nodes' labels. That is a deliberate, smaller scope than a node-link canvas
// (no connection-rendering, no port hit-testing to get wrong) while staying a
// real graph: nodes reference other nodes by id, cycles are rejected, and
// the compiled result is a genuine three/tsl node tree, not a canned preset.
//
// "Apply to selected object" compiles the referenced output nodes into a
// real THREE.MeshStandardNodeMaterial and swaps it onto the object via the
// vendored SetMaterialCommand, so Edit ▸ Undo removes a bad graph exactly
// like any other material edit.

import {
	Color, TextureLoader, SRGBColorSpace,
	Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Mesh, SphereGeometry, MeshStandardMaterial,
} from 'three';
import { UIElement } from './vendor/js/libs/ui.js';
import { SetMaterialCommand } from './vendor/js/commands/SetMaterialCommand.js';
import { toastError } from '../shared/toast.js';

const STYLE_ID = 'tws-tsl-editor-styles';

function ensureStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const el = document.createElement('style');
	el.id = STYLE_ID;
	el.textContent = CSS;
	document.head.appendChild(el);
}

// ── Node kind registry ──────────────────────────────────────────────────
// `inputs`: named slots, each resolved to another node's compiled TSL value.
// `params`: literal fields edited inline (not graph edges).
// `build(tsl, resolvedInputs, params)` returns a compiled TSL node.
const KINDS = {
	uv: { label: 'UV', inputs: [], params: [], build: (tsl) => tsl.uv() },
	time: { label: 'Time', inputs: [], params: [], build: (tsl) => tsl.time },
	cameraPosition: { label: 'Camera position', inputs: [], params: [], build: (tsl) => tsl.cameraPosition },
	normalWorld: { label: 'World normal', inputs: [], params: [], build: (tsl) => tsl.normalWorld },
	float: {
		label: 'Float', inputs: [],
		params: [{ key: 'value', type: 'number', default: 1 }],
		build: (tsl, _in, p) => tsl.float(num(p.value, 1)),
	},
	color: {
		label: 'Color', inputs: [],
		params: [{ key: 'hex', type: 'color', default: '#ffffff' }],
		build: (tsl, _in, p) => tsl.color(new Color(p.hex || '#ffffff')),
	},
	vec3: {
		label: 'Vector3', inputs: [],
		params: [
			{ key: 'x', type: 'number', default: 0 }, { key: 'y', type: 'number', default: 0 }, { key: 'z', type: 'number', default: 0 },
		],
		build: (tsl, _in, p) => tsl.vec3(num(p.x), num(p.y), num(p.z)),
	},
	texture: {
		label: 'Texture', inputs: ['uv'],
		params: [{ key: 'image', type: 'image', default: null }],
		build: (tsl, inputs, p, ctx) => {
			if (!p.image) throw new Error('Texture node needs an image.');
			return tsl.texture(ctx.getTexture(p.image), inputs.uv ?? tsl.uv());
		},
	},
	add: { label: 'Add', inputs: ['a', 'b'], params: [], build: (tsl, i) => req(i, 'a').add(req(i, 'b')) },
	sub: { label: 'Subtract', inputs: ['a', 'b'], params: [], build: (tsl, i) => req(i, 'a').sub(req(i, 'b')) },
	mul: { label: 'Multiply', inputs: ['a', 'b'], params: [], build: (tsl, i) => req(i, 'a').mul(req(i, 'b')) },
	div: { label: 'Divide', inputs: ['a', 'b'], params: [], build: (tsl, i) => req(i, 'a').div(req(i, 'b')) },
	mix: { label: 'Mix', inputs: ['a', 'b', 't'], params: [], build: (tsl, i) => tsl.mix(req(i, 'a'), req(i, 'b'), req(i, 't')) },
	dot: { label: 'Dot', inputs: ['a', 'b'], params: [], build: (tsl, i) => tsl.dot(req(i, 'a'), req(i, 'b')) },
	clamp: {
		label: 'Clamp', inputs: ['a'],
		params: [{ key: 'min', type: 'number', default: 0 }, { key: 'max', type: 'number', default: 1 }],
		build: (tsl, i, p) => tsl.clamp(req(i, 'a'), num(p.min, 0), num(p.max, 1)),
	},
	oneMinus: { label: 'One minus', inputs: ['a'], params: [], build: (tsl, i) => tsl.oneMinus(req(i, 'a')) },
	sin: { label: 'Sine', inputs: ['a'], params: [], build: (tsl, i) => tsl.sin(req(i, 'a')) },
	pow: { label: 'Power', inputs: ['a'], params: [{ key: 'exponent', type: 'number', default: 2 }], build: (tsl, i, p) => tsl.pow(req(i, 'a'), num(p.exponent, 2)) },
};

const OUTPUT_SLOTS = [
	{ key: 'colorNode', label: 'Color' },
	{ key: 'emissiveNode', label: 'Emissive' },
	{ key: 'roughnessNode', label: 'Roughness' },
	{ key: 'metalnessNode', label: 'Metalness' },
	{ key: 'opacityNode', label: 'Opacity' },
];

function num(v, fallback = 0) {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}
function req(inputs, slot) {
	const v = inputs[slot];
	if (v == null) throw new Error(`Missing input "${slot}".`);
	return v;
}
function uid() {
	return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class GraphCompileError extends Error {}

/** Topologically compiles `nodes` (a Map id -> node) for the given output node ids. Throws on a cycle or a missing input. */
function compileGraph(tsl, ctx, nodes, outputIds) {
	const resolved = new Map();
	const visiting = new Set();

	function resolve(id) {
		if (resolved.has(id)) return resolved.get(id);
		if (visiting.has(id)) throw new GraphCompileError('The graph has a cycle.');
		const node = nodes.get(id);
		if (!node) throw new GraphCompileError('A node references a deleted input.');
		visiting.add(id);
		const kind = KINDS[node.kind];
		const inputs = {};
		for (const slot of kind.inputs) {
			if (node.inputs[slot]) inputs[slot] = resolve(node.inputs[slot]);
		}
		const value = kind.build(tsl, inputs, node.params, ctx);
		visiting.delete(id);
		resolved.set(id, value);
		return value;
	}

	const out = {};
	for (const id of outputIds) out[id] = resolve(id);
	return out;
}

/**
 * Builds the Nodes tab's panel: sidebar.addTab('nodes', 'Nodes', panel).
 * @param {import('./vendor/js/Editor.js').Editor} editor
 */
export function createTslEditorPanel(editor) {
	ensureStyles();

	/** @type {Map<string, {id:string, kind:string, params:object, inputs:object}>} */
	const nodes = new Map();
	const outputs = { colorNode: null, emissiveNode: null, roughnessNode: null, metalnessNode: null, opacityNode: null };
	const textureCache = new Map(); // dataURL -> THREE.Texture, so re-applying doesn't reload

	const root = document.createElement('div');
	root.className = 'tws-tsl-panel';
	root.innerHTML = `
		<p class="tws-tsl-intro">Build a material from nodes, wire each input by picking another node, then apply it to the selected object. Needs the WebGPU renderer (Project ▸ Renderer) to light up in the viewport.</p>
		<div class="tws-tsl-preview"><canvas width="128" height="128"></canvas><p class="tws-tsl-preview-empty">Add nodes and apply to preview.</p></div>
		<div class="tws-tsl-add">
			<select class="tws-tsl-kind-select"></select>
			<button type="button" class="tws-tsl-add-btn">+ Add node</button>
		</div>
		<ol class="tws-tsl-nodes"></ol>
		<div class="tws-tsl-outputs"><h4>Material outputs</h4></div>
		<button type="button" class="tws-tsl-apply">Apply to selected object</button>
		<p class="tws-tsl-target"></p>
		<p class="tws-tsl-error" role="alert" hidden></p>
	`;

	const kindSelect = root.querySelector('.tws-tsl-kind-select');
	kindSelect.innerHTML = Object.entries(KINDS).map(([key, k]) => `<option value="${key}">${k.label}</option>`).join('');
	const nodesList = root.querySelector('.tws-tsl-nodes');
	const outputsBox = root.querySelector('.tws-tsl-outputs');
	const applyBtn = root.querySelector('.tws-tsl-apply');
	const targetEl = root.querySelector('.tws-tsl-target');
	const errorEl = root.querySelector('.tws-tsl-error');
	const previewCanvas = root.querySelector('.tws-tsl-preview canvas');
	const previewEmpty = root.querySelector('.tws-tsl-preview-empty');

	function showError(message) {
		errorEl.textContent = message;
		errorEl.hidden = !message;
	}

	function nodeLabel(node) {
		return `${KINDS[node.kind].label} #${[...nodes.keys()].indexOf(node.id) + 1}`;
	}

	function inputOptionsHtml(selectedId, excludeId) {
		const opts = ['<option value="">(none)</option>'];
		for (const node of nodes.values()) {
			if (node.id === excludeId) continue;
			opts.push(`<option value="${node.id}" ${node.id === selectedId ? 'selected' : ''}>${nodeLabel(node)}</option>`);
		}
		return opts.join('');
	}

	function renderNodes() {
		nodesList.innerHTML = '';
		for (const node of nodes.values()) {
			const kind = KINDS[node.kind];
			const li = document.createElement('li');
			li.className = 'tws-tsl-node';
			li.dataset.id = node.id;
			const paramsHtml = kind.params
				.map((p) => {
					if (p.type === 'color') return `<label>${p.key} <input type="color" data-param="${p.key}" value="${node.params[p.key]}"></label>`;
					if (p.type === 'image') return `<label>${p.key} <input type="file" accept="image/*" data-param="${p.key}"></label>`;
					return `<label>${p.key} <input type="number" step="any" data-param="${p.key}" value="${node.params[p.key]}"></label>`;
				})
				.join('');
			const inputsHtml = kind.inputs
				.map((slot) => `<label>${slot} <select data-input="${slot}">${inputOptionsHtml(node.inputs[slot], node.id)}</select></label>`)
				.join('');
			li.innerHTML = `
				<div class="tws-tsl-node-head">
					<strong>${nodeLabel(node)}</strong>
					<button type="button" class="tws-tsl-node-remove" aria-label="Remove node">✕</button>
				</div>
				<div class="tws-tsl-node-body">${inputsHtml}${paramsHtml}</div>
			`;
			nodesList.appendChild(li);
		}
	}

	function renderOutputs() {
		outputsBox.querySelectorAll('.tws-tsl-output-row').forEach((el) => el.remove());
		for (const slot of OUTPUT_SLOTS) {
			const row = document.createElement('label');
			row.className = 'tws-tsl-output-row';
			row.innerHTML = `${slot.label} <select data-output="${slot.key}">${inputOptionsHtml(outputs[slot.key], null)}</select>`;
			outputsBox.appendChild(row);
		}
	}

	function syncTarget() {
		const object = editor.selected;
		targetEl.textContent = object ? `Applies to: ${object.name || object.type}` : 'Select an object in the scene first.';
		applyBtn.disabled = !object;
	}

	nodesList.addEventListener('click', (e) => {
		const removeBtn = e.target.closest('.tws-tsl-node-remove');
		if (!removeBtn) return;
		const id = removeBtn.closest('.tws-tsl-node').dataset.id;
		nodes.delete(id);
		for (const node of nodes.values()) {
			for (const slot of Object.keys(node.inputs)) {
				if (node.inputs[slot] === id) node.inputs[slot] = null;
			}
		}
		for (const key of Object.keys(outputs)) if (outputs[key] === id) outputs[key] = null;
		renderNodes();
		renderOutputs();
	});

	nodesList.addEventListener('change', (e) => {
		const li = e.target.closest('.tws-tsl-node');
		if (!li) return;
		const node = nodes.get(li.dataset.id);
		if (!node) return;
		if (e.target.dataset.input) {
			node.inputs[e.target.dataset.input] = e.target.value || null;
		} else if (e.target.dataset.param) {
			const key = e.target.dataset.param;
			if (e.target.type === 'file') {
				const file = e.target.files?.[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					node.params[key] = reader.result;
				};
				reader.readAsDataURL(file);
			} else {
				node.params[key] = e.target.value;
			}
		}
	});

	outputsBox.addEventListener('change', (e) => {
		if (!e.target.dataset.output) return;
		outputs[e.target.dataset.output] = e.target.value || null;
	});

	root.querySelector('.tws-tsl-add-btn').addEventListener('click', () => {
		const kind = kindSelect.value;
		const def = KINDS[kind];
		const node = {
			id: uid(),
			kind,
			params: Object.fromEntries(def.params.map((p) => [p.key, p.default])),
			inputs: Object.fromEntries(def.inputs.map((slot) => [slot, null])),
		};
		nodes.set(node.id, node);
		renderNodes();
		renderOutputs();
	});

	editor.signals.objectSelected.add(syncTarget);

	async function loadTexture(dataUrl) {
		if (textureCache.has(dataUrl)) return textureCache.get(dataUrl);
		const texture = await new TextureLoader().loadAsync(dataUrl);
		texture.colorSpace = SRGBColorSpace;
		textureCache.set(dataUrl, texture);
		return texture;
	}

	async function compileMaterial() {
		const tsl = await import('three/tsl');
		const outputIds = Object.values(outputs).filter(Boolean);
		if (!outputIds.length) throw new Error('Wire at least one material output (Color, Emissive, ...) to a node.');
		// build() runs synchronously (it is the recursive graph walk), so every
		// image a texture node references must already be a loaded THREE.Texture
		// in textureCache before compileGraph runs.
		const images = [...nodes.values()].filter((n) => n.kind === 'texture' && n.params.image).map((n) => n.params.image);
		await Promise.all([...new Set(images)].map((url) => loadTexture(url)));
		const compiled = compileGraph(tsl, { getTexture: (url) => textureCache.get(url) }, nodes, outputIds);
		const { MeshStandardNodeMaterial } = await import('three/webgpu');
		const material = new MeshStandardNodeMaterial();
		for (const slot of OUTPUT_SLOTS) {
			if (outputs[slot.key]) material[slot.key] = compiled[outputs[slot.key]];
		}
		return material;
	}

	let previewHandle = null;
	async function updatePreview() {
		showError('');
		let material;
		try {
			material = await compileMaterial();
		} catch (err) {
			previewEmpty.hidden = false;
			previewEmpty.textContent = err instanceof GraphCompileError || err.message ? err.message : 'Could not compile this graph.';
			if (previewHandle) previewHandle.stop();
			return;
		}
		previewEmpty.hidden = true;
		if (!previewHandle) previewHandle = await startPreview(previewCanvas);
		previewHandle.setMaterial(material);
	}

	applyBtn.addEventListener('click', async () => {
		const object = editor.selected;
		if (!object) return;
		applyBtn.disabled = true;
		try {
			const material = await compileMaterial();
			material.name = `TSL graph (${object.name || object.type})`;
			editor.execute(new SetMaterialCommand(editor, object, material, -1), 'Apply TSL material');
			showError('');
		} catch (err) {
			showError(err.message || 'Could not apply this graph.');
			toastError(`Could not apply the material graph: ${err.message}`, { duration: 7000 });
		} finally {
			applyBtn.disabled = !editor.selected;
		}
	});

	nodesList.addEventListener('input', debounce(updatePreview, 400));
	outputsBox.addEventListener('change', debounce(updatePreview, 50));

	syncTarget();
	renderOutputs();

	return new UIElement(root);
}

function debounce(fn, ms) {
	let t;
	return (...args) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...args), ms);
	};
}

/** A small self-contained WebGPU preview: one lit sphere wearing the live-compiled material. */
async function startPreview(canvas) {
	const { WebGPURenderer } = await import('three/webgpu');
	const renderer = new WebGPURenderer({ canvas, antialias: true });
	await renderer.init();
	renderer.setSize(canvas.width, canvas.height, false);

	const scene = new Scene();
	const camera = new PerspectiveCamera(45, 1, 0.1, 10);
	camera.position.set(0, 0, 2.4);
	scene.add(new AmbientLight(0xffffff, 0.6));
	const dirLight = new DirectionalLight(0xffffff, 2.2);
	dirLight.position.set(2, 3, 4);
	scene.add(dirLight);

	const mesh = new Mesh(new SphereGeometry(0.85, 48, 48), new MeshStandardMaterial());
	scene.add(mesh);

	let stopped = false;
	function animate() {
		if (stopped) return;
		mesh.rotation.y += 0.012;
		renderer.render(scene, camera);
		requestAnimationFrame(animate);
	}
	animate();

	return {
		setMaterial(material) {
			mesh.material.dispose();
			mesh.material = material;
		},
		stop() {
			stopped = true;
		},
	};
}

const CSS = `
.tws-tsl-panel { display: flex; flex-direction: column; gap: 10px; padding: 10px; font: 400 12.5px/1.45 system-ui, -apple-system, sans-serif; color: var(--ink, #e8e8ec); }
.tws-tsl-intro { margin: 0; color: #9a9aa8; font-size: 12px; }
.tws-tsl-preview { position: relative; width: 128px; height: 128px; border-radius: 8px; overflow: hidden; background: #0d0d12; border: 1px solid rgba(255,255,255,0.12); align-self: center; }
.tws-tsl-preview canvas { width: 100%; height: 100%; display: block; }
.tws-tsl-preview-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; margin: 0; padding: 8px; font-size: 10.5px; color: #70707c; background: rgba(13,13,18,0.9); }
.tws-tsl-add { display: flex; gap: 6px; }
.tws-tsl-kind-select, .tws-tsl-node select, .tws-tsl-node input, .tws-tsl-output-row select {
	border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; background: rgba(10,10,14,0.8); color: var(--ink, #e8e8ec);
	padding: 5px 6px; font: inherit; font-size: 11.5px;
}
.tws-tsl-add-btn, .tws-tsl-apply, .tws-tsl-node-remove {
	appearance: none; cursor: pointer; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px;
	background: transparent; color: var(--ink, #e8e8ec); font: 600 11.5px/1 system-ui, sans-serif; padding: 6px 10px;
}
.tws-tsl-add-btn:hover, .tws-tsl-node-remove:hover { background: rgba(255,255,255,0.08); }
.tws-tsl-apply { background: #e8e8ec; color: #0a0a0f; align-self: flex-start; }
.tws-tsl-apply:hover { background: #fff; }
.tws-tsl-apply:disabled { opacity: 0.5; cursor: default; }
.tws-tsl-apply:focus-visible, .tws-tsl-add-btn:focus-visible, .tws-tsl-node-remove:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 2px; }
.tws-tsl-nodes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
.tws-tsl-node { border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 8px; background: rgba(255,255,255,0.03); }
.tws-tsl-node-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.tws-tsl-node-head .tws-tsl-node-remove { padding: 2px 6px; }
.tws-tsl-node-body { display: flex; flex-wrap: wrap; gap: 8px; }
.tws-tsl-node-body label { display: flex; flex-direction: column; gap: 3px; font-size: 10.5px; color: #9a9aa8; }
.tws-tsl-outputs { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.tws-tsl-outputs h4 { margin: 0; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #9a9aa8; }
.tws-tsl-output-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.tws-tsl-target { margin: 0; font-size: 11.5px; color: #9a9aa8; }
.tws-tsl-error { margin: 0; font-size: 11.5px; color: #ff7a8a; }
.tws-tsl-error[hidden] { display: none; }
`;
