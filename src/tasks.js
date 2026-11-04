// Human-task escrow marketplace UI.
//
//   /tasks            browse open tasks (search, category, location)
//   /tasks/new        post a task: quote, confirmation table, fund escrow
//   /tasks/mine       tasks my agents posted and tasks I am working
//   /tasks/:id        detail: accept, submit proof, approve, dispute, cancel, review
//
// Every action that moves funds follows one flow: ask the API for the
// confirmation table (quote or preview), show it, and only on an explicit
// confirm send the action with confirm: true. Data: /api/human-tasks/*
// (api/human-tasks/[...route].js).

import { apiFetch } from './api.js';
import { skeletonHTML, emptyStateHTML, errorStateHTML, attachRetry, ensureStateKitStyles } from './shared/state-kit.js';
import { shortAddress as short } from './shared/address.js';

const API = '/api/human-tasks';
const view = document.getElementById('am-view');
const main = document.getElementById('am-main');
const UUID = /^[0-9a-fA-F-]{36}$/;
const CATEGORIES = ['photo', 'verification', 'errand', 'data_collection', 'inspection', 'research', 'other'];
const CATEGORY_LABELS = { photo: 'Photo', verification: 'Verification', errand: 'Errand', data_collection: 'Data collection', inspection: 'Inspection', research: 'Research', other: 'Other' };

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function when(iso) {
	return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function timeLeft(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	if (ms <= 0) return 'Ended';
	const h = Math.floor(ms / 3_600_000);
	if (h >= 48) return `${Math.floor(h / 24)}d left`;
	if (h >= 1) return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
	return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

const sigLink = (sig) => (sig ? `<a class="am-mono" href="https://solscan.io/tx/${encodeURIComponent(sig)}" target="_blank" rel="noopener">${esc(short(sig))}</a>` : '');
const statusChip = (t) => `<span class="am-status am-status--${esc(t.status)}">${esc(t.status_label || t.status)}</span>`;

class ApiError extends Error {
	constructor(code, message, status, extra = {}) {
		super(message);
		this.code = code;
		this.status = status;
		Object.assign(this, extra);
	}
}

async function api(path, { method = 'GET', body, anonymous = true } = {}) {
	const res = await apiFetch(`${API}${path}`, {
		method,
		allowAnonymous: anonymous,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		timeoutMs: method === 'GET' ? undefined : 120_000,
	});
	const json = await res.json().catch(() => null);
	if (!res.ok) throw new ApiError(json?.error || `http_${res.status}`, json?.error_description || `Request failed (${res.status}).`, res.status, json || {});
	return json?.data;
}

let mePromise = null;
function me() {
	if (!mePromise) {
		mePromise = apiFetch('/api/auth/me', { allowAnonymous: true })
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => j?.user || null)
			.catch(() => null);
	}
	return mePromise;
}

const signInHref = () => `/login?next=${encodeURIComponent(location.pathname + location.search)}`;

function toast(message, kind = 'ok') {
	const el = document.getElementById('am-toast');
	el.textContent = message;
	el.dataset.kind = kind;
	el.hidden = false;
	clearTimeout(toast.t);
	toast.t = setTimeout(() => { el.hidden = true; }, 6000);
}

function friendly(err) {
	if (err?.code === 'risk_ack_required' && err.requirement?.sign_url) {
		return `${esc(err.message)} <a href="${esc(err.requirement.sign_url)}">Sign the agreements</a>`;
	}
	const next = err?.next_step ? ` ${esc(err.next_step)}` : '';
	return `${esc(err?.message || 'Something went wrong.')}${next}`;
}

function openModal({ title, body, actions }) {
	const modal = document.getElementById('am-modal');
	document.getElementById('am-modal-title').textContent = title;
	document.getElementById('am-modal-body').innerHTML = body;
	const bar = document.getElementById('am-modal-actions');
	bar.innerHTML = '';
	const previousFocus = document.activeElement;
	return new Promise((resolve) => {
		const close = (value) => {
			modal.hidden = true;
			document.removeEventListener('keydown', onKey);
			previousFocus?.focus?.();
			resolve(value);
		};
		const onKey = (e) => { if (e.key === 'Escape') close(null); };
		for (const a of actions) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = `am-btn${a.primary ? ' am-btn--primary' : ''}${a.danger ? ' am-btn--danger' : ''}`;
			b.textContent = a.label;
			b.addEventListener('click', () => close(a.value));
			bar.appendChild(b);
		}
		modal.onclick = (e) => { if (e.target === modal) close(null); };
		document.addEventListener('keydown', onKey);
		modal.hidden = false;
		bar.lastElementChild?.focus();
	});
}

function quoteTable(rows) {
	return `<table class="ht-quote"><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join('')}</tbody></table>`;
}

function setCrumb(text) {
	const here = document.getElementById('am-crumb-here');
	const sep = document.getElementById('am-crumb-sep');
	here.textContent = text || '';
	sep.hidden = !text;
}

function tabs(active) {
	const t = [['/tasks', 'Browse'], ['/tasks/new', 'Post a task'], ['/tasks/mine', 'My tasks']];
	return `<nav class="ht-tabs" aria-label="Human tasks">${t.map(([href, label]) => `<a class="ht-tab" href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function header(title, sub) {
	return `<div class="am-head"><h1>${esc(title)}</h1><p class="am-sub">${esc(sub)}</p></div>`;
}

/** Run an action button: disable while pending, toast the outcome. */
async function act(btn, fn, okMessage) {
	btn.disabled = true;
	try {
		const r = await fn();
		if (okMessage) toast(okMessage);
		return r;
	} catch (err) {
		toast(String(err?.message || 'Something went wrong.'), 'error');
		return null;
	} finally {
		btn.disabled = false;
	}
}

// ── Browse ───────────────────────────────────────────────────────────────────

function taskCard(t) {
	const loc = t.location?.kind === 'onsite' ? (t.location.label || 'On-site') : 'Remote';
	const dist = t.distance_m != null ? ` · ${(t.distance_m / 1000).toFixed(1)} km away` : '';
	return `<a class="am-card ht-card" href="${esc(t.url)}">
		<div class="ht-row"><span class="am-chip">${esc(CATEGORY_LABELS[t.category] || t.category)}</span><span class="am-meta">${esc(timeLeft(t.deadline_at))}</span></div>
		<h3 class="am-card-title">${esc(t.title)}</h3>
		<p class="am-card-persona">${esc(t.instructions)}</p>
		<div class="am-card-foot">
			<div><div class="am-price-label">Bounty</div><div class="ht-bounty">${esc(t.bounty_usdc)}<small>USDC</small></div></div>
			<div class="am-meta" style="text-align:right">${esc(loc)}${esc(dist)}<br>${esc(t.min_verification_label)}+</div>
		</div>
	</a>`;
}

async function renderBrowse() {
	setCrumb('');
	const params = new URLSearchParams(location.search);
	view.innerHTML = `${header('Human tasks', 'Agents post real-world jobs with the bounty held in USDC escrow on Solana. Accept one, submit proof, and get paid when the poster approves.')}
		${tabs('/tasks')}
		<form class="am-toolbar" id="ht-filters" role="search">
			<input class="am-input" type="search" name="q" placeholder="Search tasks" aria-label="Search tasks" value="${esc(params.get('q') || '')}" />
			<select class="am-select" name="category" aria-label="Category">
				<option value="">All categories</option>
				${CATEGORIES.map((c) => `<option value="${c}"${params.get('category') === c ? ' selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('')}
			</select>
			<select class="am-select" name="location" aria-label="Location">
				<option value="">Anywhere</option>
				<option value="remote"${params.get('location') === 'remote' ? ' selected' : ''}>Remote only</option>
				<option value="onsite"${params.get('location') === 'onsite' ? ' selected' : ''}>On-site only</option>
			</select>
			<button class="am-btn" type="button" id="ht-near">Near me</button>
			<button class="am-btn am-btn--primary" type="submit">Search</button>
		</form>
		<div id="ht-list" class="am-grid" aria-live="polite"></div>
		<div class="ht-actions"><button class="am-btn" id="ht-more" hidden>Load more</button></div>`;
	const list = document.getElementById('ht-list');
	const more = document.getElementById('ht-more');
	const form = document.getElementById('ht-filters');
	let cursor = null;
	let geo = null;
	ensureStateKitStyles();

	async function load(reset) {
		if (reset) { list.innerHTML = skeletonHTML(6); cursor = null; }
		const fd = new FormData(form);
		const q = new URLSearchParams();
		for (const k of ['q', 'category', 'location']) if (fd.get(k)) q.set(k, fd.get(k));
		if (geo) { q.set('lat', geo.lat); q.set('lng', geo.lng); q.set('radius_km', '50'); }
		if (cursor) q.set('cursor', cursor);
		try {
			const r = await api(`?${q}`);
			if (reset) list.innerHTML = '';
			if (reset && !r.items.length) {
				list.innerHTML = emptyStateHTML({
					title: 'No open tasks match',
					body: 'Nothing is open with these filters. Clear them, or post the first task yourself.',
					actions: [{ label: 'Post a task', href: '/tasks/new', primary: true }],
				});
			} else {
				list.insertAdjacentHTML('beforeend', r.items.map(taskCard).join(''));
			}
			cursor = r.next_cursor;
			more.hidden = !cursor;
		} catch (err) {
			list.innerHTML = errorStateHTML({ title: 'Could not load tasks', body: esc(err.message), scope: 'tasks' });
			attachRetry(list, () => load(true));
		}
	}

	form.addEventListener('submit', (e) => { e.preventDefault(); load(true); });
	more.addEventListener('click', () => load(false));
	document.getElementById('ht-near').addEventListener('click', (e) => {
		if (!navigator.geolocation) return toast('This browser cannot share a location.', 'error');
		const btn = e.currentTarget;
		btn.disabled = true;
		navigator.geolocation.getCurrentPosition(
			(p) => { geo = { lat: p.coords.latitude, lng: p.coords.longitude }; btn.disabled = false; btn.textContent = 'Near me: on'; load(true); },
			() => { btn.disabled = false; toast('Location permission was denied. Search by keyword instead.', 'error'); },
			{ timeout: 10_000 },
		);
	});
	await load(true);
}

// ── Post ─────────────────────────────────────────────────────────────────────

async function renderNew() {
	setCrumb('Post a task');
	const user = await me();
	if (!user) {
		view.innerHTML = `${header('Post a task', 'Fund a real-world job from one of your agents.')}${tabs('/tasks/new')}${emptyStateHTML({
			title: 'Sign in to post a task',
			body: 'A task is funded from your agent\'s Solana wallet, so it needs your account.',
			actions: [{ label: 'Sign in', href: signInHref(), primary: true }],
		})}`;
		return;
	}
	view.innerHTML = `${header('Post a task', 'The bounty and a small platform fee lock in escrow when you confirm. If nobody completes the task, all of it is refunded.')}${tabs('/tasks/new')}<div id="ht-form-host">${skeletonHTML(2)}</div>`;
	const host = document.getElementById('ht-form-host');
	let agents;
	try {
		agents = await api('/agents', { anonymous: false });
	} catch (err) {
		host.innerHTML = errorStateHTML({ title: 'Could not load your agents', body: esc(err.message), scope: 'tasks' });
		attachRetry(host, renderNew);
		return;
	}
	const fundable = agents.filter((a) => a.can_fund);
	if (!fundable.length) {
		host.innerHTML = emptyStateHTML({
			title: 'You need an agent with a funded wallet',
			body: 'Tasks are paid from an agent\'s Solana USDC balance. Create an agent, then fund its wallet.',
			actions: [{ label: 'Create an agent', href: '/create', primary: true }],
		});
		return;
	}
	host.innerHTML = `<form class="ht-form" id="ht-new" novalidate>
		<div class="ht-field"><label for="f-agent">Funding agent</label>
			<select class="am-select" id="f-agent" name="agent_id" required>
				${fundable.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${a.usdc == null ? 'balance unavailable' : `${esc(a.usdc)} USDC`})</option>`).join('')}
			</select></div>
		<div class="ht-field"><label for="f-title">Title</label><input class="am-input" id="f-title" name="title" maxlength="120" required placeholder="Photograph the menu board at the corner cafe" /></div>
		<div class="ht-field"><label for="f-inst">Instructions</label><textarea id="f-inst" name="instructions" maxlength="4000" required placeholder="Exactly what the person must do and what the photo must show."></textarea></div>
		<div class="ht-two">
			<div class="ht-field"><label for="f-cat">Category</label><select class="am-select" id="f-cat" name="category">${CATEGORIES.map((c) => `<option value="${c}">${CATEGORY_LABELS[c]}</option>`).join('')}</select></div>
			<div class="ht-field"><label for="f-bounty">Bounty (USDC)</label><input class="am-input" id="f-bounty" name="bounty_usdc" inputmode="decimal" required placeholder="10.00" /></div>
			<div class="ht-field"><label for="f-deadline">Deadline (hours)</label><input class="am-input" id="f-deadline" name="deadline_hours" type="number" min="1" max="720" value="48" required /></div>
		</div>
		<fieldset class="ht-field" style="border:0;padding:0;margin:0"><legend>Where</legend>
			<div class="ht-two">
				<select class="am-select" id="f-kind" name="location_kind" aria-label="Location type"><option value="remote">Remote, anywhere</option><option value="onsite">On-site, at a place</option></select>
			</div>
			<div class="ht-two" id="f-geo" hidden>
				<input class="am-input" name="location_label" placeholder="Place name" aria-label="Place name" maxlength="160" />
				<input class="am-input" name="lat" inputmode="decimal" placeholder="Latitude" aria-label="Latitude" />
				<input class="am-input" name="lng" inputmode="decimal" placeholder="Longitude" aria-label="Longitude" />
				<input class="am-input" name="radius_m" inputmode="numeric" placeholder="Radius in meters (200)" aria-label="Radius in meters" />
			</div>
			<span class="ht-hint" id="f-geo-hint" hidden>The proof photo must be taken within the radius. The worker's device location is checked on submit.</span>
		</fieldset>
		<div class="ht-field"><label for="f-proof">Proof required <span class="ht-hint">(optional)</span></label><input class="am-input" id="f-proof" name="proof_requirements" maxlength="1000" placeholder="Two photos, one close-up and one wide" /></div>
		<div class="ht-field"><label for="f-min">Who can accept</label><select class="am-select" id="f-min" name="min_verification"><option value="">Automatic (by bounty size)</option><option value="0">Any account</option><option value="1">Verified workers</option><option value="2">Trusted workers</option></select></div>
		<p class="ht-error" id="ht-err" role="alert" hidden></p>
		<div class="ht-actions"><button class="am-btn am-btn--primary" type="submit" id="ht-quote-btn">Review and fund</button></div>
	</form>`;
	const form = document.getElementById('ht-new');
	const kind = document.getElementById('f-kind');
	kind.addEventListener('change', () => {
		const on = kind.value === 'onsite';
		document.getElementById('f-geo').hidden = !on;
		document.getElementById('f-geo-hint').hidden = !on;
	});
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const err = document.getElementById('ht-err');
		err.hidden = true;
		const fd = Object.fromEntries(new FormData(form));
		const body = {};
		for (const [k, v] of Object.entries(fd)) if (String(v).trim() !== '') body[k] = String(v).trim();
		body.deadline_hours = Number(body.deadline_hours);
		const btn = document.getElementById('ht-quote-btn');
		btn.disabled = true;
		try {
			const quote = await api('/quote', { method: 'POST', body, anonymous: false });
			const go = await openModal({
				title: 'Confirm and fund escrow',
				body: `${quoteTable(quote.table)}<p class="ht-warn"><strong>This sends real USDC.</strong> ${esc(quote.escrow_usdc)} USDC leaves your agent's wallet now and is held in escrow on Solana ${esc(quote.network)}. The quote is valid until ${esc(when(quote.expires_at))}.</p>`,
				actions: [{ label: 'Cancel', value: false }, { label: `Lock ${quote.escrow_usdc} USDC`, value: true, primary: true }],
			});
			if (!go) return;
			const posted = await api('', { method: 'POST', body: { quote_id: quote.quote_id, confirm: true }, anonymous: false });
			toast('Task posted and funded.');
			location.assign(posted.task?.url || '/tasks/mine');
		} catch (e2) {
			err.innerHTML = friendly(e2);
			err.hidden = false;
		} finally {
			btn.disabled = false;
		}
	});
}

// ── Mine ─────────────────────────────────────────────────────────────────────

async function renderMine() {
	setCrumb('My tasks');
	const user = await me();
	if (!user) {
		view.innerHTML = `${header('My tasks', 'Tasks you posted and tasks you are working.')}${tabs('/tasks/mine')}${emptyStateHTML({
			title: 'Sign in to see your tasks', body: 'Your posted and accepted tasks live under your account.', actions: [{ label: 'Sign in', href: signInHref(), primary: true }],
		})}`;
		return;
	}
	view.innerHTML = `${header('My tasks', 'Tasks you posted and tasks you are working.')}${tabs('/tasks/mine')}<div id="ht-standing"></div><h2 class="ht-h">Posted by my agents</h2><div id="ht-posted" class="am-grid">${skeletonHTML(3)}</div><h2 class="ht-h" style="margin-top:28px">I am working</h2><div id="ht-work" class="am-grid">${skeletonHTML(3)}</div>`;
	const posted = document.getElementById('ht-posted');
	const work = document.getElementById('ht-work');
	const load = async () => {
		const [p, w, s] = await Promise.allSettled([api('/mine', { anonymous: false }), api('/work', { anonymous: false }), api('/standing', { anonymous: false })]);
		if (s.status === 'fulfilled') {
			const st = s.value;
			document.getElementById('ht-standing').innerHTML = `<div class="am-panel" style="margin-bottom:20px"><b>Worker level: ${esc(st.level_label)}</b>${st.next_step ? `<span class="am-note">${esc(st.next_step)}</span>` : ''}</div>`;
		}
		const fill = (el, r, empty) => {
			if (r.status === 'rejected') {
				el.innerHTML = errorStateHTML({ title: 'Could not load', body: esc(r.reason.message), scope: 'tasks' });
				attachRetry(el, load);
			} else if (!r.value.items.length) {
				el.innerHTML = emptyStateHTML(empty);
			} else {
				el.innerHTML = r.value.items.map(taskCard).join('');
			}
		};
		fill(posted, p, { title: 'You have not posted a task', body: 'Fund a real-world job from one of your agents.', actions: [{ label: 'Post a task', href: '/tasks/new', primary: true }], compact: true });
		fill(work, w, { title: 'You are not working on a task', body: 'Browse the board and accept one that fits.', actions: [{ label: 'Browse tasks', href: '/tasks', primary: true }], compact: true });
	};
	await load();
}

// ── Detail ───────────────────────────────────────────────────────────────────

const STEPS = ['open', 'accepted', 'submitted', 'approved', 'paid'];

function timelineHTML(t) {
	if (!t.timeline?.length) return '<p class="am-note">No activity yet.</p>';
	return `<ol class="ht-timeline">${t.timeline.map((e) => `<li><b>${esc(String(e.event).replace(/_/g, ' '))}</b> by ${esc(e.actor)}<br>${esc(when(e.at))}</li>`).join('')}</ol>`;
}

function proofHTML(t) {
	const s = t.submission;
	if (!s) return '';
	return `<div class="am-panel"><h2>Submitted proof</h2>
		${s.notes ? `<p class="ht-prose">${esc(s.notes)}</p>` : '<p class="am-note">No notes.</p>'}
		${s.photos.length ? `<div class="ht-photos">${s.photos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="Open proof photo ${i + 1}"><img src="${esc(u)}" alt="Proof photo ${i + 1}" loading="lazy" /></a>`).join('')}</div>` : ''}
		<p class="am-note" style="margin-top:8px">Submitted ${esc(when(s.submitted_at))}${s.lat != null ? ` at ${esc(Number(s.lat).toFixed(5))}, ${esc(Number(s.lng).toFixed(5))}` : ''}</p></div>`;
}

function settlementHTML(t) {
	const rows = [['Payout', t.payout_signature], ['Platform fee', t.fee_signature], ['Refund', t.refund_signature]].filter(([, s]) => s);
	if (!rows.length) return '';
	return `<h3>Settlement</h3><table class="am-table"><tbody>${rows.map(([l, s]) => `<tr><td>${l}</td><td>${sigLink(s)}</td></tr>`).join('')}</tbody></table>`;
}

function detailHTML(t) {
	const v = t.viewer;
	const loc = t.location.kind === 'onsite' ? `${esc(t.location.label || 'On-site')} (within ${esc(t.location.radius_m)} m)` : 'Remote';
	const step = STEPS.indexOf(t.status);
	return `<div class="am-detail">
		<div>
			<div class="am-panel">
				<div class="ht-row"><span class="am-chip">${esc(CATEGORY_LABELS[t.category] || t.category)}</span>${statusChip(t)}</div>
				<h1 style="margin:10px 0 6px">${esc(t.title)}</h1>
				<p class="ht-prose">${esc(t.instructions)}</p>
				${t.proof_requirements ? `<h3>Proof required</h3><p class="ht-prose">${esc(t.proof_requirements)}</p>` : ''}
			</div>
			<div style="height:16px"></div>
			${proofHTML(t)}
			${t.dispute ? `<div style="height:16px"></div><div class="am-panel"><h2>Dispute: ${esc(t.dispute.status)}</h2><p class="ht-prose">${esc(t.dispute.reason)}</p>${t.dispute.worker_response ? `<h3>Worker response</h3><p class="ht-prose">${esc(t.dispute.worker_response)}</p>` : ''}${t.dispute.resolution_note ? `<h3>Resolution</h3><p class="ht-prose">${esc(t.dispute.resolution_note)}</p>` : ''}</div>` : ''}
			<div style="height:16px"></div>
			<div class="am-panel"><h2>Timeline</h2>${timelineHTML(t)}</div>
		</div>
		<aside class="am-panel" aria-label="Task summary">
			<div class="am-price-label">Bounty</div><div class="ht-bounty">${esc(t.bounty_usdc)}<small>USDC</small></div>
			<div class="am-stats" style="margin-top:14px">
				<div class="am-stat"><b>${esc(timeLeft(t.deadline_at))}</b><span>${esc(when(t.deadline_at))}</span></div>
				<div class="am-stat"><b>${esc(t.min_verification_label)}+</b><span>Worker level</span></div>
			</div>
			<table class="am-table" style="margin-top:12px"><tbody>
				<tr><td>Where</td><td>${loc}</td></tr>
				<tr><td>Posted by</td><td>${esc(t.poster_agent?.name || 'An agent')}</td></tr>
				<tr><td>Chain</td><td>Solana ${esc(t.network)}</td></tr>
				<tr><td>Escrow</td><td class="am-mono">${esc(t.escrow_address)}</td></tr>
				${t.fee_usdc ? `<tr><td>Fee</td><td>${esc(t.fee_usdc)} USDC</td></tr>` : ''}
				${t.worker ? `<tr><td>Worker</td><td>${esc(t.worker.level_label)}${t.worker.provider ? ` via ${esc(t.worker.provider)}` : ''}</td></tr>` : ''}
			</tbody></table>
			${t.status === 'funding' && t.funding_error ? `<p class="ht-warn">Funding failed: ${esc(t.funding_error)}</p>` : ''}
			${step >= 0 ? `<p class="am-note" style="margin-top:10px">Step ${step + 1} of ${STEPS.length}: ${esc(STEPS.join(' > '))}</p>` : ''}
			${settlementHTML(t)}
			<div class="ht-actions" id="ht-actions">${actionButtons(t, v)}</div>
			${v.role === 'anonymous' ? `<p class="am-note" style="margin-top:10px"><a href="${esc(signInHref())}">Sign in</a> to accept this task.</p>` : ''}
		</aside>
	</div>`;
}

function actionButtons(t, v) {
	const b = [];
	if (v.can_claim) b.push('<button class="am-btn am-btn--primary" data-act="claim">Accept this task</button>');
	for (const a of v.worker_actions) {
		if (a === 'submit') b.push('<button class="am-btn am-btn--primary" data-act="submit">Submit proof</button>');
		if (a === 'unclaim') b.push('<button class="am-btn" data-act="unclaim">Hand back</button>');
		if (a === 'respond') b.push('<button class="am-btn am-btn--primary" data-act="respond">Respond to dispute</button>');
		if (a === 'review') b.push('<button class="am-btn" data-act="review">Rate the poster</button>');
	}
	for (const a of v.poster_actions) {
		if (a === 'approve') b.push('<button class="am-btn am-btn--primary" data-act="approve">Review and pay</button>');
		if (a === 'dispute') b.push('<button class="am-btn" data-act="dispute">Dispute proof</button>');
		if (a === 'cancel') b.push('<button class="am-btn am-btn--danger" data-act="cancel">Cancel and refund</button>');
		if (a === 'review') b.push('<button class="am-btn" data-act="review">Rate the worker</button>');
	}
	return b.join('');
}

async function postJson(path, body) {
	return api(path, { method: 'POST', body: body || {}, anonymous: false });
}

async function uploadPhoto(taskId, file) {
	const slot = await postJson(`/${taskId}/upload`, { content_type: file.type });
	if (file.size > slot.max_bytes) throw new Error(`${file.name} is larger than ${Math.round(slot.max_bytes / 1048576)} MB.`);
	const res = await fetch(slot.upload_url, { method: slot.method, headers: slot.headers, body: file });
	if (!res.ok) throw new Error(`Uploading ${file.name} failed (${res.status}).`);
	return slot.key;
}

function currentPosition() {
	return new Promise((resolve) => {
		if (!navigator.geolocation) return resolve(null);
		navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 10_000, enableHighAccuracy: true });
	});
}

async function askText({ title, label, placeholder, min = 1, confirmLabel, danger = false }) {
	const body = `<div class="ht-field"><label for="ht-ask">${esc(label)}</label><textarea id="ht-ask" placeholder="${esc(placeholder || '')}" maxlength="2000"></textarea></div><p class="ht-error" id="ht-ask-err" hidden></p>`;
	for (;;) {
		const go = await openModal({ title, body, actions: [{ label: 'Cancel', value: false }, { label: confirmLabel, value: true, primary: !danger, danger }] });
		if (!go) return null;
		const val = document.getElementById('ht-ask')?.value.trim() || '';
		if (val.length >= min) return val;
		toast(`Write at least ${min} characters.`, 'error');
	}
}

async function renderDetail(id) {
	view.innerHTML = skeletonHTML(2);
	setCrumb('Task');
	let t;
	try {
		t = await api(`/${id}`);
	} catch (err) {
		view.innerHTML = err.status === 404
			? emptyStateHTML({ title: 'Task not found', body: 'It may have been removed, or the link is wrong.', actions: [{ label: 'Browse tasks', href: '/tasks', primary: true }] })
			: errorStateHTML({ title: 'Could not load this task', body: esc(err.message), scope: 'tasks' });
		if (err.status !== 404) attachRetry(view, () => renderDetail(id));
		return;
	}
	setCrumb(t.title);
	document.title = `${t.title} · Human Tasks · three.ws`;
	view.innerHTML = detailHTML(t);
	const refresh = () => renderDetail(id);
	document.getElementById('ht-actions').addEventListener('click', async (e) => {
		const btn = e.target.closest('button[data-act]');
		if (!btn) return;
		const a = btn.dataset.act;
		try {
			if (a === 'claim') await onClaim(btn, t, refresh);
			else if (a === 'unclaim') await act(btn, () => postJson(`/${id}/unclaim`), 'Task handed back.').then((r) => r && refresh());
			else if (a === 'submit') await onSubmit(btn, t, refresh);
			else if (a === 'approve') await onApprove(btn, t, refresh);
			else if (a === 'cancel') await onCancel(btn, t, refresh);
			else if (a === 'dispute') await onDispute(btn, t, refresh);
			else if (a === 'respond') await onRespond(btn, t, refresh);
			else if (a === 'review') await onReview(btn, t, refresh);
		} catch (err) {
			toast(String(err?.message || 'Something went wrong.'), 'error');
		}
	});
}

async function onClaim(btn, t, refresh) {
	const go = await openModal({
		title: 'Accept this task',
		body: `<p>You are committing to: <strong>${esc(t.title)}</strong>.</p><p>Bounty ${esc(t.bounty_usdc)} USDC, due ${esc(when(t.deadline_at))}. Payment goes to a Solana wallet linked to your account once the poster approves your proof.</p>`,
		actions: [{ label: 'Not now', value: false }, { label: 'Accept task', value: true, primary: true }],
	});
	if (!go) return;
	btn.disabled = true;
	try {
		await postJson(`/${t.id}/claim`);
		toast('Task accepted.');
		await refresh();
	} catch (err) {
		await openModal({ title: 'Could not accept', body: `<p>${friendly(err)}</p>${err.code === 'wallet_required' || err.code === 'verification_required' ? '<p><a href="/settings">Open account settings</a></p>' : ''}`, actions: [{ label: 'Close', value: true, primary: true }] });
	} finally {
		btn.disabled = false;
	}
}

async function onSubmit(btn, t, refresh) {
	const onsite = t.location.kind === 'onsite';
	const go = await openModal({
		title: 'Submit proof',
		body: `<div class="ht-field"><label for="ht-notes">Notes</label><textarea id="ht-notes" maxlength="4000" placeholder="What you did and anything the poster should know."></textarea></div>
			<div class="ht-field" style="margin-top:12px"><label for="ht-files">Photos (JPEG, PNG or WebP, up to 8)</label><input id="ht-files" type="file" accept="image/jpeg,image/png,image/webp" multiple /></div>
			${onsite ? '<p class="ht-hint" style="margin-top:10px">This is an on-site task. Your device location is read when you submit and must be within the task radius.</p>' : ''}
			<p class="ht-error" id="ht-sub-err" hidden></p>`,
		actions: [{ label: 'Cancel', value: false }, { label: 'Upload and submit', value: true, primary: true }],
	});
	if (!go) return;
	const notes = document.getElementById('ht-notes')?.value.trim() || '';
	const files = [...(document.getElementById('ht-files')?.files || [])].slice(0, 8);
	btn.disabled = true;
	try {
		const photos = [];
		for (const f of files) photos.push(await uploadPhoto(t.id, f));
		const pos = onsite ? await currentPosition() : null;
		if (onsite && !pos) throw new Error('This task needs your location. Allow location access and try again.');
		await postJson(`/${t.id}/submit`, { notes, photos, ...(pos || {}) });
		toast('Proof submitted. The poster has 72 hours to review it.');
		await refresh();
	} catch (err) {
		toast(String(err?.message || 'Submitting failed.'), 'error');
	} finally {
		btn.disabled = false;
	}
}

async function onApprove(btn, t, refresh) {
	btn.disabled = true;
	try {
		const p = await postJson(`/${t.id}/preview-approve`);
		const go = await openModal({
			title: 'Approve and pay the worker',
			body: `${quoteTable(p.table)}<p class="ht-warn"><strong>This releases real USDC from escrow and cannot be undone.</strong> If the proof is wrong, dispute it instead.</p>`,
			actions: [{ label: 'Cancel', value: false }, { label: 'Approve and pay', value: true, primary: true }],
		});
		if (!go) return;
		await postJson(`/${t.id}/approve`, { confirm: true, preview_id: p.preview_id });
		toast('Approved. The payout is settling on Solana.');
		await refresh();
	} catch (err) {
		toast(String(err?.message || 'Approving failed.'), 'error');
	} finally {
		btn.disabled = false;
	}
}

async function onCancel(btn, t, refresh) {
	const go = await openModal({
		title: 'Cancel and refund',
		body: `<p>No one has accepted <strong>${esc(t.title)}</strong> yet. Cancelling refunds ${esc(t.escrow_usdc || t.bounty_usdc)} USDC (bounty and fee) to the wallet that funded it.</p>`,
		actions: [{ label: 'Keep task', value: false }, { label: 'Cancel and refund', value: true, danger: true }],
	});
	if (!go) return;
	const r = await act(btn, () => postJson(`/${t.id}/cancel`, { confirm: true }), 'Task cancelled. The refund is settling.');
	if (r) await refresh();
}

async function onDispute(btn, t, refresh) {
	const reason = await askText({ title: 'Dispute the proof', label: 'What is wrong with it?', placeholder: 'The photo shows a different building than the task asked for.', min: 10, confirmLabel: 'Open dispute' });
	if (!reason) return;
	const r = await act(btn, () => postJson(`/${t.id}/dispute`, { reason }), 'Dispute opened. The payout is frozen until it is resolved.');
	if (r) await refresh();
}

async function onRespond(btn, t, refresh) {
	const response = await askText({ title: 'Respond to the dispute', label: 'Your side', placeholder: 'Explain how your proof meets the instructions.', confirmLabel: 'Send response' });
	if (!response) return;
	const r = await act(btn, () => postJson(`/${t.id}/respond`, { response }), 'Response sent.');
	if (r) await refresh();
}

async function onReview(btn, t, refresh) {
	let rating = 0;
	const body = `<div class="ht-field"><span id="ht-rate-l">Rating</span><div class="ht-stars" role="group" aria-labelledby="ht-rate-l">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-pressed="false" aria-label="${n} star${n > 1 ? 's' : ''}">${n}</button>`).join('')}</div></div>
		<div class="ht-field" style="margin-top:12px"><label for="ht-comment">Comment (optional)</label><textarea id="ht-comment" maxlength="1000"></textarea></div>`;
	const pending = openModal({ title: 'Leave a review', body, actions: [{ label: 'Cancel', value: false }, { label: 'Submit review', value: true, primary: true }] });
	document.querySelector('.ht-stars')?.addEventListener('click', (e) => {
		const s = e.target.closest('button[data-n]');
		if (!s) return;
		rating = Number(s.dataset.n);
		document.querySelectorAll('.ht-stars button').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.n) <= rating)));
	});
	const go = await pending;
	if (!go) return;
	const comment = document.getElementById('ht-comment')?.value.trim() || '';
	if (!rating) return toast('Pick a rating from 1 to 5.', 'error');
	const r = await act(btn, () => postJson(`/${t.id}/review`, { rating, comment }), 'Thanks. Your review is saved.');
	if (r) await refresh();
}

// ── Router ───────────────────────────────────────────────────────────────────

async function route() {
	const path = location.pathname.replace(/\/+$/, '') || '/tasks';
	ensureStateKitStyles();
	try {
		const m = path.match(/^\/tasks\/([0-9a-fA-F-]{36})$/);
		if (m && UUID.test(m[1])) await renderDetail(m[1]);
		else if (path === '/tasks/new') await renderNew();
		else if (path === '/tasks/mine') await renderMine();
		else await renderBrowse();
	} catch (err) {
		view.innerHTML = errorStateHTML({ title: 'Something broke', body: esc(err.message), scope: 'tasks' });
		attachRetry(view, route);
	} finally {
		main.removeAttribute('aria-busy');
	}
}

route();
