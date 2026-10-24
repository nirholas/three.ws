// Adapted from @swarming/engine (visualize-web3-realtime, Apache-2.0, (c) nirholas).
// Changes: ported to plain JS; one GPU-instanced mesh with per-node radius and
// colour; pointer events (touch + mouse) with raycast hover/pick; on-demand
// rendering for reduced motion; ResizeObserver; WebGL context-loss handling.

import * as THREE from 'three';

export function webglAvailable() {
	try {
		const c = document.createElement('canvas');
		return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
	} catch {
		return false;
	}
}

export class ThreeRenderer {
	constructor(container, { background = '#0b0d12', autoRotate = true, onHover, onContextLost } = {}) {
		this.container = container;
		this.autoRotate = autoRotate;
		this.onHover = onHover;
		this.disposed = false;
		this.nodes = [];
		this.maxNodes = 4096;
		this.maxEdges = 16384;
		this.tempObj = new THREE.Object3D();
		this.tempColor = new THREE.Color();
		this.spherical = new THREE.Spherical(70, Math.PI / 2.4, 0.6);
		this.pointer = { down: false, moved: 0, x: 0, y: 0 };
		this.hoverIdx = -1;
		this.raycaster = new THREE.Raycaster();
		this.ndc = new THREE.Vector2();
		this.rafId = null;
		this.lastFrame = 0;
		this.maxZoom = 160;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.setClearColor(new THREE.Color(background), 0);
		const canvas = this.renderer.domElement;
		canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab;outline:none';
		canvas.tabIndex = 0;
		canvas.setAttribute('role', 'img');
		container.appendChild(canvas);

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
		this.applyCamera();

		this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
		const dir = new THREE.DirectionalLight(0xffffff, 1.4);
		dir.position.set(20, 40, 30);
		this.scene.add(dir);

		const geo = new THREE.SphereGeometry(1, 20, 14);
		const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
		this.mesh = new THREE.InstancedMesh(geo, mat, this.maxNodes);
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.setColorAt(0, this.tempColor.set('#ffffff'));
		this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
		this.scene.add(this.mesh);

		this.edgePos = new Float32Array(this.maxEdges * 6);
		this.edgeCol = new Float32Array(this.maxEdges * 6);
		const eg = new THREE.BufferGeometry();
		this.edgePosAttr = new THREE.BufferAttribute(this.edgePos, 3).setUsage(THREE.DynamicDrawUsage);
		this.edgeColAttr = new THREE.BufferAttribute(this.edgeCol, 3).setUsage(THREE.DynamicDrawUsage);
		eg.setAttribute('position', this.edgePosAttr);
		eg.setAttribute('color', this.edgeColAttr);
		eg.setDrawRange(0, 0);
		this.lines = new THREE.LineSegments(
			eg,
			new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
		);
		this.lines.frustumCulled = false;
		this.scene.add(this.lines);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();

		canvas.addEventListener('pointerdown', this.onDown);
		canvas.addEventListener('pointermove', this.onMove);
		canvas.addEventListener('pointerup', this.onUp);
		canvas.addEventListener('pointerleave', this.onLeave);
		canvas.addEventListener('wheel', this.onWheel, { passive: false });
		canvas.addEventListener('keydown', this.onKey);
		canvas.addEventListener('webglcontextlost', (e) => {
			e.preventDefault();
			onContextLost?.();
		});
	}

	applyCamera() {
		this.camera.position.setFromSpherical(this.spherical);
		this.camera.lookAt(0, 0, 0);
	}

	resize = () => {
		if (this.disposed) return;
		const w = Math.max(1, this.container.clientWidth);
		const h = Math.max(1, this.container.clientHeight);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.requestRender();
	};

	requestRender() {
		if (this.rafId == null && !this.disposed && !this.looping) {
			this.rafId = requestAnimationFrame(() => {
				this.rafId = null;
				this.draw();
			});
		}
	}

	/** Run a continuous loop; `step` advances the simulation before each draw. */
	start(step) {
		this.looping = true;
		const frame = (t) => {
			if (this.disposed) return;
			this.rafId = requestAnimationFrame(frame);
			if (document.hidden) return;
			const dt = this.lastFrame ? Math.min(0.05, (t - this.lastFrame) / 1000) : 0.016;
			this.lastFrame = t;
			step?.();
			if (this.autoRotate && !this.pointer.down) {
				this.spherical.theta += dt * 0.12;
				this.applyCamera();
			}
			this.draw();
		};
		this.rafId = requestAnimationFrame(frame);
	}

	stop() {
		this.looping = false;
		if (this.rafId != null) cancelAnimationFrame(this.rafId);
		this.rafId = null;
	}

	setData(nodes, edges) {
		this.nodes = nodes;
		this.edges = edges;
		this.requestRender();
	}

	draw() {
		if (this.disposed) return;
		const nodes = this.nodes;
		const count = Math.min(nodes.length, this.maxNodes);
		this.mesh.count = count;
		for (let i = 0; i < count; i++) {
			const n = nodes[i];
			this.tempObj.position.set(n.x || 0, n.y || 0, n.z || 0);
			this.tempObj.scale.setScalar(n.radius * (i === this.hoverIdx ? 1.18 : 1));
			this.tempObj.updateMatrix();
			this.mesh.setMatrixAt(i, this.tempObj.matrix);
			this.mesh.setColorAt(i, this.tempColor.set(n.color));
		}
		this.mesh.instanceMatrix.needsUpdate = true;
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

		const edges = this.edges || [];
		const ec = Math.min(edges.length, this.maxEdges);
		for (let i = 0; i < ec; i++) {
			const e = edges[i];
			const s = e.source, t = e.target, o = i * 6;
			this.edgePos[o] = s.x || 0; this.edgePos[o + 1] = s.y || 0; this.edgePos[o + 2] = s.z || 0;
			this.edgePos[o + 3] = t.x || 0; this.edgePos[o + 4] = t.y || 0; this.edgePos[o + 5] = t.z || 0;
			this.tempColor.set(e.color || '#8892a6');
			this.edgeCol[o] = this.edgeCol[o + 3] = this.tempColor.r;
			this.edgeCol[o + 1] = this.edgeCol[o + 4] = this.tempColor.g;
			this.edgeCol[o + 2] = this.edgeCol[o + 5] = this.tempColor.b;
		}
		this.edgePosAttr.needsUpdate = true;
		this.edgeColAttr.needsUpdate = true;
		this.lines.geometry.setDrawRange(0, ec * 2);
		this.renderer.render(this.scene, this.camera);
	}

	pick(clientX, clientY) {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(this.ndc, this.camera);
		const hit = this.raycaster.intersectObject(this.mesh, false)[0];
		return hit && hit.instanceId != null ? hit.instanceId : -1;
	}

	onDown = (e) => {
		this.pointer = { down: true, moved: 0, x: e.clientX, y: e.clientY };
		this.renderer.domElement.setPointerCapture?.(e.pointerId);
		this.renderer.domElement.style.cursor = 'grabbing';
	};

	onMove = (e) => {
		const p = this.pointer;
		if (p.down) {
			const dx = e.clientX - p.x, dy = e.clientY - p.y;
			p.x = e.clientX; p.y = e.clientY; p.moved += Math.abs(dx) + Math.abs(dy);
			this.spherical.theta -= dx * 0.006;
			this.spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, this.spherical.phi - dy * 0.006));
			this.applyCamera();
			this.requestRender();
			return;
		}
		const idx = this.pick(e.clientX, e.clientY);
		if (idx !== this.hoverIdx) {
			this.hoverIdx = idx;
			this.renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
			this.requestRender();
		}
		const rect = this.container.getBoundingClientRect();
		this.onHover?.(idx >= 0 ? this.nodes[idx] : null, e.clientX - rect.left, e.clientY - rect.top);
	};

	onUp = (e) => {
		const tap = this.pointer.moved < 5;
		this.pointer.down = false;
		this.renderer.domElement.style.cursor = 'grab';
		if (tap && e.pointerType !== 'mouse') {
			const idx = this.pick(e.clientX, e.clientY);
			this.hoverIdx = idx;
			const rect = this.container.getBoundingClientRect();
			this.onHover?.(idx >= 0 ? this.nodes[idx] : null, e.clientX - rect.left, e.clientY - rect.top);
			this.requestRender();
		}
	};

	onLeave = () => {
		if (this.hoverIdx !== -1) {
			this.hoverIdx = -1;
			this.onHover?.(null, 0, 0);
			this.requestRender();
		}
	};

	onWheel = (e) => {
		e.preventDefault();
		this.spherical.radius = Math.max(18, Math.min(this.maxZoom, this.spherical.radius + e.deltaY * 0.06 * (this.maxZoom / 160)));
		this.applyCamera();
		this.requestRender();
	};

	onKey = (e) => {
		const step = 0.12;
		if (e.key === 'ArrowLeft') this.spherical.theta -= step;
		else if (e.key === 'ArrowRight') this.spherical.theta += step;
		else if (e.key === 'ArrowUp') this.spherical.phi = Math.max(0.15, this.spherical.phi - step);
		else if (e.key === 'ArrowDown') this.spherical.phi = Math.min(Math.PI - 0.15, this.spherical.phi + step);
		else if (e.key === '+' || e.key === '=') this.spherical.radius = Math.max(18, this.spherical.radius - 6);
		else if (e.key === '-') this.spherical.radius = Math.min(this.maxZoom, this.spherical.radius + 6);
		else return;
		e.preventDefault();
		this.applyCamera();
		this.requestRender();
	};

	/** Fit the camera distance to the current layout extent. */
	fit() {
		const dists = this.nodes.map((n) => Math.hypot(n.x || 0, n.y || 0, n.z || 0) + n.radius).sort((a, b) => a - b);
		const r = Math.max(10, dists.length ? dists[Math.floor((dists.length - 1) * 0.92)] : 10);
		this.maxZoom = Math.max(160, r * 4);
		this.spherical.radius = Math.max(30, Math.min(this.maxZoom, r * 2.4));
		this.applyCamera();
		this.requestRender();
	}

	dispose() {
		this.disposed = true;
		this.stop();
		this.resizeObserver.disconnect();
		const c = this.renderer.domElement;
		c.removeEventListener('pointerdown', this.onDown);
		c.removeEventListener('pointermove', this.onMove);
		c.removeEventListener('pointerup', this.onUp);
		c.removeEventListener('pointerleave', this.onLeave);
		c.removeEventListener('wheel', this.onWheel);
		c.removeEventListener('keydown', this.onKey);
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
		this.lines.geometry.dispose();
		this.lines.material.dispose();
		this.renderer.dispose();
		c.remove();
	}
}
