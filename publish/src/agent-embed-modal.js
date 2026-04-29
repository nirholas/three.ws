/**
 * Embed modal for the agent hub page.
 * Shows iframe + web-component snippets with copy-to-clipboard.
 */
export class AgentEmbedModal {
	/**
	 * @param {string} agentId
	 */
	constructor(agentId) {
		this._id = agentId;
		this._modal = null;
		this._onKey = this._onKey.bind(this);
	}

	open() {
		if (this._modal) return;
		this._build();
		document.body.appendChild(this._modal);
		document.addEventListener('keydown', this._onKey);
		requestAnimationFrame(() => this._modal.classList.add('aem-open'));
	}

	close() {
		if (!this._modal) return;
		document.removeEventListener('keydown', this._onKey);
		this._modal.remove();
		this._modal = null;
	}

	_onKey(e) {
		if (e.key === 'Escape') this.close();
	}

	_build() {
		const origin = location.origin;
		const id = this._id;
		const snippets = {
			iframe:
				`<iframe\n` +
				`  src="${origin}/agent/${id}/embed"\n` +
				`  width="420" height="520"\n` +
				`  style="border:0;border-radius:12px"\n` +
				`  allow="autoplay; xr-spatial-tracking"\n` +
				`></iframe>`,
			webcomponent:
				`<script type="module"\n` +
				`  src="${origin}/dist-lib/agent-3d.js"\n` +
				`><\/script>\n` +
				`<agent-3d\n` +
				`  agent-id="${id}"\n` +
				`  style="width:420px;height:520px"\n` +
				`></agent-3d>`,
		};

		const overlay = document.createElement('div');
		overlay.className = 'aem-overlay';
		overlay.innerHTML = `
			<div class="aem-modal" role="dialog" aria-modal="true" aria-label="Embed this agent">
				<div class="aem-header">
					<span class="aem-title">Embed this agent</span>
					<button class="aem-close" aria-label="Close">&times;</button>
				</div>
				<div class="aem-body">
					<div class="aem-tabs" role="tablist">
						<button class="aem-tab active" data-tab="iframe">iframe</button>
						<button class="aem-tab" data-tab="webcomponent">&lt;agent-3d&gt;</button>
					</div>
					<div class="aem-snippet-wrap">
						<pre class="aem-snippet" id="aem-snippet-text"></pre>
						<button class="aem-copy" id="aem-copy-btn">copy</button>
					</div>
					<p class="aem-note">Free to embed — no wallet or on-chain deployment required.</p>
				</div>
			</div>
		`;

		let current = 'iframe';
		const snippetEl = overlay.querySelector('#aem-snippet-text');
		const copyBtn = overlay.querySelector('#aem-copy-btn');

		const renderSnippet = () => {
			snippetEl.textContent = snippets[current];
		};
		renderSnippet();

		overlay.querySelectorAll('.aem-tab').forEach((btn) => {
			btn.addEventListener('click', () => {
				current = btn.dataset.tab;
				overlay
					.querySelectorAll('.aem-tab')
					.forEach((b) => b.classList.toggle('active', b === btn));
				renderSnippet();
			});
		});

		copyBtn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(snippets[current]);
				copyBtn.textContent = 'copied!';
				copyBtn.classList.add('aem-copied');
				setTimeout(() => {
					copyBtn.textContent = 'copy';
					copyBtn.classList.remove('aem-copied');
				}, 1400);
			} catch {}
		});

		overlay.querySelector('.aem-close').addEventListener('click', () => this.close());
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) this.close();
		});

		this._modal = overlay;
	}
}
