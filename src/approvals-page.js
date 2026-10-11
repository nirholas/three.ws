// Approval inbox (pages/approvals.html, routes /approvals and /approvals/:id).
//
// Every gated agent action that needs the owner's yes lands here as a card with
// the confirmation table (recipient, amount, asset, chain) and its risk notes.
// Approve posts the payload_hash the owner is looking at, so the server refuses
// to run anything that differs from what was shown; a deep link from a push,
// email or chat message carries a signed token (?t=) that the server verifies
// against the request on file before the card is trusted.
//
// Also hosts the per-account auto-approve rules and the approval audit log.
// API: api/approvals/*.js, api/audit-log.js. Doc: docs/approvals.md.

import { apiFetch } from './api.js';
import { escNotif as esc, relTime } from './notifications.js';
import { isPushSupported, getPushState, enablePush } from './push-notifications.js';

const PAGE_SIZE = 20;
const TICK_MS = 10_000;
const SOON_MS = 3 * 60_000;

const GROUP_OF = {
	pending: 'pending',
	approved: 'done', executing: 'done', executed: 'done', failed: 'done',
	denied: 'denied',
	expired: 'expired',
};

const STATUS_LABEL = {
	pending: 'Pending', approved: 'Approved', executing: 'Executing', executed: 'Executed',
	failed: 'Failed', denied: 'Denied', expired: 'Expired',
};

const VIA_LABEL = {
	web: 'on the web', push: 'from a push notification', telegram: 'in Telegram', mobile: 'in the app',
	email: 'from email', auto_policy: 'by an auto-approve rule', bulk: 'in a bulk deny',
};

const LINK_PROBLEM = {
	malformed: 'This link is incomplete. Review the request below before deciding.',
	bad_signature: 'This link was not issued by three.ws. Do not trust where it came from; review the request below.',
	wrong_request: 'This link belongs to a different request. Review the request below before deciding.',
	payload_changed: 'The action on file no longer matches the one in your link, so the link will not approve it. Review what is on file below.',
	expired: 'This link has expired.',
};

const EMPTY_COPY = {
	pending: ['✅', 'Nothing waiting on you', 'When an agent wants to do something that crosses one of your guardrails, it pauses here and asks. You will get a push, chat message or email with a link straight to it.'],
	done: ['🗂', 'No approved actions yet', 'Actions you approve, and what happened when they ran, show up here.'],
	denied: ['🛑', 'Nothing denied', 'Requests you turn down are kept here so you can see what your agents tried.'],
	expired: ['⏳', 'Nothing expired', 'A request you do not answer in time expires and never runs. Those land here.'],
	all: ['🛂', 'No approval requests yet', 'Set guardrails on an agent wallet and any action that trips one will wait here for your yes.'],
};

const AUDIT_LABEL = {
	approval_requested: ['Requested', 'warn'],
	approval_auto_approved: ['Auto-approved', 'ok'],
	approval_approved: ['Approved', 'ok'],
	approval_denied: ['Denied', 'bad'],
	approval_executed: ['Executed', 'ok'],
	approval_failed: ['Failed', 'bad'],
	approval_policy_created: ['Rule added', ''],
	approval_policy_revoked: ['Rule revoked', ''],
};

const state = {
	group: 'pending',
	agent: '',
	items: [],
	cursor: null,
	counts: {},
	agents: [],
	selected: new Set(),
	focus: null,
	focusToken: null,
	loading: false,
	auditCursor: null,
	venues: [],
	maxCap: 0,
	ownAgents: [],
};

const $ = (id) => document.getElementById(id);
const els = {};

// ── API ─────────────────────────────────────────────────────────────────────────

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

function errText(r, fallback) {
	return r.data?.error_description || r.data?.error || fallback;
}

function announce(msg) {
	els.live.textContent = '';
	requestAnimationFrame(() => { els.live.textContent = msg; });
}

function showError(msg, retry) {
	els.error.innerHTML = `<strong>${esc(msg)}</strong>${retry ? '<br><button type="button" class="btn btn-sm" data-retry>Try again</button>' : ''}`;
	els.error.hidden = false;
	if (retry) els.error.querySelector('[data-retry]').addEventListener('click', () => { els.error.hidden = true; retry(); }, { once: true });
}

// ── formatting ──────────────────────────────────────────────────────────────────

function timeLeft(iso) {
	return new Date(iso).getTime() - Date.now();
}

function fmtLeft(ms) {
	if (ms <= 0) return 'Expired';
	const m = Math.floor(ms / 60_000);
	if (m < 1) return 'Expires in under a minute';
	if (m < 60) return `Expires in ${m} min`;
	const h = Math.floor(m / 60);
	return `Expires in ${h}h ${m % 60}m`;
}

function fmtDate(iso) {
	return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function liveStatus(item) {
	return item.status === 'pending' && timeLeft(item.expires_at) <= 0 ? 'expired' : item.status;
}

// ── cards ───────────────────────────────────────────────────────────────────────

function tableHtml(item) {
	const rows = (item.confirmation || []).map((r) => {
		const mono = r.key === 'recipient' && r.full;
		const copy = r.full ? `<button type="button" class="ap-copy" data-copy="${esc(r.full)}" aria-label="Copy full ${esc(r.label.toLowerCase())}">Copy</button>` : '';
		return `<tr><th scope="row">${esc(r.label)}</th><td${mono ? ' class="mono"' : ''} title="${esc(r.full || r.value)}">${esc(r.value)}${copy}</td></tr>`;
	}).join('');
	return `<table class="ap-table"><caption class="sr-only">${item.status === 'pending' ? 'What approving will do' : 'The action this request covered'}</caption><tbody>${rows}</tbody></table>`;
}

function outcomeHtml(item) {
	const s = liveStatus(item);
	const decided = item.decided_at ? `${STATUS_LABEL[item.status === 'denied' ? 'denied' : 'approved']} ${VIA_LABEL[item.decided_via] || ''} ${relTime(item.decided_at)}.` : '';
	if (s === 'executed') {
		const tx = item.explorer ? ` <a href="${esc(item.explorer)}" target="_blank" rel="noopener">View transaction</a>` : '';
		return `<div class="ap-outcome">${esc(decided)} Executed${item.executed_at ? ` ${esc(relTime(item.executed_at))}` : ''}.${item.result?.note ? ` ${esc(item.result.note)}` : ''}${tx}</div>`;
	}
	if (s === 'failed') {
		return `<div class="ap-outcome">${esc(decided)} <strong>It did not execute:</strong> ${esc(item.result?.note || 'the action failed when it ran.')} Nothing else will be attempted for this request.</div>`;
	}
	if (s === 'approved' || s === 'executing') {
		return `<div class="ap-outcome">${esc(decided)} Executing now. This page updates when it settles.</div>`;
	}
	if (s === 'denied') return `<div class="ap-outcome">${esc(decided)} Nothing was executed.</div>`;
	if (s === 'expired') return '<div class="ap-outcome">Expired without an answer. Nothing was executed; the agent will ask again if the action is still wanted.</div>';
	return '';
}

function cardHtml(item, { focus = false } = {}) {
	const s = liveStatus(item);
	const pending = s === 'pending';
	const agent = item.agent?.name
		? `<a href="/agent/${esc(item.agent.id)}">${esc(item.agent.name)}</a>`
		: (item.agent ? 'An agent' : 'Your account');
	const risks = item.risk_notes?.length
		? `<ul class="ap-risks" aria-label="Risk notes">${item.risk_notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
		: '';
	const gate = item.gate_reason ? `<p class="ap-gate">Why it asked: ${esc(item.gate_reason)}</p>` : '';
	const left = timeLeft(item.expires_at);
	const check = pending && !focus
		? `<label class="ap-check"><input type="checkbox" data-select="${esc(item.id)}"${state.selected.has(item.id) ? ' checked' : ''} /><span class="sr-only">Select for bulk deny</span></label>`
		: '';
	const foot = pending
		? `<div class="ap-foot">
				<span class="ap-expiry${left < SOON_MS ? ' is-soon' : ''}" data-expiry="${esc(item.expires_at)}">${esc(fmtLeft(left))}</span>
				<div class="ap-actions">
					<button type="button" class="btn btn-deny" data-deny="${esc(item.id)}">Deny</button>
					<button type="button" class="btn btn-approve" data-approve="${esc(item.id)}">Approve</button>
				</div>
			</div>`
		: outcomeHtml(item);
	return `<article class="ap-card${focus ? ' is-focus' : ''}" data-id="${esc(item.id)}" aria-label="${esc(item.summary)}">
		<div class="ap-head">
			${check}
			<div class="ap-title">
				<div class="ap-summary">${esc(item.summary)}</div>
				<div class="ap-meta"><span>${agent}</span><span>${esc(item.venue_label || item.action_type)}</span><span title="${esc(fmtDate(item.created_at))}">${esc(relTime(item.created_at))}</span></div>
			</div>
			<span class="pill pill-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>
		</div>
		${tableHtml(item)}
		${risks}
		${gate}
		${foot}
		<div class="ap-card-msg" data-msg role="status"></div>
		${focus ? `<p class="ap-hash" title="The exact action approving will run is pinned to this fingerprint">Action fingerprint ${esc(item.payload_hash)}</p>` : ''}
	</article>`;
}

function skeletonHtml(n = 3) {
	return Array.from({ length: n }, () => `
		<div class="ap-skel" aria-hidden="true">
			<div class="skeleton" style="height:16px;width:62%"></div>
			<div class="skeleton" style="height:11px;width:34%"></div>
			<div class="skeleton" style="height:120px;width:100%;border-radius:10px"></div>
		</div>`).join('');
}

function emptyHtml() {
	const [icon, title, body] = EMPTY_COPY[state.group];
	const filtered = state.agent ? '<button type="button" class="btn" data-clear-agent>Show every agent</button>' : '';
	const cta = !filtered && state.group === 'pending' ? '<a class="btn" href="/dashboard/wallets">Review wallet guardrails</a>' : filtered;
	return `<div class="ap-empty"><div class="ap-empty-icon" aria-hidden="true">${icon}</div><h3>${esc(title)}</h3><p>${esc(body)}</p>${cta}</div>`;
}

// ── list ────────────────────────────────────────────────────────────────────────

function visibleItems() {
	return state.focus ? state.items.filter((i) => i.id !== state.focus.id) : state.items;
}

function renderList() {
	const items = visibleItems();
	els.list.innerHTML = items.length ? items.map((i) => cardHtml(i)).join('') : emptyHtml();
	els.more.hidden = !state.cursor;
	renderToolbar();
}

function renderCounts() {
	for (const el of document.querySelectorAll('[data-count]')) {
		const n = state.counts[el.dataset.count] || 0;
		el.textContent = n > 99 ? '99+' : String(n);
		el.classList.toggle('has', n > 0);
	}
	document.title = state.counts.pending ? `(${state.counts.pending}) Approvals · three.ws` : 'Approvals · three.ws';
}

function renderToolbar() {
	const pendingIds = visibleItems().filter((i) => liveStatus(i) === 'pending').map((i) => i.id);
	for (const id of [...state.selected]) if (!pendingIds.includes(id)) state.selected.delete(id);
	els.selectAllWrap.hidden = pendingIds.length < 2;
	els.selectAll.checked = pendingIds.length > 0 && pendingIds.every((id) => state.selected.has(id));
	els.selectAll.indeterminate = state.selected.size > 0 && !els.selectAll.checked;
	els.bulk.hidden = pendingIds.length < 1;
	els.bulk.disabled = state.selected.size === 0;
	els.bulk.textContent = state.selected.size ? `Deny selected (${state.selected.size})` : 'Deny selected';

	const options = ['<option value="">All agents</option>', ...state.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || 'Unnamed agent')}</option>`)];
	els.agent.innerHTML = options.join('');
	els.agent.value = state.agent;
	els.agent.hidden = state.agents.length < 2 && !state.agent;
}

async function loadList({ reset = true } = {}) {
	if (state.loading) return;
	state.loading = true;
	if (reset) {
		state.cursor = null;
		state.items = [];
		els.list.innerHTML = skeletonHtml();
		els.list.setAttribute('aria-busy', 'true');
	}
	els.moreBtn.disabled = true;
	const qs = new URLSearchParams({ status: state.group, limit: String(PAGE_SIZE) });
	if (state.agent) qs.set('agent', state.agent);
	if (!reset && state.cursor) qs.set('cursor', state.cursor);
	try {
		const r = await call(`/api/approvals?${qs}`);
		if (r.status === 401) return showAuthWall();
		if (!r.ok) {
			if (reset) els.list.innerHTML = '';
			return showError(`Could not load your approvals. ${errText(r, '')}`.trim(), () => loadList({ reset }));
		}
		els.error.hidden = true;
		state.items = reset ? r.data.items : [...state.items, ...r.data.items];
		state.cursor = r.data.next_cursor;
		state.counts = r.data.counts || {};
		state.agents = r.data.agents || [];
		els.main.hidden = false;
		renderCounts();
		renderList();
	} catch {
		if (reset) els.list.innerHTML = '';
		showError('Could not reach three.ws. Check your connection.', () => loadList({ reset }));
	} finally {
		state.loading = false;
		els.moreBtn.disabled = false;
		els.list.removeAttribute('aria-busy');
	}
}

function setGroup(group) {
	if (group === state.group) return;
	state.group = group;
	state.selected.clear();
	for (const t of els.tabs.querySelectorAll('.ap-tab')) t.setAttribute('aria-selected', String(t.dataset.group === group));
	loadList();
}

// ── decisions ───────────────────────────────────────────────────────────────────

function findItem(id) {
	if (state.focus?.id === id) return state.focus;
	return state.items.find((i) => i.id === id) || null;
}

function cardMsg(card, text, kind = '') {
	const el = card?.querySelector('[data-msg]');
	if (!el) return;
	el.className = `ap-card-msg${kind ? ` ${kind}` : ''}`;
	el.innerHTML = text;
}

function moveCount(fromStatus, toStatus) {
	const from = GROUP_OF[fromStatus];
	const to = GROUP_OF[toStatus];
	if (!from || !to || from === to) return;
	state.counts[from] = Math.max(0, (state.counts[from] || 0) - 1);
	state.counts[to] = (state.counts[to] || 0) + 1;
	renderCounts();
}

function replaceItem(next) {
	const prev = findItem(next.id);
	if (prev) moveCount(liveStatus(prev), next.status);
	if (state.focus?.id === next.id) state.focus = { ...state.focus, ...next };
	state.items = state.items.map((i) => (i.id === next.id ? { ...i, ...next } : i));
}

function rerenderCard(id, msg, kind) {
	const item = findItem(id);
	for (const card of document.querySelectorAll(`.ap-card[data-id="${CSS.escape(id)}"]`)) {
		const focus = card.classList.contains('is-focus');
		card.outerHTML = cardHtml(item, { focus });
	}
	if (msg) for (const card of document.querySelectorAll(`.ap-card[data-id="${CSS.escape(id)}"]`)) cardMsg(card, msg, kind);
	renderToolbar();
}

function outcomeMessage(req, idempotent) {
	if (idempotent) return ['This was already decided earlier. Nothing ran twice.', ''];
	if (req.status === 'executed') return ['Approved and executed.', 'ok'];
	if (req.status === 'failed') return [`Approved, but it did not execute: ${esc((req.result?.note || 'the action failed').replace(/\.$/, ''))}.`, 'err'];
	if (req.status === 'denied') return ['Denied. Nothing was executed.', ''];
	return ['Approved. Executing now.', 'ok'];
}

async function decide(id, decision) {
	const item = findItem(id);
	if (!item) return;
	const cards = document.querySelectorAll(`.ap-card[data-id="${CSS.escape(id)}"]`);
	for (const c of cards) for (const b of c.querySelectorAll('[data-approve],[data-deny]')) b.disabled = true;
	const btn = document.querySelector(`.ap-card[data-id="${CSS.escape(id)}"] [data-${decision}]`);
	if (btn) btn.textContent = decision === 'approve' ? 'Approving…' : 'Denying…';

	const body = { decision, via: 'web' };
	if (decision === 'approve') body.payload_hash = item.payload_hash;
	if (state.focus?.id === id && state.focusToken) body.token = state.focusToken;

	let r;
	try {
		r = await call(`/api/approvals/${encodeURIComponent(id)}`, { method: 'POST', body });
	} catch {
		rerenderCard(id, 'Could not reach three.ws, so nothing was decided. Try again.', 'err');
		return;
	}
	if (r.ok) {
		const [msg, kind] = outcomeMessage(r.data.request, r.data.idempotent);
		replaceItem(r.data.request);
		rerenderCard(id, msg, kind);
		announce(msg.replace(/<[^>]+>/g, ''));
		loadAudit();
		if (r.data.request.status === 'approved' || r.data.request.status === 'executing') pollUntilSettled(id);
		return;
	}
	if (r.status === 410) {
		replaceItem({ ...item, status: 'expired' });
		rerenderCard(id, esc(errText(r, 'This request expired. Nothing was executed.')), 'err');
		return;
	}
	if (r.data?.error === 'payload_mismatch' || r.data?.error === 'link_mismatch') {
		await refreshOne(id);
		rerenderCard(id, `${esc(errText(r, 'The action changed.'))} The card now shows what is on file.`, 'err');
		return;
	}
	if (r.data?.error === 'already_denied' || r.data?.error === 'already_decided') {
		await refreshOne(id);
		rerenderCard(id, esc(errText(r, 'Already decided.')), 'err');
		return;
	}
	rerenderCard(id, esc(errText(r, 'That did not go through. Nothing was decided.')), 'err');
}

async function refreshOne(id) {
	const r = await call(`/api/approvals/${encodeURIComponent(id)}`).catch(() => null);
	if (r?.ok) replaceItem(r.data.request);
}

// An approved action executes inside the decision request, so this only runs
// when the server answered before the chain settled.
async function pollUntilSettled(id, attempt = 0) {
	if (attempt >= 6) return;
	await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
	await refreshOne(id);
	const item = findItem(id);
	if (!item) return;
	if (item.status === 'approved' || item.status === 'executing') return pollUntilSettled(id, attempt + 1);
	const [msg, kind] = outcomeMessage(item, false);
	rerenderCard(id, msg, kind);
}

function armApprove(btn) {
	if (btn.classList.contains('is-armed')) {
		decide(btn.dataset.approve, 'approve');
		return;
	}
	disarmAll();
	btn.classList.add('is-armed');
	btn.textContent = 'Confirm approve';
	announce('Press approve again to confirm. Escape cancels.');
}

function disarmAll() {
	for (const b of document.querySelectorAll('.btn-approve.is-armed')) {
		b.classList.remove('is-armed');
		b.textContent = 'Approve';
	}
}

async function bulkDeny() {
	const ids = [...state.selected];
	if (!ids.length) return;
	els.bulk.disabled = true;
	els.bulk.textContent = `Denying ${ids.length}…`;
	try {
		const r = await call('/api/approvals', { method: 'POST', body: { action: 'bulk_deny', ids } });
		if (!r.ok) {
			showError(`Bulk deny failed: ${errText(r, 'unknown error')}. Nothing was denied.`);
			return;
		}
		const denied = new Set(r.data.denied);
		for (const id of denied) {
			const card = els.list.querySelector(`.ap-card[data-id="${CSS.escape(id)}"]`);
			if (card) card.classList.add('is-leaving');
			const item = findItem(id);
			if (item) moveCount(liveStatus(item), 'denied');
			state.selected.delete(id);
		}
		const skipped = r.data.skipped?.length || 0;
		announce(`Denied ${denied.size}${skipped ? `, ${skipped} were already decided` : ''}.`);
		await new Promise((resolve) => setTimeout(resolve, 250));
		if (state.group === 'pending') state.items = state.items.filter((i) => !denied.has(i.id));
		else state.items = state.items.map((i) => (denied.has(i.id) ? { ...i, status: 'denied' } : i));
		if (state.focus && denied.has(state.focus.id)) state.focus = { ...state.focus, status: 'denied' };
		renderList();
		if (state.focus) renderFocus();
		loadAudit();
	} catch {
		showError('Could not reach three.ws. Nothing was denied.');
	} finally {
		renderToolbar();
	}
}

// ── deep link ───────────────────────────────────────────────────────────────────

function renderFocus(banner = '') {
	if (!state.focus) { els.focus.hidden = true; return; }
	els.focus.innerHTML = `${banner || els.focus.dataset.banner || ''}${cardHtml(state.focus, { focus: true })}<div class="ap-bar"><a class="btn btn-sm" href="/approvals">Back to all approvals</a></div>`;
	if (banner) els.focus.dataset.banner = banner;
	els.focus.hidden = false;
}

async function loadFocus(id) {
	els.focus.hidden = false;
	els.focus.innerHTML = skeletonHtml(1);
	const qs = state.focusToken ? `?t=${encodeURIComponent(state.focusToken)}` : '';
	let r;
	try {
		r = await call(`/api/approvals/${encodeURIComponent(id)}${qs}`);
	} catch {
		els.focus.innerHTML = '<div class="notice notice-error">Could not load this request. Check your connection and reload.</div>';
		return;
	}
	if (r.status === 401) return showAuthWall();
	if (!r.ok) {
		const nf = r.status === 404 || r.status === 400;
		els.focus.innerHTML = `<div class="notice notice-warn"><strong>${nf ? 'This request is not on your account.' : esc(errText(r, 'Could not load this request.'))}</strong>${nf ? ' It may belong to a different sign-in. Your other approvals are below.' : ''}</div>`;
		return;
	}
	const req = r.data.request;
	state.focus = req;
	let banner = '';
	if (state.focusToken && req.link_verified) {
		banner = '<div class="notice notice-ok"><strong>Link verified.</strong> This matches the request on file, signed by three.ws. Check the table, then decide.</div>';
	} else if (state.focusToken && req.link_problem) {
		banner = `<div class="notice notice-warn"><strong>Check this carefully.</strong> ${esc(LINK_PROBLEM[req.link_problem] || 'This link could not be verified.')}</div>`;
		if (req.link_problem !== 'expired') state.focusToken = null;
	}
	renderFocus(banner);
	els.focus.querySelector('.ap-card')?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ── auto-approve rules ──────────────────────────────────────────────────────────

function policyHtml(p) {
	const venues = p.venues.map((v) => state.venues.find((x) => x.key === v)?.label || v).join(', ');
	const scope = p.agent ? `Only ${esc(p.agent.name || 'one agent')}` : 'Every agent';
	let when = `added ${relTime(p.created_at)}`;
	if (p.revoked_at) when = `revoked ${relTime(p.revoked_at)}`;
	else if (!p.active) when = 'expired';
	else if (p.expires_at) when += `, ends ${fmtDate(p.expires_at)}`;
	return `<div class="ap-policy${p.active ? '' : ' is-off'}">
		<div class="ap-policy-body">
			<div class="ap-policy-label">Up to $${esc(p.max_usd.toLocaleString())} per action: ${esc(venues)}</div>
			<div class="ap-policy-meta">${scope} · ${esc(when)}</div>
		</div>
		${p.active ? `<button type="button" class="btn btn-deny btn-sm" data-revoke="${esc(p.id)}">Revoke</button>` : ''}
	</div>`;
}

function renderPolicies(policies) {
	const live = policies.filter((p) => p.active);
	els.policies.innerHTML = policies.length
		? policies.map(policyHtml).join('')
		: '<div class="notice notice-info"><strong>No rules: every gated action asks you.</strong> That is the safest setting. Add a rule only for small actions you would always say yes to.</div>';
	if (live.length === 0 && policies.length) {
		els.policies.insertAdjacentHTML('afterbegin', '<div class="notice notice-info">No rule is active, so every gated action asks you.</div>');
	}
}

async function loadPolicies() {
	const [r, agents] = await Promise.all([
		call('/api/approvals/policies').catch(() => null),
		call('/api/agents').catch(() => null),
	]);
	if (!r?.ok) {
		els.policies.innerHTML = '<div class="notice notice-error">Could not load your auto-approve rules. <button type="button" class="btn btn-sm" data-reload-policies>Try again</button></div>';
		return;
	}
	state.venues = r.data.venues || [];
	state.maxCap = r.data.max_usd_cap || 0;
	els.venues.innerHTML = state.venues.map((v, i) => `<label class="ap-check"><input type="checkbox" name="venue" value="${esc(v.key)}"${i === 0 ? ' checked' : ''} /><span>${esc(v.label)}</span></label>`).join('');
	els.max.max = String(state.maxCap);
	els.max.placeholder = `e.g. ${Math.min(25, state.maxCap)}`;
	els.maxHint.textContent = `Anything above this, or above $${state.maxCap.toLocaleString()} in any case, still asks.`;
	state.ownAgents = agents?.ok ? (agents.data.agents || []) : [];
	els.policyAgent.innerHTML = ['<option value="">Every agent I own</option>', ...state.ownAgents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || 'Unnamed agent')}</option>`)].join('');
	renderPolicies(r.data.policies || []);
}

async function createPolicy(e) {
	e.preventDefault();
	const venues = [...els.venues.querySelectorAll('input[name="venue"]:checked')].map((i) => i.value);
	const max = Number(els.max.value);
	const msg = (t, err = false) => { els.formMsg.textContent = t; els.formMsg.className = `ap-form-msg${err ? ' err' : ''}`; };
	if (!venues.length) return msg('Pick at least one venue.', true);
	if (!Number.isFinite(max) || max <= 0 || max > state.maxCap) {
		els.max.focus();
		return msg(`Enter a dollar amount between 1 and ${state.maxCap.toLocaleString()}.`, true);
	}
	const body = { venues, max_usd: max };
	if (els.policyAgent.value) body.agent_id = els.policyAgent.value;
	const days = Number(els.policyExpiry.value);
	if (days) body.expires_at = new Date(Date.now() + days * 86_400_000).toISOString();
	els.policySubmit.disabled = true;
	msg('Saving…');
	try {
		const r = await call('/api/approvals/policies', { method: 'POST', body });
		if (!r.ok) return msg(errText(r, 'Could not save the rule.'), true);
		msg('Rule added. It applies to the next request.');
		els.max.value = '';
		await loadPolicies();
		loadAudit();
	} catch {
		msg('Could not reach three.ws. The rule was not saved.', true);
	} finally {
		els.policySubmit.disabled = false;
	}
}

async function revokePolicy(btn) {
	btn.disabled = true;
	btn.textContent = 'Revoking…';
	try {
		const r = await call(`/api/approvals/policies?id=${encodeURIComponent(btn.dataset.revoke)}`, { method: 'DELETE' });
		if (!r.ok) {
			btn.disabled = false;
			btn.textContent = 'Revoke';
			showError(`Could not revoke the rule: ${errText(r, 'unknown error')}. It is still active.`);
			return;
		}
		announce('Rule revoked. Every matching action asks you again.');
		await loadPolicies();
		loadAudit();
	} catch {
		btn.disabled = false;
		btn.textContent = 'Revoke';
		showError('Could not reach three.ws. The rule is still active.');
	}
}

// ── audit log ───────────────────────────────────────────────────────────────────

function auditDetail(ev) {
	const m = ev.meta || {};
	const parts = [];
	if (m.summary) parts.push(m.summary);
	else if (m.venues) parts.push(`${m.venues.map((v) => state.venues.find((x) => x.key === v)?.label || v).join(', ')} up to $${m.max_usd}`);
	if (m.note) parts.push(m.note);
	if (m.bulk) parts.push(VIA_LABEL.bulk);
	else if (m.via && VIA_LABEL[m.via]) parts.push(VIA_LABEL[m.via]);
	return parts.join(' · ');
}

function auditRowHtml(ev) {
	const [label, kind] = AUDIT_LABEL[ev.action] || [ev.action.replace(/^approval_/, '').replace(/_/g, ' '), ''];
	const isRequest = !ev.action.startsWith('approval_policy_') && ev.resource_id;
	const detail = esc(auditDetail(ev));
	const linked = isRequest ? `<a href="/approvals/${esc(ev.resource_id)}">${detail || 'View request'}</a>` : detail;
	return `<div class="ap-audit-row">
		<span class="ap-audit-act ${kind}">${esc(label)}</span>
		<span class="ap-audit-detail">${linked}</span>
		<span class="ap-audit-time" title="${esc(fmtDate(ev.created_at))}">${esc(relTime(ev.created_at))}</span>
	</div>`;
}

async function loadAudit({ more = false } = {}) {
	if (!more) state.auditCursor = null;
	const qs = new URLSearchParams({ action_prefix: 'approval_', limit: '15' });
	if (more && state.auditCursor) qs.set('cursor', state.auditCursor);
	els.auditMoreBtn.disabled = true;
	try {
		const r = await call(`/api/audit-log?${qs}`);
		if (!r.ok) {
			if (!more) els.audit.innerHTML = '<div class="ap-audit-empty">Could not load the audit log. Reload the page to try again.</div>';
			return;
		}
		const rows = r.data.items || [];
		const html = rows.map(auditRowHtml).join('');
		if (more) els.audit.insertAdjacentHTML('beforeend', html);
		else els.audit.innerHTML = html || '<div class="ap-audit-empty">No approval activity yet. Requests, decisions and rule changes will be recorded here.</div>';
		state.auditCursor = r.data.next_cursor || null;
		els.auditMore.hidden = !state.auditCursor;
	} catch {
		if (!more) els.audit.innerHTML = '<div class="ap-audit-empty">Could not reach three.ws to load the audit log.</div>';
	} finally {
		els.auditMoreBtn.disabled = false;
	}
}

// ── push ────────────────────────────────────────────────────────────────────────

async function initPush() {
	if (!isPushSupported()) return;
	const s = await getPushState();
	els.push.hidden = false;
	if (s.subscribed) {
		els.push.textContent = 'Push on';
		els.push.disabled = true;
		els.push.title = 'Approval requests arrive as push notifications with Approve and Deny buttons.';
	} else if (s.permission === 'denied') {
		els.push.textContent = 'Push blocked';
		els.push.disabled = true;
		els.push.title = 'Notifications are blocked for three.ws in this browser. Allow them in site settings to get approval pushes.';
	} else {
		els.push.textContent = 'Enable push';
		els.push.title = 'Get each approval request as a notification you can approve or deny from your lock screen.';
	}
}

async function onEnablePush() {
	els.push.disabled = true;
	els.push.textContent = 'Enabling…';
	const r = await enablePush();
	if (r.ok) {
		announce('Push enabled. Approval requests will reach this device.');
	} else {
		const why = {
			unconfigured: 'Push is not available on this deployment yet; requests still reach you by chat and email.',
			denied: 'Notifications are blocked in this browser. Allow them in site settings, then try again.',
			dismissed: 'Push was not enabled. You can turn it on any time.',
			unsupported: 'This browser does not support push.',
		}[r.reason] || 'Could not enable push. Try again.';
		showError(why);
	}
	initPush();
}

// ── boot ────────────────────────────────────────────────────────────────────────

function showAuthWall() {
	els.main.hidden = true;
	els.error.hidden = true;
	els.auth.hidden = false;
	els.login.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function tick() {
	let changed = false;
	for (const el of document.querySelectorAll('[data-expiry]')) {
		const left = timeLeft(el.dataset.expiry);
		el.textContent = fmtLeft(left);
		el.classList.toggle('is-soon', left < SOON_MS);
		if (left <= 0) changed = true;
	}
	if (changed) {
		for (const item of [...state.items, state.focus].filter(Boolean)) {
			if (item.status === 'pending' && timeLeft(item.expires_at) <= 0) {
				const card = document.querySelector(`.ap-card[data-id="${CSS.escape(item.id)}"]`);
				if (card) rerenderCard(item.id, 'Expired without an answer. Nothing was executed.', 'err');
			}
		}
	}
}

function bind() {
	els.tabs.addEventListener('click', (e) => {
		const t = e.target.closest('.ap-tab');
		if (t) setGroup(t.dataset.group);
	});
	els.tabs.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const tabs = [...els.tabs.querySelectorAll('.ap-tab')];
		const i = tabs.indexOf(document.activeElement);
		if (i < 0) return;
		const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
		next.focus();
		setGroup(next.dataset.group);
	});
	els.agent.addEventListener('change', () => { state.agent = els.agent.value; state.selected.clear(); loadList(); });
	els.moreBtn.addEventListener('click', () => loadList({ reset: false }));
	els.bulk.addEventListener('click', bulkDeny);
	els.selectAll.addEventListener('change', () => {
		const ids = visibleItems().filter((i) => liveStatus(i) === 'pending').map((i) => i.id);
		if (els.selectAll.checked) ids.forEach((id) => state.selected.add(id));
		else state.selected.clear();
		for (const cb of els.list.querySelectorAll('[data-select]')) cb.checked = state.selected.has(cb.dataset.select);
		renderToolbar();
	});
	els.main.addEventListener('change', (e) => {
		const cb = e.target.closest('[data-select]');
		if (!cb) return;
		if (cb.checked) state.selected.add(cb.dataset.select);
		else state.selected.delete(cb.dataset.select);
		renderToolbar();
	});
	els.main.addEventListener('click', (e) => {
		const t = e.target;
		const approve = t.closest('[data-approve]');
		if (approve) return armApprove(approve);
		const deny = t.closest('[data-deny]');
		if (deny) { disarmAll(); return decide(deny.dataset.deny, 'deny'); }
		const copy = t.closest('[data-copy]');
		if (copy) {
			navigator.clipboard?.writeText(copy.dataset.copy).then(() => { copy.textContent = 'Copied'; announce('Copied.'); }, () => { copy.textContent = 'Select to copy'; });
			return;
		}
		const revoke = t.closest('[data-revoke]');
		if (revoke) return revokePolicy(revoke);
		if (t.closest('[data-clear-agent]')) { state.agent = ''; loadList(); return; }
		if (t.closest('[data-reload-policies]')) { loadPolicies(); return; }
		if (!t.closest('.btn-approve')) disarmAll();
	});
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape') disarmAll(); });
	els.form.addEventListener('submit', createPolicy);
	els.auditMoreBtn.addEventListener('click', () => loadAudit({ more: true }));
	els.push.addEventListener('click', onEnablePush);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && !els.main.hidden && !state.loading) loadList();
	});
	setInterval(tick, TICK_MS);
}

async function boot() {
	Object.assign(els, {
		main: $('ap-main'), auth: $('ap-auth'), login: $('ap-login'), error: $('ap-error'), live: $('ap-live'),
		focus: $('ap-focus'), tabs: $('ap-tabs'), list: $('ap-list'), more: $('ap-more'), moreBtn: $('ap-more-btn'),
		agent: $('ap-agent'), bulk: $('ap-bulk-deny'), selectAll: $('ap-select-all'), selectAllWrap: $('ap-select-all-wrap'),
		policies: $('ap-policies'), form: $('ap-policy-form'), venues: $('ap-venues'), max: $('ap-max'), maxHint: $('ap-max-hint'),
		policyAgent: $('ap-policy-agent'), policyExpiry: $('ap-policy-expiry'), policySubmit: $('ap-policy-submit'), formMsg: $('ap-form-msg'),
		audit: $('ap-audit'), auditMore: $('ap-audit-more'), auditMoreBtn: $('ap-audit-more-btn'), push: $('ap-push'),
	});
	bind();

	const m = location.pathname.match(/^\/approvals\/([0-9a-f-]{36})\/?$/i);
	state.focusToken = new URLSearchParams(location.search).get('t');
	els.main.hidden = false;
	els.list.innerHTML = skeletonHtml();
	els.audit.innerHTML = skeletonHtml(1);

	await loadList();
	if (!els.auth.hidden) return;
	if (m) await loadFocus(m[1].toLowerCase());
	if (!els.auth.hidden) return;
	renderList();
	// The log names venues by the labels the policies call returns.
	loadPolicies().finally(() => loadAudit());
	initPush();
}

boot();
