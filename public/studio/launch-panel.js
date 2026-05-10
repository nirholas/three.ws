// Launch panel — self-contained token launch experience for /studio.
// Handles: existing-token check, wallet events + balance auto-refresh,
// metadata upload, on-chain signing, confirmation polling with timeout
// escape hatch, and success display.
//
// Exported pure functions (tested):
//   validateLaunchForm(fields)   → { ok, errors }
//   handleLaunchSubmit(f, cb)    → { ok, errors? }
//
// DOM entry:
//   mountLaunchPanel(el, { getAvatar, getUser }) → { avatarChanged, teardown }

// ── Pure validation ─────────────────────────────────────────────────────────

export function validateLaunchForm({ name, symbol, description, initialBuy } = {}) {
	const errors = {};
	if (!name?.trim())        errors.name        = 'Token name is required';
	if (!symbol?.trim())      errors.symbol      = 'Symbol is required';
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

// ── Utilities ────────────────────────────────────────────────────────────────

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

const toSymbol = (name) =>
	(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'AGENT';

const shortenAddr = (a) => (!a || a.length < 10 ? a || '' : a.slice(0, 4) + '…' + a.slice(-4));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detectWallet() {
	if (typeof window === 'undefined') return null;
	return window.phantom?.solana || window.solana || window.backpack || window.solflare || null;
}

function fileToDataUrl(file) {
	return new Promise((res, rej) => {
		const reader = new FileReader();
		reader.onload  = (e) => res(e.target.result);
		reader.onerror = rej;
		reader.readAsDataURL(file);
	});
}

function friendlyError(msg) {
	const m = String(msg || '');
	if (/user rejected|rejected the request/i.test(m)) return 'Wallet signing cancelled.';
	if (/0x1\b/.test(m) || /insufficient.*lamports|insufficient.*sol/i.test(m))
		return 'Not enough SOL — fund your wallet and try again.';
	if (/wallet.*not.*found|no.*wallet/i.test(m))
		return 'No Solana wallet detected. Install Phantom or Backpack.';
	if (/429|rate.limit/i.test(m)) return 'Too many requests — wait a moment and try again.';
	return m;
}

const PUMP_BASE_COST = 0.022; // pump.fun fee + mint rent (estimate)
const SOLSCAN = (sig, net = 'mainnet') =>
	`https://solscan.io/tx/${sig}${net === 'devnet' ? '?cluster=devnet' : ''}`;
const PUMP_URL = (mint) => `https://pump.fun/coin/${mint}`;

// ── CSS ──────────────────────────────────────────────────────────────────────

const LP_CSS = `
.lp{display:flex;flex-direction:column;gap:.9rem}
.lp-empty{text-align:center;padding:2.5rem 1rem;color:rgba(255,255,255,.3);font-size:.85rem;line-height:1.7}
.lp-empty a{color:rgba(164,240,188,.7);text-decoration:none}
.lp-empty a:hover{color:#a4f0bc}

/* Existing-token card */
.lp-existing{display:flex;flex-direction:column;gap:.75rem}
.lp-ex-head{display:flex;align-items:center;gap:.55rem;font-size:.72rem;color:#a4f0bc;font-weight:500;letter-spacing:.03em}
.lp-ex-dot{width:7px;height:7px;border-radius:50%;background:#a4f0bc;box-shadow:0 0 6px rgba(164,240,188,.45)}
.lp-ex-card{display:flex;gap:.75rem;align-items:center;padding:.85rem;border-radius:12px;
  background:rgba(164,240,188,.04);border:1px solid rgba(164,240,188,.14)}
.lp-ex-thumb{width:52px;height:52px;border-radius:9px;object-fit:cover;flex-shrink:0;
  border:1px solid rgba(164,240,188,.2)}
.lp-ex-thumb-ph{width:52px;height:52px;border-radius:9px;background:rgba(164,240,188,.08);
  display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0}
.lp-ex-info{flex:1;min-width:0}
.lp-ex-sym{font-size:1rem;font-weight:700;color:#fff;letter-spacing:-.01em}
.lp-ex-name{font-size:.75rem;color:rgba(255,255,255,.45);margin-top:.08rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-ex-since{font-size:.65rem;color:rgba(255,255,255,.3);margin-top:.3rem}
.lp-ex-stats{display:grid;grid-template-columns:1fr 1fr;gap:.4rem}
.lp-ex-stat{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;
  padding:.45rem .6rem}
.lp-ex-stat-n{font-size:.92rem;font-weight:600;color:#fff}
.lp-ex-stat-l{font-size:.62rem;color:rgba(255,255,255,.4);margin-top:.05rem}
.lp-ex-mint{display:flex;align-items:center;gap:.5rem;padding:.45rem .65rem;border-radius:8px;
  background:rgba(255,255,255,.03);font-family:ui-monospace,monospace;font-size:.73rem;color:rgba(255,255,255,.55)}
.lp-ex-mint span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-ex-links{display:flex;gap:.45rem;flex-wrap:wrap}
.lp-ex-link{padding:.36rem .65rem;border-radius:7px;font-size:.77rem;text-decoration:none;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.75);transition:all .15s}
.lp-ex-link:hover{background:rgba(255,255,255,.1);color:#fff}
.lp-ex-new{width:100%;padding:.42rem;border-radius:7px;cursor:pointer;background:transparent;
  border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.32);font-size:.77rem}
.lp-ex-new:hover{color:rgba(255,255,255,.62);border-color:rgba(255,255,255,.16)}

/* Checking spinner */
.lp-checking{display:flex;align-items:center;gap:.55rem;padding:.65rem .75rem;border-radius:10px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);
  font-size:.78rem;color:rgba(255,255,255,.38)}
@keyframes lp-spin{to{transform:rotate(360deg)}}
.lp-spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.12);border-top-color:rgba(255,255,255,.5);
  border-radius:50%;animation:lp-spin .8s linear infinite;flex-shrink:0}

/* Launch form token card */
.lp-card{display:flex;gap:.8rem;align-items:flex-start;padding:.85rem;border-radius:12px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);transition:border-color .2s}
.lp-card:focus-within{border-color:rgba(255,255,255,.14)}
.lp-img-zone{flex-shrink:0;width:78px;height:78px;border-radius:11px;border:2px dashed rgba(255,255,255,.14);
  cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.03);position:relative;transition:all .2s}
.lp-img-zone:hover,.lp-img-zone.dragover{border-color:rgba(164,240,188,.5);background:rgba(164,240,188,.05)}
.lp-img-zone img{width:100%;height:100%;object-fit:cover;border-radius:9px}
.lp-img-ph{font-size:.62rem;color:rgba(255,255,255,.28);text-align:center;line-height:1.5;padding:.25rem;pointer-events:none}
.lp-img-file{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.lp-card-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:.35rem;padding-top:.1rem}
.lp-iname{width:100%;font-size:.97rem;font-weight:600;background:transparent;border:none;
  border-bottom:1px solid rgba(255,255,255,.09);color:#fff;padding:0 0 .28rem;outline:none;transition:border-color .15s}
.lp-iname:focus{border-bottom-color:rgba(255,255,255,.28)}
.lp-iname::placeholder{color:rgba(255,255,255,.2);font-weight:400}
.lp-isymbol{width:100%;font-size:.8rem;background:transparent;border:none;color:#a4f0bc;
  padding:0;outline:none;font-family:ui-monospace,monospace;letter-spacing:.05em}
.lp-isymbol::placeholder{color:rgba(164,240,188,.28)}
.lp-img-hint{font-size:.6rem;color:rgba(255,255,255,.2);margin-top:.3rem}

.lp label{font-size:.72rem;color:rgba(255,255,255,.4);display:block;margin-bottom:.22rem}
.lp textarea,.lp-number{width:100%;padding:.5rem .7rem;border-radius:8px;outline:none;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
  color:#fff;font-size:.85rem;font-family:inherit;box-sizing:border-box;transition:border-color .15s}
.lp textarea{resize:vertical}
.lp textarea:focus,.lp-number:focus{border-color:rgba(255,255,255,.2)}
.lp-number::-webkit-inner-spin-button{opacity:.4}
.lp-2col{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.lp-slider-head{display:flex;justify-content:space-between;align-items:baseline}
.lp-bps-val{font-size:.78rem;color:#a4f0bc;font-weight:500}
.lp-slider{width:100%;accent-color:#a4f0bc;margin-top:.4rem;cursor:pointer}
.lp-slider-hint{font-size:.62rem;color:rgba(255,255,255,.22);margin-top:.18rem}

/* Wallet bar */
.lp-wallet{display:flex;align-items:center;gap:.55rem;padding:.58rem .8rem;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;font-size:.78rem}
.lp-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:background .3s}
.lp-dot.on{background:#a4f0bc;box-shadow:0 0 6px rgba(164,240,188,.45)}
.lp-dot.off{background:rgba(255,255,255,.18)}
.lp-wallet-info{flex:1;min-width:0}
.lp-wallet-addr{color:rgba(255,255,255,.75)}
.lp-wallet-bal{color:rgba(255,255,255,.42);margin-left:.4rem;font-size:.73rem}
.lp-wallet-cost{display:block;font-size:.69rem;margin-top:.1rem}
.lp-wallet-cost.ok{color:#a4f0bc}
.lp-wallet-cost.warn{color:#f6b3b3}
.lp-wallet-cost.dim{color:rgba(255,255,255,.3)}
.lp-wallet-none{flex:1;color:rgba(255,255,255,.32)}
.lp-wbtn{padding:.28rem .65rem;border-radius:6px;cursor:pointer;flex-shrink:0;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.78);font-size:.72rem;white-space:nowrap;transition:background .15s}
.lp-wbtn:hover{background:rgba(255,255,255,.13)}
.lp-wbtn.ghost{opacity:.4;font-size:.65rem}

/* Launch button */
.lp-launch{width:100%;padding:.8rem 1rem;border-radius:10px;cursor:pointer;
  background:linear-gradient(135deg,rgba(120,200,140,.22),rgba(60,140,100,.14));
  border:1px solid rgba(120,200,140,.42);color:#c6f0d6;
  font-size:.94rem;font-weight:600;letter-spacing:-.01em;transition:all .15s;line-height:1}
.lp-launch:hover:not([disabled]){background:linear-gradient(135deg,rgba(120,200,140,.33),rgba(60,140,100,.22));
  border-color:rgba(120,200,140,.65);color:#d8f5e2}
.lp-launch[disabled]{opacity:.38;cursor:not-allowed}
.lp-launch.busy{opacity:.72;cursor:wait}
.lp-phase{font-size:.7rem;color:rgba(255,255,255,.35);text-align:center;min-height:1.1em;margin-top:.15rem}
.lp-err{font-size:.78rem;color:#f6b3b3;padding:.55rem .75rem;line-height:1.5;
  border-radius:8px;background:rgba(246,179,179,.07);border:1px solid rgba(246,179,179,.18)}
.lp-err-sub{font-size:.7rem;color:rgba(255,255,255,.3);margin-top:.3rem}

/* Confirmation timeout escape hatch */
.lp-timeout{display:flex;flex-direction:column;gap:.7rem;padding:.85rem;border-radius:12px;
  background:rgba(246,200,100,.05);border:1px solid rgba(246,200,100,.18)}
.lp-timeout-title{font-size:.85rem;font-weight:600;color:rgba(246,220,130,.9)}
.lp-timeout-body{font-size:.78rem;color:rgba(255,255,255,.55);line-height:1.55}
.lp-timeout-sig{font-family:ui-monospace,monospace;font-size:.7rem;color:rgba(255,255,255,.4);
  word-break:break-all;padding:.4rem .55rem;background:rgba(255,255,255,.04);border-radius:6px}
.lp-timeout-btns{display:flex;gap:.5rem;flex-wrap:wrap}
.lp-tbtn{padding:.42rem .8rem;border-radius:8px;cursor:pointer;font-size:.8rem;transition:all .15s}
.lp-tbtn.primary{background:rgba(164,240,188,.14);border:1px solid rgba(164,240,188,.3);color:#c8f0d8}
.lp-tbtn.primary:hover{background:rgba(164,240,188,.22)}
.lp-tbtn.ghost{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6)}
.lp-tbtn.ghost:hover{background:rgba(255,255,255,.1)}

/* Success */
.lp-ok{display:flex;flex-direction:column;align-items:center;gap:.85rem;text-align:center}
.lp-ok-thumb{width:82px;height:82px;border-radius:50%;object-fit:cover;border:2px solid rgba(164,240,188,.4)}
.lp-ok-thumb-ph{width:82px;height:82px;border-radius:50%;background:rgba(164,240,188,.08);
  border:2px solid rgba(164,240,188,.2);display:flex;align-items:center;justify-content:center;font-size:2.2rem}
.lp-ok-title{font-size:1.3rem;font-weight:700;color:#a4f0bc;letter-spacing:-.02em;margin:0}
.lp-ok-sub{font-size:.78rem;color:rgba(255,255,255,.38);margin:-.45rem 0 0}
.lp-ok-mint{display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;
  background:rgba(255,255,255,.04);border-radius:8px;width:100%;
  font-family:ui-monospace,monospace;font-size:.75rem;color:rgba(255,255,255,.6)}
.lp-ok-mint span{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-copy{padding:.2rem .5rem;border-radius:5px;cursor:pointer;flex-shrink:0;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);
  color:rgba(255,255,255,.65);font-size:.7rem;white-space:nowrap}
.lp-copy:hover{background:rgba(255,255,255,.15)}
.lp-ok-links{display:flex;gap:.45rem;justify-content:center;flex-wrap:wrap;width:100%}
.lp-ext{padding:.38rem .7rem;border-radius:7px;font-size:.78rem;text-decoration:none;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.78);transition:all .15s}
.lp-ext:hover{background:rgba(255,255,255,.11);color:#fff}
.lp-share{width:100%;padding:.55rem .9rem;border-radius:8px;cursor:pointer;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.65);font-size:.8rem}
.lp-share:hover{background:rgba(255,255,255,.09);color:rgba(255,255,255,.92)}
.lp-again{width:100%;padding:.42rem;border-radius:7px;cursor:pointer;background:transparent;
  border:1px solid rgba(255,255,255,.07);color:rgba(255,255,255,.32);font-size:.77rem}
.lp-again:hover{color:rgba(255,255,255,.62);border-color:rgba(255,255,255,.16)}
`;

let _cssInjected = false;
function injectCss() {
	if (_cssInjected || typeof document === 'undefined') return;
	_cssInjected = true;
	const el = document.createElement('style');
	el.textContent = LP_CSS;
	document.head.appendChild(el);
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const DEMO_ID = '__demo__';

export function mountLaunchPanel(container, { getAvatar, getUser } = {}) {
	injectCss();

	let av = null;

	// ── State ──────────────────────────────────────────────────────────────

	let s = {
		// form
		name: '', symbol: '', description: '',
		initialBuy: '0', buybackBps: 500,
		imageFile: null, imagePreviewUrl: null,
		_symbolEdited: false,

		// wallet
		walletAddr: null, solBalance: null,

		// existing token (checked on avatar change)
		checkingMint: false,
		existingMint: null,   // { mint, name, symbol, network, metadata_uri, stats, burns }
		forceNew: false,      // user clicked "launch another token" despite existing

		// launch phases: idle | building | signing | confirming | confirm-timeout | success | error
		phase: 'idle', phaseLabel: '',
		errorMsg: '',

		// success
		mint: null, resolvedAgentId: null,

		// timeout escape hatch
		pendingConfirm: null, // { prepId, sig, network }

		// metadata cache
		_metaUrl: null, _metaKey: null,
	};

	// ── Cleanup registry ───────────────────────────────────────────────────

	let _balanceInterval = null;
	const _walletListeners = []; // [{ wallet, event, fn }]

	function cleanup() {
		if (_balanceInterval) { clearInterval(_balanceInterval); _balanceInterval = null; }
		for (const { wallet, event, fn } of _walletListeners) {
			try { wallet.off?.(event, fn); } catch { /* ignore */ }
		}
		_walletListeners.length = 0;
	}

	// ── Existing token check ───────────────────────────────────────────────

	async function checkExistingMint(avatar) {
		if (!avatar || avatar.id === DEMO_ID) { s.existingMint = null; s.checkingMint = false; return; }
		s.checkingMint = true;
		render();
		try {
			const param = avatar.agent_id
				? `agent_id=${encodeURIComponent(avatar.agent_id)}`
				: `avatar_id=${encodeURIComponent(avatar.id)}`;
			const res = await fetch(`/api/pump/by-agent?${param}`, { credentials: 'include' });
			if (res.ok) {
				const { data } = await res.json();
				s.existingMint = data || null;
			}
		} catch { /* best-effort */ }
		s.checkingMint = false;
		render();
	}

	// ── Wallet management ──────────────────────────────────────────────────

	function subscribeWalletEvents(wallet) {
		if (!wallet?.on) return;

		const onAccountsChanged = (accounts) => {
			const acc  = Array.isArray(accounts) ? accounts[0] : accounts;
			const addr = acc?.toBase58?.() || (typeof acc === 'string' ? acc : null);
			if (!addr) { disconnectWallet(); return; }
			if (addr === s.walletAddr) return;
			s.walletAddr = addr;
			s.solBalance = null;
			render();
			fetchBalance(addr);
		};

		const onDisconnect = () => disconnectWallet();

		wallet.on('accountsChanged', onAccountsChanged);
		wallet.on('disconnect',       onDisconnect);
		_walletListeners.push(
			{ wallet, event: 'accountsChanged', fn: onAccountsChanged },
			{ wallet, event: 'disconnect',      fn: onDisconnect },
		);
	}

	async function tryAutoConnect() {
		const w = detectWallet();
		if (!w?.isConnected || !w.publicKey) return;
		const addr = w.publicKey.toBase58?.() || w.publicKey.toString?.();
		if (!addr || addr === s.walletAddr) return;
		s.walletAddr = addr;
		render();
		subscribeWalletEvents(w);
		startBalancePoll(addr);
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
			subscribeWalletEvents(w);
			startBalancePoll(addr);
		} catch { /* user dismissed */ }
	}

	function disconnectWallet() {
		s.walletAddr = null; s.solBalance = null;
		if (_balanceInterval) { clearInterval(_balanceInterval); _balanceInterval = null; }
		render();
	}

	async function fetchBalance(addr) {
		try {
			const { Connection, PublicKey } = await import('https://esm.sh/@solana/web3.js@1.98.4');
			const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
			s.solBalance = (await conn.getBalance(new PublicKey(addr))) / 1e9;
		} catch { s.solBalance = null; }
		render();
	}

	function startBalancePoll(addr) {
		if (_balanceInterval) clearInterval(_balanceInterval);
		fetchBalance(addr);
		_balanceInterval = setInterval(() => { if (s.walletAddr) fetchBalance(s.walletAddr); }, 30_000);
	}

	// ── Image handling ─────────────────────────────────────────────────────

	function handleImageFile(file) {
		if (!file?.type.startsWith('image/')) return;
		if (file.size > 4 * 1024 * 1024) { alert('Image must be under 4 MB'); return; }
		s.imageFile = file;
		const reader = new FileReader();
		reader.onload = (e) => {
			s.imagePreviewUrl = e.target.result;
			const zone = container.querySelector('.lp-img-zone');
			if (!zone) return;
			const old = zone.querySelector('img, .lp-img-ph');
			if (old) old.remove();
			const img = document.createElement('img');
			img.src = s.imagePreviewUrl; img.alt = '';
			zone.insertBefore(img, zone.firstChild);
		};
		reader.readAsDataURL(file);
	}

	// ── Confirmation polling with timeout ──────────────────────────────────

	async function pollConfirmation(conn, sig, timeoutMs = 75_000) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
			const status = value?.[0];
			if (status) {
				if (status.err) throw new Error(`On-chain error: ${JSON.stringify(status.err)}`);
				if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')
					return status;
			}
			await sleep(2000);
		}
		const err = new Error('Confirmation timeout — your transaction may still confirm.');
		err.code = 'CONFIRM_TIMEOUT';
		throw err;
	}

	// ── Launch ─────────────────────────────────────────────────────────────

	async function launch() {
		if (!formValid() || !s.walletAddr || s.phase !== 'idle') return;
		if (!av || av.id === DEMO_ID) return;
		s.errorMsg = '';

		try {
			// 1 ── Build / reuse metadata
			s.phase = 'building'; s.phaseLabel = 'Uploading metadata…'; render();

			const nameTrim = s.name.trim(), symTrim = s.symbol.trim(), descTrim = s.description.trim();
			const metaKey = `${nameTrim}|${symTrim}|${descTrim}|${!!s.imageFile}`;

			if (s._metaKey !== metaKey || !s._metaUrl) {
				let imageDataUrl = null;
				if (s.imageFile) imageDataUrl = await fileToDataUrl(s.imageFile);
				const mr = await fetch('/api/pump/build-metadata', {
					method: 'POST', credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: nameTrim, symbol: symTrim, description: descTrim,
						...(av.id       ? { avatar_id: av.id }      : {}),
						...(av.agent_id ? { agent_id: av.agent_id } : {}),
						...(imageDataUrl ? { image_data_url: imageDataUrl } : {}),
					}),
				});
				if (!mr.ok) throw new Error(`Metadata build failed (${mr.status})`);
				const md = await mr.json();
				s._metaUrl = md.metadata_url; s._metaKey = metaKey;
			}

			// 2 ── Prep transaction
			s.phase = 'signing'; s.phaseLabel = 'Sign in your wallet…'; render();

			const w = detectWallet();
			if (!w) throw new Error('No Solana wallet detected. Install Phantom or Backpack.');
			if (!w.isConnected) await w.connect?.();
			const payer = w.publicKey?.toBase58?.() || w.publicKey?.toString?.();
			if (!payer) throw new Error('Could not read wallet public key.');

			const pr = await fetch('/api/pump/launch-prep', {
				method: 'POST', credentials: 'include',
				headers: { 'content-type': 'application/json' },
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

			// 3 ── Sign
			const { VersionedTransaction, Keypair, Connection } =
				await import('https://esm.sh/@solana/web3.js@1.98.4');
			const tx = VersionedTransaction.deserialize(
				Uint8Array.from(atob(prep.tx_base64), (c) => c.charCodeAt(0)),
			);
			if (prep.mint_secret_key_b64) {
				tx.sign([Keypair.fromSecretKey(
					Uint8Array.from(atob(prep.mint_secret_key_b64), (c) => c.charCodeAt(0)),
				)]);
			}
			const signed = await w.signTransaction(tx);

			// 4 ── Send + poll confirmation (75s timeout)
			s.phase = 'confirming'; s.phaseLabel = 'Confirming on-chain…'; render();

			const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
			const sig  = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });

			try {
				await pollConfirmation(conn, sig);
			} catch (confErr) {
				if (confErr.code === 'CONFIRM_TIMEOUT') {
					s.phase = 'confirm-timeout';
					s.pendingConfirm = { prepId: prep.prep_id, sig, network: 'mainnet' };
					render(); return;
				}
				throw confErr;
			}

			await finalizeConfirm(prep.prep_id, sig);

		} catch (e) {
			s.errorMsg = friendlyError(e.message || String(e));
			s.phase = 'error'; render();
		}
	}

	// Called after confirmed on-chain (normal path or escape-hatch path)
	async function finalizeConfirm(prepId, sig) {
		const cr = await fetch('/api/pump/launch-confirm', {
			method: 'POST', credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prep_id: prepId, tx_signature: sig }),
		});
		const confirmed = await cr.json();
		if (confirmed.error) throw new Error(confirmed.error_description || confirmed.error);

		// Extract mint from what we already know (stored in pendingConfirm or parent scope)
		// The server echoes pump_agent_mint which has the mint address
		const mintAddr = confirmed.pump_agent_mint?.mint || s.pendingConfirm?.mint || null;
		if (mintAddr) s.mint = mintAddr;
		s.phase = 'success'; s.pendingConfirm = null;
		render();
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	const estimatedCost = () => PUMP_BASE_COST + Math.max(0, parseFloat(s.initialBuy) || 0);
	const formValid     = () => s.name.trim() && s.symbol.trim() && s.description.trim();

	// ── Render ─────────────────────────────────────────────────────────────

	function render() {
		if (!av || av.id === DEMO_ID)         { renderEmpty();    return; }
		if (s.checkingMint)                   { renderChecking(); return; }
		if (s.existingMint && !s.forceNew)    { renderExisting(); return; }
		if (s.phase === 'success')            { renderSuccess();  return; }
		if (s.phase === 'confirm-timeout')    { renderTimeout();  return; }
		renderForm();
	}

	function renderEmpty() {
		container.innerHTML = `<div class="lp">
			<div class="lp-empty">Select one of your own avatars from the left panel to launch a token.<br><br>
				<a href="/dashboard/avatars" target="_blank" rel="noopener">Upload an avatar →</a>
			</div></div>`;
	}

	function renderChecking() {
		container.innerHTML = `<div class="lp">
			<div class="lp-checking"><div class="lp-spin"></div>Checking for existing token…</div>
		</div>`;
	}

	function renderExisting() {
		const m   = s.existingMint;
		const st  = m.stats  || {};
		const thumbSrc = av?.thumbnail_url;
		const since = m.created_at
			? new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
			: '';
		const payments = st.confirmed_payments || 0;
		const payers   = st.unique_payers || 0;
		const mintShort = m.mint ? m.mint.slice(0, 6) + '…' + m.mint.slice(-6) : '';

		container.innerHTML = `<div class="lp"><div class="lp-existing">
			<div class="lp-ex-head"><div class="lp-ex-dot"></div>Token already launched</div>
			<div class="lp-ex-card">
				${thumbSrc
					? `<img class="lp-ex-thumb" src="${esc(thumbSrc)}" alt="" />`
					: `<div class="lp-ex-thumb-ph">🪙</div>`}
				<div class="lp-ex-info">
					<div class="lp-ex-sym">$${esc(m.symbol || '')}</div>
					<div class="lp-ex-name">${esc(m.name || '')}</div>
					${since ? `<div class="lp-ex-since">Launched ${since}</div>` : ''}
				</div>
			</div>
			${(payments > 0 || payers > 0) ? `
			<div class="lp-ex-stats">
				<div class="lp-ex-stat">
					<div class="lp-ex-stat-n">${payments}</div>
					<div class="lp-ex-stat-l">Payments received</div>
				</div>
				<div class="lp-ex-stat">
					<div class="lp-ex-stat-n">${payers}</div>
					<div class="lp-ex-stat-l">Unique payers</div>
				</div>
			</div>` : ''}
			<div class="lp-ex-mint">
				<span title="${esc(m.mint || '')}">${mintShort}</span>
				<button class="lp-copy" id="lp-ex-copy">Copy</button>
			</div>
			<div class="lp-ex-links">
				<a class="lp-ex-link" href="${esc(PUMP_URL(m.mint))}" target="_blank" rel="noopener">pump.fun ↗</a>
				<a class="lp-ex-link" href="https://solscan.io/token/${esc(m.mint)}" target="_blank" rel="noopener">Solscan ↗</a>
				${s.resolvedAgentId || av?.agent_id
					? `<a class="lp-ex-link" href="/agent/${esc(s.resolvedAgentId || av.agent_id)}">Agent page ↗</a>`
					: ''}
			</div>
			<button class="lp-ex-new" id="lp-force-new">Launch a new token for this avatar</button>
		</div></div>`;

		container.querySelector('#lp-ex-copy')?.addEventListener('click', (e) => {
			navigator.clipboard?.writeText(m.mint || '').catch(() => {});
			e.currentTarget.textContent = 'Copied!';
			setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 1500);
		});
		container.querySelector('#lp-force-new')?.addEventListener('click', () => {
			s.forceNew = true; render();
		});
	}

	function renderTimeout() {
		const pc = s.pendingConfirm || {};
		const solscanUrl = pc.sig ? SOLSCAN(pc.sig, pc.network) : null;
		container.innerHTML = `<div class="lp"><div class="lp-timeout">
			<div class="lp-timeout-title">⏱ Taking longer than expected</div>
			<div class="lp-timeout-body">
				Your transaction was sent and may confirm shortly — Solana sometimes takes a few minutes during peak load.
				Check Solscan to see the status, then click <strong>Finalize</strong> once it confirms.
			</div>
			${pc.sig ? `<div class="lp-timeout-sig">${esc(pc.sig)}</div>` : ''}
			<div class="lp-timeout-btns">
				${solscanUrl ? `<a class="lp-tbtn ghost" href="${esc(solscanUrl)}" target="_blank" rel="noopener">View on Solscan ↗</a>` : ''}
				<button class="lp-tbtn primary" id="lp-finalize">Finalize once confirmed</button>
				<button class="lp-tbtn ghost" id="lp-restart">Start over</button>
			</div>
		</div></div>`;

		container.querySelector('#lp-finalize')?.addEventListener('click', async () => {
			const btn = container.querySelector('#lp-finalize');
			if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
			try {
				if (!s.pendingConfirm) return;
				// One more on-chain check before finalizing
				const { Connection } = await import('https://esm.sh/@solana/web3.js@1.98.4');
				const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
				const { value } = await conn.getSignatureStatuses([s.pendingConfirm.sig], { searchTransactionHistory: true });
				const st = value?.[0];
				if (!st) {
					if (btn) { btn.disabled = false; btn.textContent = 'Finalize once confirmed'; }
					const note = container.querySelector('.lp-timeout-body');
					if (note) note.textContent = 'Not confirmed yet — check Solscan and try again in a moment.';
					return;
				}
				if (st.err) throw new Error(`On-chain error: ${JSON.stringify(st.err)}`);
				await finalizeConfirm(s.pendingConfirm.prepId, s.pendingConfirm.sig);
			} catch (e) {
				s.errorMsg = friendlyError(e.message || String(e));
				s.phase = 'error'; s.pendingConfirm = null; render();
			}
		});

		container.querySelector('#lp-restart')?.addEventListener('click', () => {
			s.phase = 'idle'; s.pendingConfirm = null; s.errorMsg = ''; render();
		});
	}

	function renderForm() {
		const busy = s.phase !== 'idle' && s.phase !== 'error';
		const dis  = busy ? 'disabled' : '';
		const w    = detectWallet();
		const cost = estimatedCost();

		let walletHtml;
		if (!w) {
			walletHtml = `<div class="lp-wallet">
				<div class="lp-dot off"></div>
				<span class="lp-wallet-none">No Solana wallet found</span>
				<button class="lp-wbtn" id="lp-install">Install Phantom ↗</button>
			</div>`;
		} else if (!s.walletAddr) {
			walletHtml = `<div class="lp-wallet">
				<div class="lp-dot off"></div>
				<span class="lp-wallet-none">Wallet not connected</span>
				<button class="lp-wbtn" id="lp-connect">Connect</button>
			</div>`;
		} else {
			const hasEnough = s.solBalance !== null && s.solBalance >= cost;
			const cls       = s.solBalance === null ? 'dim' : hasEnough ? 'ok' : 'warn';
			const costTxt   = s.solBalance === null
				? `Est. cost ~${cost.toFixed(3)} SOL`
				: hasEnough
					? `~${cost.toFixed(3)} SOL required · ${s.solBalance.toFixed(3)} available ✓`
					: `Need ~${cost.toFixed(3)} SOL · ${s.solBalance.toFixed(3)} in wallet`;
			walletHtml = `<div class="lp-wallet">
				<div class="lp-dot on"></div>
				<div class="lp-wallet-info">
					<span class="lp-wallet-addr">${shortenAddr(s.walletAddr)}</span>
					${s.solBalance !== null ? `<span class="lp-wallet-bal">${s.solBalance.toFixed(3)} SOL</span>` : ''}
					<span class="lp-wallet-cost ${cls}">${costTxt}</span>
				</div>
				<button class="lp-wbtn ghost" id="lp-disc" title="Disconnect">✕</button>
			</div>`;
		}

		let btnText, btnDis;
		if (busy)            { btnText = s.phaseLabel || 'Working…'; btnDis = true; }
		else if (!formValid()) { btnText = 'Fill in name, symbol &amp; description'; btnDis = true; }
		else if (!s.walletAddr){ btnText = 'Connect wallet to launch'; btnDis = true; }
		else                  { btnText = `Launch $${esc(s.symbol.trim() || 'TOKEN')}`; btnDis = false; }

		const imgSrc = s.imagePreviewUrl || av?.thumbnail_url;

		container.innerHTML = `<div class="lp">
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
					<input class="lp-number" id="lp-buy" type="number" min="0" max="50" step="0.001"
						value="${esc(s.initialBuy)}" ${dis} />
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
			${s.phase === 'error' ? `<div class="lp-err">${esc(s.errorMsg)}<div class="lp-err-sub">Fix the issue above and try again.</div></div>` : ''}
			<button class="lp-launch${busy ? ' busy' : ''}" id="lp-go" ${btnDis ? 'disabled' : ''}>${btnText}</button>
			${busy ? `<div class="lp-phase">${esc(s.phaseLabel)}</div>` : ''}
		</div>`;

		wireForm();
	}

	function renderSuccess() {
		const imgSrc   = s.imagePreviewUrl || av?.thumbnail_url;
		const mint     = s.mint || '';
		const mintShort = mint ? mint.slice(0, 6) + '…' + mint.slice(-6) : '';
		const sym      = s.symbol.trim() || 'TOKEN';
		const agentId  = s.resolvedAgentId || av?.agent_id;
		const shareText = `Just launched $${sym} on pump.fun 🎉 Built with three.ws\n${PUMP_URL(mint)}`;

		container.innerHTML = `<div class="lp"><div class="lp-ok">
			${imgSrc ? `<img class="lp-ok-thumb" src="${esc(imgSrc)}" alt="" />` : `<div class="lp-ok-thumb-ph">🪙</div>`}
			<p class="lp-ok-title">$${esc(sym)} is live!</p>
			<p class="lp-ok-sub">Your token is live on pump.fun</p>
			<div class="lp-ok-mint">
				<span title="${esc(mint)}">${mintShort}</span>
				<button class="lp-copy" id="lp-copy-mint">Copy</button>
			</div>
			<div class="lp-ok-links">
				<a class="lp-ext" href="${esc(PUMP_URL(mint))}" target="_blank" rel="noopener">pump.fun ↗</a>
				<a class="lp-ext" href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener">Solscan ↗</a>
				${agentId ? `<a class="lp-ext" href="/agent/${esc(agentId)}">Agent page ↗</a>` : ''}
			</div>
			<button class="lp-share" id="lp-share">📋 Copy launch announcement</button>
			<button class="lp-again" id="lp-again">Launch another token</button>
		</div></div>`;

		const copyBtn = (id, text) => {
			container.querySelector(id)?.addEventListener('click', (e) => {
				navigator.clipboard?.writeText(text).catch(() => {});
				const btn = e.currentTarget, orig = btn.textContent;
				btn.textContent = '✓ Copied';
				setTimeout(() => { btn.textContent = orig; }, 1800);
			});
		};
		copyBtn('#lp-copy-mint', mint);
		copyBtn('#lp-share', shareText);
		container.querySelector('#lp-again')?.addEventListener('click', () => {
			s.phase = 'idle'; s.mint = null; s.errorMsg = '';
			s.imageFile = null; s.imagePreviewUrl = null;
			s._metaUrl = null; s._metaKey = null;
			s.existingMint = null; s.forceNew = false;
			render();
		});
	}

	function wireForm() {
		const q = (sel) => container.querySelector(sel);

		q('#lp-zone')?.addEventListener('dragover',  (e) => { e.preventDefault(); q('#lp-zone')?.classList.add('dragover'); });
		q('#lp-zone')?.addEventListener('dragleave', ()  => q('#lp-zone')?.classList.remove('dragover'));
		q('#lp-zone')?.addEventListener('drop',      (e) => { e.preventDefault(); q('#lp-zone')?.classList.remove('dragover'); handleImageFile(e.dataTransfer?.files?.[0]); });
		q('#lp-img')?.addEventListener('change', (e) => handleImageFile(e.target.files?.[0]));

		q('#lp-name')?.addEventListener('input', (e) => {
			s.name = e.target.value;
			if (!s._symbolEdited) {
				s.symbol = toSymbol(s.name);
				const se = q('#lp-sym'); if (se) se.value = s.symbol;
			}
		});
		q('#lp-sym')?.addEventListener('input', (e) => {
			const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
			e.target.value = raw; s.symbol = raw; s._symbolEdited = true;
		});
		q('#lp-desc')?.addEventListener('input', (e) => { s.description = e.target.value; });

		q('#lp-buy')?.addEventListener('input', (e) => {
			s.initialBuy = e.target.value;
			const ce = container.querySelector('.lp-wallet-cost');
			if (!ce || !s.walletAddr) return;
			const cost = estimatedCost(), ok = s.solBalance !== null && s.solBalance >= cost;
			ce.className = `lp-wallet-cost ${s.solBalance === null ? 'dim' : ok ? 'ok' : 'warn'}`;
			ce.textContent = s.solBalance === null
				? `Est. cost ~${cost.toFixed(3)} SOL`
				: ok
					? `~${cost.toFixed(3)} SOL required · ${s.solBalance.toFixed(3)} available ✓`
					: `Need ~${cost.toFixed(3)} SOL · ${s.solBalance.toFixed(3)} in wallet`;
		});
		q('#lp-bps')?.addEventListener('input', (e) => {
			s.buybackBps = parseInt(e.target.value, 10);
			const v = q('#lp-bps-val'); if (v) v.textContent = `${(s.buybackBps / 100).toFixed(1)}%`;
		});

		q('#lp-install')?.addEventListener('click', () => window.open('https://phantom.app/', '_blank', 'noopener'));
		q('#lp-connect')?.addEventListener('click', connectWallet);
		q('#lp-disc')?.addEventListener('click', disconnectWallet);
		q('#lp-go')?.addEventListener('click', launch);
	}

	// ── Public API ──────────────────────────────────────────────────────────

	function avatarChanged() {
		av = getAvatar?.() || null;
		s.forceNew = false;
		s._metaUrl = null; s._metaKey = null;

		if (av && av.id !== DEMO_ID) {
			if (!s.name)           s.name        = av.name        || '';
			if (!s._symbolEdited)  s.symbol      = toSymbol(s.name);
			if (!s.description)    s.description = av.description || '';
		}

		checkExistingMint(av); // async — updates state and re-renders when done
	}

	// ── Boot ────────────────────────────────────────────────────────────────

	av = getAvatar?.() || null;
	if (av && av.id !== DEMO_ID) {
		s.name        = av.name        || '';
		s.symbol      = toSymbol(s.name);
		s.description = av.description || '';
	}

	render();
	setTimeout(tryAutoConnect, 250);
	if (av && av.id !== DEMO_ID) checkExistingMint(av);

	return {
		avatarChanged,
		teardown() { cleanup(); container.innerHTML = ''; },
	};
}
