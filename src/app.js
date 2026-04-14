import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { Viewer }        from './viewer.js';
import { SimpleDropzone } from 'simple-dropzone';
import { Validator }     from './validator.js';
import { Footer }        from './components/footer';
import { NichAgent }     from './nich-agent.js';
import { AvatarCreator } from './avatar-creator.js';
import { resolveURI, isDecentralizedURI } from './ipfs.js';
import { saveRemoteGlbToAccount }         from './account.js';
import queryString from 'query-string';

// Agent system — the new primitive layer
import { protocol, ACTION_TYPES } from './agent-protocol.js';
import { AgentIdentity }          from './agent-identity.js';
import { AgentSkills }            from './agent-skills.js';
import { AgentAvatar }            from './agent-avatar.js';
import { AgentHome }              from './agent-home.js';

window.THREE   = THREE;
window.VIEWER  = {};

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
		this.options = {
			kiosk:          Boolean(hash.kiosk),
			model:          hash.model || '',
			preset:         hash.preset || '',
			cameraPosition: hash.cameraPosition ? hash.cameraPosition.split(',').map(Number) : null,
		};

		this.el              = el;
		this.viewer          = null;
		this.viewerEl        = null;
		this.spinnerEl       = el.querySelector('.spinner');
		this.dropEl          = el.querySelector('.wrap');
		this.inputEl         = el.querySelector('#file-input');
		this.viewerContainerEl = el.querySelector('#viewer-container');
		this.validator       = new Validator(el);

		// ── Agent System ──────────────────────────────────────────────────────
		this.identity = new AgentIdentity({ autoLoad: true });
		this.skills   = null;  // initialised after identity loads
		this.avatar   = null;  // initialised after viewer + content load
		this.agentHome = null;

		// Wire validator results into the protocol
		this._hookValidator();

		this.createDropzone();
		this.setupAvatarCreator();
		this.hideSpinner();

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

		// Load specified model or default CZ avatar
		const model = options.model || '/avatars/cz.glb';
		const resolvedModel = isDecentralizedURI(model) ? resolveURI(model) : model;
		this.view(resolvedModel, '', new Map());

		// Boot the agent system once identity is ready
		this._initAgentSystem();
	}

	// ── Agent System Init ─────────────────────────────────────────────────────

	async _initAgentSystem() {
		try {
			// Wait for identity to resolve (uses local storage immediately, backend async)
			await this.identity.load();

			// Skills need identity + memory
			this.skills = new AgentSkills(protocol, this.identity.memory);

			// Expose agent on window for debugging
			window.VIEWER.agent_protocol  = protocol;
			window.VIEWER.agent_identity  = this.identity;
			window.VIEWER.agent_skills    = this.skills;

			// Announce presence
			protocol.emit({
				type:    ACTION_TYPES.PRESENCE,
				payload: { status: 'online', agentId: this.identity.id },
				agentId: this.identity.id,
			});

			// Render the agent home panel (identity card + timeline)
			const homeEl = document.getElementById('agent-home-container');
			if (homeEl) {
				this.agentHome = new AgentHome(homeEl, this.identity, protocol, this.avatar);
				await this.agentHome.render();
			}

			// Boot the voice/chat agent with skills wired in
			this._initNichAgent();

			// Log all significant actions to identity history (fire-and-forget)
			protocol.on('*', (action) => {
				if ([
					ACTION_TYPES.SPEAK,
					ACTION_TYPES.REMEMBER,
					ACTION_TYPES.SIGN,
					ACTION_TYPES.SKILL_DONE,
					ACTION_TYPES.VALIDATE,
					ACTION_TYPES.LOAD_END,
				].includes(action.type)) {
					this.identity.recordAction(action);
				}
			});

		} catch (err) {
			console.warn('[3d-agent] Agent system init failed:', err.message);
		}
	}

	_initNichAgent() {
		const agent = new NichAgent(document.body, protocol, this.skills, this.identity);
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
		this.viewerEl = this.viewerContainerEl;
		this.viewer   = new Viewer(this.viewerEl, this.options);
		return this.viewer;
	}

	// ── Dropzone ─────────────────────────────────────────────────────────────

	createDropzone() {
		const dropCtrl = new SimpleDropzone(this.dropEl, this.inputEl);
		dropCtrl.on('drop',      ({ files }) => this.load(files));
		dropCtrl.on('dropstart', () => this.showSpinner());
		dropCtrl.on('droperror', () => this.hideSpinner());
	}

	// ── Avatar Creator ────────────────────────────────────────────────────────

	setupAvatarCreator() {
		this.avatarCreator = new AvatarCreator(document.body, async (glbUrl) => {
			this.view(glbUrl, '', new Map());
			try {
				const avatar = await saveRemoteGlbToAccount(glbUrl, { source: 'avaturn' });
				this._flashSaved(avatar);
			} catch (err) {
				if (err.code !== 'not_signed_in') {
					console.warn('[3d-agent] save to account failed:', err.message);
				}
			}
		});

		const btn = document.getElementById('create-avatar-btn');
		if (btn) {
			btn.addEventListener('click', () => this.avatarCreator.open());
		}
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

		this.view(rootFile, rootPath, fileMap);
	}

	/**
	 * @param  {File|string} rootFile
	 * @param  {string} rootPath
	 * @param  {Map<string, File>} fileMap
	 */
	view(rootFile, rootPath, fileMap) {
		if (this.viewer) this.viewer.clear();

		const viewer  = this.viewer || this.createViewer();
		const fileURL = typeof rootFile === 'string' ? rootFile : URL.createObjectURL(rootFile);

		// Emit load start
		protocol.emit({
			type:    ACTION_TYPES.LOAD_START,
			payload: { url: typeof rootFile === 'string' ? rootFile : rootFile.name },
			agentId: this.identity?.id || 'default',
		});

		const cleanup = () => {
			this.hideSpinner();
			if (typeof rootFile === 'object') URL.revokeObjectURL(fileURL);
		};

		viewer
			.load(fileURL, rootPath, fileMap)
			.catch((e) => {
				// Emit load error
				protocol.emit({
					type:    ACTION_TYPES.LOAD_END,
					payload: { error: e.message },
					agentId: this.identity?.id || 'default',
				});
				this.onError(e);
			})
			.then((gltf) => {
				if (!gltf) return;

				// Emit load success
				protocol.emit({
					type:    ACTION_TYPES.LOAD_END,
					payload: { success: true },
					agentId: this.identity?.id || 'default',
				});

				// Attach the avatar empathy system to the newly loaded content
				this._attachAvatar(viewer);

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

		// Update agent-home with the live avatar reference
		if (this.agentHome) this.agentHome.avatar = this.avatar;

		window.VIEWER.agent_avatar = this.avatar;

		// Let the skills system access the viewer
		if (this.skills) {
			window.VIEWER.agent_skills = this.skills;
		}
	}

	// ── Validator hook ────────────────────────────────────────────────────────

	_hookValidator() {
		// Intercept the validator toggle DOM node to emit validation results
		const observer = new MutationObserver(() => {
			const el = document.querySelector('.validator-toggle');
			if (!el) return;

			const errors   = parseInt(el.dataset.errors   || '0', 10);
			const warnings = parseInt(el.dataset.warnings || '0', 10);
			const hints    = parseInt(el.dataset.hints    || '0', 10);

			protocol.emit({
				type:    ACTION_TYPES.VALIDATE,
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
		this.dropEl.style.display = 'none';
		import('./erc8004/register-ui.js').then(({ RegisterUI }) => {
			new RegisterUI(this.viewerContainerEl, (result) => {
				console.info('[ERC-8004] Agent registered:', result);
				this.identity.update({ isRegistered: true, meta: { ...this.identity.meta, erc8004: result } });
			});
		});
	}

	showSpinner() { this.spinnerEl.style.display = ''; }
	hideSpinner() { this.spinnerEl.style.display = 'none'; }
}

document.body.innerHTML += Footer();

document.addEventListener('DOMContentLoaded', () => {
	const app = new App(document.body, location);
	window.VIEWER.app = app;
	console.info('[3D Agent] Debugging data exported as `window.VIEWER`.');
});
