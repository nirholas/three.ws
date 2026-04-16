// <agent-stage> — shared scene host for multiple <agent-3d> children.
// See specs/STAGE_SPEC.md

import { Group, Vector3 } from 'three';
import { Viewer } from './viewer.js';

const FORMATIONS = ['row', 'circle', 'freeform'];

const STAGE_STYLE = `
	:host {
		display: block;
		position: relative;
		width: 100%;
		height: 480px;
		contain: layout style;
	}
	:host([hidden]) { display: none; }
	.stage-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.stage-canvas canvas { display: block; }
	::slotted(agent-3d) {
		position: absolute;
		pointer-events: none;
	}
`;

class AgentStageElement extends HTMLElement {
	static get observedAttributes() {
		return ['formation'];
	}

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._viewer = null;
		this._agents = [];
		this._initialized = false;
	}

	connectedCallback() {
		this._renderShell();
		this._initViewer();
		this._mo = new MutationObserver(() => this._repositionAll());
		this._mo.observe(this, { childList: true });
	}

	disconnectedCallback() {
		try { this._mo?.disconnect(); } catch {}
		for (const a of [...this._agents]) this.unregisterAgent(a.element);
		try { this._viewer?.dispose?.(); } catch {}
		this._viewer = null;
		this._initialized = false;
	}

	attributeChangedCallback(name) {
		if (name === 'formation') this._repositionAll();
	}

	get formation() {
		const f = this.getAttribute('formation') || 'row';
		return FORMATIONS.includes(f) ? f : 'row';
	}

	get viewer() { return this._viewer; }

	_renderShell() {
		const style = document.createElement('style');
		style.textContent = STAGE_STYLE;
		this.shadowRoot.appendChild(style);

		const box = document.createElement('div');
		box.className = 'stage-canvas';
		box.part = 'stage';
		this.shadowRoot.appendChild(box);
		this._canvasBox = box;

		const slot = document.createElement('slot');
		this.shadowRoot.appendChild(slot);
	}

	_initViewer() {
		if (this._initialized) return;
		this._viewer = new Viewer(this._canvasBox, { kiosk: true });
		// Default framing for a human-scale stage.
		this._viewer.defaultCamera.position.set(0, 1.55, 3.4);
		this._viewer.defaultCamera.lookAt(0, 1.2, 0);
		this._viewer.controls.target.set(0, 1.2, 0);
		this._viewer.controls.update();
		try { this._viewer.updateLights?.(); } catch {}
		try { this._viewer.updateEnvironment?.(); } catch {}
		this._viewer.invalidate();
		this._initialized = true;
	}

	// --- Called by <agent-3d> children that detect this parent stage ---

	registerAgent(element, { id, group, manifest }) {
		const finalId = this._uniqueId(id || manifest?.name || 'agent');
		const rec = { id: finalId, element, group, manifest };
		this._agents.push(rec);
		this._viewer?.scene.add(group);
		this._repositionAll();
		this.dispatchEvent(new CustomEvent('stage:agent-joined', {
			detail: { agentId: finalId, element, manifest },
			bubbles: true,
			composed: true,
		}));
		return finalId;
	}

	unregisterAgent(element) {
		const i = this._agents.findIndex((a) => a.element === element);
		if (i < 0) return;
		const [rec] = this._agents.splice(i, 1);
		try { this._viewer?.scene.remove(rec.group); } catch {}
		disposeGroup(rec.group);
		this._repositionAll();
		this.dispatchEvent(new CustomEvent('stage:agent-left', {
			detail: { agentId: rec.id, element: rec.element },
			bubbles: true,
			composed: true,
		}));
	}

	_uniqueId(base) {
		let id = base;
		let n = 1;
		const taken = new Set(this._agents.map((a) => a.id));
		while (taken.has(id)) id = `${base}-${n++}`;
		return id;
	}

	// --- Public API ---

	getAgents() {
		return this._agents.map(({ id, group, manifest, element }) => ({
			agentId: id,
			name: manifest?.name || id,
			position: [
				+group.position.x.toFixed(3),
				+group.position.y.toFixed(3),
				+group.position.z.toFixed(3),
			],
			element,
		}));
	}

	broadcast(fromId, event) {
		const detail = { from: fromId, event };
		for (const a of this._agents) {
			if (a.id === fromId) continue;
			a.element.dispatchEvent(new CustomEvent('stage:message', { detail }));
		}
		this.dispatchEvent(new CustomEvent('stage:message', {
			detail,
			bubbles: true,
			composed: true,
		}));
	}

	async routeMessage(fromId, toId, text) {
		const target = this._agents.find((a) => a.id === toId);
		if (!target) return { ok: false, error: `No agent "${toId}" on stage` };
		try {
			const reply = await target.element.say(`[from ${fromId}] ${text}`);
			return { ok: true, reply: reply?.text || '' };
		} catch (e) {
			return { ok: false, error: e?.message || String(e) };
		}
	}

	async addAgent(manifest) {
		const el = document.createElement('agent-3d');
		if (manifest && typeof manifest === 'object') {
			el._inlineManifest = manifest;
		}
		if (!el.hasAttribute('eager')) el.setAttribute('eager', '');
		this.appendChild(el);
		return el;
	}

	removeAgent(agentId) {
		const rec = this._agents.find((a) => a.id === agentId);
		if (rec) rec.element.remove();
	}

	// --- Formation / layout ---

	_repositionAll() {
		const n = this._agents.length;
		if (!n || !this._viewer) return;
		for (let i = 0; i < n; i++) {
			const { element, group, manifest } = this._agents[i];
			const slot = this._slotFor(i, n);
			group.position.copy(slot.world);
			group.lookAt(0, slot.world.y + 1.0, slot.world.z + 5.0);
			// Sub-rect for this child's chrome overlay
			element.style.position = 'absolute';
			element.style.left = slot.dom.left;
			element.style.top = slot.dom.top;
			element.style.width = slot.dom.width;
			element.style.height = slot.dom.height;
			element.style.pointerEvents = 'none';
		}
		this._viewer.invalidate();
	}

	_slotFor(i, n) {
		const f = this.formation;
		const w = 1 / Math.max(n, 1);
		if (f === 'circle') {
			const angle = (i / n) * Math.PI * 2;
			const r = Math.max(0.8, 0.4 * n);
			return {
				world: new Vector3(Math.sin(angle) * r, 0, -Math.cos(angle) * r + r * 0.5),
				dom: {
					left: `${i * w * 100}%`,
					top: '0',
					width: `${w * 100}%`,
					height: '100%',
				},
			};
		}
		if (f === 'freeform') {
			return {
				world: new Vector3(0, 0, 0),
				dom: { left: '0', top: '0', width: '100%', height: '100%' },
			};
		}
		// row
		const spacing = 1.1;
		const x = (i - (n - 1) / 2) * spacing;
		return {
			world: new Vector3(x, 0, 0),
			dom: {
				left: `${i * w * 100}%`,
				top: '0',
				width: `${w * 100}%`,
				height: '100%',
			},
		};
	}
}

function disposeGroup(group) {
	group.traverse((o) => {
		if (o.geometry) {
			try { o.geometry.dispose(); } catch {}
		}
		if (o.material) {
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) {
				for (const k of Object.keys(m)) {
					const v = m[k];
					if (v && v.isTexture) {
						try { v.dispose(); } catch {}
					}
				}
				try { m.dispose(); } catch {}
			}
		}
	});
	if (group.parent) group.parent.remove(group);
}

if (!customElements.get('agent-stage')) {
	customElements.define('agent-stage', AgentStageElement);
}

export { AgentStageElement };
