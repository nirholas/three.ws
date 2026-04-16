/**
 * PublishModal — post-publish share UI.
 *
 * DOM mirrors AvatarCreator for visual consistency but uses its own
 * `.publish-*` CSS namespace to avoid collisions. The modal renders one of
 * three states into `.publish-body`: "working" (progress), "result"
 * (snippets), or "error" / "auth-required".
 */

const STEPS = [
	{ key: 'export', label: 'Export' },
	{ key: 'upload', label: 'Upload' },
	{ key: 'register', label: 'Register' },
	{ key: 'widget', label: 'Widget' },
];

const STEP_ORDER = STEPS.map((s) => s.key);

export class PublishModal {
	constructor(containerEl) {
		this.container = containerEl || document.body;

		this.overlay = null;
		this.modal = null;
		this.body = null;

		this._onKeyDown = null;
		this._onOverlayClick = null;
		this._onTrapFocus = null;
		this._previouslyFocused = null;

		this._stepState = {
			export: 'pending',
			upload: 'pending',
			register: 'pending',
			widget: 'pending',
		};
	}

	open() {
		if (this.overlay) return;
		this._previouslyFocused = document.activeElement;
		this._build();
		this._wireEvents();
		this._showWorking();
	}

	close() {
		if (!this.overlay) return;
		if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
		this.overlay.remove();
		this.overlay = null;
		this.modal = null;
		this.body = null;
		this._onKeyDown = null;
		this._onOverlayClick = null;
		this._onTrapFocus = null;

		const prev = this._previouslyFocused;
		this._previouslyFocused = null;
		if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
			try {
				prev.focus();
			} catch (_) {}
		}
	}

	onStep = ({ step, pct = 1 }) => {
		const mapped = step === 'presign' ? 'upload' : step;
		if (!STEP_ORDER.includes(mapped)) return;
		const idx = STEP_ORDER.indexOf(mapped);
		for (let i = 0; i < idx; i++) this._stepState[STEP_ORDER[i]] = 'done';
		this._stepState[mapped] = pct >= 1 ? 'done' : 'active';
		if (pct >= 1 && idx + 1 < STEP_ORDER.length) {
			const next = STEP_ORDER[idx + 1];
			if (this._stepState[next] === 'pending') this._stepState[next] = 'active';
		}
		this._renderSteps();
	};

	showResult(urls) {
		if (!this.body) return;
		this._setTitle('Published ✓');
		const rows = [
			{ label: 'Share link', value: urls.page, open: true },
			{ label: 'Iframe snippet', value: urls.iframe, open: false },
			{ label: 'Web component snippet', value: urls.element, open: false },
		];
		this.body.innerHTML = `
			<div class="publish-result">
				${rows.map((r, i) => this._renderSnippetHTML(r, i)).join('')}
				<div class="publish-actions">
					<button type="button" class="publish-done-btn">Done</button>
				</div>
			</div>
		`;

		const values = rows.map((r) => r.value);
		this.body.querySelectorAll('.publish-copy-btn').forEach((btn) => {
			btn.addEventListener('click', () => this._copyValue(btn, values[Number(btn.dataset.idx)]));
		});
		this.body.querySelectorAll('.publish-open-btn').forEach((btn) => {
			btn.addEventListener('click', () => {
				const v = values[Number(btn.dataset.idx)];
				if (v) window.open(v, '_blank', 'noopener');
			});
		});
		const done = this.body.querySelector('.publish-done-btn');
		if (done) done.addEventListener('click', () => this.close());

		const firstCopy = this.body.querySelector('.publish-copy-btn');
		if (firstCopy) {
			try {
				firstCopy.focus();
			} catch (_) {}
		}
	}

	showAuthRequired() {
		if (!this.body) return;
		this._setTitle('Sign in to publish');
		const next = encodeURIComponent(location.href);
		this.body.innerHTML = `
			<div class="publish-auth">
				<p class="publish-auth-msg">
					Publishing saves your edited model to your account. Sign in to continue.
				</p>
				<div class="publish-actions">
					<button type="button" class="publish-cancel-btn">Cancel</button>
					<button type="button" class="publish-signin-btn">Sign in</button>
				</div>
			</div>
		`;
		this.body.querySelector('.publish-signin-btn').addEventListener('click', () => {
			window.location.href = `/login?next=${next}`;
		});
		this.body.querySelector('.publish-cancel-btn').addEventListener('click', () => this.close());
		const signIn = this.body.querySelector('.publish-signin-btn');
		if (signIn) {
			try {
				signIn.focus();
			} catch (_) {}
		}
	}

	showError(err) {
		if (!this.body) return;
		this._setTitle('Publish failed');
		const name = (err && err.name) || 'Error';
		const message = (err && err.message) || String(err);
		this.body.innerHTML = `
			<div class="publish-error" role="alert">
				<div class="publish-error-name">${escapeHtml(name)}</div>
				<div class="publish-error-message">${escapeHtml(message)}</div>
				<div class="publish-actions">
					<button type="button" class="publish-cancel-btn">Close</button>
					<button type="button" class="publish-retry-btn">Retry</button>
				</div>
			</div>
		`;
		this.body.querySelector('.publish-retry-btn').addEventListener('click', () => {
			const fn = this._onRetry;
			this.close();
			if (typeof fn === 'function') fn();
		});
		this.body.querySelector('.publish-cancel-btn').addEventListener('click', () => this.close());
		const retry = this.body.querySelector('.publish-retry-btn');
		if (retry) {
			try {
				retry.focus();
			} catch (_) {}
		}
	}

	onRetry(fn) {
		this._onRetry = fn;
	}

	_build() {
		this.overlay = document.createElement('div');
		this.overlay.className = 'publish-overlay';
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-modal', 'true');
		this.overlay.setAttribute('aria-labelledby', 'publish-title');
		this.overlay.innerHTML = `
			<div class="publish-modal">
				<div class="publish-header">
					<span class="publish-title" id="publish-title">Publishing…</span>
					<button type="button" class="publish-close" aria-label="Close">&times;</button>
				</div>
				<div class="publish-body"></div>
			</div>
		`;
		this.container.appendChild(this.overlay);
		this.modal = this.overlay.querySelector('.publish-modal');
		this.body = this.overlay.querySelector('.publish-body');
	}

	_wireEvents() {
		this.overlay.querySelector('.publish-close').addEventListener('click', () => this.close());
		this._onOverlayClick = (e) => {
			if (e.target === this.overlay) this.close();
		};
		this.overlay.addEventListener('click', this._onOverlayClick);

		this._onKeyDown = (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				this.close();
			}
		};
		document.addEventListener('keydown', this._onKeyDown);

		this._onTrapFocus = (e) => {
			if (e.key !== 'Tab') return;
			const focusables = this._focusables();
			if (!focusables.length) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		this.overlay.addEventListener('keydown', this._onTrapFocus);
	}

	_focusables() {
		if (!this.overlay) return [];
		return Array.from(
			this.overlay.querySelectorAll(
				'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		);
	}

	_setTitle(text) {
		const t = this.overlay?.querySelector('.publish-title');
		if (t) t.textContent = text;
	}

	_showWorking() {
		this._setTitle('Publishing…');
		this.body.innerHTML = `
			<div class="publish-steps" aria-live="polite">
				${STEPS.map(
					(s) => `
					<div class="publish-step publish-step--pending" data-step="${s.key}">
						<span class="publish-step-dot" aria-hidden="true"></span>
						<span class="publish-step-label">${s.label}</span>
					</div>
				`,
				).join('')}
			</div>
		`;
		this._stepState = {
			export: 'active',
			upload: 'pending',
			register: 'pending',
			widget: 'pending',
		};
		this._renderSteps();
	}

	_renderSteps() {
		if (!this.body) return;
		for (const [key, state] of Object.entries(this._stepState)) {
			const row = this.body.querySelector(`.publish-step[data-step="${key}"]`);
			if (!row) continue;
			row.classList.remove(
				'publish-step--pending',
				'publish-step--active',
				'publish-step--done',
			);
			row.classList.add(`publish-step--${state}`);
			const dot = row.querySelector('.publish-step-dot');
			if (dot) dot.textContent = state === 'done' ? '✓' : '';
		}
	}

	_renderSnippetHTML(row, i) {
		return `
			<div class="publish-snippet">
				<div class="publish-snippet-label">${escapeHtml(row.label)}</div>
				<div class="publish-snippet-row">
					<pre class="publish-snippet-value" tabindex="0">${escapeHtml(row.value)}</pre>
					<div class="publish-snippet-actions">
						<button type="button" class="publish-copy-btn" data-idx="${i}">Copy</button>
						${row.open ? `<button type="button" class="publish-open-btn" data-idx="${i}">Open</button>` : ''}
					</div>
				</div>
			</div>
		`;
	}

	async _copyValue(btn, value) {
		const prev = btn.textContent;
		try {
			await navigator.clipboard.writeText(value);
			btn.textContent = 'Copied ✓';
			btn.disabled = true;
		} catch (err) {
			console.warn('[publish-modal] clipboard write failed', err);
			btn.textContent = 'Copy failed';
		}
		setTimeout(() => {
			if (!this.overlay || !document.contains(btn)) return;
			btn.textContent = prev;
			btn.disabled = false;
		}, 1200);
	}
}

function escapeHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
