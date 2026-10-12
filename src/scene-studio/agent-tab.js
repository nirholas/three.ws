// Scene Studio: Agent tab.
//
// Sibling to the vendored r184 editor (never edits vendor/**): adds a chat
// panel to the sidebar's tab row (Sidebar.addTab, see vendor/js/Sidebar.js)
// that drives the open scene through tool calls instead of the mouse.
//
// The model only picks tools and arguments: every tool EXECUTES in this
// module, as a real editor.execute(Command) the same File/Add menus use, so
// Edit > Undo removes an agent action exactly like a manual one and autosave
// (main.js) persists it. Generation tools reuse the diorama pipeline
// (src/diorama/compose.js: composeWorld/forgeObject) that already backs the
// Forge flow, and glTF import reuses the shared Draco/KTX2/Meshopt loader
// (loader.js) the ?model= deep link and "Import from Forge" use.
//
// One reasoning round per turn is POSTed to /api/scene/agent (free, public,
// rate-limited, built from the same provider chain + tool-calling building
// blocks as the metered /api/v1/chat/completions client-tool lane, see that
// file's header) and the loop re-posts with the tool results until the model
// answers with no more tool calls or a per-turn round cap is hit.
//
// Every prompt that changes the scene pushes a version: a scene.toJSON()
// snapshot plus a viewport screenshot, both captured synchronously right
// after the mutating execute() calls (toDataURL must run in the same task as
// the render, since the editor's renderer has no preserveDrawingBuffer;
// Viewport.js renders synchronously inside each signal dispatch). The
// version list lets the user step back to any earlier state: a MultiCmdsCommand
// that removes the scene's current children and re-adds the snapshot's (plain
// SetSceneCommand only APPENDS a parsed scene's children, since the vendored
// Loader.js always runs it right after editor.clear(); that clear also wipes
// undo history, which stepping back through versions must never do), so
// restoring a version is itself one more undoable edit.

import * as THREE from 'three';
import { UIElement } from './vendor/js/libs/ui.js';
import { AddObjectCommand } from './vendor/js/commands/AddObjectCommand.js';
import { RemoveObjectCommand } from './vendor/js/commands/RemoveObjectCommand.js';
import { SetPositionCommand } from './vendor/js/commands/SetPositionCommand.js';
import { SetRotationCommand } from './vendor/js/commands/SetRotationCommand.js';
import { SetScaleCommand } from './vendor/js/commands/SetScaleCommand.js';
import { SetMaterialColorCommand } from './vendor/js/commands/SetMaterialColorCommand.js';
import { MultiCmdsCommand } from './vendor/js/commands/MultiCmdsCommand.js';
import { addGltfBufferToScene } from './loader.js';
import { composeWorld, forgeObject } from '../diorama/compose.js';
import { toastError } from '../shared/toast.js';

const STYLE_ID = 'tws-studio-agent-styles';
const ENDPOINT = '/api/scene/agent';
const MAX_ROUNDS = 6; // tool-call round-trips per user turn, bounds a runaway loop on a free/rate-limited endpoint
const MAX_VERSIONS = 30;

function ensureStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const el = document.createElement('style');
	el.id = STYLE_ID;
	el.textContent = CSS;
	document.head.appendChild(el);
}

// ── Tool catalog ─────────────────────────────────────────────────────────
// OpenAI-wire function tools (api/_lib/client-tool-round.js normalizes this
// exact shape). Kept intentionally small and scene-scoped: the agent reads
// and mutates the OPEN scene, it does not manage named server-side scenes
// (that is packages/scene-mcp's job against /api/diorama, for an MCP client).
const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'list_objects',
			description: "List every object currently in the scene: uuid, name, type, and position. Call this first to see what's there before moving, scaling, recoloring, or deleting anything.",
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'add_object',
			description: 'Generate one new 3D object from a short description and add it to the scene (e.g. "a red wooden chair"). Takes 10-60 seconds to forge a real mesh.',
			parameters: {
				type: 'object',
				properties: { prompt: { type: 'string', description: 'A short description of the single object to generate.' } },
				required: ['prompt'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'build_world',
			description: 'Generate a whole small scene (ground, several placed objects) from one sentence and add every object to the scene. Use for "build me a..." requests with multiple things; use add_object for a single item.',
			parameters: {
				type: 'object',
				properties: { prompt: { type: 'string', description: 'A sentence describing the world to build.' } },
				required: ['prompt'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'move_object',
			description: 'Move an object to an absolute position (scene units).',
			parameters: {
				type: 'object',
				properties: {
					uuid: { type: 'string' },
					x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
				},
				required: ['uuid', 'x', 'y', 'z'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'rotate_object',
			description: 'Set an object\'s rotation, in degrees, around each axis.',
			parameters: {
				type: 'object',
				properties: {
					uuid: { type: 'string' },
					x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
				},
				required: ['uuid', 'x', 'y', 'z'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'scale_object',
			description: 'Scale an object uniformly or per-axis (1 = original size).',
			parameters: {
				type: 'object',
				properties: {
					uuid: { type: 'string' },
					x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
				},
				required: ['uuid', 'x', 'y', 'z'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'set_material_color',
			description: "Set an object's base material color.",
			parameters: {
				type: 'object',
				properties: { uuid: { type: 'string' }, color: { type: 'string', description: 'CSS color, e.g. "#ff6a3d" or "tomato".' } },
				required: ['uuid', 'color'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'delete_object',
			description: 'Remove an object from the scene.',
			parameters: { type: 'object', properties: { uuid: { type: 'string' } }, required: ['uuid'] },
		},
	},
];

const SYSTEM_PROMPT = [
	'You are the Scene Studio agent on three.ws, a 3D scene editor. You help the visitor build and edit the 3D scene they have open by calling tools: every tool call is a real, undoable edit to their live scene.',
	"Call list_objects before you move, scale, recolor, or delete anything you haven't just created, so you act on the right uuid.",
	'Use add_object for one new item, build_world for a whole small scene from a sentence. Both take real time to generate; say so briefly rather than going quiet.',
	'After acting, reply with a short, concrete sentence about what changed. Never claim to have done something you did not call a tool for.',
	'If a request is ambiguous (which object, what color), make the most reasonable choice yourself rather than asking a clarifying question. Only ask when truly nothing reasonable can be inferred.',
].join(' ');

function uid() {
	return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Synchronous screenshot right after a render, see module header on timing. */
function captureScreenshot() {
	try {
		const canvas = document.querySelector('#viewport canvas');
		if (!canvas) return null;
		return canvas.toDataURL('image/jpeg', 0.72);
	} catch {
		return null; // tainted canvas (cross-origin texture) or no canvas yet, never fatal
	}
}

function forceRender(editor) {
	editor.signals.sceneGraphChanged.dispatch();
}

export class SceneAgent {
	constructor(editor) {
		this.editor = editor;
		this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
		this.versions = [];
	}

	objectSummary() {
		const out = [];
		this.editor.scene.traverse((obj) => {
			if (obj === this.editor.scene) return;
			out.push({
				uuid: obj.uuid,
				name: obj.name || obj.type,
				type: obj.type,
				position: { x: round(obj.position.x), y: round(obj.position.y), z: round(obj.position.z) },
			});
		});
		return out;
	}

	findObject(uuidOrName) {
		const byUuid = this.editor.objectByUuid(uuidOrName);
		if (byUuid) return byUuid;
		let found = null;
		this.editor.scene.traverse((obj) => {
			if (!found && obj.name === uuidOrName) found = obj;
		});
		return found;
	}

	async addGlbAsObject(glbUrl, label) {
		const res = await fetch(glbUrl);
		if (!res.ok) throw new Error(`HTTP ${res.status} fetching the generated model`);
		const contents = await res.arrayBuffer();
		return addGltfBufferToScene(this.editor, contents, label);
	}

	/** Executes one named tool call; returns the text that goes back to the model as the tool result. */
	async runTool(name, rawArgs, { onStatus } = {}) {
		let args;
		try {
			args = JSON.parse(rawArgs || '{}');
		} catch {
			return `Error: arguments were not valid JSON.`;
		}

		switch (name) {
			case 'list_objects': {
				const objects = this.objectSummary();
				return objects.length ? JSON.stringify(objects) : 'The scene is empty.';
			}

			case 'add_object': {
				const prompt = String(args.prompt || '').slice(0, 300);
				if (!prompt) return 'Error: prompt is required.';
				onStatus?.(`Forging "${prompt}"…`);
				const object = { id: uid(), prompt, status: 'pending', glbUrl: null };
				const result = await forgeObject(object);
				if (result.status !== 'ready' || !result.glbUrl) return `Could not generate "${prompt}". Try a simpler description.`;
				const added = await this.addGlbAsObject(result.glbUrl, prompt.slice(0, 48));
				return `Added "${added.name || prompt}" (uuid ${added.uuid}) at position (${round(added.position.x)}, ${round(added.position.y)}, ${round(added.position.z)}).`;
			}

			case 'build_world': {
				const prompt = String(args.prompt || '').slice(0, 400);
				if (!prompt) return 'Error: prompt is required.';
				onStatus?.(`Composing a scene for "${prompt}"…`);
				let diorama;
				try {
					diorama = await composeWorld(prompt, {
						onObject: (id, patch) => {
							if (patch.status === 'forging') onStatus?.(`Forging piece ${id.slice(0, 6)}…`);
						},
					});
				} catch (err) {
					return `Could not compose that world: ${err.message}`;
				}
				const ready = diorama.objects.filter((o) => o.status === 'ready' && o.glbUrl);
				if (!ready.length) return 'The world composed but no pieces forged successfully. Try a more concrete sentence.';
				const added = [];
				for (const obj of ready) {
					try {
						added.push(await this.addGlbAsObject(obj.glbUrl, obj.label || obj.prompt || 'Object'));
					} catch {
						// one failed import never sinks the rest of the world
					}
				}
				return `Built the scene and added ${added.length} of ${diorama.objects.length} object(s): ${added.map((o) => o.name).join(', ') || 'none imported cleanly'}.`;
			}

			case 'move_object': {
				const object = this.findObject(args.uuid);
				if (!object) return `Error: no object with uuid "${args.uuid}".`;
				this.editor.execute(new SetPositionCommand(this.editor, object, new THREE.Vector3(num(args.x), num(args.y), num(args.z))));
				return `Moved ${object.name || object.uuid} to (${num(args.x)}, ${num(args.y)}, ${num(args.z)}).`;
			}

			case 'rotate_object': {
				const object = this.findObject(args.uuid);
				if (!object) return `Error: no object with uuid "${args.uuid}".`;
				const rad = (d) => (num(d) * Math.PI) / 180;
				this.editor.execute(new SetRotationCommand(this.editor, object, new THREE.Euler(rad(args.x), rad(args.y), rad(args.z))));
				return `Rotated ${object.name || object.uuid} to (${num(args.x)}°, ${num(args.y)}°, ${num(args.z)}°).`;
			}

			case 'scale_object': {
				const object = this.findObject(args.uuid);
				if (!object) return `Error: no object with uuid "${args.uuid}".`;
				this.editor.execute(new SetScaleCommand(this.editor, object, new THREE.Vector3(num(args.x, 1), num(args.y, 1), num(args.z, 1))));
				return `Scaled ${object.name || object.uuid} to (${num(args.x, 1)}, ${num(args.y, 1)}, ${num(args.z, 1)}).`;
			}

			case 'set_material_color': {
				const object = this.findObject(args.uuid);
				if (!object) return `Error: no object with uuid "${args.uuid}".`;
				const color = new THREE.Color();
				try {
					color.set(String(args.color || '#ffffff'));
				} catch {
					return `Error: "${args.color}" is not a color this editor understands.`;
				}
				this.editor.execute(new SetMaterialColorCommand(this.editor, object, 'color', color.getHex()));
				return `Set ${object.name || object.uuid}'s color to ${args.color}.`;
			}

			case 'delete_object': {
				const object = this.findObject(args.uuid);
				if (!object) return `Error: no object with uuid "${args.uuid}".`;
				const label = object.name || object.uuid;
				this.editor.execute(new RemoveObjectCommand(this.editor, object));
				return `Deleted ${label}.`;
			}

			default:
				return `Error: unknown tool "${name}".`;
		}
	}

	/** One user turn: loops tool rounds against /api/scene/agent until the model stops calling tools. */
	async send(userText, { onStatus, onAssistant } = {}) {
		this.messages.push({ role: 'user', content: userText });
		let mutated = false;

		for (let round = 0; round < MAX_ROUNDS; round++) {
			let data;
			try {
				const res = await fetch(ENDPOINT, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ messages: this.messages, tools: TOOLS }),
				});
				data = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(data?.error_description || data?.message || `HTTP ${res.status}`);
			} catch (err) {
				onAssistant?.(`Could not reach the scene agent: ${err.message}. Try again in a moment.`, { error: true });
				return;
			}

			const toolCalls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
			if (data.content) onAssistant?.(data.content, {});
			if (!toolCalls.length) {
				this.messages.push({ role: 'assistant', content: data.content || '' });
				break;
			}

			this.messages.push({
				role: 'assistant',
				content: data.content || null,
				tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
			});

			for (const call of toolCalls) {
				onStatus?.(`${call.name.replace(/_/g, ' ')}…`);
				let result;
				try {
					result = await this.runTool(call.name, call.arguments, { onStatus });
				} catch (err) {
					result = `Error running ${call.name}: ${err.message}`;
				}
				if (!/^Error:/.test(result) && call.name !== 'list_objects') mutated = true;
				this.messages.push({ role: 'tool', tool_call_id: call.id, content: result });
			}
		}

		onStatus?.(null);
		if (mutated) this.pushVersion(userText);
	}

	pushVersion(label) {
		forceRender(this.editor);
		const snapshot = this.editor.scene.toJSON();
		const screenshot = captureScreenshot();
		this.versions.push({ id: uid(), label, at: Date.now(), snapshot, screenshot });
		if (this.versions.length > MAX_VERSIONS) this.versions.shift();
		return this.versions[this.versions.length - 1];
	}

	/**
	 * Restores a prior version as one more undoable edit. SetSceneCommand only
	 * APPENDS a parsed scene's children (vendor/js/Loader.js always calls it
	 * right after editor.clear(), which also wipes undo history); doing the
	 * same here would litter the current scene with the version's objects
	 * instead of replacing them. Composing explicit Remove + Add commands
	 * under one MultiCmdsCommand gets a real replace that stays undoable.
	 */
	restoreVersion(versionId) {
		const version = this.versions.find((v) => v.id === versionId);
		if (!version) return false;
		const loaded = new THREE.ObjectLoader().parse(version.snapshot);
		const cmds = [];
		for (const child of [...this.editor.scene.children]) {
			cmds.push(new RemoveObjectCommand(this.editor, child));
		}
		while (loaded.children.length > 0) {
			cmds.push(new AddObjectCommand(this.editor, loaded.children.pop()));
		}
		this.editor.execute(new MultiCmdsCommand(this.editor, cmds), `Restore "${version.label}"`);
		return true;
	}
}

function round(n) {
	return Math.round(n * 100) / 100;
}
function num(v, fallback = 0) {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * Builds the Agent tab's panel and returns a UIElement ready for
 * sidebar.addTab('agent', 'Agent', panel), see main.js wiring.
 * @param {import('./vendor/js/Editor.js').Editor} editor
 */
export function createAgentPanel(editor) {
	ensureStyles();
	const agent = new SceneAgent(editor);

	const root = document.createElement('div');
	root.className = 'tws-agent-panel';
	root.innerHTML = `
		<p class="tws-agent-intro">Describe what you want in the scene. The agent reads it, makes real edits, and every change is undoable (Edit&nbsp;▸&nbsp;Undo).</p>
		<div class="tws-agent-log" role="log" aria-live="polite"></div>
		<p class="tws-agent-status" aria-live="polite" hidden></p>
		<form class="tws-agent-form">
			<textarea class="tws-agent-input" placeholder="e.g. add a red wooden chair by the window" rows="2" maxlength="500"></textarea>
			<button type="submit" class="tws-agent-send">Send</button>
		</form>
		<div class="tws-agent-versions">
			<h4>Versions</h4>
			<p class="tws-agent-versions-empty">Changes the agent makes will show up here, step back to any of them.</p>
			<ol class="tws-agent-versions-list"></ol>
		</div>
	`;

	const log = root.querySelector('.tws-agent-log');
	const statusEl = root.querySelector('.tws-agent-status');
	const form = root.querySelector('.tws-agent-form');
	const input = root.querySelector('.tws-agent-input');
	const sendBtn = root.querySelector('.tws-agent-send');
	const versionsList = root.querySelector('.tws-agent-versions-list');
	const versionsEmpty = root.querySelector('.tws-agent-versions-empty');

	function appendMessage(role, text) {
		const row = document.createElement('div');
		row.className = `tws-agent-msg tws-agent-msg-${role}`;
		row.textContent = text;
		log.appendChild(row);
		log.scrollTop = log.scrollHeight;
	}

	function renderVersions() {
		versionsList.innerHTML = '';
		versionsEmpty.hidden = agent.versions.length > 0;
		for (const version of agent.versions) {
			const li = document.createElement('li');
			li.className = 'tws-agent-version';
			const time = new Date(version.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			li.innerHTML = `
				${version.screenshot ? `<img src="${version.screenshot}" alt="" width="48" height="36" />` : '<span class="tws-agent-version-noimg" aria-hidden="true"></span>'}
				<span class="tws-agent-version-label">${escapeHtml(version.label).slice(0, 60)}</span>
				<span class="tws-agent-version-time">${time}</span>
				<button type="button" data-restore="${version.id}">Restore</button>
			`;
			versionsList.appendChild(li);
		}
	}

	versionsList.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-restore]');
		if (!btn) return;
		agent.restoreVersion(btn.dataset.restore);
		appendMessage('agent', 'Restored that version.');
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const text = input.value.trim();
		if (!text || sendBtn.disabled) return;
		appendMessage('user', text);
		input.value = '';
		sendBtn.disabled = true;
		input.disabled = true;

		try {
			await agent.send(text, {
				onStatus: (text) => {
					statusEl.hidden = !text;
					if (text) statusEl.textContent = text;
				},
				onAssistant: (text, { error } = {}) => {
					if (text) appendMessage(error ? 'error' : 'agent', text);
				},
			});
		} catch (err) {
			toastError(`Scene agent failed: ${err.message}`, { duration: 7000 });
		} finally {
			statusEl.hidden = true;
			sendBtn.disabled = false;
			input.disabled = false;
			input.focus();
			renderVersions();
		}
	});

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			form.requestSubmit();
		}
	});

	return new UIElement(root);
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
.tws-agent-panel {
	display: flex; flex-direction: column; gap: 10px;
	padding: 10px; font: 400 12.5px/1.45 system-ui, -apple-system, sans-serif;
	color: var(--ink, #e8e8ec);
	height: 100%; box-sizing: border-box;
}
.tws-agent-intro { margin: 0; color: #9a9aa8; font-size: 12px; }
.tws-agent-log {
	display: flex; flex-direction: column; gap: 6px;
	min-height: 120px; max-height: 260px; overflow-y: auto;
	border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
	padding: 8px; background: rgba(0,0,0,0.2);
}
.tws-agent-msg { padding: 6px 9px; border-radius: 8px; max-width: 92%; white-space: pre-wrap; word-break: break-word; }
.tws-agent-msg-user { align-self: flex-end; background: #2a6ef0; color: #fff; }
.tws-agent-msg-agent { align-self: flex-start; background: rgba(255,255,255,0.08); }
.tws-agent-msg-error { align-self: flex-start; background: rgba(255,90,90,0.18); color: #ffb3b3; }
.tws-agent-status { margin: 0; color: #6ee7b7; font-size: 11.5px; font-style: italic; }
.tws-agent-form { display: flex; gap: 6px; }
.tws-agent-input {
	flex: 1; resize: vertical; min-height: 36px;
	border: 1px solid rgba(255,255,255,0.18); border-radius: 8px;
	padding: 8px 9px; background: rgba(10,10,14,0.8); color: var(--ink, #e8e8ec);
	font: inherit;
}
.tws-agent-input:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 1px; }
.tws-agent-send {
	appearance: none; cursor: pointer; align-self: flex-end;
	border: 0; border-radius: 8px; padding: 9px 14px;
	background: #e8e8ec; color: #0a0a0f; font: 600 12.5px/1 system-ui, sans-serif;
}
.tws-agent-send:hover { background: #fff; }
.tws-agent-send:disabled { opacity: 0.55; cursor: default; }
.tws-agent-send:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 2px; }
.tws-agent-versions { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 8px; }
.tws-agent-versions h4 { margin: 0 0 6px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #9a9aa8; }
.tws-agent-versions-empty { margin: 0; color: #70707c; font-size: 11.5px; }
.tws-agent-versions-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
.tws-agent-version { display: flex; align-items: center; gap: 8px; padding: 4px; border-radius: 6px; }
.tws-agent-version:hover { background: rgba(255,255,255,0.06); }
.tws-agent-version img, .tws-agent-version-noimg { width: 48px; height: 36px; border-radius: 4px; object-fit: cover; background: #15151b; flex-shrink: 0; }
.tws-agent-version-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
.tws-agent-version-time { color: #70707c; font-size: 10.5px; flex-shrink: 0; }
.tws-agent-version button {
	appearance: none; cursor: pointer; flex-shrink: 0;
	border: 1px solid rgba(255,255,255,0.18); border-radius: 6px;
	padding: 4px 8px; background: transparent; color: var(--ink, #e8e8ec);
	font: 600 10.5px/1 system-ui, sans-serif;
}
.tws-agent-version button:hover { background: rgba(255,255,255,0.1); }
.tws-agent-version button:focus-visible { outline: 2px solid #6ee7b7; outline-offset: 1px; }
`;
