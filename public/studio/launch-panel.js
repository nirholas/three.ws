// Launch panel for the studio right column.
// Self-contained: handles wallet detection, SOL balance, metadata upload,
// on-chain signing, confirmation, and success display — no separate modal.
//
// Exported pure functions (keep for tests):
//   validateLaunchForm(fields)            → { ok, errors }
//   handleLaunchSubmit(fields, onSubmit)  → { ok, errors? }
//
// DOM entry point:
//   mountLaunchPanel(container, { getAvatar, getUser }) → { avatarChanged, teardown }

// ── Pure validation (tested) ────────────────────────────────────────────────

export function validateLaunchForm({ name, symbol, description, initialBuy } = {}) {
	const errors = {};
	if (!name?.trim()) errors.name = 'Token name is required';
	if (!symbol?.trim()) errors.symbol = 'Symbol is required';
	if (!description?.trim()) errors.description = 'Description is required';
	if (initialBuy !== '' && initialBuy != null) {
		const n = Number(initialBuy);
		if (isNaN(n) || n < 0) errors.initialBuy = 'Initial buy must be a non-negative number';
	}
	return { ok: Object.keys(errors).length === 0, errors };
}

export function handleLaunchSubmit(fields, onSubmit) {
	const result = validateLaunchForm(fields);
	if (!result.ok) return result;
	onSubmit(fields);
	return { ok: true };
}

// ── Utilities ───────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function toSymbol(name) {
	return (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'AGENT';
}

function shortenAddr(addr) {
	if (!addr || addr.length < 10) return addr || '';
	return addr.slice(0, 4) + '…' + addr.slice(-4);
}

function detectWallet() {
	if (typeof window === 'undefined') return null;
	return window.phantom?.solana || window.solana || window.backpack || window.solflare || null;
}

function fileToDataUrl(file) {
	return new Promise((res, rej) => {
		const reader = new FileReader();
		reader.onload = (e) => res(e.target.result);
		reader.onerror = rej;
		reader.readAsDataURL(file);
	});
}

function friendlyError(msg) {
	const m = String(msg || '');
	if (/user rejected|rejected the request/i.test(m)) return 'Wallet signing cancelled.';
	if (/0x1\b/.test(m) || /insufficient.*sol/i.test(m) || /insufficient lamports/i.test(m))
		return 'Transaction failed — not enough SOL for fees and rent. Fund your wallet and try again.';
	if (/wallet.*not.*found|no.*wallet.*detected/i.test(m))
		return 'No Solana wallet detected. Install Phantom or Backpack.';
	return m;
}

// pump.fun create fee + mint account rent (estimate; actual may vary slightly)
const PUMP_BASE_COST_SOL = 0.022;

// ── CSS ─────────────────────────────────────────────────────────────────────

const LP_STYLES = `
.lp { display: flex; flex-direction: column; gap: 0.9rem; }
.lp-empty { text-align: center; padding: 2.5rem 1rem; color: rgba(255,255,255,0.3);
  font-size: 0.85rem; line-height: 1.7; }
.lp-empty a { color: rgba(164,240,188,0.7); text-decoration: none; }
.lp-empty a:hover { color: #a4f0bc; }

/* Token card — image + name/symbol */
.lp-card {
  display: flex; gap: 0.8rem; align-items: flex-start;
  padding: 0.85rem; border-radius: 12px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  transition: border-color 0.2s;
}
.lp-card:focus-within { border-color: rgba(255,255,255,0.14); }

/* Image drop zone */
.lp-img-zone {
  flex-shrink: 0; width: 78px; height: 78px; border-radius: 11px;
  border: 2px dashed rgba(255,255,255,0.14); cursor: pointer;
  overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.03); position: relative; transition: all 0.2s;
}
.lp-img-zone:hover, .lp-img-zone.dragover { border-color: rgba(164,240,188,0.5); background: rgba(164,240,188,0.05); }
.lp-img-zone img { width: 100%; height: 100%; object-fit: cover; border-radius: 9px; }
.lp-img-ph { font-size: 0.62rem; color: rgba(255,255,255,0.28); text-align: center; line-height: 1.5; padding: 0.25rem; pointer-events: none; }
.lp-img-file { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }

/* Name + symbol inline in card */
.lp-card-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.35rem; padding-top: 0.1rem; }
.lp-iname {
  width: 100%; font-size: 0.97rem; font-weight: 600;
  background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.09);
  color: #fff; padding: 0 0 0.28rem; outline: none; transition: border-color 0.15s;
}
.lp-iname:focus { border-bottom-color: rgba(255,255,255,0.28); }
.lp-iname::placeholder { color: rgba(255,255,255,0.2); font-weight: 400; }
.lp-isymbol {
  width: 100%; font-size: 0.8rem; background: transparent; border: none;
  color: #a4f0bc; padding: 0; outline: none;
  font-family: ui-monospace, monospace; letter-spacing: 0.05em;
}
.lp-isymbol::placeholder { color: rgba(164,240,188,0.28); }
.lp-img-hint { font-size: 0.6rem; color: rgba(255,255,255,0.2); margin-top: 0.3rem; }

/* Standard fields */
.lp label { font-size: 0.72rem; color: rgba(255,255,255,0.4); display: block; margin-bottom: 0.22rem; }
.lp textarea, .lp-number {
  width: 100%; padding: 0.5rem 0.7rem; border-radius: 8px; outline: none;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: #fff; font-size: 0.85rem; font-family: inherit; box-sizing: border-box;
  transition: border-color 0.15s;
}
.lp textarea { resize: vertical; }
.lp textarea:focus, .lp-number:focus { border-color: rgba(255,255,255,0.2); }
.lp-number::-webkit-inner-spin-button { opacity: 0.4; }

/* Two-column row */
.lp-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }

/* Buyback slider */
.lp-slider-head { display: flex; justify-content: space-between; align-items: baseline; }
.lp-bps-val { font-size: 0.78rem; color: #a4f0bc; font-weight: 500; }
.lp-slider { width: 100%; accent-color: #a4f0bc; margin-top: 0.4rem; cursor: pointer; }
.lp-slider-hint { font-size: 0.62rem; color: rgba(255,255,255,0.22); margin-top: 0.18rem; }

/* Wallet bar */
.lp-wallet {
  display: flex; align-items: center; gap: 0.55rem; padding: 0.58rem 0.8rem;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px; font-size: 0.78rem;
}
.lp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; transition: background 0.3s; }
.lp-dot.on  { background: #a4f0bc; box-shadow: 0 0 6px rgba(164,240,188,0.45); }
.lp-dot.off { background: rgba(255,255,255,0.18); }
.lp-wallet-info { flex: 1; min-width: 0; }
.lp-wallet-addr { color: rgba(255,255,255,0.75); }
.lp-wallet-bal  { color: rgba(255,255,255,0.42); margin-left: 0.4rem; font-size: 0.73rem; }
.lp-wallet-cost { display: block; font-size: 0.69rem; margin-top: 0.1rem; }
.lp-wallet-cost.ok   { color: #a4f0bc; }
.lp-wallet-cost.warn { color: #f6b3b3; }
.lp-wallet-cost.dim  { color: rgba(255,255,255,0.3); }
.lp-wallet-none { flex: 1; color: rgba(255,255,255,0.32); }
.lp-wbtn {
  padding: 0.28rem 0.65rem; border-radius: 6px; cursor: pointer; flex-shrink: 0;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.78); font-size: 0.72rem; white-space: nowrap;
  transition: background 0.15s;
}
.lp-wbtn:hover { background: rgba(255,255,255,0.13); }
.lp-wbtn.ghost { opacity: 0.4; font-size: 0.65rem; }

/* Launch button */
.lp-launch {
  width: 100%; padding: 0.8rem 1rem; border-radius: 10px; cursor: pointer;
  background: linear-gradient(135deg, rgba(120,200,140,0.22), rgba(60,140,100,0.14));
  border: 1px solid rgba(120,200,140,0.42); color: #c6f0d6;
  font-size: 0.94rem; font-weight: 600; letter-spacing: -0.01em;
  transition: all 0.15s; line-height: 1;
}
.lp-launch:hover:not([disabled]) {
  background: linear-gradient(135deg, rgba(120,200,140,0.33), rgba(60,140,100,0.22));
  border-color: rgba(120,200,140,0.65); color: #d8f5e2;
}
.lp-launch[disabled] { opacity: 0.38; cursor: not-allowed; }
.lp-launch.busy  { opacity: 0.72; cursor: wait; }
.lp-phase { font-size: 0.7rem; color: rgba(255,255,255,0.35); text-align: center; min-height: 1.1em; margin-top: 0.15rem; }
.lp-err {
  font-size: 0.78rem; color: #f6b3b3; padding: 0.55rem 0.75rem; line-height: 1.5;
  border-radius: 8px; background: rgba(246,179,179,0.07); border: 1px solid rgba(246,179,179,0.18);
}
.lp-err-retry { margin-top: 0.35rem; font-size: 0.72rem; color: rgba(255,255,255,0.35); }

/* ── Success state ─────────────────────────────────── */
.lp-ok { display: flex; flex-direction: column; align-items: center; gap: 0.85rem; text-align: center; }
.lp-ok-thumb { width: 82px; height: 82px; border-radius: 50%; object-fit: cover;
  border: 2px solid rgba(164,240,188,0.4); }
.lp-ok-thumb-ph { width: 82px; height: 82px; border-radius: 50%;
  background: rgba(164,240,188,0.08); border: 2px solid rgba(164,240,188,0.2);
  display: flex; align-items: center; justify-content: center; font-size: 2.2rem; }
.lp-ok-title { font-size: 1.3rem; font-weight: 700; color: #a4f0bc; letter-spacing: -0.02em; margin: 0; }
.lp-ok-sub   { font-size: 0.78rem; color: rgba(255,255,255,0.38); margin: -0.45rem 0 0; }
.lp-ok-mint {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem;
  background: rgba(255,255,255,0.04); border-radius: 8px; width: 100%;
  font-family: ui-monospace, monospace; font-size: 0.75rem; color: rgba(255,255,255,0.6);
}
.lp-ok-mint span { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lp-copy { padding: 0.2rem 0.5rem; border-radius: 5px; cursor: pointer; flex-shrink: 0;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.65); font-size: 0.7rem; white-space: nowrap; }
.lp-copy:hover { background: rgba(255,255,255,0.15); }
.lp-ok-links { display: flex; gap: 0.45rem; justify-content: center; flex-wrap: wrap; width: 100%; }
.lp-ext { padding: 0.38rem 0.7rem; border-radius: 7px; font-size: 0.78rem; text-decoration: none;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.78); transition: all 0.15s; }
.lp-ext:hover { background: rgba(255,255,255,0.11); color: #fff; }
.lp-share { width: 100%; padding: 0.55rem 0.9rem; border-radius: 8px; cursor: pointer;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.65); font-size: 0.8rem; }
.lp-share:hover { background: rgba(255,255,255,0.09); color: rgba(255,255,255,0.92); }
.lp-again { width: 100%; padding: 0.42rem; border-radius: 7px; cursor: pointer;
  background: transparent; border: 1px solid rgba(255,255,255,0.07);
  color: rgba(255,255,255,0.32); font-size: 0.77rem; }
.lp-again:hover { color: rgba(255,255,255,0.62); border-color: rgba(255,255,255,0.16); }
`;

let _stylesInjected = false;
function injectStyles() {
	if (_stylesInjected || typeof document === 'undefined') return;
	_stylesInjected = true;
	const el = document.createElement('style');
	el.textContent = LP_STYLES;
	document.head.appendChild(el);
}

// ── Mount ────────────────────────────────────────────────────────────────────

const DEMO_ID = '__demo__';

export function mountLaunchPanel(container, { getAvatar, getUser } = {}) {
	injectStyles();

	let av = null; // current avatar object

	// All mutable UI + launch state in one flat object
	let s = {
		// form (seeded from avatar on mount / avatar change)
		name: '',
		symbol: '',
		description: '',
		initialBuy: '0',
		buybackBps: 500,
		imageFile: null,
		imagePreviewUrl: null, // data URL of custom image; falls back to av.thumbnail_url
		_symbolEdited: false,  // user manually typed a symbol

		// wallet
		walletAddr: null,
		solBalance: null,

		// launch state machine
		phase: 'idle', // idle | building | signing | confirming | success | error
		phaseLabel: '',
		errorMsg: '',

		// results
		mint: null,
		resolvedAgentId: null,

		// metadata cache
		_metaUrl: null,
		_metaKey: null, // `name|symbol|description` the cached URL was built for
	};

	// ── Helpers ────────────────────────────────────────────────────────────

	function estimatedCost() {
		return PUMP_BASE_COST_SOL + Math.max(0, parseFloat(s.initialBuy) || 0);
	}

	function formValid() {
		return s.name.trim() && s.symbol.trim() && s.description.trim();
	}

	// ── Wallet ─────────────────────────────────────────────────────────────

	async function tryAutoConnect() {
		const w = detectWallet();
		if (!w?.isConnected || !w.publicKey) return;
		const addr = w.publicKey.toBase58?.() || w.publicKey.toString?.();
		if (addr && addr !== s.walletAddr) {
			s.walletAddr = addr;
			render();
			fetchBalance(addr);
		}
	}

	async function connectWallet() {
		let w = detectWallet();
		if (!w) { window.open('https://phantom.app/', '_blank', 'noopener'); return; }
		try {
			if (!w.isConnected) await w.connect?.();
			const addr = w.publicKey?.toBase58?.() || w.publicKey?.toString?.();
			if (!addr) return;
			s.walletAddr = addr;
			render();
			fetchBalance(addr);
		} catch { /* user dismissed */ }
	}

	async function fetchBalance(addr) {
		try {
			const { Connection, PublicKey } = await import('https://esm.sh/@solana/web3.js@1.98.4');
			const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
			s.solBalance = (await conn.getBalance(new PublicKey(addr))) / 1e9;
		} catch {
			s.solBalance = null;
		}
		render();
	}

	function disconnectWallet() {
		s.walletAddr = null;
		s.solBalance = null;
		render();
	}

	// ── Image ──────────────────────────────────────────────────────────────

	function handleImageFile(file) {
		if (!file?.type.startsWith('image/')) return;
		if (file.size > 4 * 1024 * 1024) { alert('Image must be under 4 MB'); return; }
		s.imageFile = file;
		const reader = new FileReader();
		reader.onload = (e) => {
			s.imagePreviewUrl = e.target.result;
			// Update img zone in-place without full re-render
			const zone = container.querySelector('.lp-img-zone');
			if (zone) {
				const old = zone.querySelector('img, .lp-img-ph');
				if (old) old.remove();
				const img = document.createElement('img');
				img.src = s.imagePreviewUrl;
				img.alt = '';
				zone.insertBefore(img, zone.firstChild);
			}
		};
		reader.readAsDataURL(file);
	}

	// ── Launch ─────────────────────────────────────────────────────────────

	async function launch() {
		if (!formValid() || !s.walletAddr || s.phase !== 'idle') return;
		if (!av || av.id === DEMO_ID) return;

		s.errorMsg = '';

		try {
			// 1. Build / reuse metadata
			s.phase = 'building';
			s.phaseLabel = 'Uploading metadata…';
			render();

			const nameTrim = s.name.trim();
			const symTrim  = s.symbol.trim();
			const descTrim = s.description.trim();
			const metaKey  = `${nameTrim}|${symTrim}|${descTrim}|${!!s.imageFile}`;

			if (s._metaKey !== metaKey || !s._metaUrl) {
				let imageDataUrl = null;
				if (s.imageFile) imageDataUrl = await fileToDataUrl(s.imageFile);

				const mr = await fetch('/api/pump/build-metadata', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						name: nameTrim, symbol: symTrim, description: descTrim,
						...(av.id        ? { avatar_id: av.id }       : {}),
						...(av.agent_id  ? { agent_id: av.agent_id }  : {}),
						...(imageDataUrl ? { image_data_url: imageDataUrl } : {}),
					}),
				});
				if (!mr.ok) throw new Error(`Metadata build failed (${mr.status})`);
				const md = await mr.json();
				s._metaUrl = md.metadata_url;
				s._metaKey = metaKey;
			}

			// 2. Prep transaction (wallet must sign)
			s.phase = 'signing';
			s.phaseLabel = 'Sign in your wallet…';
			render();

			const w = detectWallet();
			if (!w) throw new Error('No Solana wallet detected. Install Phantom or Backpack.');
			if (!w.isConnected) await w.connect?.();
			const payer = w.publicKey?.toBase58?.() || w.publicKey?.toString?.();
			if (!payer) throw new Error('Could not read wallet public key.');

			const pr = await fetch('/api/pump/launch-prep', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					...(av.agent_id ? { agent_id: av.agent_id } : { avatar_id: av.id }),
					wallet_address: payer,
					name: nameTrim, symbol: symTrim, uri: s._metaUrl,
					buyback_bps: s.buybackBps,
					sol_buy_in: Math.max(0, parseFloat(s.initialBuy) || 0),
					network: 'mainnet',
				}),
			});
			const prep = await pr.json();
			if (prep.error) throw new Error(prep.error_description || prep.error);
			s.resolvedAgentId = prep.agent_id;

			// 3. Deserialize, co-sign mint keypair, send to wallet
			const { VersionedTransaction, Keypair, Connection } =
				await import('https://esm.sh/@solana/web3.js@1.98.4');

			const tx = VersionedTransaction.deserialize(
				Uint8Array.from(atob(prep.tx_base64), (c) => c.charCodeAt(0)),
			);
			if (prep.mint_secret_key_b64) {
				const mintKp = Keypair.fromSecretKey(
					Uint8Array.from(atob(prep.mint_secret_key_b64), (c) => c.charCodeAt(0)),
				);
				tx.sign([mintKp]);
			}
			const signed = await w.signTransaction(tx);

			// 4. Send + confirm
			s.phase = 'confirming';
			s.phaseLabel = 'Confirming on-chain…';
			render();

			const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
			const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
			await conn.confirmTransaction(sig, 'confirmed');

			const cr = await fetch('/api/pump/launch-confirm', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ prep_id: prep.prep_id, tx_signature: sig }),
			});
			const confirmed = await cr.json();
			if (confirmed.error) throw new Error(confirmed.error_description || confirmed.error);

			s.mint  = prep.mint;
			s.phase = 'success';
			render();

		} catch (e) {
			s.errorMsg = friendlyError(e.message || String(e));
			s.phase = 'error';
			render();
		}
	}

	// ── Render ─────────────────────────────────────────────────────────────

	function render() {
		if (!av || av.id === DEMO_ID) { renderEmpty(); return; }
		if (s.phase === 'success')    { renderSuccess(); return; }
		renderForm();
	}

	function renderEmpty() {
		container.innerHTML = `
			<div class="lp">
				<div class="lp-empty">
					Select one of your own avatars from the left panel<br>to launch a token.
					<br><br>
					<a href="/dashboard/avatars" target="_blank" rel="noopener">Upload an avatar →</a>
				</div>
			</div>`;
	}

	function renderForm() {
		const busy = s.phase !== 'idle' && s.phase !== 'error';
		const dis  = busy ? 'disabled' : '';

		// Wallet bar
		const w = detectWallet();
		const cost = estimatedCost();
		let walletHtml;
		if (!w) {
			walletHtml = `
				<div class="lp-wallet">
					<div class="lp-dot off"></div>
					<span class="lp-wallet-none">No Solana wallet found</span>
					<button class="lp-wbtn" id="lp-install">Install Phantom ↗</button>
				</div>`;
		} else if (!s.walletAddr) {
			walletHtml = `
				<div class="lp-wallet">
					<div class="lp-dot off"></div>
					<span class="lp-wallet-none">Wallet not connected</span>
					<button class="lp-wbtn" id="lp-connect">Connect</button>
				</div>`;
		} else {
			const hasEnough = s.solBalance !== null && s.solBalance >= cost;
			const costCls   = s.solBalance === null ? 'dim' : hasEnough ? 'ok' : 'warn';
			const costTxt   = s.solBalance === null
				? `Est. cost ~${cost.toFixed(3)} SOL`
				: hasEnough
					? `~${cost.toFixed(3)} SOL required · ${s.solBalance.toFixed(3)} available ✓`
					: `Need ~${cost.toFixed(3)} SOL · ${s.solBalance.toFixed(3)} in wallet`;
			walletHtml = `
				<div class="lp-wallet">
					<div class="lp-dot on"></div>
					<div class="lp-wallet-info">
						<span class="lp-wallet-addr">${shortenAddr(s.walletAddr)}</span>
						${s.solBalance !== null ? `<span class="lp-wallet-bal">${s.solBalance.toFixed(3)} SOL</span>` : ''}
						<span class="lp-wallet-cost ${costCls}">${costTxt}</span>
					</div>
					<button class="lp-wbtn ghost" id="lp-disc" title="Disconnect">✕</button>
				</div>`;
		}

		// Launch button
		let btnText, btnDis;
		if (busy) {
			btnText = s.phaseLabel || 'Working…'; btnDis = true;
		} else if (!formValid()) {
			btnText = 'Fill in name, symbol &amp; description'; btnDis = true;
		} else if (!s.walletAddr) {
			btnText = 'Connect wallet to launch'; btnDis = true;
		} else {
			btnText = `Launch $${esc(s.symbol.trim() || 'TOKEN')}`; btnDis = false;
		}

		// Image preview
		const imgSrc = s.imagePreviewUrl || av?.thumbnail_url;

		container.innerHTML = `
			<div class="lp">
				<div class="lp-card">
					<div class="lp-img-zone" id="lp-zone">
						${imgSrc ? `<img src="${esc(imgSrc)}" alt="" />` : `<div class="lp-img-ph">Drop image<br>or click</div>`}
						<input type="file" class="lp-img-file" id="lp-img" accept="image/*" ${dis} />
					</div>
					<div class="lp-card-fields">
						<input class="lp-iname" id="lp-name" type="text" maxlength="32"
							placeholder="Token name" value="${esc(s.name)}" ${dis} />
						<input class="lp-isymbol" id="lp-sym" type="text" maxlength="10"
							placeholder="SYMBOL" value="${esc(s.symbol)}" ${dis} />
						<div class="lp-img-hint">Click image to replace · drag &amp; drop</div>
					</div>
				</div>

				<div>
					<label for="lp-desc">Description</label>
					<textarea id="lp-desc" rows="3" maxlength="500"
						placeholder="What does this agent do?" ${dis}>${esc(s.description)}</textarea>
				</div>

				<div class="lp-2col">
					<div>
						<label for="lp-buy">Initial buy (SOL)</label>
						<input class="lp-number" id="lp-buy" type="number"
							min="0" max="50" step="0.001" value="${esc(s.initialBuy)}" ${dis} />
					</div>
					<div>
						<div class="lp-slider-head">
							<label>Buyback share</label>
							<span class="lp-bps-val" id="lp-bps-val">${(s.buybackBps / 100).toFixed(1)}%</span>
						</div>
						<input type="range" class="lp-slider" id="lp-bps"
							min="0" max="5000" step="50" value="${s.buybackBps}" ${dis} />
						<div class="lp-slider-hint">Of agent revenue burned back</div>
					</div>
				</div>

				${walletHtml}

				${s.phase === 'error' ? `
					<div class="lp-err">${esc(s.errorMsg)}
						<div class="lp-err-retry">Fix the issue above and try again.</div>
					</div>` : ''}

				<button class="lp-launch${busy ? ' busy' : ''}" id="lp-go" ${btnDis ? 'disabled' : ''}>
					${btnText}
				</button>
				${busy ? `<div class="lp-phase">${esc(s.phaseLabel)}</div>` : ''}
			</div>`;

		wireForm();
	}

	function renderSuccess() {
		const imgSrc    = s.imagePreviewUrl || av?.thumbnail_url;
		const mint      = s.mint || '';
		const mintShort = mint ? mint.slice(0, 6) + '…' + mint.slice(-6) : '';
		const sym       = s.symbol.trim() || 'TOKEN';
		const pumpUrl   = `https://pump.fun/coin/${mint}`;
		const scanUrl   = `https://solscan.io/token/${mint}`;
		const agentUrl  = s.resolvedAgentId ? `/agent/${s.resolvedAgentId}` : null;
		const shareText = `Just launched $${sym} on pump.fun 🎉 Built with three.ws\n${pumpUrl}`;

		container.innerHTML = `
			<div class="lp">
				<div class="lp-ok">
					${imgSrc
						? `<img class="lp-ok-thumb" src="${esc(imgSrc)}" alt="" />`
						: `<div class="lp-ok-thumb-ph">🪙</div>`}
					<p class="lp-ok-title">$${esc(sym)} is live!</p>
					<p class="lp-ok-sub">Your token is live on pump.fun</p>

					<div class="lp-ok-mint">
						<span title="${esc(mint)}">${mintShort}</span>
						<button class="lp-copy" id="lp-copy-mint">Copy</button>
					</div>

					<div class="lp-ok-links">
						<a class="lp-ext" href="${esc(pumpUrl)}" target="_blank" rel="noopener">pump.fun ↗</a>
						<a class="lp-ext" href="${esc(scanUrl)}"  target="_blank" rel="noopener">Solscan ↗</a>
						${agentUrl ? `<a class="lp-ext" href="${esc(agentUrl)}">Agent page ↗</a>` : ''}
					</div>

					<button class="lp-share" id="lp-share">📋 Copy launch announcement</button>
					<button class="lp-again" id="lp-again">Launch another token</button>
				</div>
			</div>`;

		function copyBtn(id, text, resetText) {
			container.querySelector(id)?.addEventListener('click', (e) => {
				navigator.clipboard?.writeText(text).catch(() => {});
				const btn = e.currentTarget;
				const orig = btn.textContent;
				btn.textContent = resetText;
				setTimeout(() => { btn.textContent = orig; }, 1800);
			});
		}
		copyBtn('#lp-copy-mint', mint, 'Copied!');
		copyBtn('#lp-share', shareText, '✓ Copied to clipboard');

		container.querySelector('#lp-again')?.addEventListener('click', () => {
			s.phase = 'idle'; s.mint = null; s.errorMsg = '';
			s.imageFile = null; s.imagePreviewUrl = null;
			s._metaUrl = null; s._metaKey = null;
			render();
		});
	}

	function wireForm() {
		const q = (sel) => container.querySelector(sel);

		// Image
		q('#lp-zone')?.addEventListener('dragover', (e) => {
			e.preventDefault(); q('#lp-zone')?.classList.add('dragover');
		});
		q('#lp-zone')?.addEventListener('dragleave', () => q('#lp-zone')?.classList.remove('dragover'));
		q('#lp-zone')?.addEventListener('drop', (e) => {
			e.preventDefault(); q('#lp-zone')?.classList.remove('dragover');
			handleImageFile(e.dataTransfer?.files?.[0]);
		});
		q('#lp-img')?.addEventListener('change', (e) => handleImageFile(e.target.files?.[0]));

		// Name → auto-derive symbol
		q('#lp-name')?.addEventListener('input', (e) => {
			s.name = e.target.value;
			if (!s._symbolEdited) {
				s.symbol = toSymbol(s.name);
				const symEl = q('#lp-sym');
				if (symEl) symEl.value = s.symbol;
			}
		});

		// Symbol (force uppercase/alphanumeric)
		q('#lp-sym')?.addEventListener('input', (e) => {
			const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
			e.target.value = raw;
			s.symbol = raw;
			s._symbolEdited = true;
		});

		q('#lp-desc')?.addEventListener('input', (e) => { s.description = e.target.value; });

		// Initial buy — update cost display inline without full re-render
		q('#lp-buy')?.addEventListener('input', (e) => {
			s.initialBuy = e.target.value;
			const costEl = container.querySelector('.lp-wallet-cost');
			if (!costEl || !s.walletAddr) return;
			const cost = estimatedCost();
			const ok   = s.solBalance !== null && s.solBalance >= cost;
			costEl.className = `lp-wallet-cost ${s.solBalance === null ? 'dim' : ok ? 'ok' : 'warn'}`;
			costEl.textContent = s.solBalance === null
				? `Est. cost ~${cost.toFixed(3)} SOL`
				: ok
					? `~${cost.toFixed(3)} SOL required · ${s.solBalance.toFixed(3)} available ✓`
					: `Need ~${cost.toFixed(3)} SOL · ${s.solBalance.toFixed(3)} in wallet`;
		});

		// Buyback slider — update value label inline
		q('#lp-bps')?.addEventListener('input', (e) => {
			s.buybackBps = parseInt(e.target.value, 10);
			const v = q('#lp-bps-val');
			if (v) v.textContent = `${(s.buybackBps / 100).toFixed(1)}%`;
		});

		// Wallet
		q('#lp-install')?.addEventListener('click', () => window.open('https://phantom.app/', '_blank', 'noopener'));
		q('#lp-connect')?.addEventListener('click', connectWallet);
		q('#lp-disc')?.addEventListener('click', disconnectWallet);

		// Launch
		q('#lp-go')?.addEventListener('click', launch);
	}

	// ── Public API ──────────────────────────────────────────────────────────

	function avatarChanged() {
		av = getAvatar?.() || null;
		if (av && av.id !== DEMO_ID) {
			if (!s.name)                s.name        = av.name || '';
			if (!s._symbolEdited)       s.symbol      = toSymbol(s.name);
			if (!s.description)         s.description = av.description || '';
		}
		// Invalidate metadata cache on avatar change
		s._metaUrl = null; s._metaKey = null;
		render();
	}

	// ── Boot ────────────────────────────────────────────────────────────────

	av = getAvatar?.() || null;
	if (av && av.id !== DEMO_ID) {
		s.name        = av.name || '';
		s.symbol      = toSymbol(s.name);
		s.description = av.description || '';
	}

	render();
	setTimeout(tryAutoConnect, 250); // check for already-connected wallet

	return { avatarChanged, teardown() { container.innerHTML = ''; } };
}
