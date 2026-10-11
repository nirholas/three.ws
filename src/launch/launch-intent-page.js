// /launch/intents: funded pump.fun launch intents.
//
// One page, two views. The list (/launch/intents) carries the new-intent form
// with the quote-asset picker and the creator-fee slider, and every intent the
// account has asked for. The focus view (/launch/intents/:id) shows one intent:
// its stage tracker, every fee line with the quote's expiry, the funding card
// (send from the connected wallet, or paste a signature), the dry run, and the
// confirm step that opens an approval request the owner answers in /approvals.
//
// Everything that signs happens here or in the approval inbox: the funding
// transfer is signed by the connected browser wallet, and the launch itself is
// signed by the agent wallet only once the approval is granted. The API only
// ever sees proofs.

import { apiFetch } from '../api.js';
import { escNotif as esc, relTime } from '../notifications.js';
import { injectedProvider, connectLaunchWallet, restoreLaunchWallet } from './launch-wallet.js';

const POLL_MS = 8_000;
const TICK_MS = 1_000;
const SOON_MS = 3 * 60_000;
const ACTIVE_STAGES = new Set(['quote', 'paid', 'submitted', 'confirmed']);
const TOKEN_STORE = 'twx_launch_intent_preflight';

const $ = (id) => document.getElementById(id);
const fmt = (n, max = 6) => Number(n).toLocaleString('en-US', { maximumFractionDigits: max });
const short = (s) => (s && s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s || '');

const state = {
	route: readRoute(),
	agents: [],
	pairs: null,
	pairsNetwork: null,
	pair: null,
	intent: null,
	wallet: null,
	pollTimer: null,
	tickTimer: null,
	busy: false,
};

function readRoute() {
	const m = window.location.pathname.match(/^\/launch\/intents\/([^/]+)\/?$/);
	return { id: m ? decodeURIComponent(m[1]) : null };
}

async function call(path, { method = 'GET', body } = {}) {
	const res = await apiFetch(path, {
		method,
		allowAnonymous: method === 'GET',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, data };
}

const describe = (data, fallback) => data?.error_description || data?.message || data?.error || fallback;

// ── preflight tokens: kept per intent in this browser only ───────────────────

function storeToken(id, token) {
	try {
		const all = JSON.parse(sessionStorage.getItem(TOKEN_STORE) || '{}');
		all[id] = token;
		sessionStorage.setItem(TOKEN_STORE, JSON.stringify(all));
	} catch {
		state.tokenFallback = { ...(state.tokenFallback || {}), [id]: token };
	}
}

function readToken(id) {
	try {
		return JSON.parse(sessionStorage.getItem(TOKEN_STORE) || '{}')[id] || state.tokenFallback?.[id] || null;
	} catch {
		return state.tokenFallback?.[id] || null;
	}
}

// ── shell ────────────────────────────────────────────────────────────────────

function showError(msg) {
	const el = $('li-error');
	el.textContent = msg;
	el.hidden = !msg;
}

function announce(msg) {
	$('li-live').textContent = msg;
}

async function boot() {
	const agents = await call('/api/agents');
	if (agents.status === 401 || agents.status === 403) {
		$('li-auth').hidden = false;
		$('li-login').href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
		return;
	}
	if (!agents.ok) {
		showError(`Could not load your agents: ${describe(agents.data, `HTTP ${agents.status}`)}`);
		return;
	}
	state.agents = (agents.data.agents || []).filter((a) => a.id);
	$('li-main').hidden = false;

	if (state.route.id) {
		$('li-new').hidden = true;
		$('li-crumb').textContent = 'Launch intent';
		await loadIntent(state.route.id);
	} else {
		renderAgents();
		await loadPairs($('li-network').value);
	}
	await loadList();
	wireForm();
}

// ── agents & pairs ───────────────────────────────────────────────────────────

function renderAgents() {
	const sel = $('li-agent');
	if (!state.agents.length) {
		sel.innerHTML = '<option value="">No agents yet</option>';
		$('li-form-msg').innerHTML = 'You need an agent first. <a href="/agents/new">Create one</a>, then come back.';
		$('li-submit').disabled = true;
		return;
	}
	sel.innerHTML = state.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || 'Unnamed agent')}${a.wallet_ready === false ? ' (wallet not ready)' : ''}</option>`).join('');
	const prefill = new URLSearchParams(window.location.search).get('agent');
	if (prefill && state.agents.some((a) => a.id === prefill)) sel.value = prefill;
	fillPortrait();
}

function fillPortrait() {
	const agent = state.agents.find((a) => a.id === $('li-agent').value);
	const img = $('li-image');
	if (agent?.avatar_thumbnail_url && !img.dataset.touched) img.value = agent.avatar_thumbnail_url;
	if (agent && !$('li-name').value) $('li-name').placeholder = agent.name || 'Nova';
}

async function loadPairs(network) {
	const host = $('li-pairs');
	host.innerHTML = ['', ''].map(() => '<div class="li-skel"><div class="skeleton" style="height:16px;width:40%"></div><div class="skeleton" style="height:12px;width:70%"></div></div>').join('');
	const r = await call(`/api/pump/pairs?network=${encodeURIComponent(network)}`);
	if (!r.ok) {
		host.innerHTML = `<div class="notice notice-error" style="grid-column:1/-1;margin:0">Could not read the quote assets: ${esc(describe(r.data, `HTTP ${r.status}`))} <button type="button" class="btn btn-sm" data-reload-pairs>Try again</button></div>`;
		return;
	}
	state.pairs = r.data;
	state.pairsNetwork = network;
	const note = $('li-pairs-note');
	if (r.data.status !== 'ok') {
		note.textContent = `Chain state could not be read (${r.data.degraded_reason || r.data.stale_reason || 'rpc'}). Status shown is the last known or unknown.`;
	} else if (r.data.create_enabled === false) {
		note.textContent = 'pump.fun has creation disabled right now; quotes will be refused until it is back.';
	} else {
		note.textContent = `Read from ${network} ${relTime(r.data.read_at)}. Creator fee ${r.data.creator_fee_configurable ? 'is' : 'is not'} configurable on this network right now.`;
	}
	const current = state.pair?.id;
	const live = r.data.pairs.filter((p) => p.status === 'live');
	state.pair = r.data.pairs.find((p) => p.id === current && p.status === 'live') || live[0] || r.data.pairs[0] || null;
	renderPairs();
	renderFeeRule();
}

function renderPairs() {
	const host = $('li-pairs');
	host.innerHTML = state.pairs.pairs
		.map((p) => {
			const chosen = state.pair?.id === p.id;
			const disabled = p.status !== 'live' && p.status !== 'unknown';
			const fee = p.fees ? `LP ${p.fees.lp_bps} · protocol ${p.fees.protocol_bps} · creator ${p.fees.creator_bps} bps` : 'fee schedule unavailable';
			return `<button type="button" class="li-pair" role="radio" aria-checked="${chosen}" data-pair="${esc(p.id)}"${disabled ? ' disabled' : ''} title="${esc(p.mint || p.wrapped_mint || '')}">
				<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span class="li-pair-sym">${esc(p.symbol)}</span><span class="pill pill-${esc(p.status)}">${esc(p.status.replace(/_/g, ' '))}</span></div>
				<div class="li-pair-label">${esc(p.label)}</div>
				<div class="li-pair-meta">${esc(fee)}</div>
			</button>`;
		})
		.join('');
	$('li-buy-asset').textContent = state.pair?.symbol || 'SOL';
}

function renderFeeRule() {
	const rule = state.pair?.creator_fee || {};
	const slider = $('li-fee');
	const note = $('li-fee-note');
	if (rule.configurable) {
		slider.disabled = false;
		slider.min = String(rule.min_bps);
		slider.max = String(rule.max_bps);
		const keep = Number(slider.value);
		slider.value = String(Math.min(rule.max_bps, Math.max(rule.min_bps, Number.isFinite(keep) && slider.dataset.touched ? keep : rule.default_bps)));
		note.textContent = `You can set the creator fee between ${rule.min_bps} and ${rule.max_bps} basis points on ${state.pair.symbol} right now. It is written into the coin at launch and paid to the agent wallet on every trade.`;
	} else {
		slider.disabled = true;
		if (rule.fixed_bps != null) {
			slider.min = String(rule.fixed_bps);
			slider.max = String(rule.fixed_bps);
			slider.value = String(rule.fixed_bps);
		}
		note.textContent = rule.reason || 'The creator fee follows the pump.fun schedule for this quote.';
	}
	renderFeeValue();
}

function renderFeeValue() {
	const bps = Number($('li-fee').value) || 0;
	$('li-fee-pct').textContent = `${(bps / 100).toFixed(2)}%`;
	$('li-fee-bps').textContent = `${bps} bps`;
	const symbol = state.pair?.symbol || 'SOL';
	const scenarios = state.pair?.kind === 'sol' || !state.pair ? [10, 100, 1_000, 10_000] : [1_000, 10_000, 100_000, 1_000_000];
	$('li-earn').innerHTML = scenarios
		.map((v) => `<div><b>${fmt((v * bps) / 10_000, state.pair?.kind === 'sol' ? 4 : 2)} ${esc(symbol)}</b><span>on ${fmt(v)} ${esc(symbol)} traded</span></div>`)
		.join('');
}

// ── form ─────────────────────────────────────────────────────────────────────

function wireForm() {
	$('li-network')?.addEventListener('change', (e) => loadPairs(e.target.value));
	$('li-agent')?.addEventListener('change', fillPortrait);
	$('li-image')?.addEventListener('input', (e) => {
		e.target.dataset.touched = '1';
	});
	$('li-pairs')?.addEventListener('click', (e) => {
		const reload = e.target.closest('[data-reload-pairs]');
		if (reload) return loadPairs($('li-network').value);
		const btn = e.target.closest('[data-pair]');
		if (!btn || btn.disabled) return;
		state.pair = state.pairs.pairs.find((p) => p.id === btn.dataset.pair) || state.pair;
		renderPairs();
		renderFeeRule();
	});
	$('li-fee')?.addEventListener('input', (e) => {
		e.target.dataset.touched = '1';
		renderFeeValue();
	});
	$('li-symbol')?.addEventListener('input', (e) => {
		e.target.value = e.target.value.toUpperCase();
	});
	$('li-form')?.addEventListener('submit', createIntent);
	document.addEventListener('click', onFocusClick);
	document.addEventListener('submit', onFocusSubmit);
}

async function createIntent(e) {
	e.preventDefault();
	if (state.busy) return;
	const msg = $('li-form-msg');
	msg.className = 'li-form-msg';
	if (!state.pair) {
		msg.classList.add('err');
		msg.textContent = 'Pick a quote asset first.';
		return;
	}
	const body = {
		agent_id: $('li-agent').value,
		network: $('li-network').value,
		quote: state.pair.id,
		name: $('li-name').value.trim(),
		symbol: $('li-symbol').value.trim(),
		description: $('li-description').value.trim(),
		image_url: $('li-image').value.trim(),
		initial_buy: Number($('li-initial-buy').value) || 0,
		creator_fee_bps: state.pair.creator_fee?.configurable ? Number($('li-fee').value) : undefined,
	};
	if (!body.name || !body.symbol || !body.image_url) {
		msg.classList.add('err');
		msg.textContent = 'Name, ticker and image are required.';
		return;
	}
	state.busy = true;
	$('li-submit').disabled = true;
	msg.textContent = 'Quoting against the live curve…';
	try {
		const r = await call('/api/pump/launch-intents', { method: 'POST', body });
		if (!r.ok) {
			msg.classList.add('err');
			msg.textContent = describe(r.data, `HTTP ${r.status}`);
			if (r.data?.range) msg.textContent += ` Allowed: ${r.data.range.min_bps} to ${r.data.range.max_bps} bps.`;
			return;
		}
		storeToken(r.data.intent.id, r.data.preflight_token);
		announce('Quote ready. Opening the funding step.');
		window.location.assign(r.data.intent.links.page);
	} catch (err) {
		msg.classList.add('err');
		msg.textContent = err?.message || 'The quote could not be created.';
	} finally {
		state.busy = false;
		$('li-submit').disabled = false;
	}
}

// ── list ─────────────────────────────────────────────────────────────────────

async function loadList() {
	const host = $('li-list');
	host.innerHTML = ['', '', ''].map(() => '<div class="li-skel"><div class="skeleton" style="height:16px;width:55%"></div><div class="skeleton" style="height:12px;width:35%"></div></div>').join('');
	const r = await call('/api/pump/launch-intents?limit=40');
	if (!r.ok) {
		host.innerHTML = `<div class="notice notice-error" style="margin:0">Could not load your intents: ${esc(describe(r.data, `HTTP ${r.status}`))}</div>`;
		return;
	}
	const intents = (r.data.intents || []).filter((i) => i.id !== state.route.id);
	if (!intents.length) {
		host.innerHTML = state.route.id
			? ''
			: '<div class="li-empty"><h3>No launch intents yet</h3><p>Fill in the form above to get a quote. Nothing is charged for a quote, and an unfunded one simply expires.</p></div>';
		return;
	}
	host.innerHTML = intents.map(cardHtml).join('');
}

function cardHtml(i) {
	const total = Object.entries(i.quote?.totals || {}).map(([a, t]) => `${fmt(t.amount)} ${a}`).join(' + ') || 'free';
	return `<a class="li-card" href="${esc(i.links.page)}">
		<div class="li-card-head">
			<div>
				<div class="li-card-title">${esc(i.name)} <span style="color:var(--muted)">$${esc(i.symbol)}</span></div>
				<div class="li-card-meta"><span>${esc(i.agent?.name || 'agent')}</span><span>${esc(i.network)}</span><span>${esc(i.quote_asset?.symbol || '')} quote</span><span>${esc(total)}</span><span>${esc(relTime(i.created_at))}</span></div>
			</div>
			<span class="pill pill-${esc(i.stage)}">${esc(i.stage)}</span>
		</div>
	</a>`;
}

// ── focus ────────────────────────────────────────────────────────────────────

async function loadIntent(id, { quiet = false } = {}) {
	const host = $('li-focus');
	host.hidden = false;
	if (!quiet) host.innerHTML = '<div class="li-skel"><div class="skeleton" style="height:22px;width:45%"></div><div class="skeleton" style="height:14px;width:70%"></div><div class="skeleton" style="height:120px"></div></div>';
	const r = await call(`/api/pump/launch-intents/${encodeURIComponent(id)}`);
	if (!r.ok) {
		if (!quiet) host.innerHTML = `<div class="notice notice-error" style="margin:0">${esc(r.status === 404 ? 'That launch intent does not exist on this account.' : describe(r.data, `HTTP ${r.status}`))} <a href="/launch/intents">Back to your intents</a></div>`;
		return;
	}
	state.intent = r.data.intent;
	document.title = `${state.intent.name} ($${state.intent.symbol}) · funded launch · three.ws`;
	$('li-h1').textContent = `${state.intent.name} ($${state.intent.symbol})`;
	renderFocus();
	schedulePoll();
}

function schedulePoll() {
	clearTimeout(state.pollTimer);
	clearInterval(state.tickTimer);
	const i = state.intent;
	if (!i) return;
	if (ACTIVE_STAGES.has(i.stage) && !i.quote.expired) state.pollTimer = setTimeout(() => loadIntent(i.id, { quiet: true }), POLL_MS);
	if (i.stage === 'quote') state.tickTimer = setInterval(renderExpiry, TICK_MS);
}

function renderExpiry() {
	const el = document.querySelector('[data-expiry]');
	const i = state.intent;
	if (!el || !i) return;
	const left = new Date(i.quote.expires_at).getTime() - Date.now();
	el.classList.toggle('is-soon', left > 0 && left < SOON_MS);
	el.classList.toggle('is-over', left <= 0);
	if (left <= 0) {
		el.textContent = 'Quote expired. Ask for a new one.';
		clearInterval(state.tickTimer);
		return;
	}
	const m = Math.floor(left / 60_000);
	const s = Math.floor((left % 60_000) / 1000);
	el.textContent = `Quote holds for ${m}:${String(s).padStart(2, '0')}`;
}

function stagesHtml(i) {
	return `<ol class="li-stages" aria-label="Launch stages">${i.stages
		.map((s) => {
			const failed = (i.stage === 'failed' || i.stage === 'expired') && s.current;
			return `<li class="li-stage${s.done ? ' done' : ''}${s.current && !failed ? ' current' : ''}${failed ? ' failed' : ''}"${s.current ? ' aria-current="step"' : ''}>${esc(s.label)}${s.at ? `<time datetime="${esc(s.at)}">${esc(relTime(s.at))}</time>` : failed ? `<time>${esc(i.stage)}</time>` : ''}</li>`;
		})
		.join('')}</ol>`;
}

function linesHtml(i) {
	const q = i.quote;
	const rows = q.lines
		.map(
			(l) => `<tr class="${l.included ? 'included' : ''}"><th>${esc(l.label)}${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}${l.payee ? `<span class="note">to ${esc(l.payee)}</span>` : ''}</th><td>${l.included ? 'in the buy' : `${fmt(l.amount)} ${esc(l.asset)}`}</td></tr>`,
		)
		.join('');
	const totals = Object.entries(q.totals)
		.map(([a, t]) => `<tr class="total"><th>Total in ${esc(a)}</th><td>${fmt(t.amount)} ${esc(a)}${a === 'SOL' && q.sol_usd ? `<span class="note">≈ $${fmt(t.amount * q.sol_usd, 2)}</span>` : ''}</td></tr>`)
		.join('');
	return `<table class="li-table"><tbody>${rows}${totals}</tbody></table>${q.fees_known === false ? '<p style="margin-top:8px">The pump.fun fee schedule could not be read when this was quoted; the included fee lines are the schedule defaults.</p>' : ''}`;
}

function fundingHtml(i) {
	const f = i.funding;
	const req = Object.entries(f.required).map(([a, v]) => `${fmt(v)} ${a}`).join(' + ') || 'nothing (the quote is free)';
	const bal = f.balance ? Object.entries(f.balance).map(([a, v]) => `${fmt(v)} ${a}`).join(' · ') : 'reading…';
	const covered = f.balance && Object.entries(f.required).every(([a, v]) => Number(f.balance[a] ?? 0) >= Number(v) - 1e-9);
	let body = `<dl class="li-kv">
		<dt>Agent wallet</dt><dd><span class="mono">${esc(f.address)}</span><button type="button" class="li-copy" data-copy="${esc(f.address)}">Copy</button> <a href="${esc(f.explorer)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--muted)">Explorer</a></dd>
		<dt>Needs</dt><dd>${esc(req)}</dd>
		<dt>Holds</dt><dd>${esc(bal)}${covered ? ' <span class="pill pill-live">covered</span>' : ''}</dd>
	</dl>`;
	if (i.payment) {
		body += `<p style="margin-top:10px">Funded ${esc(relTime(i.payment.paid_at))} with <a href="${esc(i.payment.explorer)}" target="_blank" rel="noopener" class="mono">${esc(short(i.payment.signature))}</a>.</p>`;
		return body;
	}
	if (i.stage !== 'quote' || i.quote.expired) return body;
	const token = readToken(i.id);
	const walletLabel = state.wallet ? `Send from ${esc(state.wallet.name)} (${esc(short(state.wallet.address))})` : 'Connect a wallet and send';
	body += `<div class="li-actions">
		<button type="button" class="btn btn-primary" data-fund${!token || !Object.keys(f.required).length ? ' disabled' : ''}>${walletLabel}</button>
	</div>
	<details><summary>Already sent it from another wallet? Paste the signature.</summary>
		<form class="li-sig" data-pay-form><input name="signature" placeholder="Transaction signature" autocomplete="off" required /><button type="submit" class="btn btn-sm"${!token ? ' disabled' : ''}>Record payment</button></form>
	</details>
	${
		token
			? ''
			: '<p class="li-msg err">This browser does not hold the preflight token for this quote (it was created elsewhere or in another session). The token was shown once at creation; use the browser or terminal that has it, or ask for a new quote.</p>'
	}
	<p class="li-msg" data-fund-msg></p>`;
	return body;
}

function confirmHtml(i) {
	if (i.approval && i.stage === 'paid') {
		return `<p>Waiting for your yes. The request shows the recipient, amount, asset and chain; nothing signs until you approve it there.</p>
		<div class="li-actions"><a class="btn btn-primary" href="${esc(i.approval.link)}">Open the approval</a><button type="button" class="btn" data-confirm>Request again</button></div><p class="li-msg" data-confirm-msg></p>`;
	}
	if (i.stage === 'paid' || (i.stage === 'failed' && i.funding.paid)) {
		return `<p>${i.stage === 'failed' ? `The last attempt failed: ${esc(i.error || 'unknown error')}. The funds are still in the agent wallet; you can try again.` : 'The quote is funded. Confirming opens an approval request in your inbox with the exact recipient, amount, asset and chain. The agent wallet signs the create transaction only after you approve it.'}</p>
		<div class="li-actions"><button type="button" class="btn btn-primary" data-confirm>Confirm launch</button></div><p class="li-msg" data-confirm-msg></p>`;
	}
	if (i.launch) {
		return `<dl class="li-kv">
			<dt>Mint</dt><dd><span class="mono">${esc(i.mint)}</span><button type="button" class="li-copy" data-copy="${esc(i.mint)}">Copy</button></dd>
			<dt>Transaction</dt><dd><a href="${esc(i.launch.explorer)}" target="_blank" rel="noopener" class="mono">${esc(short(i.launch.signature))}</a></dd>
			${i.launch.platform_fee ? `<dt>Platform fee</dt><dd>${esc(String(i.launch.platform_fee.amount_ui ?? i.launch.platform_fee.amount))} ${esc(i.launch.platform_fee.asset || '')}</dd>` : ''}
		</dl>
		<div class="li-actions"><a class="btn btn-primary" href="${esc(i.launch.launch_url)}">Open the coin page</a><a class="btn" href="${esc(i.launch.pumpfun_url)}" target="_blank" rel="noopener">pump.fun</a>${i.approval ? `<a class="btn" href="${esc(i.approval.link)}">Approval record</a>` : ''}</div>`;
	}
	if (i.stage === 'expired') return '<p>This quote expired before it was funded. Nothing was charged. <a href="/launch/intents">Ask for a new quote</a>.</p>';
	if (i.stage === 'failed') return `<p>The launch failed: ${esc(i.error || 'unknown error')}.</p>`;
	return '<p>Fund the quote first. Confirming becomes available once the payment is recorded.</p>';
}

function dryRunHtml(i) {
	const d = i.dry_run;
	const can = !['submitted', 'confirmed', 'indexed'].includes(i.stage);
	let body = '<p>Simulates the exact create transaction against this network without a signature. On devnet nothing can reach mainnet; on mainnet a simulation never lands.</p>';
	if (d) {
		const verdictLabel = { would_succeed: 'would succeed', funding_required: 'funding required', would_fail: 'would fail', rpc_unavailable: 'RPC unavailable', compile_failed: 'could not compile', metadata_failed: 'metadata upload failed' }[d.verdict] || d.verdict;
		body += `<dl class="li-kv" style="margin-top:8px">
			<dt>Verdict</dt><dd><span class="pill pill-${d.verdict === 'would_succeed' ? 'live' : d.verdict === 'funding_required' ? 'quote' : 'failed'}">${esc(verdictLabel)}</span> <span style="font-size:12px;color:var(--dim)">${esc(relTime(d.at))}, ${esc(String(d.duration_ms))} ms</span></dd>
			${d.units_consumed != null ? `<dt>Compute</dt><dd>${fmt(d.units_consumed)} units</dd>` : ''}
			${d.error ? `<dt>Error</dt><dd class="mono">${esc(String(d.error))}</dd>` : ''}
		</dl>
		${d.logs?.length ? `<details><summary>Program logs (${d.logs.length})</summary><div class="li-logs">${esc(d.logs.join('\n'))}</div></details>` : ''}`;
	}
	if (can) body += `<div class="li-actions"><button type="button" class="btn" data-dry-run>${d ? 'Run again' : 'Dry run'}</button></div><p class="li-msg" data-dry-msg></p>`;
	return body;
}

function renderFocus() {
	const i = state.intent;
	const fee = i.creator_fee;
	const earn = fee.earnings;
	$('li-focus').innerHTML = `<article class="li-focus">
		<div class="li-focus-head">
			<div class="li-focus-title">
				<img src="${esc(i.image_url)}" alt="" width="56" height="56" loading="lazy" />
				<div>
					<h2>${esc(i.name)} <span style="color:var(--muted);font-weight:500">$${esc(i.symbol)}</span></h2>
					<p>${esc(i.agent?.name || 'Agent')} · ${esc(i.network)} · quoted in ${esc(i.quote_asset.symbol)} · created ${esc(relTime(i.created_at))}</p>
				</div>
			</div>
			<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
				<span class="pill pill-${esc(i.stage)}" style="text-transform:capitalize">${esc(i.stage)}</span>
				${i.stage === 'quote' ? '<span class="li-expiry" data-expiry></span>' : ''}
			</div>
		</div>
		${stagesHtml(i)}
		<div class="li-grid">
			<div class="li-box wide"><h3>Every fee line</h3>${linesHtml(i)}</div>
			<div class="li-box"><h3>Creator fee <span class="pill">${esc(String(fee.bps))} bps</span></h3>
				<p>${fee.configurable ? `You chose ${fee.percent}% of every trade, within the ${fee.min_bps} to ${fee.max_bps} bps this quote allowed.` : `${fee.percent}% of every trade, the schedule rate for ${esc(i.quote_asset.symbol)}.`}</p>
				${earn ? `<div class="li-earn" style="margin-top:10px">${earn.scenarios.map((s) => `<div><b>${fmt(s.earnings)} ${esc(s.quote)}</b><span>on ${fmt(s.volume)} ${esc(s.quote)} traded</span></div>`).join('')}</div>` : ''}
			</div>
			<div class="li-box"><h3>Funding ${i.funding.paid ? '<span class="pill pill-live">paid</span>' : ''}</h3>${fundingHtml(i)}</div>
			<div class="li-box wide"><h3>${i.launch ? 'Launched' : 'Confirm'} </h3>${confirmHtml(i)}</div>
			<div class="li-box wide"><h3>Dry run</h3>${dryRunHtml(i)}</div>
			${i.description ? `<div class="li-box wide"><h3>Description</h3><p>${esc(i.description)}</p></div>` : ''}
		</div>
		<p style="margin-top:14px;font-size:12px;color:var(--dim)">Intent <span class="mono">${esc(i.id)}</span> · <a href="${esc(i.links.api)}" style="color:inherit">JSON</a> · <a href="/launch/intents" style="color:inherit">All intents</a></p>
	</article>`;
	renderExpiry();
}

// ── focus actions ────────────────────────────────────────────────────────────

function setMsg(sel, text, kind = '') {
	const el = document.querySelector(sel);
	if (!el) return;
	el.className = `li-msg${kind ? ` ${kind}` : ''}`;
	el.textContent = text;
}

async function onFocusClick(e) {
	const copy = e.target.closest('[data-copy]');
	if (copy) {
		try {
			await navigator.clipboard.writeText(copy.dataset.copy);
			copy.textContent = 'Copied';
			setTimeout(() => (copy.textContent = 'Copy'), 1200);
		} catch {
			copy.textContent = 'Select it';
		}
		return;
	}
	if (e.target.closest('[data-fund]')) return fundFromWallet(e.target.closest('[data-fund]'));
	if (e.target.closest('[data-confirm]')) return confirmLaunch(e.target.closest('[data-confirm]'));
	if (e.target.closest('[data-dry-run]')) return dryRun(e.target.closest('[data-dry-run]'));
}

async function onFocusSubmit(e) {
	const form = e.target.closest('[data-pay-form]');
	if (!form) return;
	e.preventDefault();
	const sig = form.signature.value.trim();
	if (!sig) return;
	await recordPayment(sig, form.querySelector('button'));
}

async function recordPayment(signature, btn) {
	const i = state.intent;
	const token = readToken(i.id);
	if (!token) return setMsg('[data-fund-msg]', 'No preflight token in this browser for this quote.', 'err');
	if (btn) btn.disabled = true;
	setMsg('[data-fund-msg]', 'Checking the transfer on-chain…');
	const r = await call(`/api/pump/launch-intents/${encodeURIComponent(i.id)}/pay`, { method: 'POST', body: { signature, preflight_token: token } });
	if (!r.ok) {
		if (btn) btn.disabled = false;
		let text = describe(r.data, `HTTP ${r.status}`);
		if (r.data?.shortfall) text += ` Short by ${Object.entries(r.data.shortfall).map(([a, v]) => `${fmt(v)} ${a}`).join(', ')}.`;
		if (r.status === 422 && r.data?.error === 'tx_not_found') text += ' If you just sent it, wait a few seconds and record it again.';
		return setMsg('[data-fund-msg]', text, 'err');
	}
	announce(r.data.replayed ? 'Payment already recorded.' : 'Payment recorded. You can confirm the launch now.');
	await loadIntent(i.id, { quiet: true });
}

async function ensureWallet() {
	if (state.wallet) return state.wallet;
	state.wallet = (await restoreLaunchWallet()) || (await connectLaunchWallet());
	return state.wallet;
}

async function fundFromWallet(btn) {
	const i = state.intent;
	if (state.busy) return;
	state.busy = true;
	btn.disabled = true;
	try {
		if (!injectedProvider()) throw Object.assign(new Error('No Solana wallet found in this browser. Install one, or send the amount from any wallet and paste the signature below.'), { code: 'NO_PROVIDER' });
		setMsg('[data-fund-msg]', 'Connecting your wallet…');
		const wallet = await ensureWallet();
		btn.textContent = `Send from ${wallet.name} (${short(wallet.address)})`;
		setMsg('[data-fund-msg]', 'Review the transfer in your wallet. It goes to the agent wallet shown above, on the network of this quote.');
		const signature = await sendFunding({ from: wallet.address, intent: i });
		setMsg('[data-fund-msg]', `Sent ${short(signature)}. Waiting for confirmation…`);
		await waitForSignature(signature, i.network);
		await recordPayment(signature, null);
	} catch (err) {
		setMsg('[data-fund-msg]', err?.message || 'The transfer did not go through.', 'err');
		btn.disabled = false;
	} finally {
		state.busy = false;
	}
}

// Build and send the funding transfer with the connected wallet. SOL is a
// system transfer; a stable quote is an SPL transfer that also creates the
// agent wallet's token account when it does not exist yet. The transaction
// also pays the SOL leg of a stable quote (rent and network fees) in the same
// signature, so one wallet prompt funds the whole quote.
async function sendFunding({ from, intent }) {
	const [web3, spl] = await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
	const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = web3;
	const connection = new Connection(`${window.location.origin}/api/solana-rpc${intent.network === 'devnet' ? '?net=devnet' : ''}`, 'confirmed');
	const payer = new PublicKey(from);
	const to = new PublicKey(intent.funding.address);
	const required = intent.funding.required;
	const balance = intent.funding.balance || {};
	const tx = new Transaction();
	let legs = 0;
	for (const [asset, amount] of Object.entries(required)) {
		// Send only what the agent wallet is still missing, so a partly funded
		// quote is topped up instead of paid twice.
		const missing = Math.max(0, Number(amount) - Number(balance[asset] ?? 0));
		if (missing <= 0) continue;
		if (asset === 'SOL') {
			tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: Math.ceil(missing * LAMPORTS_PER_SOL) }));
			legs += 1;
			continue;
		}
		const mint = new PublicKey(intent.quote_asset.mint);
		const decimals = intent.quote_asset.decimals;
		const fromAta = spl.getAssociatedTokenAddressSync(mint, payer);
		const toAta = spl.getAssociatedTokenAddressSync(mint, to, true);
		tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(payer, toAta, to, mint));
		tx.add(spl.createTransferInstruction(fromAta, toAta, payer, BigInt(Math.ceil(missing * 10 ** decimals))));
		legs += 1;
	}
	if (!legs) throw new Error('The agent wallet already holds the quoted amount. Record a payment signature, or confirm the launch if it is already recorded.');
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.feePayer = payer;
	const provider = injectedProvider();
	let signed;
	try {
		signed = await provider.signTransaction(tx);
	} catch (err) {
		if (err?.code === 4001 || /reject|denied|cancel/i.test(err?.message || '')) throw new Error('Signature cancelled.');
		throw err;
	}
	return connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
}

async function waitForSignature(signature, network, timeoutMs = 75_000) {
	const { Connection } = await import('@solana/web3.js');
	const connection = new Connection(`${window.location.origin}/api/solana-rpc${network === 'devnet' ? '?net=devnet' : ''}`, 'confirmed');
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
		const status = value?.[0];
		if (status?.err) throw new Error(`The transfer failed on-chain: ${JSON.stringify(status.err)}`);
		if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
		await new Promise((r) => setTimeout(r, 1_500));
	}
	throw new Error(`The transfer ${short(signature)} has not confirmed yet. Paste the signature below once it lands.`);
}

async function confirmLaunch(btn) {
	const i = state.intent;
	btn.disabled = true;
	setMsg('[data-confirm-msg]', 'Preparing the mint and asking for your approval…');
	const r = await call(`/api/pump/launch-intents/${encodeURIComponent(i.id)}/confirm`, { method: 'POST', body: {} });
	if (!r.ok) {
		btn.disabled = false;
		return setMsg('[data-confirm-msg]', describe(r.data, `HTTP ${r.status}`), 'err');
	}
	announce('Approval request created.');
	await loadIntent(i.id, { quiet: true });
	if (r.data.created && r.data.approval?.link) window.location.assign(`${r.data.approval.link}?from=launch-intent`);
}

async function dryRun(btn) {
	const i = state.intent;
	btn.disabled = true;
	setMsg('[data-dry-msg]', 'Simulating the create transaction…');
	const r = await call(`/api/pump/launch-intents/${encodeURIComponent(i.id)}/dry-run`, { method: 'POST', body: {} });
	if (!r.ok) {
		btn.disabled = false;
		return setMsg('[data-dry-msg]', describe(r.data, `HTTP ${r.status}`), 'err');
	}
	state.intent = r.data.intent;
	renderFocus();
	announce(`Dry run: ${r.data.dry_run.verdict.replace(/_/g, ' ')}.`);
}

boot().catch((err) => showError(err?.message || 'The page could not load.'));
