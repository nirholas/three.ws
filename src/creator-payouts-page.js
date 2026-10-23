// /creator/payouts: where an agent's creator-fee share is paid.
//
// The owner picks an agent, registers the wallet that receives their share
// (the wallet signs a challenge in the browser, and a step-up confirms it is
// really the owner at the keyboard), and sees totals, why anything is held,
// and every distribution. The explainer at the bottom is read from
// /api/creator-payouts?info=1, so cadence and the per-$100 split are never
// hand-written copy.
//
// Nothing here moves funds. The page only registers a destination; the
// distribution cron sends, and only when payouts are switched live.

import { apiFetch } from './api.js';
import { injectedProvider } from './launch/launch-wallet.js';
import { shortAddress } from './shared/address.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtSol = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'n/a');

const state = { agents: [], agentId: null, data: null, step: null, busy: false, error: null };

async function call(path, { method = 'GET', body } = {}) {
	const res = await apiFetch(path, {
		method,
		allowAnonymous: method === 'GET',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, data: data?.data ?? data };
}

const describe = (data, fallback) => data?.error_description || data?.message || data?.error || fallback;

function showError(msg) {
	const el = $('cp-error');
	el.textContent = msg || '';
	el.hidden = !msg;
}

function announce(msg) {
	$('cp-live').textContent = msg;
}

// ── Explainer (public, from ?info=1) ─────────────────────────────────────────

async function loadInfo() {
	const r = await call('/api/creator-payouts?info=1');
	if (!r.ok) {
		$('cp-flow').innerHTML = `<div class="cp-empty">Could not load the payout schedule (${esc(describe(r.data, `HTTP ${r.status}`))}). Reload to try again.</div>`;
		return;
	}
	const legs = r.data.flow?.legs || [];
	$('cp-flow').innerHTML = legs.length
		? legs
				.map(
					(l) =>
						`<div class="cp-leg"><b>$${esc(l.usd)}</b><span><strong>${esc(l.label)}</strong>. ${esc(l.detail)}</span></div>`,
				)
				.join('') + `<small>Per $100 of creator fees claimed. Minimum payout ${esc(fmtSol(r.data.minimum_payout_sol))} SOL.</small>`
		: '<div class="cp-empty">The split policy is not available right now.</div>';
	$('cp-sched').innerHTML = (r.data.schedule || [])
		.map((s) => `<li><span><strong>${esc(s.label)}</strong><br><small>${esc(s.does)}</small></span><span>${esc(s.cadence)}</span></li>`)
		.join('');
}

// ── Owner view ───────────────────────────────────────────────────────────────

function renderBody() {
	const body = $('cp-body');
	body.setAttribute('aria-busy', 'false');
	const d = state.data;
	if (!d) return;
	const p = d.payouts;
	const w = p.wallet;
	const live = p.live;

	const stats = `
		<div class="cp-stats">
			<div class="cp-stat"><b>${esc(fmtSol(p.total_sent_sol))}</b><span>SOL sent</span></div>
			<div class="cp-stat"><b>${esc(fmtSol(p.total_pending_sol))}</b><span>SOL pending</span></div>
			<div class="cp-stat"><b>${esc(fmtSol(p.total_held_sol))}</b><span>SOL held</span></div>
		</div>`;

	const held = p.held_reasons.length
		? `<ul class="cp-hold">${p.held_reasons
				.map((h) => `<li><strong>${esc(fmtSol(h.sol))} SOL held: ${esc(h.label)}.</strong> ${esc(h.fix)}</li>`)
				.join('')}</ul>`
		: '';

	const pauseNote = live
		? ''
		: '<div class="notice notice-warn" style="margin-top:14px">Payouts are not switched on yet. Shares are recorded and shown here, and are sent once payouts go live.</div>';

	let walletBlock;
	if (w.wallet) {
		walletBlock = `<p>Payouts go to <span class="mono">${esc(w.wallet)}</span>, registered ${esc(when(w.registered_at))}.</p>`;
	} else if (w.pending) {
		walletBlock = '<p>No active payout wallet yet.</p>';
	} else {
		walletBlock = '<div class="cp-empty">No payout wallet registered. Register one below and your share is sent there. Until then it is held, never lost.</div>';
	}
	const pending = w.pending
		? `<div class="notice notice-warn" style="margin-top:12px">
				<strong>Wallet change pending.</strong> <span class="mono">${esc(w.pending.wallet)}</span> takes effect ${esc(when(w.pending.effective_at))}
				(a ${esc(w.cooldown_hours)} hour wait protects you if someone else changed it). Payouts are held until then.
				<div class="cp-row"><button class="btn btn-sm btn-danger" data-act="cancel" ${state.busy ? 'disabled' : ''}>Cancel change</button></div>
			</div>`
		: '';

	const step = state.step ? renderStep() : '';
	const regBtn = !state.step
		? `<div class="cp-row"><button class="btn btn-primary" data-act="register" ${state.busy ? 'disabled' : ''}>${w.wallet ? 'Change payout wallet' : 'Register payout wallet'} with a connected wallet</button></div>
		   <small>You sign a message with the wallet to prove you control it. Nothing is spent. ${w.wallet ? `A change waits ${esc(w.cooldown_hours)} hours before it applies.` : ''}</small>`
		: '';

	const rows = p.recent_distributions;
	const table = rows.length
		? `<div class="cp-scroll"><table class="cp-table"><thead><tr><th>Date</th><th>Coin</th><th>Share (SOL)</th><th>Status</th><th>Transfer</th></tr></thead><tbody>${rows
				.map(
					(r) => `<tr>
					<td>${esc(when(r.at))}</td>
					<td class="mono">${esc(shortAddress(r.mint, 4, 4))}</td>
					<td>${esc(fmtSol(r.sol))}</td>
					<td><span class="pill ${esc(r.status)}">${esc(r.status)}</span>${r.hold_reason ? `<br><small>${esc(r.hold?.label || r.hold_reason)}</small>` : ''}</td>
					<td>${r.signature ? `<a class="mono" target="_blank" rel="noopener" href="${esc(r.explorer)}">${esc(shortAddress(r.signature, 6, 6))}</a>` : 'n/a'}</td>
				</tr>`,
				)
				.join('')}</tbody></table></div>`
		: '<div class="cp-empty">No distributions yet. When one of this agent\'s coins earns creator fees and the fees are claimed, your share appears here.</div>';

	body.innerHTML = `
		<div class="cp-card">
			<h2>Payout wallet</h2>
			${walletBlock}${pending}${pauseNote}${step}${regBtn}
			<div id="cp-reg-err" class="notice notice-error" role="alert" style="margin-top:12px" ${state.error ? '' : 'hidden'}>${esc(state.error)}</div>
		</div>
		<div class="cp-card">
			<h2>Earnings</h2>
			<p>Minimum payout ${esc(fmtSol(p.minimum_payout_sol))} SOL. Smaller shares wait and add up.</p>
			${stats}${held}
		</div>
		<div class="cp-card">
			<div class="cp-row" style="margin-top:0;justify-content:space-between">
				<h2 style="margin:0">Distributions</h2>
				<button class="btn btn-sm" data-act="csv" ${rows.length ? '' : 'disabled'}>Export CSV</button>
			</div>
			${table}
		</div>`;
	bind();
}

function renderStep() {
	const s = state.step;
	return `<div class="cp-field" style="border:1px solid var(--line-2);border-radius:10px;padding:14px">
		<strong style="font-size:13px">Confirm it is you</strong>
		<p>Registering <span class="mono">${esc(shortAddress(s.wallet, 6, 6))}</span> as the payout wallet needs your account password or an emailed code.</p>
		<div class="cp-row">
			<button class="btn btn-sm" data-method="password" aria-pressed="${s.method === 'password'}">Password</button>
			<button class="btn btn-sm" data-method="email_code" aria-pressed="${s.method === 'email_code'}">Emailed code</button>
			${s.method === 'email_code' ? `<button class="btn btn-sm" data-act="send-code" ${s.busy ? 'disabled' : ''}>${s.codeSent ? 'Resend code' : 'Send code'}</button>` : ''}
		</div>
		<div class="cp-field"><label for="cp-proof">${s.method === 'password' ? 'Password' : 'Code from the email'}</label>
			<input id="cp-proof" type="${s.method === 'password' ? 'password' : 'text'}" autocomplete="${s.method === 'password' ? 'current-password' : 'one-time-code'}" /></div>
		${s.err ? `<div class="notice notice-error" role="alert" style="margin-top:12px">${esc(s.err)}</div>` : ''}
		<div class="cp-row">
			<button class="btn btn-primary" data-act="confirm" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Working' : 'Confirm and sign'}</button>
			<button class="btn" data-act="step-cancel" ${s.busy ? 'disabled' : ''}>Back</button>
		</div>
	</div>`;
}

function bind() {
	const body = $('cp-body');
	body.querySelector('[data-act="register"]')?.addEventListener('click', startRegister);
	body.querySelector('[data-act="cancel"]')?.addEventListener('click', cancelPending);
	body.querySelector('[data-act="csv"]')?.addEventListener('click', downloadCsv);
	body.querySelector('[data-act="step-cancel"]')?.addEventListener('click', () => {
		state.step = null;
		state.error = null;
		renderBody();
	});
	body.querySelector('[data-act="send-code"]')?.addEventListener('click', sendCode);
	body.querySelector('[data-act="confirm"]')?.addEventListener('click', confirmRegister);
	body.querySelectorAll('[data-method]').forEach((b) =>
		b.addEventListener('click', () => {
			state.step.method = b.dataset.method;
			state.step.err = null;
			renderBody();
			$('cp-proof')?.focus();
		}),
	);
	$('cp-proof')?.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') confirmRegister();
	});
}

async function load() {
	$('cp-body').setAttribute('aria-busy', 'true');
	const r = await call(`/api/creator-payouts?agent=${encodeURIComponent(state.agentId)}`);
	if (!r.ok) {
		showError(`Could not load payouts: ${describe(r.data, `HTTP ${r.status}`)}`);
		$('cp-body').innerHTML = '<div class="cp-card"><div class="cp-empty">Payout details are unavailable. <button class="btn btn-sm" id="cp-retry">Try again</button></div></div>';
		$('cp-body').setAttribute('aria-busy', 'false');
		$('cp-retry')?.addEventListener('click', () => {
			showError('');
			load();
		});
		return;
	}
	showError('');
	state.data = r.data;
	renderBody();
}

// ── Register a payout wallet ─────────────────────────────────────────────────

async function startRegister() {
	state.error = null;
	const provider = injectedProvider();
	if (!provider) {
		state.error = 'No Solana wallet found in this browser. Install Phantom, Backpack or Solflare, then try again.';
		renderBody();
		return;
	}
	let address;
	try {
		const resp = await provider.connect();
		address = (resp?.publicKey || provider.publicKey)?.toString();
	} catch {
		state.error = 'The wallet connection was declined.';
		renderBody();
		return;
	}
	if (!address) {
		state.error = 'Could not read the wallet address.';
		renderBody();
		return;
	}
	state.step = { wallet: address, method: 'password', codeSent: false, busy: false, err: null };
	renderBody();
	$('cp-proof')?.focus();
}

async function sendCode() {
	const s = state.step;
	s.busy = true;
	s.err = null;
	renderBody();
	const r = await call('/api/wallet-whitelist', {
		method: 'POST',
		body: { action: 'stepup_code', agent_id: state.agentId, kind: 'payout_wallet', op: { wallet: s.wallet } },
	});
	s.busy = false;
	if (r.ok) {
		s.codeSent = true;
		announce('Code sent to your email');
	} else s.err = describe(r.data, 'Could not send the code.');
	renderBody();
	$('cp-proof')?.focus();
}

async function confirmRegister() {
	const s = state.step;
	if (!s || s.busy) return;
	const proofVal = $('cp-proof')?.value || '';
	if (!proofVal) {
		s.err = s.method === 'password' ? 'Enter your password.' : 'Enter the code from the email.';
		renderBody();
		return;
	}
	s.busy = true;
	s.err = null;
	renderBody();
	const fail = (msg) => {
		s.busy = false;
		s.err = msg;
		renderBody();
	};

	const grant = await call('/api/wallet-whitelist', {
		method: 'POST',
		body: {
			action: 'stepup',
			agent_id: state.agentId,
			kind: 'payout_wallet',
			op: { wallet: s.wallet },
			method: s.method,
			proof: s.method === 'password' ? { password: proofVal } : { code: proofVal },
		},
	});
	if (!grant.ok) return fail(describe(grant.data, 'Confirmation failed.'));

	const ch = await call('/api/creator-payouts', {
		method: 'POST',
		body: { action: 'challenge', agent_id: state.agentId, wallet: s.wallet },
	});
	if (!ch.ok) return fail(describe(ch.data, 'Could not start the signature.'));

	let signature;
	try {
		const provider = injectedProvider();
		const signed = await provider.signMessage(new TextEncoder().encode(ch.data.message), 'utf8');
		const bytes = signed?.signature || signed;
		signature = btoa(String.fromCharCode(...new Uint8Array(bytes)));
	} catch {
		return fail('The wallet did not sign. Approve the signature request to register the wallet.');
	}

	const reg = await call('/api/creator-payouts', {
		method: 'POST',
		body: {
			action: 'register',
			agent_id: state.agentId,
			wallet: s.wallet,
			message: ch.data.message,
			signature,
			grant: grant.data.grant || grant.data.id,
		},
	});
	if (!reg.ok) return fail(describe(reg.data, 'Registration failed.'));

	state.step = null;
	announce('Payout wallet saved');
	await load();
}

async function cancelPending() {
	state.busy = true;
	renderBody();
	const r = await call('/api/creator-payouts', { method: 'POST', body: { action: 'cancel', agent_id: state.agentId } });
	state.busy = false;
	if (!r.ok) state.error = describe(r.data, 'Could not cancel the change.');
	else announce('Pending change cancelled');
	await load();
}

async function downloadCsv() {
	try {
		const res = await apiFetch(`/api/creator-payouts?agent=${encodeURIComponent(state.agentId)}&format=csv`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const url = URL.createObjectURL(await res.blob());
		const a = document.createElement('a');
		a.href = url;
		a.download = `creator-payouts-${state.agentId}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	} catch (e) {
		showError(`Could not export the CSV: ${e.message}`);
	}
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
	loadInfo();
	const agents = await call('/api/agents');
	if (agents.status === 401 || agents.status === 403) {
		$('cp-auth').hidden = false;
		$('cp-login').href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
		return;
	}
	if (!agents.ok) {
		showError(`Could not load your agents: ${describe(agents.data, `HTTP ${agents.status}`)}`);
		return;
	}
	state.agents = (agents.data.agents || []).filter((a) => a.id);
	$('cp-main').hidden = false;
	if (!state.agents.length) {
		$('cp-body').setAttribute('aria-busy', 'false');
		$('cp-body').innerHTML = '<div class="cp-card"><div class="cp-empty">You have no agents yet. <a href="/create">Create one</a> and launch a coin to start earning creator fees.</div></div>';
		return;
	}
	const sel = $('cp-agent');
	sel.innerHTML = state.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join('');
	const fromUrl = new URLSearchParams(window.location.search).get('agent');
	state.agentId = state.agents.some((a) => a.id === fromUrl) ? fromUrl : state.agents[0].id;
	sel.value = state.agentId;
	sel.addEventListener('change', () => {
		state.agentId = sel.value;
		state.step = null;
		state.error = null;
		load();
	});
	await load();
}

boot();
