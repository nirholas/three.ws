// <agent-3d> — the web component that ships the whole framework in one tag.
// See specs/EMBED_SPEC.md

import { Viewer } from './viewer.js';
import { Runtime } from './runtime/index.js';
import { SceneController } from './runtime/scene.js';
import { SkillRegistry } from './skills/index.js';
import { Memory } from './memory/index.js';
import { loadManifest, fetchRelative } from './manifest.js';
import { resolveURI } from './ipfs.js';
import { resolveAgentById, resolveByAgentId, AgentResolveError } from './agent-resolver.js';
import { parseAgentRef, resolveOnchainAgent, toManifest } from './erc8004/resolver.js';

const MODES = ['inline', 'floating', 'section', 'fullscreen'];

// Derive the origin of the script itself so cross-origin embeds hit the right API.
const _scriptOrigin = (() => {
	try {
		return new URL(import.meta.url).origin;
	} catch {
		return '';
	}
})();

function originAllowed(originUrl, policy, firstParty = []) {
	if (!originUrl) return false;
	let host;
	try {
		host = new URL(originUrl).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (firstParty.some((fp) => host === fp || host.endsWith('.' + fp))) return true;
	const hosts = policy?.origins?.hosts ?? [];
	const mode = policy?.origins?.mode ?? 'allowlist';
	const matches = hosts.some((h) => {
		const lower = h.toLowerCase();
		if (lower.startsWith('*.')) return host.endsWith(lower.slice(1)) && host !== lower.slice(2);
		return host === lower;
	});
	return mode === 'allowlist' ? matches : !matches;
}

const BASE_STYLE = `
	:host {
		display: block;
		position: relative;
		width: 100%;
		height: 480px;
		--agent-bubble-radius: 16px;
		--agent-accent: #3b82f6;
		--agent-surface: rgba(17, 24, 39, 0.92);
		--agent-on-surface: #f9fafb;
		--agent-chat-font: system-ui, -apple-system, sans-serif;
		--agent-mic-glow: #22c55e;
		--agent-shadow: 0 20px 60px rgba(0,0,0,0.3);
		contain: layout style;
	}
	:host([mode="floating"]) {
		position: fixed;
		z-index: 2147483000;
		width: var(--agent-width, 320px);
		height: var(--agent-height, 420px);
		border-radius: var(--agent-bubble-radius);
		overflow: hidden;
		box-shadow: var(--agent-shadow);
		transition:
			width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
			border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@media (prefers-reduced-motion: reduce) {
		:host([mode="floating"]) { transition: none; }
	}
	/* Inline responsive: height follows width at a 3:4 portrait ratio */
	:host([mode="inline"][data-responsive]) {
		height: auto;
		aspect-ratio: var(--agent-aspect, 3/4);
	}
	:host([mode="fullscreen"]) {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		z-index: 2147483000;
	}
	:host([hidden]) { display: none; }
	.stage {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.stage canvas { display: block; }
	/* Pill tap target — shown when collapsed to pill on narrow viewports */
	.pill-btn {
		display: none;
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: none;
		border: 0;
		cursor: pointer;
		border-radius: inherit;
		z-index: 10;
	}
	/* Swipe-down handle visible when bottom-sheet is expanded */
	.pill-drag {
		display: none;
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		width: 36px;
		height: 4px;
		border-radius: 2px;
		background: rgba(255,255,255,0.25);
		pointer-events: none;
		z-index: 20;
	}
	.chrome {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: 12px;
		display: flex;
		gap: 8px;
		align-items: flex-end;
		pointer-events: none;
	}
	.chrome > * { pointer-events: auto; }
	.chat {
		flex: 1;
		max-height: 40%;
		overflow-y: auto;
		background: var(--agent-surface);
		color: var(--agent-on-surface);
		font: 14px/1.4 var(--agent-chat-font);
		border-radius: 12px;
		padding: 10px 12px;
		backdrop-filter: blur(12px);
	}
	.chat:empty { display: none; }
	.msg { margin: 4px 0; }
	.msg .role { opacity: 0.55; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
	.input-row {
		display: flex;
		gap: 6px;
		background: var(--agent-surface);
		border-radius: 999px;
		padding: 4px 4px 4px 14px;
		backdrop-filter: blur(12px);
		flex: 1;
	}
	.input-row input {
		flex: 1;
		background: transparent;
		border: 0;
		color: var(--agent-on-surface);
		font: 14px var(--agent-chat-font);
		outline: none;
	}
	button.icon {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 0;
		background: var(--agent-accent);
		color: white;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	button.icon.mic[data-listening="true"] { box-shadow: 0 0 0 4px var(--agent-mic-glow); }
	.poster {
		position: absolute;
		inset: 0;
		background-size: contain;
		background-position: center;
		background-repeat: no-repeat;
		transition: opacity 0.4s;
		pointer-events: none;
	}
	.loading {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		color: var(--agent-on-surface);
		font: 14px var(--agent-chat-font);
		background: var(--agent-surface);
		padding: 8px 14px;
		border-radius: 999px;
	}
	.error, .agent-3d-error {
		position: absolute;
		inset: 16px;
		display: grid;
		place-items: center;
		color: var(--agent-on-surface);
		background: var(--agent-surface);
		border-radius: 12px;
		padding: 16px;
		font: 14px var(--agent-chat-font);
	}
`;

class Agent3DElement extends HTMLElement {
	static get observedAttributes() {
		return [
			'src',
			'manifest',
			'body',
			'agent-id',
			'mode',
			'position',
			'width',
			'height',
			'voice',
			'api-key',
			'key-proxy',
			'responsive',
		];
	}

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this._viewer = null;
		this._scene = null;
		this._runtime = null;
		this._memory = null;
		this._skills = null;
		this._manifest = null;
		this._mounted = false;
		this._booting = false;
		this._listening = false;
		this._pillActive = false;
		this._mqNarrow = null;
		this._mqNarrowHandler = null;
		this._ro = null;
		this._outsideTapHandler = null;
		this._autoResolvedManifest = false;
		this._suppressAttrChange = false;
	}

	connectedCallback() {
		this._renderShell();
		this._applyLayout();
		this._setupResponsive();
		this._observeViewport();
		// Defer boot until visible unless `eager` attr is present
		if (this.hasAttribute('eager')) this._boot();
	}

	disconnectedCallback() {
		this._teardown();
	}

	attributeChangedCallback(name, oldVal, newVal) {
		if (!this._mounted || this._suppressAttrChange) return;
		if (['mode', 'position', 'width', 'height', 'responsive'].includes(name))
			this._applyLayout();
		if (['src', 'manifest', 'body', 'agent-id'].includes(name)) {
			// Source change — reboot
			this._teardown();
			this._boot();
		}
	}

	_renderShell() {
		const style = document.createElement('style');
		style.textContent = BASE_STYLE;
		this.shadowRoot.appendChild(style);

		const stage = document.createElement('div');
		stage.className = 'stage';
		stage.part = 'stage';
		this.shadowRoot.appendChild(stage);
		this._stageEl = stage;

		const poster = document.createElement('div');
		poster.className = 'poster';
		if (this.getAttribute('poster')) {
			poster.style.backgroundImage = `url(${this.getAttribute('poster')})`;
		}
		this.shadowRoot.appendChild(poster);
		this._posterEl = poster;

		const loading = document.createElement('div');
		loading.className = 'loading';
		loading.textContent = 'Loading...';
		loading.hidden = true;
		this.shadowRoot.appendChild(loading);
		this._loadingEl = loading;

		// Pill button — tap/keyboard target when floating collapses to pill on narrow viewports
		const pillBtn = document.createElement('button');
		pillBtn.className = 'pill-btn';
		pillBtn.setAttribute('aria-label', 'Open agent');
		pillBtn.addEventListener('click', () => this._expandPill());
		pillBtn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this._expandPill();
			}
		});
		this.shadowRoot.appendChild(pillBtn);
		this._pillBtn = pillBtn;

		// Drag handle shown when bottom-sheet is expanded
		const pillDrag = document.createElement('div');
		pillDrag.className = 'pill-drag';
		this.shadowRoot.appendChild(pillDrag);
		this._pillDrag = pillDrag;

		// Chat + input chrome (omitted in kiosk mode)
		if (!this.hasAttribute('kiosk')) {
			const chrome = document.createElement('div');
			chrome.className = 'chrome';
			chrome.part = 'chrome';

			const chat = document.createElement('div');
			chat.className = 'chat';
			chat.part = 'chat';

			const row = document.createElement('div');
			row.className = 'input-row';
			const input = document.createElement('input');
			input.type = 'text';
			input.placeholder = 'Say something...';
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' && input.value.trim()) {
					const v = input.value.trim();
					input.value = '';
					this.say(v);
				}
			});
			const micBtn = document.createElement('button');
			micBtn.className = 'icon mic';
			micBtn.title = 'Push to talk';
			micBtn.innerHTML = '🎙';
			micBtn.addEventListener('click', () => this._toggleMic());
			row.appendChild(input);
			row.appendChild(micBtn);

			chrome.appendChild(chat);
			chrome.appendChild(row);
			this.shadowRoot.appendChild(chrome);
			this._chatEl = chat;
			this._inputEl = input;
			this._micEl = micBtn;
		}
	}

	_isResponsive() {
		// Default on; opt out with responsive="false"
		return this.getAttribute('responsive') !== 'false';
	}

	_clampWidth(val) {
		const px = _parsePx(val);
		if (!px) return val;
		const min = Math.round(Math.max(160, px * 0.65));
		const vwPct = Math.round((px / 1440) * 100);
		return `clamp(${min}px, ${vwPct}vw, ${px}px)`;
	}

	_clampHeight(val) {
		const px = _parsePx(val);
		if (!px) return val;
		const min = Math.round(Math.max(200, px * 0.65));
		const vhPct = Math.round((px / 900) * 100);
		return `clamp(${min}px, ${vhPct}vh, ${px}px)`;
	}

	_applyLayout() {
		const mode = this.getAttribute('mode') || 'inline';
		if (!MODES.includes(mode)) return;
		const responsive = this._isResponsive();

		if (mode === 'floating') {
			if (!this._pillActive) {
				const pos = this.getAttribute('position') || 'bottom-right';
				const offset = (this.getAttribute('offset') || '24px 24px').split(/\s+/);
				const [vOff, hOff] = [offset[0], offset[1] || offset[0]];
				this.style.top = this.style.bottom = this.style.left = this.style.right = '';
				if (pos.includes('top')) this.style.top = vOff;
				else this.style.bottom = vOff;
				if (pos.includes('left')) this.style.left = hOff;
				else if (pos.includes('right')) this.style.right = hOff;
				else if (pos.includes('center')) {
					this.style.left = '50%';
					this.style.transform = 'translateX(-50%)';
				}
			}

			const width = this.getAttribute('width') || '320px';
			const height = this.getAttribute('height') || '420px';
			this.style.setProperty('--agent-width', responsive ? this._clampWidth(width) : width);
			this.style.setProperty(
				'--agent-height',
				responsive ? this._clampHeight(height) : height,
			);
		} else {
			this.style.top =
				this.style.bottom =
				this.style.left =
				this.style.right =
				this.style.transform =
					'';

			const width = this.getAttribute('width');
			const height = this.getAttribute('height');

			if (mode === 'inline') {
				if (width) this.style.width = responsive ? this._clampWidth(width) : width;
				if (height) {
					this.style.height = height;
					this.removeAttribute('data-responsive');
				} else if (responsive && width) {
					// No explicit height: aspect-ratio preserves 3:4 portrait via CSS
					this.style.height = '';
					this.setAttribute('data-responsive', '');
				}
			}

			if (width)
				this.style.setProperty(
					'--agent-width',
					responsive ? this._clampWidth(width) : width,
				);
			if (height)
				this.style.setProperty(
					'--agent-height',
					responsive ? this._clampHeight(height) : height,
				);
		}
	}

	_setupResponsive() {
		const mode = this.getAttribute('mode') || 'inline';

		// ResizeObserver on this — reacts to container changes without a viewport listener
		if (mode === 'inline' && typeof ResizeObserver !== 'undefined') {
			this._ro = new ResizeObserver(() => this._applyLayout());
			this._ro.observe(this);
		}

		// matchMedia for floating pill collapse at narrow viewports
		if (mode === 'floating' && this._isResponsive() && typeof window !== 'undefined') {
			this._mqNarrow = window.matchMedia('(max-width: 479px)');
			this._mqNarrowHandler = (e) => this._updatePillState(e.matches);
			this._mqNarrow.addEventListener('change', this._mqNarrowHandler);
			this._updatePillState(this._mqNarrow.matches);
		}

		// Swipe-down to close the bottom-sheet (CSS transitions handle the animation)
		let touchStartY = 0;
		this.shadowRoot.addEventListener(
			'touchstart',
			(e) => {
				touchStartY = e.touches[0].clientY;
			},
			{ passive: true },
		);
		this.shadowRoot.addEventListener(
			'touchend',
			(e) => {
				const dy = e.changedTouches[0].clientY - touchStartY;
				if (dy > 60 && this._pillActive && this.getAttribute('aria-expanded') === 'true') {
					this._collapsePill();
				}
			},
			{ passive: true },
		);
	}

	_updatePillState(narrow) {
		if (narrow && !this._pillActive) {
			this._pillActive = true;
			this._collapsePill();
		} else if (!narrow && this._pillActive) {
			this._pillActive = false;
			this._restoreFromPill();
		}
	}

	_collapsePill() {
		this.style.width = '56px';
		this.style.height = '56px';
		this.style.borderRadius = '50%';
		this.setAttribute('aria-expanded', 'false');
		this._pillBtn.style.display = 'block';
		this._pillDrag.style.display = 'none';
		const chrome = this.shadowRoot.querySelector('.chrome');
		if (chrome) chrome.style.display = 'none';
		this._stageEl.style.display = 'none';
		if (this._outsideTapHandler) {
			document.removeEventListener('pointerdown', this._outsideTapHandler);
			this._outsideTapHandler = null;
		}
	}

	_expandPill() {
		if (!this._pillActive) return;
		this.style.width = '100vw';
		this.style.height = '70vh';
		this.style.borderRadius = '16px 16px 0 0';
		this.style.bottom = '0';
		this.style.top = 'auto';
		this.style.left = '0';
		this.style.right = '0';
		this.style.transform = 'none';
		this.setAttribute('aria-expanded', 'true');
		this._pillBtn.style.display = 'none';
		this._pillDrag.style.display = 'block';
		const chrome = this.shadowRoot.querySelector('.chrome');
		if (chrome) chrome.style.display = '';
		this._stageEl.style.display = '';

		// Close on outside tap
		this._outsideTapHandler = (e) => {
			if (!e.composedPath().includes(this)) this._collapsePill();
		};
		setTimeout(() => document.addEventListener('pointerdown', this._outsideTapHandler), 0);
	}

	_restoreFromPill() {
		this.removeAttribute('aria-expanded');
		this._pillBtn.style.display = 'none';
		this._pillDrag.style.display = 'none';
		const chrome = this.shadowRoot.querySelector('.chrome');
		if (chrome) chrome.style.display = '';
		this._stageEl.style.display = '';
		// Clear pill inline overrides, re-apply proper floating layout
		this.style.width = this.style.height = this.style.borderRadius = '';
		this.style.bottom =
			this.style.top =
			this.style.left =
			this.style.right =
			this.style.transform =
				'';
		this._applyLayout();
		if (this._outsideTapHandler) {
			document.removeEventListener('pointerdown', this._outsideTapHandler);
			this._outsideTapHandler = null;
		}
	}

	_observeViewport() {
		if (this.hasAttribute('eager')) return;
		if (typeof IntersectionObserver === 'undefined') {
			this._boot();
			return;
		}
		this._io = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				this._io.disconnect();
				this._boot();
			}
		});
		this._io.observe(this);
	}

	async _boot() {
		if (this._booting || this._mounted) return;
		this._booting = true;
		try {
			this._loadingEl.hidden = false;
			this.dispatchEvent(
				new CustomEvent('agent:load-progress', { detail: { phase: 'manifest', pct: 0.1 } }),
			);

			const manifest = await this._resolveManifest();
			this._manifest = manifest;
			this.dispatchEvent(
				new CustomEvent('agent:load-progress', { detail: { phase: 'manifest', pct: 0.3 } }),
			);

			// Hydrate instructions.md if referenced
			if (
				typeof manifest.brain?.instructions === 'string' &&
				manifest.brain.instructions.endsWith('.md')
			) {
				const text = await fetchRelative(manifest, manifest.brain.instructions);
				if (text) manifest.instructions = stripFrontmatter(text);
			} else if (manifest.brain?.instructions) {
				manifest.instructions = manifest.brain.instructions;
			}

			// Embed-policy surface + origin gate (fail-open on infra errors)
			const _backendId = (() => {
				const a = this.getAttribute('agent-id') || manifest.id?.agentId || '';
				return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a)
					? a
					: null;
			})();
			if (_backendId) {
				try {
					const _policyBase = _scriptOrigin || window.location.origin;
					const _pr = await fetch(
						`${_policyBase}/api/agents/${_backendId}/embed-policy`,
						{ credentials: 'omit' },
					);
					if (_pr.ok) {
						const { policy } = await _pr.json();
						if (policy) {
							if (policy.surfaces?.script === false) {
								this._fail(
									'embed_denied_surface',
									'This agent disallows the script-tag embed.',
								);
								return;
							}
							const _fp = ['3dagent.vercel.app', 'localhost'];
							const _host = window.location.origin;
							if (
								!_host.startsWith('http://localhost') &&
								!originAllowed(_host, policy, _fp)
							) {
								this._fail(
									'embed_denied_origin',
									`This agent isn't permitted on ${_host}.`,
								);
								return;
							}
						}
					}
				} catch (_e) {
					console.warn('[agent-3d] embed-policy fetch failed; continuing', _e);
				}
			}

			// Build Viewer
			this.dispatchEvent(
				new CustomEvent('agent:load-progress', { detail: { phase: 'body', pct: 0.45 } }),
			);
			const viewer = new Viewer(this._stageEl, { kiosk: this.hasAttribute('kiosk') });
			this._viewer = viewer;
			const bodyURI = resolveURI(manifest.body?.uri);
			if (bodyURI) {
				await viewer.load(bodyURI, '', new Map());
			}
			this._scene = new SceneController(viewer);

			// Memory
			this.dispatchEvent(
				new CustomEvent('agent:load-progress', { detail: { phase: 'memory', pct: 0.6 } }),
			);
			const memoryNamespace =
				manifest.id?.agentId || this.getAttribute('memory-key') || manifest.name || 'anon';
			this._memory = await Memory.load({
				mode: this.getAttribute('memory') || manifest.memory?.mode || 'local',
				namespace: memoryNamespace,
				manifestURI: manifest._baseURI + 'manifest.json',
				fetchFn: fetch.bind(globalThis),
			});

			// Skills
			this.dispatchEvent(
				new CustomEvent('agent:load-progress', { detail: { phase: 'skills', pct: 0.75 } }),
			);
			this._skills = new SkillRegistry({
				trust: this.getAttribute('skill-trust') || 'owned-only',
				ownerAddress: manifest.id?.owner,
			});
			const skillList = manifest.skills || [];
			for (const spec of skillList) {
				try {
					const skill = await this._skills.install(spec, {
						bundleBase: manifest._baseURI,
					});
					this.dispatchEvent(
						new CustomEvent('skill:loaded', {
							detail: { name: skill.name, uri: skill.uri },
						}),
					);
				} catch (e) {
					console.warn('[agent-3d] skill load failed', spec, e);
				}
			}

			// Runtime
			this.dispatchEvent(
				new CustomEvent('agent:load-progress', { detail: { phase: 'brain', pct: 0.9 } }),
			);
			const providerConfig = {
				apiKey: this.getAttribute('api-key') || undefined,
				proxyURL: this.getAttribute('key-proxy') || undefined,
				agentId: _backendId || undefined,
				apiOrigin: _scriptOrigin || window.location.origin,
			};
			// Apply tts="..." attribute shorthand on top of the manifest's voice config.
			const ttsOverride = this._parseTTSAttribute();
			if (ttsOverride) {
				manifest.voice = manifest.voice || {};
				manifest.voice.tts = { ...(manifest.voice.tts || {}), ...ttsOverride };
			}
			this._runtime = new Runtime({
				manifest,
				viewer: this._scene,
				memory: this._memory,
				skills: this._skills,
				providerConfig,
			});
			// Re-dispatch runtime events on the host
			for (const ev of [
				'brain:thinking',
				'brain:message',
				'skill:tool-called',
				'voice:speech-start',
				'voice:speech-end',
				'voice:transcript',
				'voice:listen-start',
				'memory:write',
			]) {
				this._runtime.addEventListener(ev, (e) => {
					this.dispatchEvent(
						new CustomEvent(ev, { detail: e.detail, bubbles: true, composed: true }),
					);
					if (ev === 'brain:message' && this._chatEl) this._renderMessage(e.detail);
				});
			}

			this._mounted = true;
			this._loadingEl.hidden = true;
			if (!this._pillActive) this._posterEl.style.opacity = '0';
			this.dispatchEvent(
				new CustomEvent('agent:ready', {
					detail: { agent: this, manifest },
					bubbles: true,
					composed: true,
				}),
			);
		} catch (err) {
			console.error('[agent-3d] boot failed', err);
			this._loadingEl.hidden = true;
			if (err instanceof AgentResolveError && err.code === 'not-found') {
				const el = document.createElement('div');
				el.className = 'agent-3d-error';
				el.textContent = 'Agent not found';
				this.shadowRoot.appendChild(el);
			} else {
				this._showError(err);
			}
			this.dispatchEvent(
				new CustomEvent('agent:error', {
					detail: { phase: 'boot', error: err },
					bubbles: true,
					composed: true,
				}),
			);
		} finally {
			this._booting = false;
		}
	}

	async _resolveManifest() {
		const src = this.getAttribute('src');
		const manifestAttr = this.getAttribute('manifest');
		const body = this.getAttribute('body');
		const agentIdAttr = this.getAttribute('agent-id');
		const chainIdAttr = this.getAttribute('chain-id');
		if (src) {
			if (agentIdAttr) console.warn('[agent-3d] both src and agent-id provided; using src');
			return loadManifest(src, {
				rpcURL: this.getAttribute('rpc-url'),
				registry: this.getAttribute('registry'),
			});
		}
		if (agentIdAttr) {
			// On-chain reference? Supported forms:
			//   agent-id="eip155:8453:0xabc...:42"   full CAIP-10 + token
			//   agent-id="onchain:8453:42"           shorthand, canonical registry
			//   agent-id="42" chain-id="8453"        numeric id + explicit chain
			//   agent-id="agent://8453/42"           agent URI
			const caipInput = chainIdAttr
				? {
						chainId: Number(chainIdAttr),
						agentId: agentIdAttr,
						registry: this.getAttribute('registry') || undefined,
					}
				: agentIdAttr;
			const ref = parseAgentRef(caipInput);
			if (ref) {
				const resolved = await resolveOnchainAgent(ref);
				if (resolved.error && !resolved.glbUrl)
					throw new Error(`On-chain resolve failed: ${resolved.error}`);
				return toManifest(resolved);
			}
			// Explicit manifest= wins over backend UUID resolution.
			if (manifestAttr) return loadManifest(manifestAttr);
			// Resolve agent-id → manifestUrl via backend, then load that manifest.
			const manifestUrl = await resolveByAgentId(agentIdAttr);
			if (manifestUrl) {
				this._autoResolvedManifest = true;
				this.setAttribute('manifest', manifestUrl);
				return loadManifest(manifestUrl);
			}
			// No manifestUrl on agent record — build inline manifest from avatar data.
			return resolveAgentById(agentIdAttr);
		}
		if (manifestAttr) return loadManifest(manifestAttr);
		if (body) {
			// Ad-hoc agent from a bare GLB
			const instructionsAttr = this.getAttribute('instructions');
			return {
				spec: 'agent-manifest/0.1',
				_baseURI: '',
				name: this.getAttribute('name') || 'Agent',
				body: { uri: body, format: 'gltf-binary' },
				brain: {
					provider: this.getAttribute('brain') ? 'anthropic' : 'none',
					model: this.getAttribute('brain') || undefined,
					instructions: instructionsAttr || 'You are an embodied 3D agent.',
				},
				instructions: instructionsAttr || 'You are an embodied 3D agent.',
				voice: { tts: { provider: 'browser' }, stt: { provider: 'browser' } },
				skills: (this.getAttribute('skills') || '')
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
					.map((uri) => ({ uri })),
				memory: { mode: this.getAttribute('memory') || 'local' },
				tools: ['wave', 'lookAt', 'play_clip', 'setExpression', 'speak', 'remember'],
				version: '0.1.0',
			};
		}
		throw new Error('<agent-3d> requires src=, manifest=, or body= attribute');
	}

	_renderMessage({ role, content }) {
		if (!this._chatEl) return;
		if (!content) return;
		const msg = document.createElement('div');
		msg.className = 'msg';
		msg.innerHTML = `<div class="role">${role}</div><div class="body"></div>`;
		msg.querySelector('.body').textContent = content;
		this._chatEl.appendChild(msg);
		this._chatEl.scrollTop = this._chatEl.scrollHeight;
	}

	_showError(err) {
		const el = document.createElement('div');
		el.className = 'error';
		el.textContent = `Couldn't load agent: ${err.message || err}`;
		this.shadowRoot.appendChild(el);
	}

	_fail(code, message) {
		this._loadingEl.hidden = true;
		const el = document.createElement('div');
		el.className = 'error';
		el.textContent = message;
		this.shadowRoot.appendChild(el);
		this.dispatchEvent(
			new CustomEvent('agent:error', {
				detail: { phase: 'policy', error: { code, message } },
				bubbles: true,
				composed: true,
			}),
		);
	}

	async _toggleMic() {
		if (!this._runtime) return;
		if (this._listening) {
			this._runtime.stt?.stop();
			this._listening = false;
			this._micEl.dataset.listening = 'false';
			return;
		}
		this._listening = true;
		this._micEl.dataset.listening = 'true';
		try {
			const text = await this._runtime.listen();
			if (text) await this.say(text, { voice: true });
		} catch (e) {
			console.warn('[agent-3d] listen failed', e);
		} finally {
			this._listening = false;
			this._micEl.dataset.listening = 'false';
		}
	}

	_teardown() {
		// Clear manifest that was auto-resolved from agent-id so the next boot resolves fresh.
		// Suppress attributeChangedCallback to avoid a reboot loop.
		if (this._autoResolvedManifest) {
			this._suppressAttrChange = true;
			try {
				this.removeAttribute('manifest');
			} finally {
				this._suppressAttrChange = false;
			}
			this._autoResolvedManifest = false;
		}
		try {
			this._io?.disconnect();
		} catch {}
		try {
			this._ro?.disconnect();
		} catch {}
		try {
			if (this._mqNarrow && this._mqNarrowHandler) {
				this._mqNarrow.removeEventListener('change', this._mqNarrowHandler);
			}
		} catch {}
		if (this._outsideTapHandler) {
			document.removeEventListener('pointerdown', this._outsideTapHandler);
			this._outsideTapHandler = null;
		}
		try {
			this._runtime?.destroy();
		} catch {}
		try {
			this._viewer?.dispose?.();
		} catch {}
		this._mounted = false;
		this._pillActive = false;
		this._runtime = this._viewer = this._scene = this._memory = this._skills = null;
	}

	// --- Public JS API ---

	async say(text, opts = {}) {
		if (!this._runtime) await this._waitForReady();
		return this._runtime.send(text, { voice: opts.voice ?? this.hasAttribute('voice') });
	}

	async ask(text, opts = {}) {
		const reply = await this.say(text, opts);
		return reply?.text || '';
	}

	clearConversation() {
		this._runtime?.clearConversation();
	}

	async wave(opts) {
		return this._scene?.playAnimationByHint('wave', opts);
	}
	async lookAt(target) {
		return this._scene?.lookAt(target);
	}
	async play(name, opts) {
		return this._scene?.playClipByName(name, opts);
	}

	async installSkill(uri) {
		if (!this._skills) throw new Error('Agent not mounted');
		return this._skills.install({ uri });
	}
	uninstallSkill(name) {
		return this._skills?.uninstall(name);
	}
	get skills() {
		return this._skills?.all() || [];
	}
	get memory() {
		return this._memory;
	}
	get manifest() {
		return this._manifest;
	}
	get runtime() {
		return this._runtime;
	}

	setMode(mode) {
		this.setAttribute('mode', mode);
	}
	setPosition(pos, offset) {
		this.setAttribute('position', pos);
		if (offset) this.setAttribute('offset', offset);
	}
	setSize(w, h) {
		this.setAttribute('width', w);
		this.setAttribute('height', h);
	}

	pause() {
		this._runtime?.pause();
	}
	resume() {
		/* viewer resumes via IntersectionObserver */
	}
	destroy() {
		this._teardown();
	}

	_waitForReady() {
		if (this._mounted) return Promise.resolve();
		return new Promise((resolve) => {
			const on = () => {
				this.removeEventListener('agent:ready', on);
				resolve();
			};
			this.addEventListener('agent:ready', on);
			if (!this._booting) this._boot();
		});
	}
}

function stripFrontmatter(text) {
	const m = text.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
	return m ? m[1] : text;
}

if (!customElements.get('agent-3d')) {
	customElements.define('agent-3d', Agent3DElement);
}

export { Agent3DElement };
