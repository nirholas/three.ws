/**
 * Agent Home — Presence Component
 * ---------------------------------
 * The agent's home page. Not a dashboard. Not a settings panel.
 * A *place* — somewhere you can go to see the agent, its history, its skills.
 *
 * Every agent deserves an address. This renders it.
 * Embeddable anywhere: main page identity card, /agent/:id home page.
 */

import { ACTION_TYPES } from './agent-protocol.js';
import { MEMORY_TYPES }  from './agent-memory.js';

const ACTION_ICONS = {
	[ACTION_TYPES.SPEAK]:         '💬',
	[ACTION_TYPES.REMEMBER]:      '🧠',
	[ACTION_TYPES.SIGN]:          '✍️',
	[ACTION_TYPES.PERFORM_SKILL]: '⚡',
	[ACTION_TYPES.SKILL_DONE]:    '✓',
	[ACTION_TYPES.SKILL_ERROR]:   '⚠',
	[ACTION_TYPES.LOAD_END]:      '📦',
	[ACTION_TYPES.VALIDATE]:      '🔍',
	default:                      '·',
};

const EMOTION_LABELS = {
	neutral:     'calm',
	concern:     'focused',
	celebration: 'excited',
	patience:    'patient',
	curiosity:   'curious',
	empathy:     'empathetic',
};

export class AgentHome {
	/**
	 * @param {HTMLElement}                                    containerEl
	 * @param {import('./agent-identity.js').AgentIdentity}   identity
	 * @param {import('./agent-protocol.js').AgentProtocol}   protocol
	 * @param {import('./agent-avatar.js').AgentAvatar}        [avatar]
	 */
	constructor(containerEl, identity, protocol, avatar = null) {
		this.container = containerEl;
		this.identity  = identity;
		this.protocol  = protocol;
		this.avatar    = avatar;

		this._panel    = null;
		this._timeline = [];
		this._maxTimeline = 30;
		this._emotionInterval = null;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	async render() {
		await this._ensureIdentityLoaded();
		this._buildPanel();
		this._subscribeProtocol();
		this._startEmotionPoll();
	}

	destroy() {
		if (this._panel) this._panel.remove();
		clearInterval(this._emotionInterval);
		this.protocol.off('*', this._onAnyAction);
	}

	// ── Identity Card ─────────────────────────────────────────────────────────

	_buildPanel() {
		const id     = this.identity;
		const skills = id.skills || [];
		const panel  = document.createElement('div');
		panel.className  = 'agent-home-panel';
		panel.innerHTML  = `
			<div class="agent-home-identity">
				<div class="agent-home-avatar-ring" id="agent-avatar-ring">
					<div class="agent-home-avatar-inner" id="agent-avatar-inner">
						<span class="agent-home-avatar-emoji" id="agent-avatar-emoji">◎</span>
					</div>
				</div>
				<div class="agent-home-info">
					<div class="agent-home-name-row">
						<span class="agent-home-name" id="agent-home-name">${_esc(id.name)}</span>
						${id.isRegistered ? `
						<span class="agent-home-badge erc8004" title="Registered on-chain (ERC-8004)">
							<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
						</span>` : ''}
					</div>
					<div class="agent-home-status" id="agent-home-status">
						<span class="agent-home-dot online"></span>
						<span id="agent-home-emotion-label">present</span>
						<span class="agent-home-status-sep" aria-hidden="true">·</span>
						<span class="agent-home-address" id="agent-home-address">${id.walletAddress ? _shortAddr(id.walletAddress) : 'no wallet'}</span>
					</div>
				</div>
				<button class="agent-home-btn" id="agent-copy-link" title="Copy agent link">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
				</button>
			</div>

			${skills.length ? `
			<details class="agent-home-skills" id="agent-skills-details">
				<summary class="agent-home-skills-summary">
					<span class="agent-home-skills-label">Skills</span>
					<span class="agent-home-skills-count">${skills.length}</span>
					<svg class="agent-home-chevron" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
				</summary>
				<div class="agent-home-skills-strip" id="agent-skills-strip">
					${skills.map(s => `<span class="agent-skill-chip">${_esc(s)}</span>`).join('')}
				</div>
			</details>
			` : ''}

			<div class="agent-home-memory-bar" id="agent-memory-bar">
				${this._renderMemoryBar()}
			</div>

			<div class="agent-home-timeline" id="agent-timeline">
				<div class="agent-timeline-empty">
					<svg class="agent-timeline-empty-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a6 6 0 0 0-4 10.5V15a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.5A6 6 0 0 0 12 2z"/><path d="M10 20h4"/><path d="M11 23h2"/></svg>
					<span class="agent-timeline-empty-title">Waiting for activity</span>
					<span class="agent-timeline-empty-sub">Your agent's actions will log here once it starts working</span>
				</div>
			</div>
		`;

		this.container.appendChild(panel);
		this._panel = panel;

		// Copy link button
		panel.querySelector('#agent-copy-link')?.addEventListener('click', () => {
			const url = `${location.origin}${id.homeUrl || `/agent/${id.id}`}`;
			navigator.clipboard?.writeText(url).catch(() => {});
			this._flashBtn(panel.querySelector('#agent-copy-link'), '✓');
		});
	}

	// ── Memory Bar ────────────────────────────────────────────────────────────

	_renderMemoryBar() {
		if (!this.identity.memory) return '';
		const stats = this.identity.memory.stats;
		if (!stats.total) return '<span class="agent-mem-empty">no memories yet</span>';

		return Object.entries(stats)
			.filter(([k]) => k !== 'total')
			.filter(([, v]) => v > 0)
			.map(([type, count]) => `
				<span class="agent-mem-chip" data-type="${type}" title="${count} ${type} ${count === 1 ? 'memory' : 'memories'}">
					${_memIcon(type)} ${count}
				</span>
			`).join('') + `<span class="agent-mem-total">${stats.total}</span>`;
	}

	_refreshMemoryBar() {
		const bar = this._panel?.querySelector('#agent-memory-bar');
		if (bar) bar.innerHTML = this._renderMemoryBar();
	}

	// ── Action Timeline ───────────────────────────────────────────────────────

	_subscribeProtocol() {
		this._onAnyAction = (action) => {
			// Only show meaningful actions (skip internal think/presence churn)
			if ([ACTION_TYPES.THINK, ACTION_TYPES.PRESENCE].includes(action.type)) return;
			this._pushTimeline(action);
		};
		this.protocol.on('*', this._onAnyAction);
	}

	_pushTimeline(action) {
		this._timeline.unshift(action);
		if (this._timeline.length > this._maxTimeline) this._timeline.pop();

		const timelineEl = this._panel?.querySelector('#agent-timeline');
		if (!timelineEl) return;

		const emptyEl = timelineEl.querySelector('.agent-timeline-empty');
		if (emptyEl) emptyEl.remove();

		const item = document.createElement('div');
		item.className = 'agent-timeline-item';
		item.innerHTML = `
			<span class="agent-timeline-icon">${ACTION_ICONS[action.type] || ACTION_ICONS.default}</span>
			<span class="agent-timeline-text">${_timelineText(action)}</span>
			<span class="agent-timeline-time">${_relTime(action.timestamp)}</span>
		`;
		item.style.animation = 'agent-timeline-in 0.25s ease';

		timelineEl.insertBefore(item, timelineEl.firstChild);

		// Keep DOM clean
		while (timelineEl.children.length > this._maxTimeline) {
			timelineEl.removeChild(timelineEl.lastChild);
		}

		// Refresh memory bar if it was a remember action
		if (action.type === ACTION_TYPES.REMEMBER) {
			this._refreshMemoryBar();
		}
	}

	// ── Emotion Presence ──────────────────────────────────────────────────────

	_startEmotionPoll() {
		// Update the emotion label in the status bar every second
		this._emotionInterval = setInterval(() => {
			if (!this.avatar) return;
			const state    = this.avatar.emotionState;
			const dominant = Object.entries(state).reduce((a, b) => b[1] > a[1] ? b : a, ['neutral', 0]);
			const label    = EMOTION_LABELS[dominant[0]] || 'present';

			const el = this._panel?.querySelector('#agent-home-emotion-label');
			if (el && el.textContent !== label) {
				el.style.opacity = '0';
				setTimeout(() => {
					el.textContent  = label;
					el.style.opacity = '1';
				}, 150);
			}

			// Pulse the avatar ring colour based on dominant emotion
			const ring = this._panel?.querySelector('#agent-avatar-ring');
			if (ring) {
				ring.dataset.emotion = dominant[0];
			}
		}, 1000);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	async _ensureIdentityLoaded() {
		if (!this.identity.isLoaded) {
			await this.identity.load();
		}
	}

	_flashBtn(btn, text) {
		if (!btn) return;
		const orig = btn.innerHTML;
		btn.textContent = text;
		setTimeout(() => { btn.innerHTML = orig; }, 1500);
	}
}

// ── Rendering Helpers ─────────────────────────────────────────────────────────

function _esc(str) {
	return String(str || '').replace(/[<>&"]/g, c =>
		({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])
	);
}

function _shortAddr(addr) {
	if (!addr) return '';
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function _memIcon(type) {
	return { user: '👤', feedback: '↩', project: '📋', reference: '🔗' }[type] || '·';
}

function _relTime(ts) {
	const diff = Date.now() - ts;
	if (diff < 60_000)  return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return new Date(ts).toLocaleDateString();
}

function _timelineText(action) {
	const p = action.payload || {};
	switch (action.type) {
		case ACTION_TYPES.SPEAK:
			return _esc((p.text || '').slice(0, 80) + ((p.text?.length > 80) ? '…' : ''));
		case ACTION_TYPES.REMEMBER:
			return _esc(`Remembered: ${(p.content || '').slice(0, 60)}`);
		case ACTION_TYPES.PERFORM_SKILL:
			return _esc(`Performing skill: ${p.skill || '?'}`);
		case ACTION_TYPES.SKILL_DONE:
			return _esc(`${p.skill || 'Skill'} complete`);
		case ACTION_TYPES.SKILL_ERROR:
			return _esc(`${p.skill || 'Skill'} failed: ${(p.error || '').slice(0, 50)}`);
		case ACTION_TYPES.SIGN:
			return _esc(`Signed: ${(p.message || '').slice(0, 50)}`);
		case ACTION_TYPES.LOAD_END:
			return p.error ? _esc(`Load failed: ${p.error}`) : 'Model loaded';
		case ACTION_TYPES.VALIDATE:
			return _esc(`Validation: ${p.errors || 0} errors, ${p.warnings || 0} warnings`);
		default:
			return _esc(action.type.replace(/-/g, ' '));
	}
}
