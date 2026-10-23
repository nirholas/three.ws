/**
 * Agent Wallet hub: owner-funded budget tab (owner-only).
 *
 * The owner keeps the funds in their OWN wallet and signs one transaction that
 * creates a fixed-delegation allowance (mint, cap, expiry) to the agent wallet
 * on the Solana Subscriptions and Allowances program. The agent can only pull
 * through the program, and the program itself rejects anything past the cap or
 * after a revoke. The owner can revoke at any time with one signature.
 *
 * Every transaction here is prepared by the server and returned UNSIGNED; the
 * owner's browser wallet signs it. See docs/agent-allowance-budgets.md.
 */

import { registerWalletTab } from '../registry.js';
import { shortAddress } from '../util.js';
import { consumeCsrfToken } from '../../api.js';
import { connectLaunchWallet, signAndBroadcast, waitForConfirmation } from '../../launch/launch-wallet.js';

const STYLE_ID = 'awh-allowance-style';
const STYLE = `
.awa-intro { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height:1.55; margin:0 0 var(--space-3,12px); max-width:64ch; }
.awa-list { display:flex; flex-direction:column; gap:10px; }
.awa-item { border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); background: var(--surface-1,rgba(255,255,255,.03)); padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.awa-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
.awa-mint { font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); overflow-wrap:anywhere; }
.awa-badge { display:inline-flex; align-items:center; font-size: var(--text-2xs,.6875rem); font-weight:600; padding:2px 9px; border-radius: var(--radius-pill,999px); border:1px solid transparent; }
.awa-badge.active { color: var(--success,#4ade80); background: color-mix(in srgb, var(--success,#4ade80) 12%, transparent); border-color: color-mix(in srgb, var(--success,#4ade80) 32%, transparent); }
.awa-badge.expired, .awa-badge.exhausted, .awa-badge.unknown { color: var(--warn,#fbbf24); background: color-mix(in srgb, var(--warn,#fbbf24) 12%, transparent); border-color: color-mix(in srgb, var(--warn,#fbbf24) 30%, transparent); }
.awa-badge.revoked, .awa-badge.closed { color: var(--ink-dim,#888); border-color: var(--stroke,rgba(255,255,255,.12)); }
.awa-meter { height:8px; border-radius:99px; background: var(--surface-2,rgba(255,255,255,.07)); overflow:hidden; }
.awa-meter > i { display:block; height:100%; background: var(--accent,#7c9cff); border-radius:99px; transition: width var(--duration-fast,140ms); }
.awa-stats { display:grid; grid-template-columns: repeat(auto-fit,minmax(120px,1fr)); gap:8px; }
.awa-stat .k { display:block; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); }
.awa-stat .v { font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); }
.awa-form { display:grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom: var(--space-3,12px); }
.awa-field label { display:block; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); margin-bottom:5px; }
.awa-field input, .awa-field select { width:100%; box-sizing:border-box; font:inherit; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:8px 11px; transition: border-color var(--duration-fast,140ms); }
.awa-field input:hover, .awa-field select:hover { border-color: var(--stroke-strong,rgba(255,255,255,.2)); }
.awa-field input:focus-visible, .awa-field select:focus-visible { outline:2px solid var(--accent,#7c9cff); outline-offset:1px; }
.awa-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.awa-hint { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); }
.awa-spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(255,255,255,.3); border-top-color: currentColor; border-radius:50%; animation: awa-rot .7s linear infinite; vertical-align:-2px; margin-right:6px; }
@keyframes awa-rot { to { transform: rotate(360deg); } }
.awa-err { background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); border-radius: var(--radius-md,10px); padding:10px 12px; font-size: var(--text-sm,.764rem); margin-bottom: var(--space-3,12px); line-height:1.45; }
.awa-skel { height:14px; border-radius:6px; background: var(--surface-2,rgba(255,255,255,.05)); animation: awa-pulse 1.4s ease-in-out infinite; margin:9px 0; }
@keyframes awa-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
@media (prefers-reduced-motion: reduce) { .awa-spin, .awa-skel { animation:none; } .awa-meter > i { transition:none; } }
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
		if (!r.ok) return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `request failed (${r.status})` };
		return { ok: true, status: r.status, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

// Raw integer string -> decimal string using the mint's decimals.
function fromRaw(raw, decimals) {
	if (raw == null) return '-';
	const n = BigInt(raw);
	const base = 10n ** BigInt(decimals);
	const whole = n / base;
	const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return frac ? `${whole}.${frac}` : whole.toString();
}

const STATUS_LABEL = { active: 'Active', expired: 'Expired', exhausted: 'Fully used', revoked: 'Revoked', closed: 'Closed on chain', unknown: 'Status unavailable' };

registerWalletTab({
	id: 'allowance',
	label: 'Budget',
	order: 58,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const esc = ctx.escapeHtml;
		const toast = ctx.toast;
		const base = `/api/agents/${encodeURIComponent(ctx.agentId)}/solana/allowance`;

		let destroyed = false;
		const state = {
			loaded: false,
			signedOut: false,
			error: null,
			data: null,
			form: { mint: '', amount: '', days: '30' },
			busy: null, // 'create' | `revoke:${id}`
			actionError: null,
		};
		const network = () => ctx.getNetwork();

		function render() {
			if (destroyed) return;
			if (state.signedOut) { panel.innerHTML = renderSignedOut(); return; }
			panel.innerHTML = `${renderList()}${renderComposer()}`;
			wire();
		}

		function renderSignedOut() {
			const next = encodeURIComponent(location.pathname + location.search + location.hash);
			return `<div class="awh-card"><div class="awh-card-h">Owner-funded budget</div>
				<p class="awa-intro">Budgets are private to the wallet owner. Sign in to review or create one.</p>
				<div class="awa-actions"><a class="awh-btn awh-btn--primary" href="/login?next=${next}">Sign in</a></div></div>`;
		}

		function renderList() {
			if (!state.loaded) {
				return `<div class="awh-card"><div class="awh-card-h">On-chain allowances</div><div class="awa-skel" style="width:55%"></div><div class="awa-skel"></div><div class="awa-skel" style="width:40%"></div></div>`;
			}
			if (state.error) {
				return `<div class="awh-card"><div class="awh-card-h">On-chain allowances</div><div class="awa-err" role="alert">Couldn't load your allowances.<br>${esc(state.error)}</div><div class="awa-actions"><button class="awh-btn" type="button" data-act="reload">Retry</button></div></div>`;
			}
			const items = state.data?.allowances || [];
			if (!items.length) {
				return `<div class="awh-card"><div class="awh-card-h">On-chain allowances</div>
					<p class="awa-intro" style="margin-bottom:0;">No owner-funded budget yet. Your funds stay in your own wallet; you sign once to let this agent pull up to a cap, until an expiry, and you can revoke at any time. The Solana program itself rejects anything past the cap.</p></div>`;
			}
			return `<div class="awh-card"><div class="awh-card-h">On-chain allowances</div><div class="awa-list">${items.map(renderItem).join('')}</div></div>`;
		}

		function renderItem(a) {
			const dec = a.decimals ?? 0;
			const cap = BigInt(a.capRaw);
			const spent = a.spentRaw == null ? 0n : BigInt(a.spentRaw);
			const pct = cap > 0n ? Number((spent * 100n) / cap) : 0;
			const open = a.status === 'active' || a.status === 'exhausted' || a.status === 'expired' || a.status === 'unknown';
			const expiry = a.expiryTs ? new Date(a.expiryTs * 1000).toLocaleString() : 'No expiry';
			const revoking = state.busy === `revoke:${a.id}`;
			return `<div class="awa-item">
				<div class="awa-head"><span class="awa-mint" title="${esc(a.mint)}">${esc(shortAddress(a.mint))}</span><span class="awa-badge ${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span></div>
				<div class="awa-meter" role="img" aria-label="${pct}% of the cap used"><i style="width:${Math.min(100, pct)}%"></i></div>
				<div class="awa-stats">
					<div class="awa-stat"><span class="k">Cap</span><span class="v">${esc(fromRaw(a.capRaw, dec))}</span></div>
					<div class="awa-stat"><span class="k">Spent</span><span class="v">${esc(fromRaw(a.spentRaw, dec))}</span></div>
					<div class="awa-stat"><span class="k">Remaining</span><span class="v">${esc(fromRaw(a.remainingRaw, dec))}</span></div>
					<div class="awa-stat"><span class="k">Expires</span><span class="v">${esc(expiry)}</span></div>
				</div>
				${a.liveError ? `<div class="awa-hint">Live balance unavailable: ${esc(a.liveError)}</div>` : ''}
				${open ? `<div class="awa-actions"><button class="awh-btn" type="button" data-revoke="${esc(a.id)}" ${state.busy ? 'disabled' : ''}>${revoking ? '<span class="awa-spin" aria-hidden="true"></span>Waiting on your wallet…' : 'Revoke'}</button><span class="awa-hint">One signature closes the allowance on chain. Further pulls fail immediately.</span></div>` : ''}
			</div>`;
		}

		function renderComposer() {
			if (!state.loaded || state.error) return '';
			const creating = state.busy === 'create';
			return `<div class="awh-card"><div class="awh-card-h">Fund a budget from your wallet</div>
				<p class="awa-intro">Pick a token, a cap and an expiry, then approve one transaction in your own wallet. Funds never leave your wallet until the agent pulls them, and never beyond the cap.</p>
				${state.actionError ? `<div class="awa-err" role="alert">${esc(state.actionError)}</div>` : ''}
				<div class="awa-form">
					<div class="awa-field"><label for="awa-mint">Token mint</label><input id="awa-mint" type="text" autocomplete="off" spellcheck="false" placeholder="USDC mint address" value="${esc(state.form.mint)}" /></div>
					<div class="awa-field"><label for="awa-amount">Cap (token units)</label><input id="awa-amount" type="text" inputmode="decimal" placeholder="25" value="${esc(state.form.amount)}" /></div>
					<div class="awa-field"><label for="awa-days">Expires in (days)</label><input id="awa-days" type="text" inputmode="numeric" value="${esc(state.form.days)}" /></div>
				</div>
				<div class="awa-actions">
					<button class="awh-btn awh-btn--primary" type="button" id="awa-create" ${state.busy ? 'disabled' : ''}>${creating ? '<span class="awa-spin" aria-hidden="true"></span>Waiting on your wallet…' : 'Sign & fund budget'}</button>
					<span class="awa-hint">Opens your browser wallet's transaction prompt (${esc(network())}).</span>
				</div>
			</div>`;
		}

		function wire() {
			panel.querySelector('[data-act="reload"]')?.addEventListener('click', () => { state.loaded = false; render(); load(); });
			panel.querySelector('#awa-mint')?.addEventListener('input', (e) => { state.form.mint = e.target.value.trim(); });
			panel.querySelector('#awa-amount')?.addEventListener('input', (e) => { state.form.amount = e.target.value; });
			panel.querySelector('#awa-days')?.addEventListener('input', (e) => { state.form.days = e.target.value; });
			panel.querySelector('#awa-create')?.addEventListener('click', create);
			panel.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', () => revoke(b.getAttribute('data-revoke'))));
		}

		async function load() {
			const res = await call(`${base}?network=${encodeURIComponent(network())}`);
			if (destroyed) return;
			state.loaded = true;
			if (res.status === 401) { state.signedOut = true; render(); return; }
			state.signedOut = false;
			state.error = res.ok ? null : res.message;
			state.data = res.ok ? res.data : null;
			render();
		}

		async function sendOwnerTx(prep, address) {
			const signature = await signAndBroadcast({ txBase64: prep.transaction, version: 0, address });
			const confirmed = await waitForConfirmation(signature);
			if (!confirmed) throw new Error('The transaction was sent but has not confirmed yet. Reload in a minute to see it.');
			return signature;
		}

		async function create() {
			if (state.busy) return;
			state.actionError = null;
			if (network() !== 'mainnet') { state.actionError = 'Switch the network selector to mainnet. Devnet budgets are created with scripts/allowance-devnet-proof.mjs.'; render(); return; }
			if (!state.form.mint || !state.form.amount) { state.actionError = 'Enter the token mint and a cap.'; render(); return; }
			state.busy = 'create'; render();
			try {
				const { address } = await connectLaunchWallet();
				const prepRes = await call(base, { method: 'POST', body: { op: 'prepare', network: network(), owner: address, mint: state.form.mint, amount: state.form.amount, expiresInDays: Number(state.form.days) } });
				if (!prepRes.ok) throw new Error(prepRes.message);
				const prep = prepRes.data;
				const signature = await sendOwnerTx(prep, address);
				const conf = await call(base, { method: 'POST', body: { op: 'confirm', network: network(), signature, delegationPda: prep.delegationPda, nonce: prep.nonce, kind: prep.kind } });
				if (!conf.ok) throw new Error(conf.message);
				state.form = { mint: '', amount: '', days: state.form.days };
				toast('Budget funded on chain');
				await load();
			} catch (e) {
				state.actionError = e?.message || 'Could not create that budget.';
			} finally {
				if (!destroyed) { state.busy = null; render(); }
			}
		}

		async function revoke(id) {
			if (state.busy) return;
			state.actionError = null;
			state.busy = `revoke:${id}`; render();
			try {
				const { address } = await connectLaunchWallet();
				const prepRes = await call(base, { method: 'POST', body: { op: 'revoke', network: network(), id } });
				if (!prepRes.ok) throw new Error(prepRes.message);
				if (prepRes.data.owner !== address) throw new Error(`Connect the owner wallet ${shortAddress(prepRes.data.owner)} to revoke this budget.`);
				const signature = await sendOwnerTx(prepRes.data, address);
				const done = await call(base, { method: 'POST', body: { op: 'revoked', network: network(), id, signature } });
				if (!done.ok) throw new Error(done.message);
				toast('Budget revoked');
				await load();
			} catch (e) {
				state.actionError = e?.message || 'Could not revoke that budget.';
			} finally {
				if (!destroyed) { state.busy = null; render(); }
			}
		}

		const detachNet = ctx.onNetworkChange(() => { state.loaded = false; render(); load(); });
		render();
		load();

		return {
			onShow() { if (!state.loaded) load(); },
			destroy() { destroyed = true; detachNet?.(); },
		};
	},
});
