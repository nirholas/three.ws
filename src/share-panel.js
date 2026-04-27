import { renderQRToCanvas, renderQRToSVG } from './erc8004/qr.js';
import {
	DEFAULT_OPTIONS,
	SIZES,
	buildEmbedUrl,
	buildIframeSnippet,
	buildWebComponentSnippet,
} from './share-panel-builders.js';
import './share-panel.css';

// Re-export the pure helpers so existing imports keep working.
export {
	buildEmbedUrl,
	buildIframeSnippet,
	buildWebComponentSnippet,
	DEFAULT_OPTIONS,
	SIZES,
} from './share-panel-builders.js';

/**
 * One-click share modal for an agent: link, customisable iframe + web-component
 * snippets with a live preview, OG card, and QR code.
 *
 * @example
 * const panel = new SharePanel({
 *   agent: { id, slug, name },
 *   container: document.body,
 * });
 * panel.open();
 */

export class SharePanel {
	/**
	 * @param {{
	 *   agent: { id: string, slug?: string, name?: string, thumbnailUrl?: string },
	 *   container?: HTMLElement,
	 *   embedOrigin?: string,
	 * }} opts
	 */
	constructor({ agent, container = document.body, embedOrigin = location.origin }) {
		this._agent = agent;
		this._container = container;
		this._origin = embedOrigin;
		this._backdrop = null;
		this._opener = null;
		this._opts = { ...DEFAULT_OPTIONS };
		this._onKeyDown = this._onKeyDown.bind(this);
	}

	open() {
		if (this._backdrop) return;
		this._opener = document.activeElement;

		const { id, slug, name } = this._agent;
		const link = `${this._origin}/a/${slug || id}`;
		const ogUrl = `${this._origin}/api/a-og?id=${id}`;
		const modalId = `share-panel-title-${id}`;

		const backdrop = document.createElement('div');
		backdrop.className = 'share-panel-backdrop';
		backdrop.setAttribute('role', 'presentation');

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
					<div class="share-panel-code" data-role="link-code">${_esc(link)}</div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy-target="link-code">Copy</button>
						<a class="share-panel-btn" href="${_esc(link)}" target="_blank" rel="noopener">Open ↗</a>
					</div>
				</div>
			</div>

			<div class="share-panel-row" data-section="customise">
				<div class="share-panel-label">Customise embed</div>
				<div class="share-panel-controls">
					<fieldset class="share-panel-fieldset">
						<legend>Background</legend>
						<div class="share-panel-segments" role="radiogroup" aria-label="Background">
							${_segmentBtn('bg', 'transparent', 'Transparent', this._opts.bg)}
							${_segmentBtn('bg', 'dark', 'Dark', this._opts.bg)}
							${_segmentBtn('bg', 'light', 'Light', this._opts.bg)}
						</div>
					</fieldset>
					<fieldset class="share-panel-fieldset">
						<legend>Name plate</legend>
						<div class="share-panel-segments" role="radiogroup" aria-label="Name plate">
							${_segmentBtn('name', 'true', 'On', String(this._opts.name))}
							${_segmentBtn('name', 'false', 'Off', String(this._opts.name))}
						</div>
					</fieldset>
					<fieldset class="share-panel-fieldset">
						<legend>Size</legend>
						<div class="share-panel-segments" role="radiogroup" aria-label="Size">
							${_segmentBtn('size', 'small', 'Small', this._opts.size)}
							${_segmentBtn('size', 'medium', 'Medium', this._opts.size)}
							${_segmentBtn('size', 'large', 'Large', this._opts.size)}
						</div>
					</fieldset>
				</div>
			</div>

			<div class="share-panel-row" data-section="preview">
				<div class="share-panel-label">Live preview</div>
				<div class="share-panel-preview" data-role="preview-frame-mount"></div>
			</div>

			<div class="share-panel-row" data-section="iframe">
				<div class="share-panel-label">iframe embed</div>
				<div class="share-panel-field">
					<div class="share-panel-code" data-role="iframe-code"></div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy-target="iframe-code">Copy</button>
					</div>
				</div>
			</div>

			<div class="share-panel-row" data-section="wc">
				<div class="share-panel-label">Web component</div>
				<div class="share-panel-field">
					<div class="share-panel-code" data-role="wc-code"></div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy-target="wc-code">Copy</button>
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
					<div class="share-panel-code" data-role="og-code">${_esc(ogUrl)}</div>
					<div class="share-panel-actions">
						<button class="share-panel-btn" data-copy-target="og-code">Copy URL</button>
					</div>
				</div>
			</div>

			<hr class="share-panel-divider">

			<div class="share-panel-row" data-section="qr">
				<div class="share-panel-label">QR code</div>
				<div class="share-panel-qr" id="share-panel-qr-mount"></div>
			</div>
		`;

		modal.querySelector('.share-panel-close').addEventListener('click', () => this.close());

		// Segment-button toggles
		modal.querySelectorAll('.share-panel-segment').forEach((btn) => {
			btn.addEventListener('click', () => this._onSegmentClick(btn));
		});

		// Copy buttons (resolve target text on click for live snippet content)
		modal.querySelectorAll('[data-copy-target]').forEach((btn) => {
			btn.addEventListener('click', () => this._copy(btn));
		});

		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) this.close();
		});

		backdrop.appendChild(modal);
		this._container.appendChild(backdrop);
		this._backdrop = backdrop;

		this._renderSnippets();
		this._mountPreview();
		this._renderQR(link);

		document.addEventListener('keydown', this._onKeyDown);
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

	// ── Snippet rendering ────────────────────────────────────────────────────────

	_renderSnippets() {
		const m = this._backdrop;
		if (!m) return;
		const args = { origin: this._origin, agentId: this._agent.id, opts: this._opts };
		m.querySelector('[data-role="iframe-code"]').textContent = buildIframeSnippet(args);
		m.querySelector('[data-role="wc-code"]').textContent = buildWebComponentSnippet(args);
	}

	// ── Live preview ─────────────────────────────────────────────────────────────

	_mountPreview() {
		const mount = this._backdrop?.querySelector('[data-role="preview-frame-mount"]');
		if (!mount) return;
		mount.innerHTML = '';
		this._previewMount = mount;
		this._renderPreview();
	}

	_renderPreview() {
		if (!this._previewMount) return;
		const { width, height } = SIZES[this._opts.size];
		const url = new URL(
			buildEmbedUrl({
				origin: this._origin,
				agentId: this._agent.id,
				opts: this._opts,
			}),
		);
		// Always set preview=1 so the embed page skips its origin allow-list
		// gate when the dialog runs on a non-allowlisted host.
		url.searchParams.set('preview', '1');

		const frame = document.createElement('iframe');
		frame.className = 'share-panel-preview-frame';
		frame.src = url.toString();
		frame.width = String(width);
		frame.height = String(height);
		frame.setAttribute('loading', 'lazy');
		frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
		frame.setAttribute('allow', 'autoplay; xr-spatial-tracking');
		frame.setAttribute(
			'aria-label',
			`Live preview of ${this._agent.name || 'agent'} embed`,
		);
		// Visualise the chosen background while the iframe paints.
		frame.dataset.bg = this._opts.bg;
		this._previewMount.replaceChildren(frame);
	}

	// ── Segment toggles ──────────────────────────────────────────────────────────

	_onSegmentClick(btn) {
		const group = btn.dataset.group;
		const value = btn.dataset.value;
		if (!group) return;

		// Update opts
		if (group === 'name') {
			this._opts.name = value === 'true';
		} else {
			this._opts[group] = value;
		}

		// Update aria-checked + active class for the group
		const groupRoot = btn.closest('.share-panel-segments');
		groupRoot.querySelectorAll('.share-panel-segment').forEach((b) => {
			const active = b === btn;
			b.classList.toggle('share-panel-segment--active', active);
			b.setAttribute('aria-checked', String(active));
		});

		this._renderSnippets();
		this._renderPreview();
	}

	// ── Misc ─────────────────────────────────────────────────────────────────────

	_renderQR(link) {
		const qrMount = this._backdrop?.querySelector('#share-panel-qr-mount');
		if (!qrMount) return;
		try {
			const canvas = renderQRToCanvas(link, { scale: 6, margin: 2 });
			qrMount.appendChild(canvas);
		} catch {
			try {
				qrMount.innerHTML = renderQRToSVG(link, { scale: 6, margin: 2 });
			} catch {
				qrMount.textContent = link;
			}
		}
	}

	_copy(btn) {
		const targetRole = btn.getAttribute('data-copy-target');
		const node = this._backdrop?.querySelector(`[data-role="${targetRole}"]`);
		if (!node) return;
		const text = node.textContent || '';
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

	_onKeyDown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			this.close();
		}
		if (e.key === 'Tab' && this._backdrop) {
			_handleTabTrap(e, this._backdrop.querySelector('.share-panel-modal'));
		}
	}
}

// ── Internal helpers ─────────────────────────────────────────────────────────────

function _segmentBtn(group, value, label, currentValue) {
	const active = String(currentValue) === String(value);
	return (
		`<button type="button"` +
		` class="share-panel-segment${active ? ' share-panel-segment--active' : ''}"` +
		` role="radio" aria-checked="${active}"` +
		` data-group="${_esc(group)}" data-value="${_esc(value)}">${_esc(label)}</button>`
	);
}

function _esc(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const FOCUSABLE =
	'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function _trapFocus(modal) {
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
