/**
 * Launch Token Modal — pump.fun token launch flow.
 *
 * Steps: 1) details form  2) quote + bonding curve  3) wallet sign  4) success
 *
 * Usage:
 *   import { openLaunchTokenModal } from './launch-token-modal.js';
 *   openLaunchTokenModal({ agentId, agentName, imageUrl });
 */

import { mountLaunchBondingCurve } from './bonding-curve-chart.js';

const _isDev =
	typeof location !== 'undefined' &&
	(location.hostname === 'localhost' || location.hostname === '127.0.0.1');

function _esc(s) {
	return String(s ?? '').replace(
		/[<>&"]/g,
		(c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
	);
}

function _nameToSymbol(name) {
	const words = String(name || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const raw =
		words.length === 1
			? words[0].slice(0, 5)
			: words.map((w) => w[0] || '').join('').slice(0, 5);
	return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'AGENT';
}

function _solFmt(v) {
	if (v == null) return '—';
	const n = Number(v);
	return `${n >= 10 ? n.toFixed(3) : n.toFixed(4)} SOL`;
}

function _apiError(status, data) {
	const code = data?.error || '';
	const desc = data?.error_description || '';
	if (status === 429 || code === 'rate_limited')
		return 'Too many launch attempts, try again tomorrow';
	if (status === 404 || code === 'not_found') return null; // caller should close
	if (
		status === 403 ||
		code === 'forbidden' ||
		code === 'wallet_mismatch' ||
		desc.toLowerCase().includes('wallet')
	)
		return 'Wrong wallet — connect the wallet that owns this agent';
	return desc || `Request failed (${status})`;
}

export class LaunchTokenModal {
	/**
	 * @param {{ agentId: string, agentName?: string, imageUrl?: string }} opts
	 */
	constructor({ agentId, agentName = 'Agent', imageUrl = '' }) {
		this.agentId = agentId;
		this._d = {
			name: String(agentName).slice(0, 32),
			symbol: _nameToSymbol(agentName),
			description: '',
			image: String(imageUrl),
			initialBuySol: 0,
			cluster: 'mainnet',
		};
		this._step = 1;
		this._overlay = null;
		this._chart = null;
		this._keyHandler = null;
		this._solPriceUsd = null;
	}

	async _fetchSolPrice() {
		try {
			const r = await fetch(
				'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
			);
			if (r.ok) {
				const data = await r.json();
				this._solPriceUsd = data?.solana?.usd || null;
				// If modal is open on step 1, re-render to show price hints
				if (this._overlay && this._step === 1) {
					this._renderStep1();
				}
			}
		} catch (e) {
			console.warn('Could not fetch SOL price', e);
		}
	}

	_injectCss() {
		if (document.getElementById('ltm-styles')) return;
		const style = document.createElement('style');
		style.id = 'ltm-styles';
		style.textContent = `
			.ltm-input-wrap { position: relative; display: flex; }
			.ltm-input-wrap .ltm-input { flex-grow: 1; }
			.ltm-input-adornment {
				position: absolute;
				right: 12px;
				top: 50%;
				transform: translateY(-50%);
				color: var(--muted, #888);
				font-size: 13px;
				pointer-events: none;
			}
		`;
		document.head.appendChild(style);
	}

	_solFmtWithUsd(solAmount) {
		if (solAmount == null) return '—';
		const n = Number(solAmount);
		let text = `${n >= 10 ? n.toFixed(3) : n.toFixed(4)} SOL`;
		if (this._solPriceUsd) {
			const usd = (n * this._solPriceUsd).toFixed(2);
			text += ` (~$${usd})`;
		}
		return text;
	}

	open() {
		if (this._overlay) return;
		this._injectCss();
		this._fetchSolPrice();

		const el = document.createElement('div');
		el.className = 'ltm-overlay';
		document.body.appendChild(el);
		this._overlay = el;
		el.addEventListener('click', (e) => {
			if (e.target === el) this._close();
		});
		this._keyHandler = (e) => {
			if (e.key === 'Escape') this._close();
		};
		window.addEventListener('keydown', this._keyHandler);
		requestAnimationFrame(() => el.classList.add('ltm-open'));
		this._renderStep1();
	}

	_close() {
		if (this._chart) {
			this._chart.destroy();
			this._chart = null;
		}
		if (!this._overlay) return;
		this._overlay.classList.remove('ltm-open');
		const el = this._overlay;
		this._overlay = null;
		setTimeout(() => el.remove(), 200);
		if (this._keyHandler) {
			window.removeEventListener('keydown', this._keyHandler);
			this._keyHandler = null;
		}
	}

	_stepDots() {
		return [1, 2, 3, 4]
			.map(
				(i) =>
					`<div class="ltm-step-dot ${this._step === i ? 'active' : this._step > i ? 'done' : ''}"></div>`,
			)
			.join('');
	}

	_shell(title, body, footer) {
		return `
		<div class="ltm-modal" role="dialog" aria-modal="true" aria-label="Launch Agent Token">
			<div class="ltm-header">
				<span class="ltm-title">${_esc(title)}</span>
				<div class="ltm-header-right">
					<div class="ltm-steps">${this._stepDots()}</div>
					<button class="ltm-close" aria-label="Close modal">×</button>
				</div>
			</div>
			<div class="ltm-body">${body}</div>
			<div class="ltm-footer">${footer}</div>
		</div>`;
	}

	_paint(html) {
		if (this._chart) {
			this._chart.destroy();
			this._chart = null;
		}
		if (!this._overlay) return;
		this._overlay.innerHTML = html;
		this._overlay.querySelector('.ltm-close')?.addEventListener('click', () => this._close());
	}

	// ── Step 1 — Token details ────────────────────────────────────────────────

	_renderStep1() {
		this._step = 1;
		const d = this._d;
		const netToggle = _isDev
			? `<div class="ltm-net-row">
				<span>Network:</span>
				<div class="ltm-toggle">
					<button class="ltm-toggle-btn${d.cluster === 'mainnet' ? ' active' : ''}" data-net="mainnet">Mainnet</button>
					<button class="ltm-toggle-btn${d.cluster === 'devnet' ? ' active' : ''}" data-net="devnet">Devnet</button>
				</div>
			</div>`
			: '';

		this._paint(
			this._shell(
				'Launch Token — Details',
				`<div class="ltm-field">
					<label class="ltm-label" for="ltm-name">
						Token name <span class="ltm-hint">max 32 chars</span>
					</label>
					<input class="ltm-input" id="ltm-name" maxlength="32"
						value="${_esc(d.name)}" autocomplete="off">
				</div>
				<div class="ltm-field">
					<label class="ltm-label" for="ltm-sym">
						Symbol <span class="ltm-hint">2–10 alphanumeric</span>
					</label>
					<input class="ltm-input" id="ltm-sym" maxlength="10"
						value="${_esc(d.symbol)}" autocomplete="off">
					<span class="ltm-field-err" id="ltm-sym-err"></span>
				</div>
				<div class="ltm-field">
					<label class="ltm-label" for="ltm-desc">
						Description <span class="ltm-hint">optional, max 280</span>
					</label>
					<textarea class="ltm-textarea" id="ltm-desc"
						maxlength="280" rows="2">${_esc(d.description)}</textarea>
				</div>
				<div class="ltm-field">
					<label class="ltm-label" for="ltm-img">
						Image URL <span class="ltm-hint">optional</span>
					</label>
					<input class="ltm-input" id="ltm-img"
						value="${_esc(d.image)}" autocomplete="off" placeholder="https://…">
				</div>
				<div class="ltm-field">
					<label class="ltm-label" for="ltm-buy">
						Dev buy <span class="ltm-hint">optional, 0–50 SOL</span>
					</label>
					<div class="ltm-input-wrap">
						<input class="ltm-input" type="number" id="ltm-buy"
							min="0" max="50" step="0.1" value="${d.initialBuySol}">
						<span class="ltm-input-adornment" id="ltm-buy-usd"></span>
					</div>
				</div>
				${netToggle}`,
				`<div></div>
				<button class="ltm-btn ltm-btn-primary" id="ltm-s1-next">Preview →</button>`,
			),
		);

		const nameInput = this._overlay.querySelector('#ltm-name');
		const symInput = this._overlay.querySelector('#ltm-sym');
		const symErr = this._overlay.querySelector('#ltm-sym-err');
		const buyInput = this._overlay.querySelector('#ltm-buy');
		const buyUsd = this._overlay.querySelector('#ltm-buy-usd');
		let symTouched = d.symbol !== _nameToSymbol(d.name);

		const updateBuyUsd = () => {
			if (!this._solPriceUsd || !buyUsd) return;
			const sol = parseFloat(buyInput.value) || 0;
			const usd = (sol * this._solPriceUsd).toFixed(2);
			buyUsd.textContent = `~ $${usd}`;
		};

		if (buyInput) {
			buyInput.addEventListener('input', updateBuyUsd);
			updateBuyUsd();
		}

		nameInput.addEventListener('input', () => {
			if (!symTouched) symInput.value = _nameToSymbol(nameInput.value);
		});
		symInput.addEventListener('input', () => {
			symInput.value = symInput.value.toUpperCase();
			symTouched = true;
			symErr.textContent = '';
			symInput.classList.remove('ltm-err');
		});

		this._overlay.querySelectorAll('[data-net]').forEach((btn) => {
			btn.addEventListener('click', () => {
				this._d.cluster = btn.dataset.net;
				this._overlay
					.querySelectorAll('[data-net]')
					.forEach((b) => b.classList.toggle('active', b === btn));
			});
		});

		this._overlay.querySelector('#ltm-s1-next').addEventListener('click', () => {
			const name = nameInput.value.trim();
			const symbol = symInput.value.toUpperCase().trim();

			if (!name) {
				nameInput.classList.add('ltm-err');
				nameInput.focus();
				return;
			}
			nameInput.classList.remove('ltm-err');

			if (!/^[A-Za-z0-9]{2,10}$/.test(symbol)) {
				symInput.classList.add('ltm-err');
				symErr.textContent = 'Must be 2–10 alphanumeric characters (A-Z, 0-9)';
				symInput.focus();
				return;
			}
			symInput.classList.remove('ltm-err');
			symErr.textContent = '';

			this._d.name = name;
			this._d.symbol = symbol;
			this._d.description = this._overlay.querySelector('#ltm-desc').value.trim();
			this._d.image = this._overlay.querySelector('#ltm-img').value.trim();
			this._d.initialBuySol = Math.min(
				50,
				Math.max(0, parseFloat(this._overlay.querySelector('#ltm-buy').value) || 0),
			);

			this._renderStep2();
		});
	}

	// ── Step 2 — Preview quote + bonding curve ────────────────────────────────

	async _renderStep2() {
		this._step = 2;

		this._paint(
			this._shell(
				'Launch Token — Preview',
				`<div class="ltm-chart-title">Bonding curve (price vs supply)</div>
				<div class="ltm-chart-wrap" id="ltm-chart"></div>
				<div id="ltm-quote" class="ltm-quote-block">
					<div class="ltm-status-msg">
						<span class="ltm-spinner"></span>Fetching quote…
					</div>
				</div>`,
				`<button class="ltm-btn" id="ltm-s2-back">← Back</button>
				<button class="ltm-btn ltm-btn-primary" id="ltm-s2-next" disabled>Continue →</button>`,
			),
		);

		const chartEl = this._overlay.querySelector('#ltm-chart');
		if (chartEl) this._chart = mountLaunchBondingCurve(chartEl);

		this._overlay.querySelector('#ltm-s2-back').addEventListener('click', () => this._renderStep1());

		try {
			const qs = new URLSearchParams({
				initial_buy_sol: String(this._d.initialBuySol),
				cluster: this._d.cluster,
			});
			const resp = await fetch(`/api/agents/tokens/launch-quote?${qs}`, {
				credentials: 'include',
			});
			const data = await resp.json();

			if (!resp.ok) {
				if (resp.status === 404) { this._close(); return; }
				const msg = _apiError(resp.status, data) || 'Request failed';
				this._overlay.querySelector('#ltm-quote').innerHTML =
					`<div class="ltm-status-msg ltm-err">${_esc(msg)}</div>`;
				return;
			}

			const rows = [['Fixed costs (rent + fees)', this._solFmtWithUsd(data.fixed_total_sol)]];
			if (data.initial_buy && data.initial_buy.sol > 0) {
				rows.push(['Dev buy', this._solFmtWithUsd(data.initial_buy.sol)]);
				if (data.initial_buy.protocol_fee_sol > 0)
					rows.push(['Protocol fee (~1%)', this._solFmtWithUsd(data.initial_buy.protocol_fee_sol)]);
				if (data.initial_buy.tokens_out) {
					const n = Number(data.initial_buy.tokens_out).toLocaleString();
					rows.push([`Tokens you receive`, `${n} ${this._d.symbol}`]);
				}
			}
			rows.push(['Total SOL needed', this._solFmtWithUsd(data.total_sol)]);

			this._overlay.querySelector('#ltm-quote').innerHTML = rows
				.map(
					([label, val], i) =>
						`<div class="ltm-quote-row">
							<span class="ltm-q-label">${_esc(label)}</span>
							<span class="ltm-q-val${i === rows.length - 1 ? ' ltm-total' : ''}">${_esc(val)}</span>
						</div>`,
				)
				.join('');

			const nextBtn = this._overlay.querySelector('#ltm-s2-next');
			nextBtn.disabled = false;
			nextBtn.addEventListener('click', () => this._renderStep3());
		} catch {
			if (!this._overlay) return;
			this._overlay.querySelector('#ltm-quote').innerHTML =
				`<div class="ltm-status-msg ltm-err">Connection error, please try again</div>`;
		}
	}

	// ── Step 3 — Connect wallet & sign ────────────────────────────────────────

	_renderStep3() {
		this._step = 3;

		this._paint(
			this._shell(
				'Launch Token — Sign',
				`<div class="ltm-wallet-row">
					<div class="ltm-wallet-info">
						<div class="ltm-wallet-status disconnected" id="ltm-ws">Wallet not connected</div>
						<div class="ltm-wallet-addr" id="ltm-wa"></div>
					</div>
					<button class="ltm-btn" id="ltm-connect">Connect Wallet</button>
				</div>
				<div class="ltm-status-msg" id="ltm-msg"></div>`,
				`<button class="ltm-btn" id="ltm-s3-back">← Back</button>
				<button class="ltm-btn ltm-btn-primary" id="ltm-launch" disabled>Sign &amp; Launch</button>`,
			),
		);

		this._overlay.querySelector('#ltm-s3-back').addEventListener('click', () => this._renderStep2());

		const connectBtn = this._overlay.querySelector('#ltm-connect');
		const launchBtn = this._overlay.querySelector('#ltm-launch');
		let walletAddr = null;

		const _setConnected = (addr) => {
			walletAddr = addr;
			const ws = this._overlay.querySelector('#ltm-ws');
			const wa = this._overlay.querySelector('#ltm-wa');
			if (ws) { ws.textContent = 'Connected'; ws.className = 'ltm-wallet-status connected'; }
			if (wa) wa.textContent = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
			connectBtn.style.display = 'none';
			launchBtn.disabled = false;
		};

		const sol = window.solana ?? window.phantom?.solana ?? window.backpack ?? window.solflare;
		if (sol?.isConnected && sol?.publicKey) {
			_setConnected(sol.publicKey.toString());
		}

		connectBtn.addEventListener('click', async () => {
			if (!sol) {
				this._msg('No Solana wallet detected. Install Phantom or Backpack.', true);
				return;
			}
			connectBtn.disabled = true;
			connectBtn.textContent = 'Connecting…';
			try {
				await sol.connect();
				_setConnected(sol.publicKey.toString());
			} catch {
				connectBtn.disabled = false;
				connectBtn.textContent = 'Connect Wallet';
				this._msg('Wallet connection cancelled.', true);
			}
		});

		launchBtn.addEventListener('click', () => this._doLaunch(walletAddr));
	}

	// ── Launch: prep → sign → broadcast → confirm ─────────────────────────────

	async _doLaunch(walletAddress) {
		const launchBtn = this._overlay.querySelector('#ltm-launch');
		const backBtn = this._overlay.querySelector('#ltm-s3-back');
		launchBtn.disabled = true;
		backBtn.disabled = true;

		const reset = () => {
			if (!this._overlay) return;
			if (launchBtn) launchBtn.disabled = false;
			if (backBtn) backBtn.disabled = false;
		};

		try {
			this._msg('Preparing transaction…');
			const prepResp = await fetch('/api/agents/tokens/launch-prep', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					agent_id: this.agentId,
					provider: 'pumpfun',
					cluster: this._d.cluster,
					wallet_address: walletAddress,
					name: this._d.name,
					symbol: this._d.symbol,
					description: this._d.description,
					image: this._d.image,
					initial_buy_sol: this._d.initialBuySol,
				}),
			});
			const prep = await prepResp.json();

			if (!prepResp.ok) {
				if (prepResp.status === 404) { this._close(); return; }
				const msg = _apiError(prepResp.status, prep) || 'Preparation failed';
				this._msg(msg, true);
				reset();
				return;
			}

			this._msg('Sign transaction in your wallet…');
			const sol = window.solana ?? window.phantom?.solana ?? window.backpack ?? window.solflare;
			const { Transaction } = await import('@solana/web3.js');
			const txBytes = Uint8Array.from(atob(prep.tx_base64), (c) => c.charCodeAt(0));
			const tx = Transaction.from(txBytes);

			let signed;
			try {
				signed = await sol.signTransaction(tx);
			} catch {
				this._msg('Transaction signing cancelled.', true);
				reset();
				return;
			}

			this._msg('Broadcasting to Solana…');
			const { Connection } = await import('@solana/web3.js');
			const rpcUrl =
				prep.cluster === 'devnet'
					? 'https://api.devnet.solana.com'
					: 'https://api.mainnet-beta.solana.com';
			const conn = new Connection(rpcUrl, 'confirmed');

			let signature;
			try {
				signature = await conn.sendRawTransaction(signed.serialize(), {
					skipPreflight: false,
					preflightCommitment: 'confirmed',
				});
			} catch (e) {
				this._msg(
					`Broadcast failed: ${(e.message || String(e)).slice(0, 100)}`,
					true,
				);
				reset();
				return;
			}

			this._msg('Confirming on-chain…');
			const confirmResp = await fetch('/api/agents/tokens/launch-confirm', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					prep_id: prep.prep_id,
					tx_signature: signature,
					wallet_address: walletAddress,
				}),
			});
			const confirmed = await confirmResp.json();

			if (!confirmResp.ok) {
				const msg = _apiError(confirmResp.status, confirmed) || 'Confirmation failed';
				this._msg(msg, true);
				reset();
				return;
			}

			const mint = confirmed.agent?.token?.mint || prep.mint;
			const pumpUrl =
				prep.cluster === 'mainnet' ? `https://pump.fun/coin/${mint}` : null;
			this._renderStep4(mint, pumpUrl);
		} catch {
			this._msg('Connection error, please try again', true);
			reset();
		}
	}

	// ── Step 4 — Success ──────────────────────────────────────────────────────

	_renderStep4(mint, pumpUrl) {
		this._step = 4;
		this._paint(
			this._shell(
				'Token Launched!',
				`<div class="ltm-success">
					<div class="ltm-success-icon">🎉</div>
					<div class="ltm-success-title">Token launched successfully!</div>
					<div class="ltm-mint-box">${_esc(mint)}</div>
					${pumpUrl ? `<a class="ltm-pumpfun-link" href="${_esc(pumpUrl)}" target="_blank" rel="noopener noreferrer">View on pump.fun →</a>` : ''}
				</div>`,
				`<div></div>
				<button class="ltm-btn ltm-btn-primary" id="ltm-done">Done</button>`,
			),
		);

		this._overlay.querySelector('#ltm-done').addEventListener('click', () => {
			this._close();
			location.reload();
		});

		window.dispatchEvent(
			new CustomEvent('agent-token-launched', { detail: { mint, pumpUrl } }),
		);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	_msg(text, err = false) {
		const el = this._overlay?.querySelector('#ltm-msg');
		if (!el) return;
		el.textContent = text;
		el.className = `ltm-status-msg${err ? ' ltm-err' : ''}`;
	}
}

/**
 * Open the launch token modal.
 * @param {{ agentId: string, agentName?: string, imageUrl?: string }} opts
 * @returns {LaunchTokenModal}
 */
export function openLaunchTokenModal(opts) {
	const modal = new LaunchTokenModal(opts);
	modal.open();
	return modal;
}
