/**
 * Agent Wallet hub: spend delegation tab (owner-only).
 *
 * A signed, epoch-bounded spend delegation is a portable authorization the
 * owner signs with their OWN linked Solana wallet (a message, never a
 * transaction): "this agent may move at most CAP lamports per EPOCH, until
 * NOT_AFTER." Any counterparty can verify the signature offline: see
 * packages/agent-guards/src/delegation.js, the canonical spec this panel's
 * signing flow implements byte-for-byte. The platform enforces the same cap
 * server-side against the agent wallet's REALIZED spend (never the agent's
 * own claim), on every preflight through POST /api/agent/guard.
 *
 * The owner's wallet does the signing, not this page and not the agent. The
 * CLAUDE.md on-chain-signing confirmation gate is about an agent signing or
 * spending; an owner approving their own browser wallet's signMessage prompt
 * for their own agent is the normal, expected use of this feature.
 */

import { registerWalletTab } from '../registry.js';
import { shortAddress, timeAgo } from '../util.js';
import { consumeCsrfToken } from '../../api.js';
import { injectedProvider, connectLaunchWallet } from '../../launch/launch-wallet.js';

// Mirrors packages/agent-guards/src/delegation.js's delegationMessage() byte for
// byte. That module is not imported here on purpose: it pulls in node:crypto
// for the (server-only) signature *verification* path, which this browser
// bundle never needs and should not ship. The *format* below is frozen by the
// same spec (packages/agent-guards/README.md, "Spec: signed spend delegation")
// and covered by tests/agent-guard-endpoint.test.js registering a delegation
// signed over exactly this string.
const DELEGATION_DOMAIN = 'three.ws/agent-spend-delegation/v1';
export function delegationMessage(d) {
	return [
		DELEGATION_DOMAIN,
		`agent: ${d.agent}`,
		`owner: ${d.owner}`,
		`cap_lamports_per_epoch: ${d.cap_lamports_per_epoch}`,
		`epoch_seconds: ${d.epoch_seconds}`,
		`not_after: ${d.not_after}`,
		`nonce: ${d.nonce}`,
	].join('\n');
}

const STYLE_ID = 'awh-delegation-style';
const STYLE = `
.awd-intro { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height:1.55; margin:0 0 var(--space-3,12px); max-width:62ch; }
.awd-active { border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); background: var(--surface-1,rgba(255,255,255,.03)); padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
.awd-row { display:flex; justify-content:space-between; gap:12px; font-size: var(--text-sm,.764rem); padding:5px 0; border-top:1px solid var(--stroke,rgba(255,255,255,.06)); }
.awd-row:first-child { border-top:none; }
.awd-row .k { color: var(--ink-dim,#888); }
.awd-row .v { color: var(--ink,#e8e8e8); font-family: var(--font-mono,ui-monospace,monospace); text-align:right; }
.awd-badge { display:inline-flex; align-items:center; gap:5px; font-size: var(--text-2xs,.6875rem); font-weight:600; padding:2px 9px; border-radius: var(--radius-pill,999px); border:1px solid transparent; }
.awd-badge.ok { color: var(--success,#4ade80); background: color-mix(in srgb, var(--success,#4ade80) 12%, transparent); border-color: color-mix(in srgb, var(--success,#4ade80) 32%, transparent); }
.awd-badge.exp { color: var(--warn,#fbbf24); background: color-mix(in srgb, var(--warn,#fbbf24) 12%, transparent); border-color: color-mix(in srgb, var(--warn,#fbbf24) 30%, transparent); }
.awd-form { display:grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom: var(--space-3,12px); }
.awd-field label { display:block; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); margin-bottom:5px; }
.awd-field input, .awd-field select { width:100%; box-sizing:border-box; font:inherit; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:8px 11px; transition: border-color var(--duration-fast,140ms); }
.awd-field input:focus, .awd-field select:focus { outline:none; border-color: var(--stroke-strong,rgba(255,255,255,.2)); }
.awd-owner { display:flex; align-items:center; gap:8px; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); margin-bottom: var(--space-3,12px); }
.awd-owner .addr { font-family: var(--font-mono,ui-monospace,monospace); color: var(--ink-dim,#888); }
.awd-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.awd-hint { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); }
.awd-spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(255,255,255,.3); border-top-color: currentColor; border-radius:50%; animation: awd-rot .7s linear infinite; vertical-align:-2px; margin-right:6px; }
@keyframes awd-rot { to { transform: rotate(360deg); } }
.awd-err { background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); border-radius: var(--radius-md,10px); padding:10px 12px; font-size: var(--text-sm,.764rem); margin-bottom: var(--space-3,12px); line-height:1.45; }
.awd-skel { height:14px; border-radius:6px; background: var(--surface-2,rgba(255,255,255,.05)); animation: awd-pulse 1.4s ease-in-out infinite; margin:9px 0; }
@keyframes awd-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
@media (prefers-reduced-motion: reduce) { .awd-spin, .awd-skel { animation:none; } }
`;

const EPOCH_PRESETS = [
	{ key: '3600', label: '1 hour' },
	{ key: '21600', label: '6 hours' },
	{ key: '86400', label: '1 day' },
	{ key: '604800', label: '1 week' },
];

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
		if (!r.ok) {
			return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `request failed (${r.status})`, extra: j || null };
		}
		return { ok: true, status: r.status, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

// Decimal SOL string -> integer lamports string, without floating-point
// rounding: the signed message carries lamports as an exact decimal string
// and a float would risk a byte-level mismatch that breaks the signature.
function solToLamports(input) {
	const s = String(input ?? '').trim();
	if (!/^\d+(\.\d+)?$/.test(s) || s === '0' || /^0\.0*$/.test(s)) return null;
	const [whole, frac = ''] = s.split('.');
	const fracLamports = (frac + '000000000').slice(0, 9);
	const lamports = BigInt(whole || '0') * 1_000_000_000n + BigInt(fracLamports || '0');
	return lamports > 0n ? lamports.toString() : null;
}

function lamportsToSol(lamports) {
	const n = BigInt(lamports ?? 0);
	const whole = n / 1_000_000_000n;
	const frac = (n % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : whole.toString();
}

function toBase64(bytes) {
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
	return btoa(out);
}

function freshNonce() {
	return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `nonce-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

const DELEGATION_ERROR_COPY = {
	invalid_delegation: 'That delegation was malformed before it even reached your wallet. Try again.',
	expired_delegation: 'The expiry you chose is already in the past.',
	agent_not_found: 'This agent has no linked owner wallet to delegate from. Link a Solana wallet to your account first.',
	wrong_signer: "The signature doesn't match your linked owner wallet. Make sure you approved the prompt with the same wallet shown below.",
	replayed_nonce: 'That exact delegation has already been registered. Try again to get a fresh nonce.',
};

registerWalletTab({
	id: 'delegation',
	label: 'Delegation',
	order: 59,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const esc = ctx.escapeHtml;
		const toast = ctx.toast;
		const base = (sub) => `/api/agents/${encodeURIComponent(ctx.agentId)}/solana/${sub}`;

		let destroyed = false;
		let detachNet = null;
		const state = {
			loaded: false,
			signedOut: false,
			active: null, // delegation row | { error } | null
			ownerWallet: null, // address | null while unresolved
			ownerLoaded: false,
			form: { capSol: '0.5', epoch: '86400', expiryDays: '30' },
			signing: false,
			signError: null,
		};

		function render() {
			if (destroyed) return;
			if (state.signedOut) { panel.innerHTML = renderSignedOut(); return; }
			panel.innerHTML = `${renderActive()}${renderComposer()}`;
			wire();
		}

		function renderSignedOut() {
			const next = encodeURIComponent(location.pathname + location.search + location.hash);
			return `<div class="awh-card">
				<div class="awh-card-h">Spend delegation</div>
				<p class="awd-intro">Spend delegations are private to the wallet owner. Sign in to review or sign one for your agent.</p>
				<div class="awd-actions"><a class="awh-btn awh-btn--primary" href="/login?next=${next}">Sign in</a></div>
			</div>`;
		}

		function renderActive() {
			if (!state.loaded) {
				return `<div class="awh-card"><div class="awh-card-h">Active delegation</div><div class="awd-skel" style="width:60%"></div><div class="awd-skel"></div><div class="awd-skel" style="width:40%"></div></div>`;
			}
			if (state.active?.error) {
				return `<div class="awh-card"><div class="awh-card-h">Active delegation</div><div class="awd-err" role="alert">Couldn't load your delegation.<br>${esc(state.active.error)}</div><div class="awd-actions"><button class="awh-btn" type="button" data-act="reload">Retry</button></div></div>`;
			}
			const d = state.active;
			if (!d) {
				return `<div class="awh-card">
					<div class="awh-card-h">Active delegation</div>
					<p class="awd-intro" style="margin-bottom:0;">No spend delegation on file. This is optional, on top of the numeric caps and policy rules below: a delegation is a portable, offline-verifiable receipt any counterparty can check, capping this agent to at most a fixed amount per rolling window until a fixed expiry.</p>
				</div>`;
			}
			const notAfterMs = new Date(d.not_after).getTime();
			const expired = Number.isFinite(notAfterMs) && notAfterMs < Date.now();
			const epochLabel = EPOCH_PRESETS.find((p) => p.key === String(d.epoch_seconds))?.label || `${d.epoch_seconds}s`;
			return `<div class="awh-card">
				<div class="awh-card-h">Active delegation</div>
				<div class="awd-active">
					<div class="awd-row"><span class="k">Status</span><span class="v"><span class="awd-badge ${expired ? 'exp' : 'ok'}">${expired ? 'Expired' : 'Active'}</span></span></div>
					<div class="awd-row"><span class="k">Cap per epoch</span><span class="v">${esc(lamportsToSol(d.cap_lamports_per_epoch))} SOL</span></div>
					<div class="awd-row"><span class="k">Epoch length</span><span class="v">${esc(epochLabel)}</span></div>
					<div class="awd-row"><span class="k">${expired ? 'Expired' : 'Expires'}</span><span class="v">${esc(new Date(d.not_after).toLocaleString())} (${esc(timeAgo(Math.floor(notAfterMs / 1000)))})</span></div>
					<div class="awd-row"><span class="k">Owner wallet</span><span class="v">${esc(shortAddress(d.owner_wallet))}</span></div>
					<div class="awd-row"><span class="k">Nonce</span><span class="v">${esc(shortAddress(d.nonce, 6, 6))}</span></div>
				</div>
				<p class="awd-hint" style="margin-top:8px;">Signing a new delegation below replaces this one once the new nonce registers.</p>
			</div>`;
		}

		function renderComposer() {
			const ownerLine = !state.ownerLoaded
				? `<div class="awd-owner"><span class="awd-spin" aria-hidden="true"></span>Looking up your linked wallet…</div>`
				: state.ownerWallet
					? `<div class="awd-owner">Signing as <span class="addr">${esc(shortAddress(state.ownerWallet))}</span></div>`
					: `<div class="awd-owner">No Solana wallet linked to your account yet. Connecting below will link one.</div>`;
			return `<div class="awh-card">
				<div class="awh-card-h">Sign a new delegation</div>
				<p class="awd-intro">Choose a cap and a window, then approve a sign-message prompt in your own wallet: never a transaction, nothing moves. Any counterparty can verify the signature offline.</p>
				${state.signError ? `<div class="awd-err" role="alert">${esc(state.signError)}</div>` : ''}
				${ownerLine}
				<div class="awd-form">
					<div class="awd-field">
						<label for="awd-cap">Cap per epoch (SOL)</label>
						<input id="awd-cap" type="text" inputmode="decimal" value="${esc(state.form.capSol)}" />
					</div>
					<div class="awd-field">
						<label for="awd-epoch">Epoch length</label>
						<select id="awd-epoch">
							${EPOCH_PRESETS.map((p) => `<option value="${p.key}" ${state.form.epoch === p.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
						</select>
					</div>
					<div class="awd-field">
						<label for="awd-expiry">Expires in (days)</label>
						<input id="awd-expiry" type="text" inputmode="numeric" value="${esc(state.form.expiryDays)}" />
					</div>
				</div>
				<div class="awd-actions">
					<button class="awh-btn awh-btn--primary" type="button" id="awd-sign" ${state.signing ? 'disabled' : ''}>
						${state.signing ? '<span class="awd-spin" aria-hidden="true"></span>Waiting on your wallet…' : 'Sign & activate'}
					</button>
					<span class="awd-hint grow">Opens your browser wallet's sign-message prompt.</span>
				</div>
			</div>`;
		}

		function wire() {
			panel.querySelector('[data-act="reload"]')?.addEventListener('click', () => { state.loaded = false; render(); loadActive(); });
			const capEl = panel.querySelector('#awd-cap');
			const epochEl = panel.querySelector('#awd-epoch');
			const expiryEl = panel.querySelector('#awd-expiry');
			capEl?.addEventListener('input', () => { state.form.capSol = capEl.value; });
			epochEl?.addEventListener('change', () => { state.form.epoch = epochEl.value; });
			expiryEl?.addEventListener('input', () => { state.form.expiryDays = expiryEl.value; });
			panel.querySelector('#awd-sign')?.addEventListener('click', signAndActivate);
		}

		async function loadActive() {
			const res = await call(base('delegation'));
			if (destroyed) return;
			state.loaded = true;
			if (res.status === 401) { state.signedOut = true; render(); return; }
			state.signedOut = false;
			state.active = res.ok ? res.data?.delegation ?? null : { error: res.message };
			render();
		}

		async function loadOwnerWallet() {
			const res = await call('/api/auth/wallets');
			if (destroyed) return;
			state.ownerLoaded = true;
			if (res.ok) {
				const solWallets = (res.data?.wallets || []).filter((w) => w.chain_type === 'solana');
				solWallets.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
				state.ownerWallet = solWallets[0]?.address || null;
			}
			render();
		}

		async function signAndActivate() {
			if (state.signing) return;
			const capLamports = solToLamports(state.form.capSol);
			if (!capLamports) { state.signError = 'Enter a cap greater than 0 SOL.'; render(); return; }
			const epochSeconds = Number(state.form.epoch);
			const expiryDays = Number(state.form.expiryDays);
			if (!Number.isFinite(expiryDays) || expiryDays <= 0) { state.signError = 'Enter an expiry at least 1 day out.'; render(); return; }

			state.signing = true; state.signError = null; render();
			try {
				const { address: connected } = await connectLaunchWallet();
				if (state.ownerWallet && connected !== state.ownerWallet) {
					throw Object.assign(new Error(`Your wallet is connected as ${shortAddress(connected)}, but your account's linked owner wallet is ${shortAddress(state.ownerWallet)}. Switch accounts in your wallet extension and try again.`), { code: 'wrong_wallet' });
				}
				const provider = injectedProvider();
				if (!provider?.signMessage) throw Object.assign(new Error('This wallet cannot sign messages.'), { code: 'no_provider' });

				const delegation = {
					agent: ctx.agentId,
					owner: connected,
					cap_lamports_per_epoch: capLamports,
					epoch_seconds: String(epochSeconds),
					not_after: String(Math.floor(Date.now() / 1000) + Math.round(expiryDays * 86400)),
					nonce: freshNonce(),
				};
				const message = delegationMessage(delegation);
				const { signature } = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
				const delegationSignature = toBase64(signature);

				const res = await call(base('delegation'), { method: 'POST', body: { delegation, delegationSignature } });
				if (destroyed) return;
				if (!res.ok) {
					state.signError = DELEGATION_ERROR_COPY[res.code] || res.message || 'Could not register that delegation.';
					render();
					return;
				}
				state.active = res.data?.delegation ?? null;
				state.ownerWallet = connected;
				toast('Delegation signed and active');
				render();
			} catch (e) {
				if (destroyed) return;
				state.signError = e?.code === 'NO_PROVIDER'
					? 'No Solana wallet extension found. Install Phantom, Backpack, or Solflare and try again.'
					: (e?.message || 'Could not sign that delegation.');
				render();
			} finally {
				if (!destroyed) { state.signing = false; render(); }
			}
		}

		detachNet = ctx.onNetworkChange(() => { state.loaded = false; render(); loadActive(); });
		render();
		loadActive();
		loadOwnerWallet();

		return {
			onShow() { if (!state.loaded) loadActive(); },
			destroy() { destroyed = true; detachNet?.(); },
		};
	},
});
