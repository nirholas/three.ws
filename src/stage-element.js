// <agent-stage> — shared scene host for multiple <agent-3d> children.
// See specs/STAGE_SPEC.md

import { Group, Vector3 } from 'three';
import { Viewer } from './viewer.js';
import { createStageSpeechQueue } from './stage-speech-queue.js';

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
		// One voice at a time: every agent line on this stage waits here for the
		// floor. See src/stage-speech-queue.js for the ordering rules.
		this._speech = createStageSpeechQueue({
			speak: (agentId, text) => {
				const rec = this._agents.find((a) => a.id === agentId);
				if (!rec?.speak) throw new Error(`Agent "${agentId}" has no voice on this stage`);
				return rec.speak(text);
			},
			cancel: (agentId) => this._agents.find((a) => a.id === agentId)?.stopSpeaking?.(),
			onChange: (speaking, previous) =>
				this.dispatchEvent(
					new CustomEvent('stage:speaking-change', {
						detail: { speaking, previous },
						bubbles: true,
						composed: true,
					}),
				),
		});
	}

	connectedCallback() {
		this._renderShell();
		this._initViewer();
		this._mo = new MutationObserver(() => this._repositionAll());
		this._mo.observe(this, { childList: true });
	}

	disconnectedCallback() {
		try {
			this._mo?.disconnect();
		} catch {}
		for (const a of [...this._agents]) this.unregisterAgent(a.element);
		this._speech.clear();
		try {
			this._viewer?.dispose?.();
		} catch {}
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

	get viewer() {
		return this._viewer;
	}

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
		// A device/browser that can't grant a WebGL context (GPU blocklist, context
		// budget exhausted, headless) makes the Viewer constructor throw "Error
		// creating WebGL context". connectedCallback runs this synchronously, so an
		// unguarded throw escapes as an uncaught error and blanks the host page.
		// Degrade instead: leave _viewer null (registerAgent/unregisterAgent already
		// null-check it) so child agents simply don't render rather than crash.
		try {
			this._viewer = new Viewer(this._canvasBox, { kiosk: true });
		} catch (err) {
			this._viewer = null;
			this._initialized = true;
			return;
		}
		// Default framing for a human-scale stage.
		this._viewer.defaultCamera.position.set(0, 1.55, 3.4);
		this._viewer.defaultCamera.lookAt(0, 1.2, 0);
		this._viewer.controls.target.set(0, 1.2, 0);
		this._viewer.controls.update();
		try {
			this._viewer.updateLights?.();
		} catch {}
		try {
			this._viewer.updateEnvironment?.();
		} catch {}
		this._viewer.invalidate();
		this._initialized = true;
	}

	// --- Called by <agent-3d> children that detect this parent stage ---

	/**
	 * @param {HTMLElement} element the child agent
	 * @param {{
	 *   id?: string,
	 *   group?: import('three').Group,
	 *   manifest?: object,
	 *   speak?: (text: string) => Promise<unknown>,
	 *   stopSpeaking?: () => void,
	 * }} opts `speak` plays one line through the agent's own voice and resolves
	 *   when it ends; the stage only calls it when the agent holds the floor.
	 *   `stopSpeaking` cuts that line short. `group` is the agent's body in the
	 *   shared scene; a child that renders its own body omits it.
	 * @returns {string} the agent's id on this stage
	 */
	registerAgent(element, { id, group, manifest, speak, stopSpeaking } = {}) {
		const existing = this._agents.find((a) => a.element === element);
		if (existing) {
			// A child that reboots (budget teardown, mode flip) registers again:
			// keep its id and seat, take its new voice and body.
			if (group && group !== existing.group) {
				if (existing.group) {
					try {
						this._viewer?.scene.remove(existing.group);
					} catch {}
					disposeGroup(existing.group);
				}
				existing.group = group;
				this._viewer?.scene.add(group);
			}
			if (manifest) existing.manifest = manifest;
			existing.speak = speak;
			existing.stopSpeaking = stopSpeaking;
			this._repositionAll();
			return existing.id;
		}
		const finalId = this._uniqueId(id || manifest?.name || 'agent');
		const rec = { id: finalId, element, group: group || null, manifest, speak, stopSpeaking, position: null };
		this._agents.push(rec);
		if (group) this._viewer?.scene.add(group);
		this._repositionAll();
		this.dispatchEvent(
			new CustomEvent('stage:agent-joined', {
				detail: { agentId: finalId, element, manifest },
				bubbles: true,
				composed: true,
			}),
		);
		return finalId;
	}

	unregisterAgent(element) {
		const i = this._agents.findIndex((a) => a.element === element);
		if (i < 0) return;
		// Silence a departing agent while its record (and so its stopSpeaking
		// hook) still exists: drop its queued lines and cut off its current one
		// so the next agent gets the floor at once.
		const rec = this._agents[i];
		this._speech.cancelAgent(rec.id);
		// A speaking-change listener may have touched the roster; find it again.
		const at = this._agents.indexOf(rec);
		if (at < 0) return; // a listener already removed it, events and all
		this._agents.splice(at, 1);
		if (rec.group) {
			try {
				this._viewer?.scene.remove(rec.group);
			} catch {}
			disposeGroup(rec.group);
		}
		this._repositionAll();
		this.dispatchEvent(
			new CustomEvent('stage:agent-left', {
				detail: { agentId: rec.id, element: rec.element },
				bubbles: true,
				composed: true,
			}),
		);
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
		return this._agents.map(({ id, group, manifest, element, position }) => {
			const p = group?.position || position;
			return {
				agentId: id,
				name: manifest?.name || id,
				position: p ? [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)] : [0, 0, 0],
				element,
			};
		});
	}

	/**
	 * Queue a line for an agent on this stage. It plays through that agent's
	 * own voice (lip-sync and captions included) once every line ahead of it
	 * has finished. Priority: 'user' > 'broadcast' > 'ambient' (the default).
	 * Resolves, never rejects, with `{ status, agentId, text, priority }`
	 * where status is 'spoken', 'dropped', 'cancelled', 'error' or 'timeout'.
	 */
	speak(agentId, text, { priority = 'ambient' } = {}) {
		if (!this._agents.some((a) => a.id === agentId)) {
			return Promise.resolve({
				status: 'error',
				agentId,
				text: String(text ?? ''),
				priority,
				error: `No agent "${agentId}" on stage`,
			});
		}
		return this._speech.enqueue(agentId, text, { priority });
	}

	/** Drop an agent's queued lines and stop the one it is saying. Returns the count. */
	cancelSpeech(agentId) {
		return this._speech.cancelAgent(agentId);
	}

	/** The line holding the floor (`{ agentId, text, priority, startedAt }`), or null. */
	get speaking() {
		return this._speech.speaking;
	}

	/** Lines waiting for the floor, in the order they will play. */
	get speechQueue() {
		return this._speech.pending;
	}

	broadcast(fromId, event) {
		const detail = { from: fromId, event };
		for (const a of this._agents) {
			if (a.id === fromId) continue;
			a.element.dispatchEvent(new CustomEvent('stage:message', { detail }));
		}
		this.dispatchEvent(
			new CustomEvent('stage:message', {
				detail,
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * Hand `text` to another agent as a user turn and wait for its reply. The
	 * reply is spoken at `priority` (the caller's turn priority when it comes
	 * from say_to_agent), so it queues behind what the caller is already saying.
	 */
	async routeMessage(fromId, toId, text, { priority } = {}) {
		const target = this._agents.find((a) => a.id === toId);
		if (!target) return { ok: false, error: `No agent "${toId}" on stage` };
		try {
			const reply = await target.element.say(`[from ${fromId}] ${text}`, priority ? { priority } : {});
			if (reply == null) return { ok: false, error: `Agent "${toId}" did not reply` };
			return { ok: true, reply: typeof reply === 'string' ? reply : reply.text || '' };
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
		if (!n) return;
		for (let i = 0; i < n; i++) {
			const rec = this._agents[i];
			const { element, group } = rec;
			const slot = this._slotFor(i, n);
			rec.position = slot.world;
			if (group) {
				group.position.copy(slot.world);
				group.lookAt(0, slot.world.y + 1.0, slot.world.z + 5.0);
			}
			// Sub-rect for this child's chrome overlay
			element.style.position = 'absolute';
			element.style.left = slot.dom.left;
			element.style.top = slot.dom.top;
			element.style.width = slot.dom.width;
			element.style.height = slot.dom.height;
			element.style.pointerEvents = 'none';
		}
		this._viewer?.invalidate();
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
			try {
				o.geometry.dispose();
			} catch {}
		}
		if (o.material) {
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			for (const m of mats) {
				for (const k of Object.keys(m)) {
					const v = m[k];
					if (v && v.isTexture) {
						try {
							v.dispose();
						} catch {}
					}
				}
				try {
					m.dispose();
				} catch {}
			}
		}
	});
	if (group.parent) group.parent.remove(group);
}

if (!customElements.get('agent-stage')) {
	customElements.define('agent-stage', AgentStageElement);
}

export { AgentStageElement };
