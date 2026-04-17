import { renderQRToCanvas } from './erc8004/qr.js';
import './share-panel.css';

/**
 * One-click share modal for an agent: link, iframe snippet, web-component
 * snippet, OG preview, and QR code.
 *
 * @example
 * const panel = new SharePanel({ agent: { id, slug, name, thumbnailUrl }, container: document.body });
 * panel.open();
 */
export class SharePanel {
	/**
	 * @param {{ agent: { id: string, slug?: string, name?: string, thumbnailUrl?: string }, container?: HTMLElement, embedOrigin?: string }} opts
	 */
	constructor({ agent, container = document.body, embedOrigin = location.origin }) {
		this._agent = agent;
		this._container = container;
		this._origin = embedOrigin;
		this._backdrop = null;
		this._opener = null;
		this._onKeyDown = this._onKeyDown.bind(this);
	}

	open() {
		if (this._backdrop) return;
		this._opener = document.activeElement;

		const { id, slug, name } = this._agent;
		const origin = this._origin;
		const link = `${origin}/a/${slug || id}`;
		const iframeSnippet =
			`<iframe src="${origin}/agent-embed.html?id=${id}"\n` +
			`    width="480" height="640" frameborder="0" allow="microphone; camera"></iframe>`;
		const wcSnippet =
			`<script type="module" src="${origin}/dist-lib/agent-3d.js"><\/script>\n` +
			`<agent-3d agent-id="${id}"></agent-3d>`;
		const ogUrl = `${origin}/api/a-og?id=${id}`;

		const backdrop = document.createElement('div');
		backdrop.className = 'share-panel-backdrop';
		backdrop.setAttribute('role', 'presentation');

		const modalId = `share-panel-title-${id}`;
		const modal = document.createElement('div');
		modal.className = 'share-panel-modal';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-labelledby', modalId);
		modal.tabIndex = -1;

		modal.innerHTML = `
			<div class="share-panel-header">
				<h2 class="share-panel-title" id="${modalId}">Share ${name ? _esc(name) : 'Agent'}</h2>
				<button class="share-panel-close" aria-label="Close share panel">&times;</button>
			</div>

			<div class="share-panel-row" data-section="link">
				<div class="share-panel-label">Link</div>
				<div class="share-panel-field">
					<div class="share-panel-code">${_esc(link)}</div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy="${_esc(link)}">Copy</button>
						<a class="share-panel-btn" href="${_esc(link)}" target="_blank" rel="noopener">Open ↗</a>
					</div>
				</div>
			</div>

			<div class="share-panel-row" data-section="iframe">
				<div class="share-panel-label">iframe embed</div>
				<div class="share-panel-field">
					<div class="share-panel-code">${_esc(iframeSnippet)}</div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy="${_esc(iframeSnippet)}">Copy</button>
					</div>
				</div>
			</div>

			<div class="share-panel-row" data-section="wc">
				<div class="share-panel-label">Web component</div>
				<div class="share-panel-field">
					<div class="share-panel-code">${_esc(wcSnippet)}</div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy="${_esc(wcSnippet)}">Copy</button>
					</div>
				</div>
			</div>

			<hr class="share-panel-divider">

			<div class="share-panel-row" data-section="og">
				<div class="share-panel-label">OG preview</div>
				<img class="share-panel-og-img" src="${_esc(ogUrl)}"
					alt="OG preview for ${_esc(name || id)}"
					style="aspect-ratio:1200/630;">
				<div class="share-panel-field" style="margin-top:6px;">
					<div class="share-panel-code">${_esc(ogUrl)}</div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy="${_esc(ogUrl)}">Copy URL</button>
					</div>
				</div>
			</div>

			<hr class="share-panel-divider">

			<div class="share-panel-row" data-section="qr">
				<div class="share-panel-label">QR code</div>
				<div class="share-panel-qr" id="share-panel-qr-mount"></div>
			</div>
		`;

		// Attach close handler
		modal.querySelector('.share-panel-close').addEventListener('click', () => this.close());

		// Copy buttons
		modal.querySelectorAll('[data-copy]').forEach((btn) => {
			btn.addEventListener('click', () => this._copy(btn));
		});

		// Dismiss on backdrop click (outside modal)
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) this.close();
		});

		backdrop.appendChild(modal);
		this._container.appendChild(backdrop);
		this._backdrop = backdrop;

		// Render QR
		try {
			const canvas = renderQRToCanvas(link, { scale: 6, margin: 2 });
			modal.querySelector('#share-panel-qr-mount').appendChild(canvas);
		} catch {
			modal.querySelector('#share-panel-qr-mount').textContent = 'QR coming soon';
		}

		// Focus trap + keyboard
		document.addEventListener('keydown', this._onKeyDown);
		// Focus modal so Esc works immediately; focus first button for usability
		const firstBtn = modal.querySelector('button');
		(firstBtn || modal).focus();

		_trapFocus(modal);
	}

	close() {
		if (!this._backdrop) return;
		document.removeEventListener('keydown', this._onKeyDown);
		this._backdrop.remove();
		this._backdrop = null;
		if (this._opener && typeof this._opener.focus === 'function') {
			this._opener.focus();
		}
		this._opener = null;
	}

	_onKeyDown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			this.close();
		}
		if (e.key === 'Tab' && this._backdrop) {
			_handleTabTrap(e, this._backdrop.querySelector('.share-panel-modal'));
		}
	}

	_copy(btn) {
		const text = btn.getAttribute('data-copy');
		navigator.clipboard.writeText(text).then(() => {
			const orig = btn.textContent;
			btn.textContent = 'Copied ✓';
			btn.classList.add('copied');
			setTimeout(() => {
				btn.textContent = orig;
				btn.classList.remove('copied');
			}, 1200);
		});
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _esc(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function _trapFocus(modal) {
	// Initial focus on first focusable element
	const els = modal.querySelectorAll(FOCUSABLE);
	if (els.length) els[0].focus();
}

function _handleTabTrap(e, modal) {
	const els = Array.from(modal.querySelectorAll(FOCUSABLE));
	if (!els.length) return;
	const first = els[0];
	const last = els[els.length - 1];
	if (e.shiftKey) {
		if (document.activeElement === first) {
			e.preventDefault();
			last.focus();
		}
	} else {
		if (document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
}
