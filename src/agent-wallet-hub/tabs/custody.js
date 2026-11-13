/**
 * Agent Wallet hub: Custody tab (owner-only).
 *
 * Three things the owner controls about who holds and uses the agent's key:
 *
 *   1. Signing mode (GET/PUT /api/agents/:id/signer, DELETE .../signer/session):
 *      platform (the server signs within policy), external (the owner's own
 *      wallet signs every fund-moving transaction) or session (a delegated key
 *      with an on-chain spend cap and expiry the owner grants from their wallet).
 *   2. Key export (POST /api/agents/:id/wallet/export/{challenge,grant,rotate}):
 *      re-authentication, then a sealed key that only this page can open, then
 *      re-encrypted to a passphrase typed here. The plaintext key and the
 *      passphrase never leave the browser. "Rotate after export" previews and
 *      then sweeps every balance to a fresh platform key.
 *   3. Balance history (GET /api/agents/:id/wallet/history): the hourly snapshot
 *      series the balance-snapshot cron writes, drawn as one line.
 */

import { registerWalletTab } from '../registry.js';
import { consumeCsrfToken } from '../../api.js';
import { injectStyle as injectBaseStyle } from './withdraw.js';
import { injectedProvider } from '../../launch/launch-wallet.js';
import { beginKeyExport, openSealedKey, encryptKeyToPassphrase, passphraseProblem, MIN_PASSPHRASE_LENGTH } from '../../wallet/export.js';
import { explorerTxUrl, formatUsd } from '../util.js';

const STYLE_ID = 'awh-custody-style';
const STYLE = `
#awh-panel-custody { display: flex; flex-direction: column; gap: var(--awh-gap, 16px); }
.awh-cu-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:var(--space-3,12px); }
.awh-cu-head h3 { margin:0; font-size:var(--text-md,.8125rem); color:var(--ink-bright,#fff); }
.awh-cu-modes { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:0 0 var(--space-3,12px); }
.awh-cu-mode { text-align:left; border:1px solid var(--stroke,rgba(255,255,255,.1)); background:var(--surface-2,rgba(255,255,255,.04)); color:var(--ink,#e8e8e8); border-radius:var(--radius-md,10px); padding:10px 12px; cursor:pointer; font:inherit; transition:border-color 120ms, background 120ms, transform 80ms; }
.awh-cu-mode:hover:not(:disabled) { border-color:var(--ink-dim,#888); background:var(--surface-3,rgba(255,255,255,.08)); }
.awh-cu-mode:active:not(:disabled) { transform:translateY(1px); }
.awh-cu-mode:focus-visible { outline:var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset:var(--focus-ring-offset,2px); }
.awh-cu-mode[aria-pressed="true"] { border-color:var(--success,#4ade80); background:color-mix(in srgb,var(--success,#4ade80) 10%,transparent); }
.awh-cu-mode:disabled { opacity:.55; cursor:default; }
.awh-cu-mode b { display:block; color:var(--ink-bright,#fff); font-size:var(--text-md,.8125rem); margin-bottom:2px; }
.awh-cu-mode span { font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); line-height:1.4; }
.awh-cu-info { font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); margin:0 0 var(--space-3,12px); line-height:1.5; }
.awh-cu-kv { display:grid; grid-template-columns:max-content 1fr; gap:6px 14px; font-size:var(--text-sm,.764rem); margin:0 0 var(--space-3,12px); }
.awh-cu-kv dt { color:var(--ink-dim,#888); }
.awh-cu-kv dd { margin:0; color:var(--ink,#e8e8e8); overflow-wrap:anywhere; font-family:var(--font-mono,ui-monospace,monospace); }
.awh-cu-meter { height:8px; border-radius:99px; background:var(--surface-2,rgba(255,255,255,.08)); overflow:hidden; margin:6px 0 12px; }
.awh-cu-meter > i { display:block; height:100%; background:var(--success,#4ade80); }
.awh-cu-meter.warn > i { background:var(--warn,#fbbf24); }
.awh-cu-acts { display:flex; gap:8px; flex-wrap:wrap; }
.awh-cu-ranges { display:flex; gap:6px; }
.awh-cu-ranges button { border:1px solid var(--stroke,rgba(255,255,255,.1)); background:transparent; color:var(--ink,#e8e8e8); border-radius:var(--radius-pill,999px); padding:4px 12px; font:inherit; font-size:var(--text-sm,.764rem); cursor:pointer; transition:background 120ms, border-color 120ms; }
.awh-cu-ranges button:hover { background:var(--surface-2,rgba(255,255,255,.08)); }
.awh-cu-ranges button:active { transform:translateY(1px); }
.awh-cu-ranges button:focus-visible { outline:var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset:2px; }
.awh-cu-ranges button[aria-pressed="true"] { border-color:var(--success,#4ade80); color:var(--ink-bright,#fff); }
.awh-cu-stats { display:flex; gap:20px; flex-wrap:wrap; margin:0 0 8px; font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); }
.awh-cu-stats strong { display:block; font-size:var(--text-lg,1rem); color:var(--ink-bright,#fff); font-weight:600; }
.awh-cu-chart { position:relative; width:100%; touch-action:pan-y; }
.awh-cu-chart svg { display:block; width:100%; height:auto; overflow:visible; }
.awh-cu-chart .ax { stroke:var(--stroke,rgba(255,255,255,.12)); stroke-width:1; }
.awh-cu-chart .ln { fill:none; stroke:var(--success,#4ade80); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
.awh-cu-chart .gd { stroke:var(--stroke,rgba(255,255,255,.08)); stroke-width:1; stroke-dasharray:2 4; }
.awh-cu-chart .tx { fill:var(--ink-dim,#888); font-size:10px; }
.awh-cu-chart .cr { stroke:var(--ink-dim,#888); stroke-dasharray:3 3; }
.awh-cu-chart .dt { fill:var(--success,#4ade80); stroke:var(--surface-1,#111); stroke-width:2; }
.awh-cu-read { min-height:1.4em; font-size:var(--text-sm,.764rem); color:var(--ink,#e8e8e8); margin-top:6px; }
.awh-cu-empty { text-align:center; padding:var(--space-5,20px) var(--space-3,12px); color:var(--ink-dim,#888); font-size:var(--text-sm,.764rem); }
.awh-cu-empty strong { display:block; color:var(--ink,#e8e8e8); font-size:var(--text-md,.8125rem); margin-bottom:4px; }
.awh-cu-modal { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,.6); }
.awh-cu-dlg { width:min(480px,100%); max-height:calc(100dvh - 32px); overflow:auto; background:var(--bg-1,#1a1a1a); box-shadow:0 18px 48px rgba(0,0,0,.45); border:1px solid var(--stroke,rgba(255,255,255,.12)); border-radius:var(--radius-lg,14px); padding:20px; color:var(--ink,#e8e8e8); }
.awh-cu-dlg h3 { margin:0 0 8px; color:var(--ink-bright,#fff); font-size:var(--text-lg,1rem); }
.awh-cu-dlg label { display:block; font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); margin:12px 0 5px; }
.awh-cu-dlg textarea { width:100%; min-height:130px; resize:vertical; font-family:var(--font-mono,ui-monospace,monospace); font-size:11px; box-sizing:border-box; }
.awh-cu-warn { border:1px solid color-mix(in srgb,var(--warn,#fbbf24) 40%,transparent); background:color-mix(in srgb,var(--warn,#fbbf24) 8%,transparent); border-radius:var(--radius-md,10px); padding:10px 12px; font-size:var(--text-sm,.764rem); line-height:1.5; margin:8px 0; }
.awh-cu-foot { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:16px; }
@media (max-width:560px) { .awh-cu-modes { grid-template-columns:1fr; } }
@media (prefers-reduced-motion: reduce) { .awh-cu-mode, .awh-cu-ranges button { transition:none; } }
`;

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}

async function call(url, { method = 'GET', body = null } = {}) {
	try {
		const opts = { method, credentials: 'include', headers: {} };
		if (body != null) {
			opts.headers['content-type'] = 'application/json';
			opts.body = JSON.stringify(body);
		}
		if (method !== 'GET') {
			const token = await consumeCsrfToken();
			if (token) opts.headers['x-csrf-token'] = token;
		}
		const r = await fetch(url, opts);
		let j = null;
		try { j = await r.json(); } catch { /* empty body */ }
		if (!r.ok) return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `Request failed (${r.status}).` };
		return { ok: true, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'Network error. Check your connection and retry.' };
	}
}

function b64FromBytes(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

function bytesFromB64(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Connect the injected wallet and return its address. */
async function connectOwnerWallet() {
	const provider = injectedProvider();
	if (!provider) throw new Error('No Solana wallet found in this browser. Install Phantom, Backpack or Solflare, then retry.');
	let resp;
	try {
		resp = await provider.connect();
	} catch {
		throw new Error('The wallet connection was cancelled.');
	}
	const address = (resp?.publicKey || provider.publicKey)?.toString();
	if (!address) throw new Error('Could not read the wallet address.');
	return { provider, address };
}

/** Sign a prepared base64 transaction with the owner's wallet. Returns base64 of the signed bytes. */
async function signPrepared(provider, address, transactionB64) {
	const { VersionedTransaction } = await import('@solana/web3.js');
	if (provider.publicKey && provider.publicKey.toString() !== address) throw new Error('The connected wallet changed. Reconnect the wallet that signs for this agent.');
	const tx = VersionedTransaction.deserialize(bytesFromB64(transactionB64));
	let signed;
	try {
		signed = await provider.signTransaction(tx);
	} catch {
		throw new Error('The signature request was rejected in the wallet. Nothing was sent.');
	}
	return b64FromBytes(signed.serialize());
}

const MODE_COPY = {
	platform: { title: 'Platform', body: 'The server signs within your spend policy. Needed for unattended agents.' },
	external: { title: 'My wallet', body: 'Every fund-moving transaction waits for your wallet signature. The platform never signs.' },
	session: { title: 'Session key', body: 'A delegated key with an on-chain spend cap and expiry. The agent acts alone inside the cap.' },
};

function fmtAmount(n) {
	if (n == null || !Number.isFinite(Number(n))) return 'n/a';
	return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

registerWalletTab({
	id: 'custody',
	label: 'Custody',
	order: 58,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectBaseStyle();
		injectStyle();
		const esc = ctx.escapeHtml;
		const agentBase = `/api/agents/${encodeURIComponent(ctx.agentId)}`;
		let destroyed = false;
		let modal = null;

		const state = {
			signer: null,       // null while loading | { error } | payload
			signerBusy: false,
			signerErr: null,
			hist: null,         // null while loading | { error } | payload
			range: '24h',
			histNetwork: ctx.getNetwork(),
		};

		/* ---------- modal with focus trap ---------- */

		function closeModal() {
			if (!modal) return;
			modal.opener?.focus?.();
			modal.el.remove();
			document.removeEventListener('keydown', modal.onKey, true);
			modal = null;
		}

		function openModal(html, { label }) {
			closeModal();
			const el = document.createElement('div');
			el.className = 'awh-cu-modal';
			el.innerHTML = `<div class="awh-cu-dlg" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">${html}</div>`;
			const dlg = el.firstElementChild;
			const onKey = (ev) => {
				if (ev.key === 'Escape') { ev.stopPropagation(); closeModal(); return; }
				if (ev.key !== 'Tab') return;
				const items = [...dlg.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
				if (!items.length) { ev.preventDefault(); return; }
				const first = items[0];
				const last = items[items.length - 1];
				if (ev.shiftKey && (document.activeElement === first || document.activeElement === dlg)) { ev.preventDefault(); last.focus(); }
				else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
			};
			el.addEventListener('mousedown', (ev) => { if (ev.target === el) closeModal(); });
			document.addEventListener('keydown', onKey, true);
			modal = { el, dlg, onKey, opener: document.activeElement };
			document.body.appendChild(el);
			return dlg;
		}

		function setDialog(dlg, html) {
			dlg.innerHTML = html;
			(dlg.querySelector('[autofocus],input,select,textarea,button') || dlg).focus();
		}

		/* ---------- signer card ---------- */

		async function loadSigner() {
			const res = await call(`${agentBase}/signer`);
			if (destroyed) return;
			state.signer = res.ok ? res.data : { error: res.message };
			render();
		}

		function sessionHtml(s) {
			if (!s) return '';
			const pct = s.cap ? Math.min(100, Math.round(((s.spent || 0) / s.cap) * 100)) : 0;
			const live = s.status === 'active';
			const net = s.network === 'devnet' ? 'devnet' : 'mainnet';
			return `<dl class="awh-cu-kv">
				<dt>Session</dt><dd>${esc(s.status)}</dd>
				<dt>Delegate key</dt><dd>${esc(s.delegate)}</dd>
				<dt>Cap</dt><dd>${esc(fmtAmount(s.cap))} (${esc(net)})</dd>
				<dt>Spent</dt><dd>${esc(fmtAmount(s.spent))}</dd>
				<dt>Expires</dt><dd>${s.expires_at ? esc(new Date(s.expires_at).toLocaleString()) : 'n/a'}</dd>
				${s.grant_signature ? `<dt>Grant</dt><dd><a href="${esc(explorerTxUrl(s.grant_signature, net))}" target="_blank" rel="noopener">${esc(s.grant_signature.slice(0, 16))}...</a></dd>` : ''}
			</dl>
			${live ? `<div class="awh-cu-meter${pct >= 80 ? ' warn' : ''}" role="img" aria-label="${pct} percent of the session cap spent"><i style="width:${pct}%"></i></div>` : ''}`;
		}

		function recentHtml(list) {
			if (!list?.length) return '';
			return `<div class="awh-card-h" style="margin-top:8px;">Your last signed transactions</div>
			<ul style="list-style:none;margin:0 0 var(--space-3,12px);padding:0;font-size:var(--text-sm,.764rem);">${list.map((t) => `<li style="display:flex;gap:10px;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--stroke,rgba(255,255,255,.06));"><span>${esc(t.kind)} <span style="color:var(--ink-dim,#888)">${esc(t.status)}</span></span>${t.signature ? `<a href="${esc(explorerTxUrl(t.signature, t.network))}" target="_blank" rel="noopener">${esc(t.signature.slice(0, 12))}...</a>` : ''}</li>`).join('')}</ul>`;
		}

		function signerHtml() {
			const d = state.signer;
			if (d === null) return '<div class="awh-card"><div class="awh-skel-line" style="width:40%"></div><div class="awh-skel-line"></div><div class="awh-skel-line" style="width:70%"></div></div>';
			if (d.error) return `<div class="awh-card"><div class="awh-err" role="alert">Could not load the signing mode.<div class="why">${esc(d.error)}</div></div><button class="awh-btn" type="button" data-act="reload-signer">Retry</button></div>`;
			const busy = state.signerBusy ? 'disabled' : '';
			const chip = (m) => `<button type="button" class="awh-cu-mode" data-mode="${m}" aria-pressed="${d.mode === m}" ${busy}><b>${MODE_COPY[m].title}</b><span>${MODE_COPY[m].body}</span></button>`;
			const live = d.session && ['active', 'pending'].includes(d.session.status);
			return `<div class="awh-card">
				<div class="awh-cu-head"><h3>Signing mode</h3><span class="awh-chip">${d.custodial ? 'Platform holds the signing key' : 'Platform cannot sign alone'}</span></div>
				<p class="awh-cu-info">Choose who signs this agent's fund-moving transactions. Switching away from a session key revokes it on-chain.</p>
				<div class="awh-cu-modes" role="group" aria-label="Signing mode">${['platform', 'external', 'session'].map(chip).join('')}</div>
				${d.external_pubkey ? `<dl class="awh-cu-kv"><dt>Signing wallet</dt><dd>${esc(d.external_pubkey)}</dd></dl>` : ''}
				${sessionHtml(d.session)}
				${state.signerErr ? `<div class="awh-err" role="alert" style="margin-bottom:10px;">${esc(state.signerErr)}</div>` : ''}
				<div class="awh-cu-acts">
					<button class="awh-btn awh-btn--primary" type="button" data-act="grant" ${busy}>Grant session key</button>
					${live ? `<button class="awh-btn awh-btn--danger" type="button" data-act="revoke" ${busy}>Revoke session</button>` : ''}
				</div>
				${recentHtml(d.recent_external_txs)}
			</div>`;
		}

		async function submitSigned(prepared, provider, address) {
			const signed = await signPrepared(provider, address, prepared.transaction);
			const res = await call('/api/tx/submit', { method: 'POST', body: { tx_id: prepared.tx_id, signed_transaction: signed } });
			if (!res.ok) throw new Error(res.message);
			return res.data;
		}

		async function changeMode(mode) {
			if (state.signer?.mode === mode || state.signerBusy) return;
			if (mode === 'session') { openGrantDialog(); return; }
			state.signerBusy = true; state.signerErr = null; render();
			try {
				let body = { mode };
				let wallet = null;
				if (mode === 'external') {
					wallet = await connectOwnerWallet();
					body = { mode, pubkey: wallet.address };
				}
				const res = await call(`${agentBase}/signer`, { method: 'PUT', body });
				if (!res.ok) throw new Error(res.message);
				if (res.data.prepared) {
					wallet = wallet || (await connectOwnerWallet());
					await submitSigned(res.data.prepared, wallet.provider, wallet.address);
				}
				ctx.toast(mode === 'platform' ? 'Platform signing restored' : 'Your wallet now signs for this agent');
			} catch (err) {
				state.signerErr = err.message;
			}
			state.signerBusy = false;
			await loadSigner();
		}

		function openGrantDialog() {
			const net = ctx.getNetwork() === 'devnet' ? 'devnet' : 'mainnet';
			const dlg = openModal('', { label: 'Grant a session key' });
			const draw = (err = '', busy = false) => {
				setDialog(dlg, `<h3>Grant a session key</h3>
					<p class="awh-cu-info">Your wallet approves a delegate to spend up to a cap of USDC on ${esc(net)} until it expires. The agent can act alone inside that cap and nowhere else. A small SOL float is also sent to the delegate for fees.</p>
					<form id="awh-cu-grant" novalidate>
						<label for="awh-cu-cap">Spend cap (USDC)</label>
						<input class="awh-in" id="awh-cu-cap" inputmode="decimal" autocomplete="off" value="${esc(dlg.dataset.cap || '25')}" required autofocus>
						<label for="awh-cu-hours">Expires after (hours)</label>
						<input class="awh-in" id="awh-cu-hours" inputmode="numeric" autocomplete="off" value="${esc(dlg.dataset.hours || '24')}" required>
						${err ? `<div class="awh-err" role="alert" style="margin-top:12px;">${esc(err)}</div>` : ''}
						<div class="awh-cu-foot"><button class="awh-btn" type="button" data-x="cancel" ${busy ? 'disabled' : ''}>Cancel</button><button class="awh-btn awh-btn--primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="awh-spin"></span>Waiting for wallet...' : 'Grant from my wallet'}</button></div>
					</form>`);
				dlg.querySelector('[data-x="cancel"]').addEventListener('click', closeModal);
				dlg.querySelector('#awh-cu-grant').addEventListener('submit', onSubmit);
			};
			async function onSubmit(ev) {
				ev.preventDefault();
				const cap = Number(dlg.querySelector('#awh-cu-cap').value);
				const hours = Number(dlg.querySelector('#awh-cu-hours').value);
				dlg.dataset.cap = String(dlg.querySelector('#awh-cu-cap').value);
				dlg.dataset.hours = String(dlg.querySelector('#awh-cu-hours').value);
				if (!Number.isFinite(cap) || cap <= 0) { draw('Enter a cap greater than zero.'); return; }
				if (!Number.isInteger(hours) || hours < 1) { draw('Enter a whole number of hours, 1 or more.'); return; }
				draw('', true);
				try {
					const wallet = await connectOwnerWallet();
					const res = await call(`${agentBase}/signer`, { method: 'PUT', body: { mode: 'session', cap, expires_in_hours: hours, network: net, pubkey: wallet.address } });
					if (!res.ok) throw new Error(res.message);
					await submitSigned(res.data.prepared, wallet.provider, wallet.address);
					closeModal();
					ctx.toast('Session key granted');
					await loadSigner();
				} catch (err) {
					if (destroyed || !modal) return;
					draw(err.message);
				}
			}
			draw();
		}

		async function revokeSession() {
			state.signerBusy = true; state.signerErr = null; render();
			try {
				const res = await call(`${agentBase}/signer/session`, { method: 'DELETE' });
				if (!res.ok) throw new Error(res.message);
				if (res.data.prepared) {
					const wallet = await connectOwnerWallet();
					await submitSigned(res.data.prepared, wallet.provider, wallet.address);
				}
				ctx.toast('Session key revoked');
			} catch (err) {
				state.signerErr = `The platform stopped using the session key, but the on-chain revoke is not confirmed: ${err.message}`;
			}
			state.signerBusy = false;
			await loadSigner();
		}

		/* ---------- key export dialog ---------- */

		function openExportDialog() {
			const dlg = openModal('', { label: 'Export private key' });
			const st = { step: 'intro', method: 'password', busy: false, err: '', codeSent: false, challenge: null, grant: null, envelope: null, address: null, rotate: null };

			const methodHtml = () => {
				const m = st.method;
				const tabs = ['password', 'email_code', 'wallet'].map((k) => `<button type="button" class="awh-btn${m === k ? ' awh-btn--primary' : ''}" data-method="${k}" aria-pressed="${m === k}">${{ password: 'Password', email_code: 'Emailed code', wallet: 'Wallet signature' }[k]}</button>`).join('');
				let body;
				if (m === 'password') body = '<input class="awh-in" id="awh-cu-proof" type="password" autocomplete="current-password" placeholder="Account password" autofocus>';
				else if (m === 'email_code') body = `<div class="awh-row"><button class="awh-btn" type="button" data-x="send-code" ${st.busy ? 'disabled' : ''}>${st.codeSent ? 'Send a new code' : 'Email me a code'}</button><input class="awh-in" id="awh-cu-proof" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" ${st.codeSent ? '' : 'disabled'}></div>`;
				else body = '<p class="awh-cu-info" style="margin:0;">Your linked wallet signs a one-time message. No transaction is sent and nothing costs a fee.</p>';
				return `<div class="awh-cu-acts" role="group" aria-label="Confirmation method" style="margin:10px 0;">${tabs}</div>${body}`;
			};

			const views = {
				intro: () => `<h3>Export private key</h3>
					<div class="awh-cu-warn"><strong>Anyone who holds this key controls the wallet.</strong> The key is sealed so only this page can open it, then encrypted to a passphrase you choose. It is shown once and never logged. Store the encrypted file somewhere safe and offline.</div>
					<p class="awh-cu-info">First confirm it is you.</p>${methodHtml()}`,
				pass: () => `<h3>Choose a passphrase</h3>
					<p class="awh-cu-info">This passphrase encrypts the exported key in your browser. It is never sent to the server and cannot be recovered. Use at least ${MIN_PASSPHRASE_LENGTH} characters.</p>
					<label for="awh-cu-pp">Passphrase</label><input class="awh-in" id="awh-cu-pp" type="password" autocomplete="new-password" autofocus>
					<label for="awh-cu-pp2">Repeat passphrase</label><input class="awh-in" id="awh-cu-pp2" type="password" autocomplete="new-password">`,
				reveal: () => `<h3>Your encrypted key</h3>
					<div class="awh-cu-warn">Shown once. Copy or download it now. Closing this dialog discards it from the page, and the server keeps no copy.</div>
					<label for="awh-cu-env">Encrypted export for ${esc(ctx.shortAddress(st.address))}</label>
					<textarea class="awh-in" id="awh-cu-env" readonly spellcheck="false">${esc(JSON.stringify(st.envelope, null, 2))}</textarea>
					<p class="awh-cu-info" style="margin-top:8px;">Decrypt later with <code>node scripts/decrypt-wallet-export.mjs</code>.</p>
					<div class="awh-cu-acts"><button class="awh-btn awh-btn--primary" type="button" data-x="copy">Copy</button><button class="awh-btn" type="button" data-x="download">Download file</button><button class="awh-btn" type="button" data-x="rotate-start">Rotate key now</button></div>`,
				rotate: () => {
					const r = st.rotate;
					if (!r) return '<h3>Rotate the key</h3><div class="awh-skel-line"></div><div class="awh-skel-line"></div>';
					if (r.done) return `<h3>Key rotated</h3><p class="awh-cu-info">Every balance moved to the new address. The exported key now controls an empty wallet.</p><dl class="awh-cu-kv"><dt>New address</dt><dd>${esc(r.new_address)}</dd></dl>`;
					return `<h3>Rotate after export</h3>
						<p class="awh-cu-info">${esc(r.note || '')}</p>
						<dl class="awh-cu-kv"><dt>Old address</dt><dd>${esc(r.old_address)}</dd><dt>SOL to move</dt><dd>${esc(fmtAmount(r.sol_after_fee))} (of ${esc(fmtAmount(r.sol))}, fee reserved)</dd><dt>Token accounts</dt><dd>${r.tokens?.length ? esc(String(r.tokens.length)) : 'none'}</dd><dt>Network</dt><dd>${esc(r.network)}</dd></dl>
						<div class="awh-cu-warn">This moves real funds. Review the address and balances above before confirming.</div>`;
				},
			};

			const footer = () => {
				const busy = st.busy ? 'disabled' : '';
				const spin = '<span class="awh-spin"></span>Working...';
				if (st.step === 'intro') return `<button class="awh-btn" type="button" data-x="close">Cancel</button><button class="awh-btn awh-btn--primary" type="button" data-x="confirm-id" ${busy}>${st.busy ? spin : 'Confirm identity'}</button>`;
				if (st.step === 'pass') return `<button class="awh-btn" type="button" data-x="close" ${busy}>Cancel</button><button class="awh-btn awh-btn--primary" type="button" data-x="do-export" ${busy}>${st.busy ? spin : 'Export key'}</button>`;
				if (st.step === 'reveal') return '<button class="awh-btn" type="button" data-x="close">Done</button>';
				if (st.rotate?.done) return '<button class="awh-btn awh-btn--primary" type="button" data-x="close">Done</button>';
				return `<button class="awh-btn" type="button" data-x="close" ${busy}>Not now</button>${st.rotate && !st.rotate.error ? `<button class="awh-btn awh-btn--danger" type="button" data-x="rotate-go" ${busy}>${st.busy ? spin : 'Move funds and rotate'}</button>` : ''}`;
			};

			function draw() {
				if (destroyed || !modal) return;
				const keep = dlg.querySelector('#awh-cu-proof')?.value;
				setDialog(dlg, `${views[st.step]()}${st.err ? `<div class="awh-err" role="alert" style="margin-top:12px;">${esc(st.err)}</div>` : ''}<div class="awh-cu-foot">${footer()}</div>`);
				const proof = dlg.querySelector('#awh-cu-proof');
				if (proof && keep && !proof.disabled) proof.value = keep;
				dlg.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => { st.method = b.dataset.method; st.err = ''; st.codeSent = false; draw(); }));
				dlg.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => onAction(b.dataset.x)));
				dlg.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') onAction(st.step === 'pass' ? 'do-export' : 'confirm-id'); }));
			}

			async function run(fn) {
				st.busy = true; st.err = ''; draw();
				try { await fn(); } catch (err) { st.err = err.message || 'Something went wrong. Nothing was changed.'; }
				st.busy = false; draw();
			}

			async function onAction(act) {
				if (st.busy && act !== 'close') return;
				if (act === 'close') { st.envelope = null; closeModal(); return; }
				if (act === 'send-code') {
					return run(async () => {
						const res = await call(`${agentBase}/wallet/export/challenge`, { method: 'POST', body: { method: 'email_code' } });
						if (!res.ok) throw new Error(res.message);
						st.codeSent = true;
						ctx.toast('Code sent to your email');
					});
				}
				if (act === 'confirm-id') {
					return run(async () => {
						let proof = {};
						if (st.method === 'password') {
							const v = dlg.querySelector('#awh-cu-proof')?.value || '';
							if (!v) throw new Error('Enter your password.');
							proof = { password: v };
						} else if (st.method === 'email_code') {
							const v = (dlg.querySelector('#awh-cu-proof')?.value || '').trim();
							if (!/^\d{6}$/.test(v)) throw new Error('Enter the six-digit code from the email.');
							proof = { code: v };
						} else {
							const ch = await call(`${agentBase}/wallet/export/challenge`, { method: 'POST', body: { method: 'wallet' } });
							if (!ch.ok) throw new Error(ch.message);
							const { provider } = await connectOwnerWallet();
							if (!provider.signMessage) throw new Error('This wallet cannot sign messages. Use your password or an emailed code.');
							let sig;
							try {
								({ signature: sig } = await provider.signMessage(new TextEncoder().encode(ch.data.message), 'utf8'));
							} catch {
								throw new Error('The signature request was rejected in the wallet.');
							}
							proof = { message: ch.data.message, signature: b64FromBytes(sig) };
						}
						const res = await call(`${agentBase}/wallet/export/grant`, { method: 'POST', body: { method: st.method, proof } });
						if (!res.ok) throw new Error(res.message);
						st.grant = res.data.grant;
						st.step = 'pass';
					});
				}
				if (act === 'do-export') {
					return run(async () => {
						const pp = dlg.querySelector('#awh-cu-pp')?.value || '';
						const pp2 = dlg.querySelector('#awh-cu-pp2')?.value || '';
						const problem = passphraseProblem(pp);
						if (problem) throw new Error(problem);
						if (pp !== pp2) throw new Error('The two passphrases do not match.');
						const kp = await beginKeyExport();
						const res = await call(`${agentBase}/wallet/export`, { method: 'POST', body: { confirm_export: true, reauth_grant: st.grant, client_public_key: kp.publicKey } });
						st.grant = null;
						if (!res.ok) {
							if (res.code === 'step_up_required') st.step = 'intro';
							throw new Error(res.message);
						}
						const { address, sealed } = res.data;
						const secret = await openSealedKey(sealed, kp.privateKey, { agentId: ctx.agentId, address });
						try {
							st.envelope = await encryptKeyToPassphrase(secret, pp, { address, agentId: ctx.agentId });
						} finally {
							secret.fill(0);
						}
						st.address = address;
						st.step = 'reveal';
					});
				}
				if (act === 'copy') { const ok = await ctx.copyToClipboard(JSON.stringify(st.envelope)); ctx.toast(ok ? 'Encrypted export copied' : 'Copy failed. Select the text and copy it manually.'); return; }
				if (act === 'download') {
					const blob = new Blob([JSON.stringify(st.envelope, null, 2)], { type: 'application/json' });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = `three-ws-wallet-export-${st.address.slice(0, 8)}.json`;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(a.href), 4000);
					return;
				}
				if (act === 'rotate-start') {
					st.step = 'rotate'; st.rotate = null; draw();
					const res = await call(`${agentBase}/wallet/export/rotate`, { method: 'POST', body: { network: ctx.getNetwork() } });
					if (destroyed || !modal) return;
					if (!res.ok) { st.rotate = { error: true }; st.err = res.message; } else st.rotate = res.data;
					draw();
					return;
				}
				if (act === 'rotate-go') {
					return run(async () => {
						const res = await call(`${agentBase}/wallet/export/rotate`, { method: 'POST', body: { network: st.rotate.network, confirm_rotate: true, expected_address: st.rotate.old_address } });
						if (!res.ok) throw new Error(res.message);
						st.rotate = { done: true, new_address: res.data.new_address };
						st.envelope = null;
						ctx.toast('Key rotated');
					});
				}
			}
			draw();
		}

		/* ---------- history chart ---------- */

		async function loadHistory() {
			state.hist = null;
			renderHistory();
			state.histNetwork = ctx.getNetwork();
			const res = await call(`${agentBase}/wallet/history?range=${state.range}&network=${encodeURIComponent(state.histNetwork)}`);
			if (destroyed) return;
			state.hist = res.ok ? res.data : { error: res.message };
			renderHistory();
		}

		function chartSvg(points) {
			// T reserves a band above the plot for the max label, F a band between the plot
			// floor and the axis for the min label, so neither label ever sits under the line.
			const W = 640, H = 200, L = 8, R = 8, T = 24, B = 22, F = 16;
			const pts = points.filter((p) => p.usd_total != null).map((p) => ({ t: Date.parse(p.captured_at), v: p.usd_total, p }));
			if (pts.length < 1) return '';
			const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
			let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
			if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
			const x = (t) => L + (t1 === t0 ? (W - L - R) / 2 : ((t - t0) / (t1 - t0)) * (W - L - R));
			const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B - F);
			const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
			const fmtT = (t) => new Date(t).toLocaleString(undefined, state.range === '24h' ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
			return { pts, x, y, svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Wallet value in US dollars over the last ${esc(state.range)}, from ${esc(formatUsd(pts[0].v) || '')} to ${esc(formatUsd(pts[pts.length - 1].v) || '')}" preserveAspectRatio="none">
				<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
				${pts.length === 1
					? `<text class="tx" x="${W / 2}" y="${H - 6}" text-anchor="middle">${esc(fmtT(t0))}</text>`
					: `<text class="tx" x="${L}" y="${H - 6}">${esc(fmtT(t0))}</text><text class="tx" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtT(t1))}</text>`}
				<line class="gd" x1="${L}" x2="${W - R}" y1="${T}" y2="${T}"/><line class="gd" x1="${L}" x2="${W - R}" y1="${H - B - F}" y2="${H - B - F}"/>
				<text class="tx" x="${L}" y="${T - 6}">${esc(formatUsd(hi) || '')}</text><text class="tx" x="${L}" y="${H - B - 4}">${esc(formatUsd(lo) || '')}</text>
				<path class="ln" d="${d}"/>
				${pts.length === 1 ? `<circle class="dt" cx="${x(t0).toFixed(1)}" cy="${y(pts[0].v).toFixed(1)}" r="4"/>` : ''}
				<g class="hv" hidden><line class="cr" y1="${T}" y2="${H - B}"/><circle class="dt" r="4"/></g>
			</svg>` };
		}

		function renderHistory() {
			const host = panel.querySelector('[data-host="history"]');
			if (!host) return;
			const h = state.hist;
			const ranges = ['24h', '7d', '30d'].map((r) => `<button type="button" data-range="${r}" aria-pressed="${state.range === r}">${r}</button>`).join('');
			const head = `<div class="awh-cu-head"><h3>Balance history</h3><div class="awh-cu-ranges" role="group" aria-label="Range">${ranges}</div></div>`;
			let body;
			if (h === null) body = '<div class="awh-skel-line" style="width:40%"></div><div class="awh-skel-line" style="height:140px"></div>';
			else if (h.error) body = `<div class="awh-err" role="alert">Could not load balance history.<div class="why">${esc(h.error)}</div></div><button class="awh-btn" type="button" data-act="reload-history">Retry</button>`;
			else if (!h.points.some((p) => p.usd_total != null)) body = '<div class="awh-cu-empty"><strong>No snapshots yet</strong>The first one appears within an hour. After that this chart tracks the wallet value over time.</div>';
			else {
				const chart = chartSvg(h.points);
				const s = h.summary;
				const sign = s.change_usd > 0 ? '+' : '';
				body = `<div class="awh-cu-stats"><div><strong>${esc(formatUsd(h.points.filter((p) => p.usd_total != null).pop().usd_total) || 'n/a')}</strong>Latest value</div>
					<div>${s.count < 2
						? '<strong>n/a</strong>Change, from the next snapshot'
						: `<strong>${s.change_usd == null ? 'n/a' : `${sign}${esc(formatUsd(s.change_usd) || '')}`}</strong>${s.change_pct == null ? 'Change' : `Change (${sign}${esc(s.change_pct.toFixed(2))}%)`}`}</div>
					<div><strong>${esc(String(s.count))}</strong>Snapshots (${esc(h.network)})</div></div>
					<div class="awh-cu-chart" tabindex="0" aria-describedby="awh-cu-read">${chart.svg}</div>
					<div class="awh-cu-read" id="awh-cu-read" aria-live="polite">Hover or use the arrow keys to read a point.</div>`;
				host.innerHTML = `<div class="awh-card">${head}${body}</div>`;
				wireHistory(host, chart);
				return;
			}
			host.innerHTML = `<div class="awh-card">${head}${body}</div>`;
			wireHistory(host, null);
		}

		function wireHistory(host, chart) {
			host.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { if (state.range !== b.dataset.range) { state.range = b.dataset.range; loadHistory(); } }));
			host.querySelector('[data-act="reload-history"]')?.addEventListener('click', loadHistory);
			if (!chart) return;
			const wrap = host.querySelector('.awh-cu-chart');
			const svg = wrap.querySelector('svg');
			const hv = svg.querySelector('.hv');
			const read = host.querySelector('#awh-cu-read');
			let idx = chart.pts.length - 1;
			const show = (i) => {
				idx = Math.max(0, Math.min(chart.pts.length - 1, i));
				const p = chart.pts[idx];
				const cx = chart.x(p.t), cy = chart.y(p.v);
				hv.hidden = false;
				hv.querySelector('line').setAttribute('x1', cx);
				hv.querySelector('line').setAttribute('x2', cx);
				hv.querySelector('circle').setAttribute('cx', cx);
				hv.querySelector('circle').setAttribute('cy', cy);
				const q = p.p;
				read.textContent = `${new Date(p.t).toLocaleString()}: ${formatUsd(p.v)} (${fmtAmount(q.sol)} SOL, ${fmtAmount(q.usdc)} USDC)`;
			};
			wrap.addEventListener('pointermove', (ev) => {
				const r = svg.getBoundingClientRect();
				const vx = ((ev.clientX - r.left) / r.width) * 640;
				let best = 0, bd = Infinity;
				chart.pts.forEach((p, i) => { const dd = Math.abs(chart.x(p.t) - vx); if (dd < bd) { bd = dd; best = i; } });
				show(best);
			});
			wrap.addEventListener('pointerleave', () => { hv.hidden = true; });
			wrap.addEventListener('keydown', (ev) => {
				if (ev.key === 'ArrowLeft') { ev.preventDefault(); show(idx - 1); }
				else if (ev.key === 'ArrowRight') { ev.preventDefault(); show(idx + 1); }
				else if (ev.key === 'Home') { ev.preventDefault(); show(0); }
				else if (ev.key === 'End') { ev.preventDefault(); show(chart.pts.length - 1); }
			});
		}

		/* ---------- shell ---------- */

		function render() {
			if (destroyed) return;
			let signerHost = panel.querySelector('[data-host="signer"]');
			if (!signerHost) {
				panel.innerHTML = `<div data-host="signer"></div>
					<div class="awh-card"><div class="awh-cu-head"><h3>Export private key</h3><button class="awh-btn" type="button" data-act="export">Export key</button></div>
					<p class="awh-cu-info" style="margin:0;">Download the wallet key, encrypted to a passphrase only you know. Requires you to confirm your identity again, and you can rotate to a fresh key afterwards.</p></div>
					<div data-host="history"></div>`;
				panel.querySelector('[data-act="export"]').addEventListener('click', openExportDialog);
				signerHost = panel.querySelector('[data-host="signer"]');
				renderHistory();
			}
			signerHost.innerHTML = signerHtml();
			signerHost.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => changeMode(b.dataset.mode)));
			signerHost.querySelector('[data-act="grant"]')?.addEventListener('click', openGrantDialog);
			signerHost.querySelector('[data-act="revoke"]')?.addEventListener('click', revokeSession);
			signerHost.querySelector('[data-act="reload-signer"]')?.addEventListener('click', loadSigner);
		}

		const offNetwork = ctx.onNetworkChange?.(() => loadHistory());

		render();
		loadSigner();
		loadHistory();

		return {
			onShow() { loadSigner(); },
			destroy() {
				destroyed = true;
				closeModal();
				if (typeof offNetwork === 'function') offNetwork();
			},
		};
	},
});
