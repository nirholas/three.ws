import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { Viewer } from './viewer.js';
import { Editor } from './editor/index.js';
import { SimpleDropzone } from 'simple-dropzone';
import { Validator } from './validator.js';
import { Footer } from './components/footer';
import { NichAgent } from './nich-agent.js';
import { AvatarCreator } from './avatar-creator.js';
import { resolveURI, isDecentralizedURI } from './ipfs.js';
import { saveRemoteGlbToAccount, getMe, readAuthHint } from './account.js';
import { getWidget } from './widgets.js';
import queryString from 'query-string';

// Agent system — the new primitive layer
import { protocol, ACTION_TYPES } from './agent-protocol.js';
import { AgentIdentity } from './agent-identity.js';
import { AgentSkills } from './agent-skills.js';
import { AgentAvatar } from './agent-avatar.js';
import { AgentHome } from './agent-home.js';

// Runtime — LLM brain, scene control, file-based memory, skill bundles
import { SceneController } from './runtime/scene.js';
import { Runtime } from './runtime/index.js';
import { Memory } from './memory/index.js';
import { SkillRegistry } from './skills/index.js';

window.THREE = THREE;
window.VIEWER = {};

function _blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const s = reader.result;
			const comma = s.indexOf(',');
			resolve(comma >= 0 ? s.slice(comma + 1) : s);
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

function _base64ToFile(b64, name, type) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new File([bytes], name, { type });
}

if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
	console.error('The File APIs are not fully supported in this browser.');
} else if (!WebGL.isWebGL2Available()) {
	console.error('WebGL is not supported in this browser.');
}

class App {
	/**
	 * @param  {Element} el
	 * @param  {Location} location
	 */
	constructor(el, location) {
		const hash = location.hash ? queryString.parse(location.hash) : {};
		const qp = new URLSearchParams(location.search);
		// agentQuery: from ?agent= query param → editing mode (main UI with save-back)
		// agentHash:  from #agent= hash → legacy embed mode
		const agentQuery = qp.get('agent') || '';
		const agentHash = hash.agent || '';
		this.options = {
			kiosk: Boolean(hash.kiosk),
			model: hash.model || '',
			preset: hash.preset || '',
			cameraPosition: hash.cameraPosition ? hash.cameraPosition.split(',').map(Number) : null,
			brain: hash.brain || 'none',
			proxyURL: hash.proxyURL || '',
			agent: agentHash, // hash-based agent keeps legacy embed behaviour
			agentEdit: agentQuery, // query-param agent → editing surface
			widget: hash.widget || '',
			register: hash.register !== undefined,
			// pending=1 signals a post-login save round-trip
			pending: qp.get('pending') === '1',
		};

		this.el = el;
		this.viewer = null;
		this.editor = null;
		this.viewerEl = null;
		this.spinnerEl = el.querySelector('.spinner');
		this.dropEl = el.querySelector('.wrap');
		this.inputEl = el.querySelector('#file-input');
		this.viewerContainerEl = el.querySelector('#viewer-container');
		this.validator = new Validator(el);

		// ── Agent System ──────────────────────────────────────────────────────
		this.identity = new AgentIdentity({ autoLoad: true });
		this.skills = null; // initialised after identity loads
		this.avatar = null; // initialised after viewer + content load
		this.agentHome = null;
		this.sceneCtrl = null; // SceneController — created when viewer is ready
		this.runtime = null; // LLM Runtime — created after identity + memory load
		this.fileMemory = null; // file-based Memory for LLM context
		this.skillRegistry = null; // external skill bundle loader

		// Wire validator results into the protocol
		this._hookValidator();

		this._editingAgentId = this.options.agentEdit || null;

		this.createDropzone();
		this.setupAvatarCreator();
		this.hideSpinner();
		this._applyViewerMode();
		this._updateSignInLink();
		this._setupSaveToAccount();
		this._setupMakeWidgetButton();

		const options = this.options;

		if (options.kiosk) {
			const headerEl = document.querySelector('header');
			headerEl.style.display = 'none';
		}

		// Check for register page
		if (hash.register !== undefined) {
			this._showRegisterPage();
			return;
		}

		// Load a specific agent by ID: /#agent=<uuid> (embed mode)
		if (options.agent) {
			this._loadAgent(options.agent);
			return;
		}

		// Load a saved widget by ID: /#widget=<wdgt_...>
		if (options.widget) {
			this._loadWidget(options.widget);
			this._initAgentSystem();
			this._initWidgetBridge();
			return;
		}

		// Editing an existing agent: ?agent=<uuid> (authenticated editing surface)
		if (options.agentEdit) {
			this._loadAgentForEdit(options.agentEdit);
		} else {
			// Resume a stashed editor session (post-login round-trip), else
			// load the model named in the URL or fall back to the CZ avatar.
			this._maybeResumeOrLoad(options);
		}

		// After sign-in redirect, check for a pending_save stash.
		if (options.pending) {
			this._maybePendingSave();
		}

		// Boot the agent system once identity is ready
		this._initAgentSystem();

		// Studio preview iframes use postMessage to live-update brand config.
		this._initWidgetBridge();
	}

	/**
	 * If the URL carries ?resume=<token>, restore the stashed editor session
	 * (load source + replay edits + optionally auto-open Publish). Otherwise
	 * load the model from #model= or the default CZ avatar.
	 */
	async _maybeResumeOrLoad(options) {
		const params = new URLSearchParams(location.search);
		const resumeToken = params.get('resume');

		if (resumeToken) {
			try {
				const { restoreSession, clearStash } = await import('./editor/edit-persistence.js');
				const stashed = await restoreSession(resumeToken);
				if (stashed) {
					if (stashed.source.url) {
						await this.view(stashed.source.url, '', new Map());
					} else if (stashed.source.file) {
						const f = stashed.source.file;
						await this.load(new Map([[f.name, f]]));
					}

					if (this.editor && this.editor.session) {
						this.editor.session.restoreEdits(stashed.edits);
						// Panels snapshotted the original material values before
						// restoreEdits mutated them — rebuild so the GUI mirrors
						// the restored state.
						this.editor.materialEditor?.rebuild?.();
						this.editor.textureInspector?.rebuild?.();
						this.editor.sceneExplorer?.rebuild?.();
					}

					if (params.get('publish') === '1') {
						this.editor?._openPublishModal?.();
					}

					await clearStash(resumeToken);

					const clean = new URL(location.href);
					clean.searchParams.delete('resume');
					clean.searchParams.delete('publish');
					history.replaceState(null, '', clean.toString());
					return;
				}
			} catch (err) {
				console.warn('[3d-agent] resume failed', err);
			}
		}

		const model = options.model || '/avatars/cz.glb';
		const resolvedModel = isDecentralizedURI(model) ? resolveURI(model) : model;
		this.view(resolvedModel, '', new Map());
	}

	// ── Agent System Init ─────────────────────────────────────────────────────

	async _initAgentSystem() {
		try {
			// Wait for identity to resolve (uses local storage immediately, backend async)
			await this.identity.load();

			// Skills need identity + memory
			this.skills = new AgentSkills(protocol, this.identity.memory);

			// File-based memory for LLM context injection
			this.fileMemory = await Memory.load({
				mode: 'local',
				namespace: this.identity.id,
			});

			// External skill bundle loader (empty initially — skills load on demand)
			this.skillRegistry = new SkillRegistry({ trust: 'owned-only' });

			// LLM Runtime — the agent's brain. Defaults to 'none' provider
			// (NichAgent pattern matching). Configure with #brain=anthropic&proxyURL=...
			this.runtime = new Runtime({
				manifest: {
					name: this.identity.name || 'Agent',
					instructions: [
						`You are ${this.identity.name || 'Agent'}, an AI agent embedded in a 3D model viewer at 3dagent.vercel.app.`,
						'You can control the 3D scene, remember things, and help users with their 3D work.',
						'Be concise, clear, and helpful. You are present and embodied — act like it.',
					].join(' '),
					brain: {
						provider: this.options.brain,
						proxyURL: this.options.proxyURL || undefined,
					},
					tools: ['wave', 'lookAt', 'play_clip', 'setExpression', 'speak', 'remember'],
				},
				viewer: this.sceneCtrl, // null until viewer loads
				memory: this.fileMemory,
				skills: this.skillRegistry,
			});

			// Bridge Runtime assistant messages to the protocol bus
			this.runtime.addEventListener('brain:message', (e) => {
				if (e.detail.role === 'assistant' && e.detail.content) {
					protocol.emit({
						type: ACTION_TYPES.SPEAK,
						payload: { text: e.detail.content, sentiment: 0 },
						agentId: this.identity.id,
					});
				}
			});

			// Expose agent on window for debugging
			window.VIEWER.agent_protocol = protocol;
			window.VIEWER.agent_identity = this.identity;
			window.VIEWER.agent_skills = this.skills;
			window.VIEWER.agent_runtime = this.runtime;

			// Announce presence
			protocol.emit({
				type: ACTION_TYPES.PRESENCE,
				payload: { status: 'online', agentId: this.identity.id },
				agentId: this.identity.id,
			});

			// Render the agent home panel (identity card + timeline)
			const homeEl = document.getElementById('agent-home-container');
			if (homeEl) {
				this.agentHome = new AgentHome(homeEl, this.identity, protocol, this.avatar);
				await this.agentHome.render();
			}

			// Boot the voice/chat agent with skills and runtime wired in
			this._initNichAgent();

			// Log all significant actions to identity history (fire-and-forget)
			protocol.on('*', (action) => {
				if (
					[
						ACTION_TYPES.SPEAK,
						ACTION_TYPES.REMEMBER,
						ACTION_TYPES.SIGN,
						ACTION_TYPES.SKILL_DONE,
						ACTION_TYPES.VALIDATE,
						ACTION_TYPES.LOAD_END,
					].includes(action.type)
				) {
					this.identity.recordAction(action);
				}
			});
		} catch (err) {
			console.warn('[3d-agent] Agent system init failed:', err.message);
		}
	}

	_applyViewerMode() {
		const { kiosk, widget, agent, register } = this.options;
		let mode = 'main';
		if (kiosk || widget || agent) mode = 'embed';
		else if (register) mode = 'register';
		document.body.dataset.viewerMode = mode;
		if (mode === 'main') {
			// Optimistic paint from the last-known auth hint; corrected by
			// _updateSignInLink once /api/auth/me resolves.
			document.body.dataset.authed = readAuthHint() ?? 'pending';
		}
	}

	async _updateSignInLink() {
		const link = document.getElementById('nav-sign-in');
		try {
			const user = await getMe();
			if (link && user) link.classList.add('signed-in');
			if (document.body.dataset.viewerMode === 'main') {
				document.body.dataset.authed = user ? 'true' : 'false';
			}
		} catch {
			if (document.body.dataset.viewerMode === 'main') {
				document.body.dataset.authed = 'false';
			}
		}
	}

	_refreshMakeWidgetButton() {
		const btn = document.getElementById('make-widget-btn');
		if (!btn) return;
		const url = this._currentModelUrl;
		if (!url && !this._hasLocalGlb) {
			btn.hidden = true;
			return;
		}
		if (url) {
			btn.href = `/studio?model=${encodeURIComponent(url)}`;
		}
		btn.hidden = false;
	}

	_refreshSaveToAccountButton() {
		const btn = document.getElementById('save-to-account-btn');
		if (!btn) return;
		const hasModel = this._currentModelUrl || this._hasLocalGlb;
		btn.hidden = !hasModel;
	}

	_setupSaveToAccount() {
		const btn = document.getElementById('save-to-account-btn');
		if (!btn) return;
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			this._triggerSaveToAccount();
		});
	}

	_setupMakeWidgetButton() {
		const btn = document.getElementById('make-widget-btn');
		if (!btn) return;
		btn.addEventListener('click', async (e) => {
			const user = await getMe();
			if (!user) {
				e.preventDefault();
				await this._stashAndRedirectToLogin();
			}
			// Authed: let the href navigate to /studio normally.
		});
	}

	async _triggerSaveToAccount() {
		const user = await getMe();
		if (!user) {
			await this._stashAndRedirectToLogin();
			return;
		}
		await this._performSave(user);
	}

	async _stashAndRedirectToLogin() {
		const btn = document.getElementById('save-to-account-btn');
		if (btn) {
			btn.setAttribute('disabled', '');
			btn.querySelector('span').textContent = 'Preparing…';
		}

		const stash = {
			glbUrl: this._currentModelUrl || null,
			fileName: this._currentLocalFile?.name || null,
			fileB64: null,
			returnTo: '/app',
			agentId: this._editingAgentId || null,
			ts: Date.now(),
		};

		// Local file drops can't be re-hydrated from a blob URL after reload.
		// Encode as base64 and stash — sessionStorage quota is ~5MB, so this
		// fails gracefully for oversized GLBs (user re-drops after sign-in).
		if (this._currentLocalFile) {
			try {
				stash.fileB64 = await _blobToBase64(this._currentLocalFile);
				stash.contentType = this._currentLocalFile.type || 'model/gltf-binary';
			} catch {
				/* fall through without file data */
			}
		}

		try {
			sessionStorage.setItem('pending_save', JSON.stringify(stash));
		} catch {
			// Quota exceeded — drop the file payload and retry with just metadata
			delete stash.fileB64;
			try {
				sessionStorage.setItem('pending_save', JSON.stringify(stash));
			} catch {
				/* storage disabled — proceed without stash */
			}
		}
		location.href = '/login?next=' + encodeURIComponent('/app?pending=1');
	}

	async _performSave(user) {
		if (!user) return;
		const btn = document.getElementById('save-to-account-btn');
		if (btn) {
			btn.setAttribute('disabled', '');
			btn.querySelector('span').textContent = 'Saving…';
		}
		try {
			let avatarId;
			const source = this._currentLocalFile || this._currentModelUrl;
			if (!source) {
				// Nothing to save — reset UI and bail
				if (btn) {
					btn.removeAttribute('disabled');
					btn.querySelector('span').textContent = 'Save to account';
				}
				return;
			}
			const avatar = await saveRemoteGlbToAccount(source, {
				source: this._currentLocalFile ? 'upload' : 'import',
				name: this._currentLocalFile?.name,
				source_meta: this._currentLocalFile
					? { original_filename: this._currentLocalFile.name }
					: undefined,
			});
			avatarId = avatar.id;

			if (this._editingAgentId) {
				// Update existing agent's avatar
				if (avatarId) {
					await fetch(`/api/agents/${this._editingAgentId}`, {
						method: 'PUT',
						credentials: 'include',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ avatar_id: avatarId }),
					});
				}
				location.href = `/agent/${this._editingAgentId}`;
			} else {
				// Create a new agent linked to the uploaded avatar
				const res = await fetch('/api/agents/me', {
					method: 'GET',
					credentials: 'include',
				});
				const data = res.ok ? await res.json() : null;
				let agentId = data?.agent?.id;

				if (!agentId) {
					const created = await fetch('/api/agents', {
						method: 'POST',
						credentials: 'include',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ name: 'My Agent' }),
					});
					const createdData = created.ok ? await created.json() : null;
					agentId = createdData?.agent?.id;
				}

				if (agentId && avatarId) {
					await fetch(`/api/agents/${agentId}`, {
						method: 'PUT',
						credentials: 'include',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ avatar_id: avatarId }),
					});
				}

				if (agentId) {
					location.href = `/agent/${agentId}`;
				} else {
					this._flashSaved({ name: 'your account' });
					if (btn) {
						btn.removeAttribute('disabled');
						btn.querySelector('span').textContent = 'Save to account';
					}
				}
			}
		} catch (err) {
			console.warn('[3d-agent] save failed:', err.message);
			if (btn) {
				btn.removeAttribute('disabled');
				btn.querySelector('span').textContent = 'Save to account';
			}
		}
	}

	async _maybePendingSave() {
		let stash;
		try {
			const raw = sessionStorage.getItem('pending_save');
			if (!raw) return;
			stash = JSON.parse(raw);
		} catch {
			return;
		}

		// Stale stashes (older than 1 hour) are discarded — the user likely
		// abandoned the sign-in flow and we shouldn't silently replay old work.
		if (!stash || !stash.ts || Date.now() - stash.ts > 60 * 60 * 1000) {
			sessionStorage.removeItem('pending_save');
			return;
		}

		const user = await getMe();
		if (!user) return; // still not authed — leave stash intact

		sessionStorage.removeItem('pending_save');

		// Restore the editing context from the stash
		if (stash.agentId) this._editingAgentId = stash.agentId;

		// Re-hydrate the model: local file (base64) takes priority over remote URL
		if (stash.fileB64 && stash.fileName) {
			const file = _base64ToFile(
				stash.fileB64,
				stash.fileName,
				stash.contentType || 'model/gltf-binary',
			);
			await this.load(new Map([[stash.fileName, file]]));
		} else if (stash.glbUrl && stash.glbUrl !== this._currentModelUrl) {
			await this.view(stash.glbUrl, '', new Map());
		}

		// Strip ?pending from URL before saving
		const clean = new URL(location.href);
		clean.searchParams.delete('pending');
		history.replaceState(null, '', clean.toString());

		await this._performSave(user);
	}

	async _loadAgent(agentId) {
		this.identity = new AgentIdentity({ agentId, autoLoad: false });
		await this.identity.load();

		let glbUrl = '/avatars/cz.glb';
		if (this.identity.avatarId) {
			try {
				const resp = await fetch(`/api/avatars/${this.identity.avatarId}`, {
					credentials: 'include',
				});
				if (resp.ok) {
					const { avatar } = await resp.json();
					if (avatar?.url) glbUrl = avatar.url;
				}
			} catch {
				/* fall through to default */
			}
		}

		this.view(glbUrl, '', new Map());
		this._initAgentSystem();
	}

	async _loadAgentForEdit(agentId) {
		// Fetch the agent record and load its GLB into the editor (main UI, not embed)
		let glbUrl = null;
		try {
			const resp = await fetch(`/api/agents/${agentId}`, { credentials: 'include' });
			if (resp.ok) {
				const { agent } = await resp.json();
				if (agent?.avatar_id) {
					const avatarResp = await fetch(`/api/avatars/${agent.avatar_id}`, {
						credentials: 'include',
					});
					if (avatarResp.ok) {
						const { avatar } = await avatarResp.json();
						if (avatar?.url) glbUrl = avatar.url;
					}
				}
			}
		} catch {
			/* fall through to default */
		}

		if (glbUrl) {
			await this.view(glbUrl, '', new Map());
		} else {
			this._maybeResumeOrLoad(this.options);
		}
		this._initAgentSystem();
		this._initWidgetBridge();
	}

	async _loadWidget(widgetId) {
		let widget;
		try {
			widget = await getWidget(widgetId);
		} catch (err) {
			this._showWidgetError(`Widget not found: ${widgetId}`);
			return;
		}
		window.VIEWER.widget = widget;

		const cfg = widget.config || {};
		const modelUrl = widget.avatar?.model_url || '/avatars/cz.glb';

		// Apply config to options BEFORE creating the viewer so first frame is right.
		if (Array.isArray(cfg.cameraPosition) && cfg.cameraPosition.length === 3) {
			this.options.cameraPosition = cfg.cameraPosition;
		}
		if (cfg.envPreset && cfg.envPreset !== 'none') {
			this.options.preset = cfg.envPreset;
		}

		// Kiosk + showControls drive the chrome.
		if (cfg.showControls === false || this.options.kiosk) {
			document.querySelector('header')?.style.setProperty('display', 'none');
		}

		const resolved = isDecentralizedURI(modelUrl) ? resolveURI(modelUrl) : modelUrl;
		this.view(resolved, '', new Map());

		// Apply post-create brand bits once viewer exists.
		queueMicrotask(() => this._applyWidgetConfig(cfg));

		// Caption overlay — render once, simple.
		if (cfg.caption) this._renderWidgetCaption(cfg.caption);

		// Notify parent (script embed / Studio) that we're up.
		this._postToParent({ type: 'widget:ready', id: widget.id, widgetType: widget.type });
	}

	_applyWidgetConfig(cfg) {
		if (!this.viewer) return;
		try {
			if (cfg.background) this.viewer.setBackgroundColor(cfg.background);
			if (typeof cfg.autoRotate === 'boolean' && this.viewer.controls) {
				this.viewer.controls.autoRotate = cfg.autoRotate;
				if (typeof cfg.rotationSpeed === 'number') {
					this.viewer.controls.autoRotateSpeed = cfg.rotationSpeed;
				}
			}
			if (cfg.envPreset && this.viewer.setEnvironment) {
				this.viewer.setEnvironment(cfg.envPreset);
			}
		} catch (e) {
			console.warn('[widget] applyConfig failed', e?.message);
		}
	}

	_renderWidgetCaption(text) {
		let el = document.getElementById('widget-caption');
		if (!el) {
			el = document.createElement('div');
			el.id = 'widget-caption';
			el.style.cssText =
				'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);padding:8px 18px;background:rgba(0,0,0,0.55);color:#fff;font-family:Inter,system-ui,sans-serif;font-size:14px;border-radius:999px;backdrop-filter:blur(8px);z-index:5;pointer-events:none;max-width:90vw;text-align:center';
			document.body.appendChild(el);
		}
		el.textContent = text;
	}

	_showWidgetError(message) {
		const el = document.createElement('div');
		el.style.cssText =
			'position:fixed;inset:0;display:grid;place-items:center;background:#0a0a0a;color:#e0e0e0;font-family:Inter,system-ui,sans-serif;text-align:center;padding:2rem;z-index:9999';
		el.innerHTML = `<div><h1 style="font-weight:300;margin:0 0 0.5rem">Widget unavailable</h1><p style="opacity:0.7;margin:0">${message.replace(/[<>&"]/g, '')}</p><p style="margin-top:1.5rem"><a href="/" style="color:#8b5cf6">Open viewer</a> · <a href="/widgets" style="color:#8b5cf6">Browse gallery</a></p></div>`;
		document.body.appendChild(el);
	}

	_initWidgetBridge() {
		// Studio sends live config updates without a full reload. Also handles
		// runtime commands (play_clip, wave) for parent-driven embeds.
		window.addEventListener('message', (event) => {
			if (event.origin !== location.origin) return;
			const data = event.data;
			if (!data || typeof data !== 'object') return;

			if (data.type === 'widget:config' && data.config) {
				this._applyWidgetConfig(data.config);
				if (typeof data.config.caption === 'string') {
					this._renderWidgetCaption(data.config.caption);
				}
				return;
			}

			if (data.type === 'widget:command' && data.command) {
				this._handleWidgetCommand(data.command, data.args || {});
			}
		});
	}

	_handleWidgetCommand(command, args) {
		const sceneCtrl = this.sceneCtrl || window.VIEWER?.scene_ctrl;
		if (!sceneCtrl) return;
		try {
			switch (command) {
				case 'play_clip':
					sceneCtrl.playClipByName?.(args.name);
					break;
				case 'lookAt':
					sceneCtrl.lookAt?.(args.target);
					break;
				case 'setExpression':
					sceneCtrl.setExpression?.(args.name, args.weight);
					break;
			}
		} catch (e) {
			console.warn('[widget] command failed', command, e?.message);
		}
	}

	_postToParent(msg) {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage(msg, '*');
		}
	}

	_initNichAgent() {
		const agent = new NichAgent(
			document.body,
			protocol,
			this.skills,
			this.identity,
			this.runtime,
		);
		window.VIEWER.agent = agent;
		// Greet on first open
		agent.onFirstOpen = () => {
			this.skills.perform('greet', {}, { identity: this.identity });
		};
	}

	// ── Viewer setup + Avatar attachment ────────────────────────────────────

	/**
	 * Sets up the view manager.
	 * @return {Viewer}
	 */
	createViewer() {
		if (this.viewer) this.viewer.dispose();
		this.viewerEl = this.viewerContainerEl;
		this.viewer = new Viewer(this.viewerEl, this.options);
		if (!this.options.kiosk) {
			this.editor = new Editor(this.viewer);
			this.editor.attach();
			window.VIEWER.editor = this.editor;
		}
		window.VIEWER.viewer = this.viewer;
		return this.viewer;
	}

	// ── Dropzone ─────────────────────────────────────────────────────────────

	createDropzone() {
		const dropCtrl = new SimpleDropzone(this.dropEl, this.inputEl);
		dropCtrl.on('drop', ({ files }) => this.load(files));
		dropCtrl.on('dropstart', () => this.showSpinner());
		dropCtrl.on('droperror', () => this.hideSpinner());
	}

	// ── Avatar Creator ────────────────────────────────────────────────────────

	setupAvatarCreator() {
		// Ready Player Me iframe builder. The creator stays mounted so downstream
		// flows (selfie → agent) can reopen it. "Create Avatar" button is a link
		// to /create — no click wiring here.
		this.avatarCreator = new AvatarCreator(document.body, async (glbUrl) => {
			this.view(glbUrl, '', new Map());
			try {
				const avatar = await saveRemoteGlbToAccount(glbUrl, {
					source: 'import',
					source_meta: { provider: 'readyplayerme', source_url: glbUrl },
				});
				this._flashSaved(avatar);
			} catch (err) {
				if (err.code !== 'not_signed_in') {
					console.warn('[3d-agent] save to account failed:', err.message);
				}
			}
		});
	}

	// ── File Loading ──────────────────────────────────────────────────────────

	/**
	 * @param  {Map<string, File>} fileMap
	 */
	load(fileMap) {
		let rootFile, rootPath;
		Array.from(fileMap).forEach(([path, file]) => {
			if (file.name.match(/\.(gltf|glb)$/)) {
				rootFile = file;
				rootPath = path.replace(file.name, '');
			}
		});

		if (!rootFile) {
			this.onError('No .gltf or .glb asset found.');
		}

		return this.view(rootFile, rootPath, fileMap);
	}

	/**
	 * @param  {File|string} rootFile
	 * @param  {string} rootPath
	 * @param  {Map<string, File>} fileMap
	 */
	view(rootFile, rootPath, fileMap) {
		if (this.viewer) this.viewer.clear();

		const viewer = this.viewer || this.createViewer();
		const fileURL = typeof rootFile === 'string' ? rootFile : URL.createObjectURL(rootFile);

		this._currentModelUrl = typeof rootFile === 'string' ? rootFile : null;
		this._hasLocalGlb = typeof rootFile !== 'string';
		this._currentLocalFile = typeof rootFile !== 'string' ? rootFile : null;
		this._refreshMakeWidgetButton();
		this._refreshSaveToAccountButton();

		// Emit load start
		protocol.emit({
			type: ACTION_TYPES.LOAD_START,
			payload: { url: typeof rootFile === 'string' ? rootFile : rootFile.name },
			agentId: this.identity?.id || 'default',
		});

		const cleanup = () => {
			this.hideSpinner();
			if (typeof rootFile === 'object') URL.revokeObjectURL(fileURL);
		};

		return viewer
			.load(fileURL, rootPath, fileMap)
			.catch((e) => {
				// Emit load error
				protocol.emit({
					type: ACTION_TYPES.LOAD_END,
					payload: { error: e.message },
					agentId: this.identity?.id || 'default',
				});
				this.onError(e);
			})
			.then((gltf) => {
				if (!gltf) return;

				// Emit load success
				protocol.emit({
					type: ACTION_TYPES.LOAD_END,
					payload: { success: true },
					agentId: this.identity?.id || 'default',
				});

				// Attach the avatar empathy system to the newly loaded content
				this._attachAvatar(viewer);

				// Notify the editor of the new model so it can rebuild panels
				if (this.editor) {
					const isString = typeof rootFile === 'string';
					this.editor.onContentChanged({
						url: isString ? rootFile : null,
						file: isString ? null : rootFile,
						name: isString ? rootFile.split('/').pop().split('?')[0] : rootFile.name,
					});
				}

				// Configure external animations (Mixamo-style) for skinned models
				this._configureAnimations(viewer);

				if (!this.options.kiosk) {
					this.validator.validate(fileURL, rootPath, fileMap, gltf);
				}
				cleanup();
			});
	}

	/** Attach (or reattach) the AgentAvatar to the viewer after content loads */
	_attachAvatar(viewer) {
		if (this.avatar) this.avatar.detach();
		this.avatar = new AgentAvatar(viewer, protocol, this.identity);
		this.avatar.attach();

		// Create (or replace) the SceneController for agent scene operations
		this.sceneCtrl = new SceneController(viewer);
		if (this.runtime) this.runtime.viewer = this.sceneCtrl;

		// Update agent-home with the live avatar reference
		if (this.agentHome) this.agentHome.avatar = this.avatar;

		window.VIEWER.agent_avatar = this.avatar;
		window.VIEWER.scene_ctrl = this.sceneCtrl;

		// Let the skills system access the viewer
		if (this.skills) {
			window.VIEWER.agent_skills = this.skills;
		}
	}

	/**
	 * Configure Mixamo-style external animations for the viewer.
	 * Looks for animation GLBs in /animations/ and registers them.
	 * Each GLB should contain a single animation clip exported from Mixamo
	 * (downloaded as GLB with "Without Skin" checked).
	 */
	_configureAnimations(viewer) {
		// Check if model has a skeleton
		let hasSkeleton = false;
		if (viewer.content) {
			viewer.content.traverse((node) => {
				if (node.isSkinnedMesh) hasSkeleton = true;
			});
		}
		if (!hasSkeleton) return;

		// Fetch the animation manifest
		fetch('/animations/manifest.json')
			.then((r) => {
				if (!r.ok) throw new Error('No animation manifest');
				return r.json();
			})
			.then((manifest) => {
				if (Array.isArray(manifest) && manifest.length > 0) {
					viewer.setAnimationDefs(manifest);
				}
			})
			.catch(() => {
				// No manifest — use sensible defaults if files exist
				const defaults = [
					{ name: 'idle', url: '/animations/idle.glb', label: 'Idle' },
					{ name: 'walking', url: '/animations/walking.glb', label: 'Walking' },
					{ name: 'running', url: '/animations/running.glb', label: 'Running' },
					{ name: 'waving', url: '/animations/waving.glb', label: 'Waving' },
					{ name: 'dancing', url: '/animations/dancing.glb', label: 'Dancing' },
					{ name: 'sitting', url: '/animations/sitting.glb', label: 'Sitting' },
					{ name: 'jumping', url: '/animations/jumping.glb', label: 'Jumping' },
				];

				// Probe which files actually exist (HEAD requests)
				Promise.all(
					defaults.map((def) =>
						fetch(def.url, { method: 'HEAD' })
							.then((r) => (r.ok ? def : null))
							.catch(() => null),
					),
				).then((results) => {
					const available = results.filter(Boolean);
					if (available.length > 0) {
						viewer.setAnimationDefs(available);
					}
				});
			});
	}

	// ── Validator hook ────────────────────────────────────────────────────────

	_hookValidator() {
		// Intercept the validator toggle DOM node to emit validation results
		const observer = new MutationObserver(() => {
			const el = document.querySelector('.validator-toggle');
			if (!el) return;

			const errors = parseInt(el.dataset.errors || '0', 10);
			const warnings = parseInt(el.dataset.warnings || '0', 10);
			const hints = parseInt(el.dataset.hints || '0', 10);

			protocol.emit({
				type: ACTION_TYPES.VALIDATE,
				payload: { errors, warnings, hints },
				agentId: this.identity?.id || 'default',
			});
		});
		observer.observe(document.body, { childList: true, subtree: true, attributes: true });
	}

	// ── UI Helpers ────────────────────────────────────────────────────────────

	_flashSaved(avatar) {
		const el = document.createElement('div');
		el.className = 'save-toast';
		el.innerHTML = `Saved to your account · <a href="/dashboard/#avatars">${avatar.name}</a>`;
		document.body.appendChild(el);
		setTimeout(() => el.remove(), 5000);
	}

	/**
	 * @param  {Error} error
	 */
	onError(error) {
		let message = (error || {}).message || error.toString();
		if (message.match(/ProgressEvent/)) {
			message = 'Unable to retrieve this file. Check JS console and browser network tab.';
		} else if (message.match(/Unexpected token/)) {
			message = `Unable to parse file content. Verify that this file is valid. Error: "${message}"`;
		} else if (error && error.target && error.target instanceof Image) {
			message = 'Missing texture: ' + error.target.src.split('/').pop();
		}
		window.alert(message);
		console.error(error);
	}

	_showRegisterPage() {
		window.location.replace('/register');
	}

	showSpinner() {
		this.spinnerEl.style.display = '';
	}
	hideSpinner() {
		this.spinnerEl.style.display = 'none';
	}
}

document.body.innerHTML += Footer();

document.addEventListener('DOMContentLoaded', () => {
	const app = new App(document.body, location);
	window.VIEWER.app = app;
	console.info('[3D Agent] Debugging data exported as `window.VIEWER`.');
});
