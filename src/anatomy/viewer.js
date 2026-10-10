// AnatomyViewer: renders a normalized anatomy spec as an interactive
// isometric engineering illustration.
//
// Each part instance is a chain of three groups. The repeat group holds the
// radial or linear copy transform. The pivot holds the spec position,
// rotation and scale plus the explode offset. The motion group is recomputed
// every frame from the part's spin, oscillate, crank and pulse motions, and
// holds the fill mesh (shaded surface, hidden-line occluder, pick target), the
// fat edge lines, child parts (which inherit the motion) and attached effects.
//
// The viewer owns the WebGL canvas and a label overlay. All other UI lives in
// runtime.js and talks to the viewer through the public methods below.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { buildShape } from './shapes.js';
import { buildEffect, buildFlow } from './effects.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const AXIS_VEC = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const ISO_DIR = new THREE.Vector3(1, 0.82, 1).normalize();
// A spec can ask for 220 parts x 96 repeats; the viewer stops building
// instances past this so a pathological spec cannot freeze the tab.
const MAX_INSTANCES = 2400;
const MAX_EFFECT_INSTANCES = 96;
const DIM = 0.12;

const PALETTE = ['#4f8dff', '#ff8a3d', '#2fbf9b', '#c46cff', '#f2c14e', '#ff5d73', '#5cc8ff', '#8fd14f', '#b08968', '#9aa5b1'];

const THEMES = {
	dark: { bg: '#0b0e14', grid: '#1d2433', gridCenter: '#2a3448', accent: '#5eb0ff', ink: '#ffffff', inkMix: 0.4, fillMix: 0.42 },
	light: { bg: '#f5f6f8', grid: '#dfe3ea', gridCenter: '#c9d0db', accent: '#1f6fff', ink: '#0d1220', inkMix: 0.6, fillMix: 0 },
};

function hashIndex(s, n) {
	let h = 0;
	for (const ch of String(s)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
	return Math.abs(h) % n;
}

function resolveTheme(pref) {
	if (pref === 'dark' || pref === 'light') return pref;
	const attr = document.documentElement.getAttribute('data-theme');
	if (attr === 'dark' || attr === 'light') return attr;
	return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export class AnatomyViewer {
	/**
	 * @param {HTMLElement} container  element the canvas and labels mount into
	 * @param {object} [opts]
	 * @param {'auto'|'dark'|'light'} [opts.theme]
	 * @param {(id: string|null, ev?: PointerEvent) => void} [opts.onHover]
	 * @param {(id: string|null) => void} [opts.onSelect]
	 */
	constructor(container, opts = {}) {
		this.container = container;
		this.opts = opts;
		this.themePref = opts.theme || 'auto';
		this.themeName = resolveTheme(this.themePref);

		this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.localClippingEnabled = true;
		this.renderer.toneMapping = THREE.NeutralToneMapping;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.canvas = this.renderer.domElement;
		this.canvas.className = 'anx-canvas';
		this.canvas.setAttribute('aria-label', 'Interactive 3D machine view. Drag to rotate, scroll to zoom.');
		this.canvas.setAttribute('role', 'img');
		container.appendChild(this.canvas);

		this.labelLayer = document.createElement('div');
		this.labelLayer.className = 'anx-labels';
		this.labelLayer.setAttribute('aria-hidden', 'true');
		container.appendChild(this.labelLayer);

		this.scene = new THREE.Scene();
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		pmrem.dispose();
		this.scene.environment = this.envTexture;
		this.scene.environmentIntensity = 0.75;
		this.key = new THREE.DirectionalLight('#ffffff', 1.4);
		this.key.position.set(4, 9, 6);
		this.scene.add(this.key, new THREE.HemisphereLight('#ffffff', '#445066', 0.55));

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
		this.controls = new OrbitControls(this.camera, this.canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.09;
		this.controls.zoomToCursor = true;
		this.controls.minZoom = 0.25;
		this.controls.maxZoom = 12;
		this.controls.addEventListener('start', () => {
			this.tween = null;
			this.autoRotateUntil = 0;
		});

		this.root = new THREE.Group();
		this.scene.add(this.root);
		this.grid = null;

		this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
		this.lineMaterials = new Set();
		this.geomCache = new Map();
		this.state = { playing: true, speed: 1, explode: 0, section: null, sectionPos: 0.5, xray: false, labels: true };
		this.focus = null;
		this.hoverId = null;
		this.selectedId = null;
		this.hidden = new Set();
		this.time = 0;
		this.radius = 1;
		this.tween = null;
		this.dirty = true;
		this.visible = true;
		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
		this.pendingPick = null;

		this.reset();
		this.bindEvents();
		this.applyTheme();
		this.resize();
		this.clock = new THREE.Clock();
		this.renderer.setAnimationLoop(() => this.tick());
	}

	// ---------------------------------------------------------------- build

	reset() {
		this.parts = new Map(); // id -> { spec, mats, instances: [{pivot, motion, fill, edges}], children: [] }
		this.motionNodes = [];
		this.effects = [];
		this.flows = [];
		this.pickables = [];
		this.labelParts = [];
		this.instanceCount = 0;
		this.effectCount = 0;
	}

	clearScene() {
		for (const e of [...this.effects, ...this.flows]) {
			e.object.removeFromParent();
			e.dispose();
		}
		for (const p of this.parts.values()) {
			p.mats.fill.dispose();
			p.mats.edge.dispose();
			p.mats.back?.dispose();
			this.lineMaterials.delete(p.mats.edge);
		}
		for (const m of this.lineMaterials) m.dispose();
		this.lineMaterials.clear();
		this.root.clear();
		this.labelLayer.replaceChildren();
		this.reset();
	}

	/**
	 * Render a spec. `progressive` keeps the camera where it is and eases it
	 * to the new framing, for specs that grow while they stream in.
	 */
	load(spec, { progressive = false } = {}) {
		this.spec = spec;
		this.clearScene();
		const byId = new Map(spec.parts.map((p) => [p.id, p]));
		const childrenOf = new Map();
		for (const p of spec.parts) {
			const key = p.parent && byId.has(p.parent) ? p.parent : null;
			if (!childrenOf.has(key)) childrenOf.set(key, []);
			childrenOf.get(key).push(p);
		}
		this.childrenOf = childrenOf;
		const groups = [...new Set(spec.parts.map((p) => p.group).filter(Boolean))];
		for (const p of spec.parts) {
			const base = p.color || PALETTE[(p.group ? groups.indexOf(p.group) : hashIndex(p.id, PALETTE.length)) % PALETTE.length];
			this.parts.set(p.id, { spec: p, color: new THREE.Color(base), mats: this.makeMaterials(p), instances: [], effectAnchors: [] });
		}
		for (const p of childrenOf.get(null) || []) this.buildPart(p, this.root);

		const effectsByParent = new Map();
		for (const e of spec.effects) {
			const k = e.parent && this.parts.has(e.parent) ? e.parent : null;
			if (!effectsByParent.has(k)) effectsByParent.set(k, []);
			effectsByParent.get(k).push(e);
		}
		const ctx = { lineMaterial: (o) => this.makeLineMaterial(o) };
		for (const [parentId, list] of effectsByParent) {
			const anchors = parentId ? this.parts.get(parentId).instances.map((i) => i.motion) : [this.root];
			for (const eff of list) {
				for (const anchor of anchors) {
					if (this.effectCount >= MAX_EFFECT_INSTANCES) break;
					const built = buildEffect(eff, ctx);
					if (!built) continue;
					built.id = eff.id;
					anchor.add(built.object);
					this.effects.push(built);
					this.effectCount++;
				}
			}
		}
		for (const flow of spec.flows) {
			const built = buildFlow(flow, ctx);
			built.id = flow.id;
			this.root.add(built.object);
			this.flows.push(built);
		}
		// Shapes no longer in the spec free their geometry; shapes that are
		// still there (the common case while a spec streams in) are reused.
		for (const key of [...this.geomCache.keys()]) if (!this.geomCacheUsed?.has(key)) this.disposeGeom(key);
		this.geomCacheUsed = null;

		this.pickLabelParts();
		this.computeExplodeDirections();
		this.applyMotion(0);
		this.frameModel(progressive);
		this.applySection();
		this.applyExplode();
		this.refreshLooks();
		this.dirty = true;
		return { instances: this.instanceCount, truncated: this.instanceCount >= MAX_INSTANCES };
	}

	getGeometry(shape) {
		const key = JSON.stringify(shape);
		this.geomCacheUsed ??= new Set();
		this.geomCacheUsed.add(key);
		let g = this.geomCache.get(key);
		if (!g) {
			const { fill, lines } = buildShape(shape);
			fill.computeBoundingBox();
			fill.computeBoundingSphere();
			const lineGeom = new LineSegmentsGeometry();
			lineGeom.setPositions(lines);
			g = { fill, lineGeom, center: fill.boundingBox.getCenter(new THREE.Vector3()) };
			this.geomCache.set(key, g);
		}
		return g;
	}

	disposeGeom(key) {
		const g = this.geomCache.get(key);
		if (!g) return;
		g.fill.dispose();
		g.lineGeom.dispose();
		this.geomCache.delete(key);
	}

	makeLineMaterial({ color = '#ffffff', width = 1.2, dashed = false, dashSize = 0.1, gapSize = 0.05, transparent = false, opacity = 1 } = {}) {
		const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, dashed, dashSize, gapSize, transparent, opacity, worldUnits: false });
		m.resolution.set(this.width || 1, this.height || 1);
		this.lineMaterials.add(m);
		return m;
	}

	makeMaterials() {
		const fill = new THREE.MeshStandardMaterial({
			color: '#888888',
			metalness: 0.25,
			roughness: 0.55,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});
		const edge = this.makeLineMaterial({ width: 1.25 });
		return { fill, edge, back: null, key: '' };
	}

	buildPart(part, parent) {
		const entry = this.parts.get(part.id);
		const rep = part.repeat;
		const count = rep ? rep.count : 1;
		for (let k = 0; k < count; k++) {
			if (this.instanceCount >= MAX_INSTANCES) return;
			this.instanceCount++;
			const repeatNode = new THREE.Group();
			if (rep?.mode === 'radial') {
				const span = rep.angle >= 360 ? (rep.angle / count) * k : count > 1 ? (rep.angle / (count - 1)) * k : 0;
				repeatNode.quaternion.setFromAxisAngle(AXIS_VEC[rep.axis], span * DEG);
			} else if (rep?.mode === 'linear') {
				repeatNode.position.set(rep.offset[0] * k, rep.offset[1] * k, rep.offset[2] * k);
			}
			const pivot = new THREE.Group();
			pivot.position.fromArray(part.position);
			pivot.rotation.set(part.rotation[0] * DEG, part.rotation[1] * DEG, part.rotation[2] * DEG);
			pivot.scale.fromArray(part.scale);
			pivot.userData.base = pivot.position.clone();
			const motion = new THREE.Group();
			motion.userData.motions = part.motion;
			const geom = this.getGeometry(part.shape);
			const fill = new THREE.Mesh(geom.fill, entry.mats.fill);
			fill.userData.partId = part.id;
			const edges = new LineSegments2(geom.lineGeom, entry.mats.edge);
			edges.userData.partId = part.id;
			edges.renderOrder = 2;
			motion.add(fill, edges);
			pivot.add(motion);
			repeatNode.add(pivot);
			parent.add(repeatNode);
			if (part.motion.length) this.motionNodes.push(motion);
			this.pickables.push(fill);
			entry.instances.push({ repeatNode, pivot, motion, fill, edges, center: geom.center });
			for (const child of this.childrenOf.get(part.id) || []) this.buildPart(child, motion);
		}
	}

	pickLabelParts() {
		const explicit = this.spec.parts.filter((p) => p.label === true);
		const pool = explicit.length ? explicit : (this.childrenOf.get(null) || []).filter((p) => p.label !== false).slice(0, 18);
		this.labelParts = pool.map((p) => {
			const el = document.createElement('div');
			el.className = 'anx-label';
			el.textContent = p.name;
			el.dataset.part = p.id;
			this.labelLayer.appendChild(el);
			return { id: p.id, el, w: 0, h: 0 };
		});
		this.labelExtra = new Map();
	}

	// --------------------------------------------------------------- motion

	applyMotion(t) {
		const q = new THREE.Quaternion();
		for (const node of this.motionNodes) {
			node.position.set(0, 0, 0);
			node.quaternion.identity();
			node.scale.set(1, 1, 1);
			for (const m of node.userData.motions) {
				const ph = (m.phase || 0) * DEG;
				if (m.type === 'spin') {
					q.setFromAxisAngle(AXIS_VEC[m.axis], TAU * m.speed * t + ph);
					node.quaternion.multiply(q);
				} else if (m.type === 'oscillate') {
					const s = Math.sin(TAU * m.frequency * t + ph);
					if (m.kind === 'rotate') {
						q.setFromAxisAngle(AXIS_VEC[m.axis], m.amplitude * DEG * s);
						node.quaternion.multiply(q);
					} else {
						node.position.addScaledVector(AXIS_VEC[m.axis], m.amplitude * s);
					}
				} else if (m.type === 'crank') {
					// Slider-crank: piston travel for crank radius r and rod
					// length l, centred so it swings between +r and -r.
					const th = TAU * m.speed * t + ph;
					const r = m.radius;
					const l = m.rod;
					const sin = Math.sin(th);
					const x = r * Math.cos(th) + Math.sqrt(Math.max(l * l - r * r * sin * sin, 0)) - l;
					node.position.addScaledVector(AXIS_VEC[m.axis], x);
				} else if (m.type === 'pulse') {
					node.scale.multiplyScalar(1 + m.amplitude * Math.sin(TAU * m.frequency * t + ph));
				}
			}
		}
	}

	// -------------------------------------------------------------- explode

	computeExplodeDirections() {
		this.root.updateMatrixWorld(true);
		const box = new THREE.Box3();
		for (const f of this.pickables) box.expandByObject(f);
		const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
		const size = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length() / 2;
		const tops = this.childrenOf.get(null) || [];
		const fallback = new THREE.Vector3(0, 1, 0);
		for (const p of this.spec.parts) {
			const entry = this.parts.get(p.id);
			for (const inst of entry.instances) {
				if (p.explode) {
					inst.pivot.userData.explodeDir = new THREE.Vector3().fromArray(p.explode);
					continue;
				}
				if (!tops.includes(p)) {
					inst.pivot.userData.explodeDir = null;
					continue;
				}
				// Top-level parts fly outward from the model centre, scaled by
				// how far they already sit from it so the assembly order holds.
				const c = inst.fill.localToWorld(inst.center.clone());
				const d = c.sub(center);
				const len = d.length();
				const dir = len > size * 0.02 ? d.divideScalar(len) : fallback.clone();
				const parentQ = inst.pivot.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
				dir.applyQuaternion(parentQ).multiplyScalar(size * 0.35 + len * 0.9);
				inst.pivot.userData.explodeDir = dir;
			}
		}
	}

	applyExplode() {
		const k = this.state.explode;
		for (const entry of this.parts.values()) {
			for (const inst of entry.instances) {
				const dir = inst.pivot.userData.explodeDir;
				inst.pivot.position.copy(inst.pivot.userData.base);
				if (dir && k > 0) inst.pivot.position.addScaledVector(dir, k);
			}
		}
		this.dirty = true;
	}

	// -------------------------------------------------------------- framing

	modelBox(ids = null) {
		this.root.updateMatrixWorld(true);
		const box = new THREE.Box3();
		const tmp = new THREE.Box3();
		const want = ids ? this.expandIds(ids) : null;
		for (const f of this.pickables) {
			if (want && !want.has(f.userData.partId)) continue;
			if (this.hidden.has(f.userData.partId)) continue;
			if (!f.geometry.boundingBox) f.geometry.computeBoundingBox();
			tmp.copy(f.geometry.boundingBox).applyMatrix4(f.matrixWorld);
			box.union(tmp);
		}
		if (ids) {
			for (const e of [...this.effects, ...this.flows]) if (ids.includes(e.id)) box.expandByObject(e.object);
		}
		return box;
	}

	frameModel(progressive) {
		this.root.position.set(0, 0, 0);
		const box = this.modelBox();
		if (box.isEmpty()) return;
		const center = box.getCenter(new THREE.Vector3());
		this.root.position.copy(center).negate();
		const size = box.getSize(new THREE.Vector3());
		this.radius = Math.max(size.length() / 2, 0.05);
		this.modelSize = size;
		this.modelMin = box.min.clone().sub(center);
		this.updateGrid();
		this.updateFrustum();
		const dist = this.radius * 6;
		this.camera.near = 0.01;
		this.camera.far = dist * 4;
		if (!progressive || !this.framed) {
			this.controls.target.set(0, 0, 0);
			this.camera.position.copy(ISO_DIR).multiplyScalar(dist);
			this.camera.zoom = 1;
			this.camera.updateProjectionMatrix();
			this.controls.update();
			this.framed = true;
		} else {
			this.tween = { target: new THREE.Vector3(), zoom: 1 };
		}
		this.camera.updateProjectionMatrix();
	}

	updateGrid() {
		if (this.grid) {
			this.grid.removeFromParent();
			this.grid.geometry.dispose();
			this.grid.material.dispose();
		}
		const extent = Math.max(this.modelSize.x, this.modelSize.z) * 1.8 + this.radius * 0.5;
		const step = 10 ** Math.floor(Math.log10(extent / 12));
		const divisions = Math.min(200, Math.max(4, Math.round(extent / step)));
		const t = THEMES[this.themeName];
		this.grid = new THREE.GridHelper(divisions * step, divisions, t.gridCenter, t.grid);
		this.grid.material.transparent = true;
		this.grid.material.opacity = 0.9;
		this.grid.material.depthWrite = false;
		this.grid.position.y = this.modelMin.y - this.radius * 0.04;
		this.grid.renderOrder = -1;
		this.scene.add(this.grid);
	}

	updateFrustum() {
		const aspect = (this.width || 1) / (this.height || 1);
		const half = this.radius * 1.12;
		const fitW = aspect >= 1 ? half * aspect : half;
		const fitH = aspect >= 1 ? half : half / aspect;
		this.camera.left = -fitW;
		this.camera.right = fitW;
		this.camera.top = fitH;
		this.camera.bottom = -fitH;
		this.camera.updateProjectionMatrix();
	}

	/** Ease the camera to frame a set of parts, or the whole model when ids is empty. */
	focusOn(ids) {
		if (!ids?.length) {
			this.tween = { target: new THREE.Vector3(), zoom: 1 };
			return;
		}
		const box = this.modelBox(ids);
		if (box.isEmpty()) return;
		const c = box.getCenter(new THREE.Vector3());
		const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, this.radius * 0.12);
		const zoom = THREE.MathUtils.clamp(this.radius / (r * 1.35), 1, 5);
		this.tween = { target: c, zoom };
	}

	resetView() {
		const dist = this.radius * 6;
		this.tween = null;
		this.controls.target.set(0, 0, 0);
		this.camera.position.copy(ISO_DIR).multiplyScalar(dist);
		this.camera.zoom = 1;
		this.camera.updateProjectionMatrix();
		this.controls.update();
		this.dirty = true;
	}

	/** Snap to an orthographic view: 'iso', 'front', 'side', 'top'. */
	setView(name) {
		const dirs = { iso: ISO_DIR, front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), top: new THREE.Vector3(0, 1, 0.0001) };
		const dir = (dirs[name] || ISO_DIR).clone().normalize();
		this.camera.position.copy(this.controls.target).addScaledVector(dir, this.radius * 6);
		this.camera.updateProjectionMatrix();
		this.controls.update();
		this.dirty = true;
	}

	// ---------------------------------------------------------------- looks

	expandIds(ids) {
		const out = new Set();
		const visit = (id) => {
			if (out.has(id)) return;
			out.add(id);
			for (const c of this.childrenOf?.get(id) || []) visit(c.id);
		};
		for (const id of ids) visit(id);
		return out;
	}

	refreshLooks() {
		const focusSet = this.focus ? this.expandIds(this.focus) : null;
		this.focusSet = focusSet;
		const t = THEMES[this.themeName];
		const bg = new THREE.Color(t.bg);
		const ink = new THREE.Color(t.ink);
		const accent = new THREE.Color(t.accent);
		for (const [id, entry] of this.parts) {
			const p = entry.spec;
			const dimmed = focusSet ? !focusSet.has(id) : false;
			const hovered = this.hoverId === id;
			const selected = this.selectedId === id;
			const hidden = this.hidden.has(id);
			const { fill, edge } = entry.mats;
			let style = p.style;
			if (this.state.xray && style === 'solid') style = 'xray';

			let opacity = 1;
			let transparent = false;
			let depthWrite = true;
			let colorWrite = true;
			if (style === 'glass') {
				opacity = 0.2;
				transparent = true;
				depthWrite = false;
			} else if (style === 'ghost') {
				opacity = 0.06;
				transparent = true;
				depthWrite = false;
			} else if (style === 'xray') {
				opacity = 0.1;
				transparent = true;
				depthWrite = false;
			} else if (style === 'wire') {
				colorWrite = false;
				depthWrite = false;
			}
			if (dimmed && colorWrite) {
				opacity = Math.min(opacity, 0.05);
				transparent = true;
				depthWrite = false;
			}
			fill.color.copy(entry.color).lerp(bg, t.fillMix);
			fill.opacity = opacity;
			fill.emissive.copy(entry.color).multiplyScalar(p.glow * 0.9);
			if (selected) fill.emissive.lerp(accent, 0.35);
			const key = `${transparent}|${depthWrite}|${colorWrite}`;
			if (key !== entry.mats.key) {
				fill.transparent = transparent;
				fill.depthWrite = depthWrite;
				fill.colorWrite = colorWrite;
				fill.needsUpdate = true;
				entry.mats.key = key;
			}

			const edgeColor = entry.color.clone().lerp(ink, t.inkMix);
			if (p.glow > 0 && this.themeName === 'dark') edgeColor.lerp(new THREE.Color('#ffffff'), p.glow * 0.3);
			edge.color.copy(hovered || selected ? accent : edgeColor);
			let edgeOpacity = style === 'ghost' ? 0.35 : style === 'glass' ? 0.85 : style === 'xray' ? 0.75 : 1;
			if (dimmed) edgeOpacity *= 0.16;
			edge.opacity = edgeOpacity;
			if (edge.transparent !== edgeOpacity < 1) {
				edge.transparent = edgeOpacity < 1;
				edge.needsUpdate = true;
			}
			edge.linewidth = hovered ? 2.6 : selected ? 2.2 : style === 'ghost' ? 1 : 1.25;
			for (const inst of entry.instances) {
				inst.fill.visible = !hidden;
				inst.edges.visible = !hidden;
				inst.fill.renderOrder = transparent ? 1 : 0;
			}
		}
		const effectDim = (id) => (focusSet && !focusSet.has(id) ? DIM : 1);
		for (const e of this.effects) e.setDim(effectDim(e.id));
		for (const f of this.flows) f.setDim(effectDim(f.id));
		this.dirty = true;
	}

	setFocus(ids) {
		this.focus = ids?.length ? ids : null;
		this.refreshLooks();
		this.focusOn(this.focus);
	}

	setHover(id) {
		if (this.hoverId === id) return;
		this.hoverId = id;
		this.canvas.style.cursor = id ? 'pointer' : '';
		this.refreshLooks();
	}

	setSelected(id) {
		this.selectedId = id;
		this.refreshLooks();
	}

	setPartVisible(id, visible) {
		if (visible) this.hidden.delete(id);
		else this.hidden.add(id);
		this.refreshLooks();
	}

	setXray(on) {
		this.state.xray = Boolean(on);
		this.refreshLooks();
	}

	setLabels(on) {
		this.state.labels = Boolean(on);
		this.labelLayer.hidden = !on;
		this.dirty = true;
	}

	setPlaying(on) {
		this.state.playing = Boolean(on);
		this.dirty = true;
	}

	setSpeed(s) {
		this.state.speed = s;
	}

	setExplode(k) {
		this.state.explode = THREE.MathUtils.clamp(k, 0, 1);
		this.applyExplode();
	}

	/** Cut the model with a plane normal to `axis` at `pos` (0..1 across the model). */
	setSection(axis, pos = this.state.sectionPos) {
		this.state.section = axis || null;
		this.state.sectionPos = THREE.MathUtils.clamp(pos, 0, 1);
		this.applySection();
	}

	applySection() {
		const axis = this.state.section;
		const planes = axis ? [this.clipPlane] : null;
		if (axis) {
			const half = (this.modelSize?.[axis] || 1) / 2;
			const c = -half * 1.02 + this.state.sectionPos * half * 2.04;
			this.clipPlane.normal.copy(AXIS_VEC[axis]).negate();
			this.clipPlane.constant = c;
		}
		for (const entry of this.parts.values()) {
			const { fill, edge } = entry.mats;
			const had = Boolean(fill.clippingPlanes?.length);
			fill.clippingPlanes = planes;
			edge.clippingPlanes = planes;
			if (had !== Boolean(planes)) {
				fill.needsUpdate = true;
				edge.needsUpdate = true;
			}
			if (axis) this.ensureCaps(entry);
			for (const inst of entry.instances) if (inst.back) inst.back.visible = Boolean(axis) && !this.hidden.has(entry.spec.id) && entry.spec.style === 'solid';
		}
		this.dirty = true;
	}

	// Section caps: back faces drawn in a flat cut colour read as solid
	// material where the plane slices through a closed part.
	ensureCaps(entry) {
		if (!entry.mats.back) {
			entry.mats.back = new THREE.MeshBasicMaterial({ side: THREE.BackSide, clippingPlanes: [this.clipPlane] });
		}
		entry.mats.back.color.copy(entry.color).lerp(new THREE.Color(THEMES[this.themeName].bg), 0.55);
		for (const inst of entry.instances) {
			if (inst.back) continue;
			inst.back = new THREE.Mesh(inst.fill.geometry, entry.mats.back);
			inst.back.raycast = () => {};
			inst.fill.parent.add(inst.back);
		}
	}

	// ---------------------------------------------------------------- theme

	setTheme(pref) {
		this.themePref = pref;
		this.applyTheme();
	}

	applyTheme() {
		this.themeName = resolveTheme(this.themePref);
		const t = THEMES[this.themeName];
		this.scene.background = new THREE.Color(t.bg);
		(this.container.closest('.anx') || this.container).dataset.anxTheme = this.themeName;
		if (this.modelSize) this.updateGrid();
		for (const entry of this.parts.values()) if (entry.mats.back) entry.mats.back.color.copy(entry.color).lerp(new THREE.Color(t.bg), 0.55);
		this.refreshLooks();
	}

	// --------------------------------------------------------------- events

	bindEvents() {
		this.onResize = () => this.resize();
		this.resizeObserver = new ResizeObserver(this.onResize);
		this.resizeObserver.observe(this.container);
		this.visObserver = new IntersectionObserver((entries) => {
			this.visible = entries.some((e) => e.isIntersecting);
		});
		this.visObserver.observe(this.container);
		this.themeObserver = new MutationObserver(() => {
			if (this.themePref === 'auto') this.applyTheme();
		});
		this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

		let down = null;
		this.onPointerDown = (e) => {
			down = { x: e.clientX, y: e.clientY };
		};
		this.onPointerMove = (e) => {
			if (e.buttons) return;
			this.pendingPick = { x: e.clientX, y: e.clientY, ev: e };
		};
		this.onPointerUp = (e) => {
			if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
			down = null;
			const id = this.pick(e.clientX, e.clientY);
			this.opts.onSelect?.(id);
		};
		this.onPointerLeave = () => {
			this.pendingPick = null;
			this.setHover(null);
			this.opts.onHover?.(null);
		};
		this.canvas.addEventListener('pointerdown', this.onPointerDown);
		this.canvas.addEventListener('pointermove', this.onPointerMove);
		this.canvas.addEventListener('pointerup', this.onPointerUp);
		this.canvas.addEventListener('pointerleave', this.onPointerLeave);
	}

	pick(clientX, clientY) {
		const rect = this.canvas.getBoundingClientRect();
		this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hits = this.raycaster.intersectObjects(this.pickables, false);
		const clip = this.state.section ? this.clipPlane : null;
		for (const h of hits) {
			const id = h.object.userData.partId;
			if (!h.object.visible || this.hidden.has(id)) continue;
			if (clip && clip.distanceToPoint(h.point) < 0) continue;
			if (this.focusSet && !this.focusSet.has(id)) continue;
			return id;
		}
		return null;
	}

	resize() {
		const r = this.container.getBoundingClientRect();
		this.width = Math.max(1, Math.round(r.width));
		this.height = Math.max(1, Math.round(r.height));
		this.renderer.setSize(this.width, this.height, false);
		this.canvas.style.width = '100%';
		this.canvas.style.height = '100%';
		for (const m of this.lineMaterials) m.resolution.set(this.width, this.height);
		this.updateFrustum();
		this.dirty = true;
	}

	// ----------------------------------------------------------------- loop

	tick() {
		const dt = Math.min(this.clock.getDelta(), 0.1);
		if (!this.visible || document.hidden) return;
		if (this.pendingPick) {
			const { x, y, ev } = this.pendingPick;
			this.pendingPick = null;
			const id = this.pick(x, y);
			if (id !== this.hoverId) {
				this.setHover(id);
			}
			this.opts.onHover?.(id, ev);
		}
		if (this.tween) {
			const k = 1 - Math.exp(-dt * 7);
			this.controls.target.lerp(this.tween.target, k);
			const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(this.radius * 6);
			this.camera.position.copy(this.controls.target).add(offset);
			this.camera.zoom += (this.tween.zoom - this.camera.zoom) * k;
			this.camera.updateProjectionMatrix();
			if (this.controls.target.distanceTo(this.tween.target) < this.radius * 1e-3 && Math.abs(this.camera.zoom - this.tween.zoom) < 1e-3) this.tween = null;
			this.dirty = true;
		}
		const moved = this.controls.update();
		if (moved) this.dirty = true;
		const animating = this.state.playing && this.state.speed > 0;
		if (animating) {
			this.time += dt * this.state.speed * (this.spec?.view?.speed ?? 1);
			this.applyMotion(this.time);
		}
		if (!animating && !this.dirty) return;

		const frame = {
			dark: this.themeName === 'dark',
			pixelScale: (this.renderer.getPixelRatio() * this.height * this.camera.zoom) / (this.camera.top - this.camera.bottom),
		};
		const effectDt = animating ? dt * this.state.speed : 0;
		for (const e of this.effects) e.update(this.time, effectDt, frame);
		for (const f of this.flows) f.update(this.time, effectDt, frame);
		this.renderer.render(this.scene, this.camera);
		if (this.state.labels) this.updateLabels();
		this.dirty = false;
		this.opts.onFrame?.();
	}

	/** Project label anchors to screen and hide the ones that would overlap. */
	updateLabels() {
		const placed = [];
		const v = new THREE.Vector3();
		const order = [...this.labelParts].sort((a, b) => {
			const pa = a.id === this.selectedId || a.id === this.hoverId || this.focusSet?.has(a.id) ? 0 : 1;
			const pb = b.id === this.selectedId || b.id === this.hoverId || this.focusSet?.has(b.id) ? 0 : 1;
			return pa - pb;
		});
		for (const label of order) {
			const entry = this.parts.get(label.id);
			const inst = entry?.instances[0];
			const show = inst && !this.hidden.has(label.id) && (!this.focusSet || this.focusSet.has(label.id));
			if (!show) {
				label.el.hidden = true;
				continue;
			}
			v.copy(inst.center);
			inst.fill.localToWorld(v);
			v.project(this.camera);
			const x = (v.x * 0.5 + 0.5) * this.width;
			const y = (-v.y * 0.5 + 0.5) * this.height;
			if (!label.w) {
				label.el.hidden = false;
				label.w = label.el.offsetWidth;
				label.h = label.el.offsetHeight;
			}
			const rect = { l: x - label.w / 2, t: y - label.h - 10, r: x + label.w / 2, b: y - 10 };
			const offscreen = rect.l < 0 || rect.r > this.width || rect.t < 0 || y > this.height;
			const overlaps = placed.some((p) => !(rect.r + 4 < p.l || rect.l - 4 > p.r || rect.b + 2 < p.t || rect.t - 2 > p.b));
			if (offscreen || overlaps) {
				label.el.hidden = true;
				continue;
			}
			placed.push(rect);
			label.el.hidden = false;
			label.el.style.transform = `translate(${Math.round(rect.l)}px, ${Math.round(rect.t)}px)`;
			label.el.classList.toggle('is-active', label.id === this.hoverId || label.id === this.selectedId);
		}
	}

	/** Screen position of a part's first instance, for tooltips. */
	screenPoint(id) {
		const inst = this.parts.get(id)?.instances[0];
		if (!inst) return null;
		const v = inst.center.clone();
		inst.fill.localToWorld(v);
		v.project(this.camera);
		return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
	}

	/** PNG of the current frame at 2x device resolution. */
	async screenshot() {
		const prev = this.renderer.getPixelRatio();
		this.renderer.setPixelRatio(Math.min(prev * 2, 3));
		this.renderer.setSize(this.width, this.height, false);
		const frame = { dark: this.themeName === 'dark', pixelScale: (this.renderer.getPixelRatio() * this.height * this.camera.zoom) / (this.camera.top - this.camera.bottom) };
		for (const e of this.effects) e.update(this.time, 0, frame);
		for (const f of this.flows) f.update(this.time, 0, frame);
		this.renderer.render(this.scene, this.camera);
		const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
		this.renderer.setPixelRatio(prev);
		this.renderer.setSize(this.width, this.height, false);
		this.dirty = true;
		return blob;
	}

	dispose() {
		this.renderer.setAnimationLoop(null);
		this.resizeObserver.disconnect();
		this.visObserver.disconnect();
		this.themeObserver.disconnect();
		this.canvas.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas.removeEventListener('pointermove', this.onPointerMove);
		this.canvas.removeEventListener('pointerup', this.onPointerUp);
		this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
		this.clearScene();
		for (const key of [...this.geomCache.keys()]) this.disposeGeom(key);
		if (this.grid) {
			this.grid.geometry.dispose();
			this.grid.material.dispose();
		}
		this.envTexture.dispose();
		this.controls.dispose();
		this.renderer.dispose();
		this.canvas.remove();
		this.labelLayer.remove();
	}
}
