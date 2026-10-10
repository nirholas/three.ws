/**
 * Agent Mail: the owner's view of an agent's email inbox.
 *
 * Routes: /agents/:id/mail, plus /agent-mail with an optional ?id=<uuid>
 * (no id: the signed-in owner's agents; one mounts directly, several get a
 * picker). ?m=<message id> opens a message, which is the link the
 * mail_received notification carries. API: /api/v1/agents/:id/mail
 * (docs/agent-mail.md).
 *
 * Sends and replies are quote then confirm: the page asks for a quote, shows
 * the exact sender, recipients, subject, body, routing and price, and sends
 * only after the owner ticks the confirmation. Received mail is untrusted, so
 * it is rendered as plain text only: no HTML, no live links, and hidden
 * direction-changing or zero-width characters are made visible.
 */

import './agent-mail.css';
import { consumeCsrfToken } from './api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = document.getElementById('am-root');
const titleEl = document.querySelector('title');

const FOLDERS = [
	['inbox', 'Inbox'],
	['sent', 'Sent'],
	['spam', 'Spam'],
	['all', 'All mail'],
];

const EVENT_LABEL = {
	pending: 'Waiting for approval',
	approved: 'Approved',
	run_started: 'Run started',
	dismissed: 'Denied',
	expired: 'Approval expired',
	failed: 'Failed',
	skipped: 'Skipped',
};

const RUN_LABEL = {
	queued: 'Queued',
	running: 'Running',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled',
	waiting: 'Waiting',
};

const PAY_LABEL = { credits: 'Account credits', wallet: 'Agent wallet (USDC on Solana)' };

// Bidirectional overrides, zero-width and other invisible format characters:
// the tricks a hostile sender uses to make text read differently than it is.
const HIDDEN_CHARS = /[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

const state = {
	agent: null,
	mailbox: null,
	pricing: null,
	domain: null,
	folder: 'inbox',
	query: '',
	items: [],
	cursor: null,
	hasMore: false,
	listLoading: true,
	listError: null,
	selectedId: null,
	message: null,
	msgLoading: false,
	msgError: null,
	settings: null,
	settingsError: null,
	events: [],
	eventsError: null,
	editingRule: null,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

/** Escape untrusted text and make invisible characters visible. */
function untrustedText(s) {
	return esc(String(s ?? '')).replace(
		HIDDEN_CHARS,
		(c) => `<span class="am-hidden-char" title="Hidden character removed from display">U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}</span>`,
	);
}

function hasHiddenChars(s) {
	HIDDEN_CHARS.lastIndex = 0;
	const hit = HIDDEN_CHARS.test(String(s ?? ''));
	HIDDEN_CHARS.lastIndex = 0;
	return hit;
}

/** Text of an HTML-only message, read in an inert document (no scripts, no loads). */
function htmlToText(html) {
	const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
	doc.querySelectorAll('script,style,head').forEach((n) => n.remove());
	return (doc.body?.innerText ?? doc.body?.textContent ?? '').trim();
}

function setPageTitle(text) {
	document.title = text;
	titleEl?.setAttribute('data-i18n-owned', '1');
}

function timeAgo(iso) {
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((Date.now() - t) / 1000));
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
}

function fullDate(iso) {
	const d = new Date(iso);
	return Number.isFinite(d.getTime()) ? d.toLocaleString() : '';
}

function fmtUsd(n) {
	const v = Number(n);
	return Number.isFinite(v) ? `$${v.toFixed(2)}` : '';
}

function fmtBytes(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	if (v < 1024) return `${v} B`;
	if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
	return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function splitAddresses(s) {
	return String(s || '')
		.split(/[,;\s]+/)
		.map((x) => x.trim())
		.filter(Boolean);
}

function debounce(fn, ms) {
	let t;
	return (...a) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
	};
}

let toastTimer;
function toast(text, tone = 'info') {
	let el = document.getElementById('am-toast');
	if (!el) {
		el = document.createElement('div');
		el.id = 'am-toast';
		el.className = 'am-toast';
		el.setAttribute('role', 'status');
		el.setAttribute('aria-live', 'polite');
		document.body.appendChild(el);
	}
	el.textContent = text;
	el.dataset.tone = tone;
	el.classList.add('am-toast--on');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove('am-toast--on'), 3600);
}

class ApiFailure extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

async function api(path, { method = 'GET', body } = {}) {
	const opts = { method, credentials: 'include', headers: { accept: 'application/json' } };
	if (body !== undefined) {
		opts.headers['content-type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	if (method !== 'GET') {
		const token = await consumeCsrfToken();
		if (token) opts.headers['x-csrf-token'] = token;
	}
	let res;
	try {
		res = await fetch(`/api/v1/agents/${encodeURIComponent(state.agent.id)}/mail${path}`, opts);
	} catch {
		throw new ApiFailure(0, 'network_error', 'Could not reach three.ws. Check your connection and try again.');
	}
	let j = null;
	try {
		j = await res.json();
	} catch {
		j = null;
	}
	if (!res.ok) {
		throw new ApiFailure(
			res.status,
			j?.error?.code || 'error',
			j?.error?.message || `Request failed (${res.status}).`,
			j?.error?.details || null,
		);
	}
	return j?.data;
}

function errorBlock(err, retryAct) {
	return `
		<div class="am-state am-state--error" role="alert">
			<p>${esc(err?.message || 'Something went wrong.')}</p>
			${retryAct ? `<button type="button" class="am-btn am-btn--sm" data-act="${esc(retryAct)}">Try again</button>` : ''}
		</div>`;
}

// ── page shells ──────────────────────────────────────────────────────────────

function renderLoading(label) {
	root.innerHTML = `
		<div class="am-skel" aria-busy="true" aria-label="${esc(label)}">
			<div class="am-skel-bar"></div>
			<div class="am-skel-split"><div></div><div></div></div>
		</div>`;
}

function renderMessage({ title, body, actions = [], retry, tone = 'error' }) {
	root.innerHTML = `
		<div class="am-msg" ${tone === 'error' ? 'role="alert"' : 'role="region" aria-labelledby="am-msg-h"'}>
			<h1 id="am-msg-h">${esc(title)}</h1>
			<p>${esc(body)}</p>
			<div class="am-row am-row--center">
				${actions.map((a) => `<a class="am-btn${a.primary ? ' am-btn--primary' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`).join('')}
				${retry ? '<button class="am-btn" type="button" data-act="retry">Try again</button>' : ''}
			</div>
		</div>`;
	root.querySelector('[data-act="retry"]')?.addEventListener('click', () => boot());
}

function renderPicker(agents) {
	root.innerHTML = `
		<section class="am-pick" aria-labelledby="am-pick-h">
			<h1 id="am-pick-h" class="am-h1">Agent mail</h1>
			<p class="am-lede">Every agent can have its own email address on agents.three.ws. Pick an agent to open its inbox.</p>
			<ul class="am-pick-list">
				${agents
					.map(
						(a) => `
					<li><a class="am-pick-row" href="/agents/${encodeURIComponent(a.id)}/mail">
						${a.avatar_thumbnail_url ? `<img class="am-pick-av" src="${esc(a.avatar_thumbnail_url)}" alt="" loading="lazy" />` : '<span class="am-pick-av" aria-hidden="true"></span>'}
						<span class="am-pick-name">${esc(a.name || 'Untitled agent')}</span>
						<span aria-hidden="true">→</span>
					</a></li>`,
					)
					.join('')}
			</ul>
		</section>`;
	setPageTitle('Agent mail · three.ws');
}

// ── main layout ──────────────────────────────────────────────────────────────

function renderShell() {
	const a = state.agent;
	const mb = state.mailbox;
	root.innerHTML = `
		<header class="am-head">
			<div class="am-head-id">
				${a.avatar_thumbnail_url ? `<img class="am-head-av" src="${esc(a.avatar_thumbnail_url)}" alt="" loading="lazy" decoding="async" />` : '<span class="am-head-av" aria-hidden="true"></span>'}
				<div class="am-head-text">
					<h1 class="am-h1">${esc(a.name || 'Agent')} mail</h1>
					${
						mb
							? `<p class="am-sub"><span class="am-mono">${esc(mb.address)}</span>
								<button type="button" class="am-btn am-btn--ghost am-btn--sm" data-act="copy-address" aria-label="Copy address">Copy</button></p>`
							: `<p class="am-sub">No address yet. Give this agent an inbox on ${esc(state.domain || 'agents.three.ws')}.</p>`
					}
				</div>
			</div>
			<div class="am-row">
				${mb ? '<button type="button" class="am-btn am-btn--primary" data-act="compose" aria-keyshortcuts="c">Compose</button>' : ''}
				<a class="am-btn am-btn--ghost" href="/agents/${encodeURIComponent(a.id)}">Agent</a>
				<a class="am-btn am-btn--ghost" href="/approvals">Approvals</a>
				<a class="am-btn am-btn--ghost" href="/docs/agent-mail">Docs</a>
			</div>
		</header>
		${mb ? mailboxPanels() : '<div id="am-create"></div>'}
		<div id="am-modal-host"></div>`;
	root.querySelector('[data-act="copy-address"]')?.addEventListener('click', copyAddress);
	root.querySelector('[data-act="compose"]')?.addEventListener('click', () => openCompose({ mode: 'new' }));
	if (!mb) {
		renderCreate();
		return;
	}
	bindMailbox();
	renderUsage();
	renderList();
	renderReader();
	renderSettings();
	renderRules();
	renderEvents();
}

function mailboxPanels() {
	return `
		<p class="am-usage" id="am-usage" aria-live="polite"></p>
		<section class="am-panel am-panel--mail" aria-label="Messages">
			<div class="am-toolbar">
				<div class="am-tabs" role="tablist" aria-label="Folders">
					${FOLDERS.map(([k, l]) => `<button type="button" role="tab" class="am-tab" data-folder="${k}" aria-selected="${state.folder === k}">${l}${k === 'inbox' ? '<span class="am-count" id="am-unread"></span>' : ''}</button>`).join('')}
				</div>
				<form class="am-search" role="search" id="am-search">
					<label class="am-visually-hidden" for="am-q">Search mail</label>
					<input id="am-q" type="search" placeholder="Search subject, body or address" value="${esc(state.query)}" autocomplete="off" aria-keyshortcuts="/" />
				</form>
				<button type="button" class="am-btn am-btn--ghost am-btn--sm" data-act="refresh">Refresh</button>
			</div>
			<div class="am-split" data-open="${state.selectedId ? 'reader' : 'list'}">
				<div class="am-list-col" id="am-list" aria-live="polite"></div>
				<div class="am-reader-col" id="am-reader"></div>
			</div>
		</section>
		<div class="am-cols">
			<section class="am-panel" aria-labelledby="am-rules-h">
				<div class="am-panel-head">
					<h2 id="am-rules-h" class="am-h2">Mail rules</h2>
					<button type="button" class="am-btn am-btn--sm" data-act="new-rule">New rule</button>
				</div>
				<p class="am-note">When mail arrives from a sender you name, send it to your approvals queue or start an automation run with your instruction. The email reaches the agent as data only, never as instructions.</p>
				<div id="am-rules"></div>
			</section>
			<section class="am-panel" aria-labelledby="am-settings-h">
				<div class="am-panel-head"><h2 id="am-settings-h" class="am-h2">Sending limits</h2></div>
				<div id="am-settings"></div>
			</section>
		</div>
		<section class="am-panel" aria-labelledby="am-events-h">
			<div class="am-panel-head">
				<h2 id="am-events-h" class="am-h2">Rule activity</h2>
				<button type="button" class="am-btn am-btn--ghost am-btn--sm" data-act="reload-events">Refresh</button>
			</div>
			<div id="am-events" aria-live="polite"></div>
		</section>`;
}

function bindMailbox() {
	root.querySelectorAll('[data-folder]').forEach((b) =>
		b.addEventListener('click', () => {
			if (state.folder === b.dataset.folder) return;
			state.folder = b.dataset.folder;
			root.querySelectorAll('[data-folder]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
			syncUrl();
			loadList();
		}),
	);
	const q = root.querySelector('#am-q');
	const run = debounce(() => {
		state.query = q.value.trim();
		loadList();
	}, 300);
	q.addEventListener('input', run);
	root.querySelector('#am-search').addEventListener('submit', (e) => {
		e.preventDefault();
		state.query = q.value.trim();
		loadList();
	});
	root.querySelector('[data-act="refresh"]').addEventListener('click', () => {
		loadList();
		refreshMailbox();
	});
	root.querySelector('[data-act="new-rule"]').addEventListener('click', () => {
		state.editingRule = 'new';
		renderRules();
		root.querySelector('#am-rule-name')?.focus();
	});
	root.querySelector('[data-act="reload-events"]').addEventListener('click', () => loadEvents());
}

function syncUrl() {
	const params = new URLSearchParams(location.search);
	params.delete('id');
	if (state.selectedId) params.set('m', state.selectedId);
	else params.delete('m');
	if (state.folder !== 'inbox') params.set('folder', state.folder);
	else params.delete('folder');
	const qs = params.toString();
	history.replaceState(null, '', `/agents/${encodeURIComponent(state.agent.id)}/mail${qs ? `?${qs}` : ''}`);
}

async function copyAddress() {
	try {
		await navigator.clipboard.writeText(state.mailbox.address);
		toast('Address copied');
	} catch {
		toast('Copy failed. Select the address and copy it by hand.', 'error');
	}
}

function renderUsage() {
	const el = root.querySelector('#am-usage');
	const mb = state.mailbox;
	if (!el || !mb) return;
	const l = mb.limits || {};
	const unread = root.querySelector('#am-unread');
	if (unread) unread.textContent = mb.unread ? String(mb.unread) : '';
	const cap = state.settings?.policy?.daily_send_cap;
	el.innerHTML = `
		<span>${esc(l.sent_last_day ?? 0)} of ${esc(cap != null ? Math.min(cap, l.per_day ?? cap) : (l.per_day ?? 0))} sends today</span>
		<span aria-hidden="true">·</span>
		<span>${esc(l.sent_last_hour ?? 0)} of ${esc(l.per_hour ?? 0)} this hour</span>
		${l.warming_up ? '<span aria-hidden="true">·</span><span>New mailbox: limits rise as it warms up</span>' : ''}
		${state.pricing ? `<span aria-hidden="true">·</span><span>${esc(fmtUsd(state.pricing.send_usd))} per send</span>` : ''}`;
}

async function refreshMailbox() {
	try {
		const data = await api('');
		state.mailbox = data.mailbox;
		state.pricing = data.pricing;
		renderUsage();
	} catch {
		// The list and reader carry their own error states; a stale counter is harmless.
	}
}

// ── mailbox creation ─────────────────────────────────────────────────────────

const create = { quote: null, error: null, busy: false, localPart: '', displayName: '' };

function renderCreate() {
	const el = root.querySelector('#am-create');
	if (!el) return;
	const q = create.quote;
	el.innerHTML = `
		<section class="am-panel am-panel--create" aria-labelledby="am-create-h">
			<h2 id="am-create-h" class="am-h2">Give ${esc(state.agent.name || 'this agent')} an inbox</h2>
			<p class="am-lede">A real address other people and agents can write to. Mail between three.ws agents is delivered instantly. The agent reads it through its tools, always as untrusted data, and every send waits for a quote you approve.</p>
			<form id="am-create-form" class="am-form">
				<label class="am-field">
					<span>Address</span>
					<span class="am-addr-input">
						<input id="am-lp" name="local_part" value="${esc(create.localPart)}" placeholder="auto from the agent's name" autocomplete="off" spellcheck="false" maxlength="32" pattern="[a-z0-9][a-z0-9.\\-]{1,30}[a-z0-9]" />
						<span class="am-mono am-dim-text">@${esc(state.domain || 'agents.three.ws')}</span>
					</span>
				</label>
				<label class="am-field">
					<span>Display name</span>
					<input id="am-dn" name="display_name" value="${esc(create.displayName)}" placeholder="${esc(state.agent.name || '')}" maxlength="64" autocomplete="off" />
				</label>
				<div class="am-row">
					<button type="submit" class="am-btn am-btn--primary" ${create.busy ? 'disabled' : ''}>${create.busy && !q ? 'Getting a quote…' : 'Get a quote'}</button>
					<span class="am-dim-text">${state.pricing ? `${esc(fmtUsd(state.pricing.create_usd))} once` : ''}</span>
				</div>
			</form>
			${create.error ? errorBlock(create.error) : ''}
			${
				q
					? `<div class="am-confirm" role="group" aria-labelledby="am-create-confirm-h">
						<h3 id="am-create-confirm-h" class="am-h3">Confirm</h3>
						<dl class="am-table">
							<div><dt>Address</dt><dd class="am-mono">${esc(q.address)}</dd></div>
							<div><dt>Display name</dt><dd>${esc(q.display_name || 'none')}</dd></div>
							<div><dt>Price</dt><dd>${esc(fmtUsd(q.price_usd))}${q.payment_source === 'wallet' ? ' USDC on Solana' : ''}</dd></div>
							<div><dt>Paid from</dt><dd>${esc(PAY_LABEL[q.payment_source] || q.payment_source)}${q.payment_source === 'wallet' && q.funding?.wallet_address ? ` <span class="am-mono">${esc(q.funding.wallet_address)}</span>` : ''}</dd></div>
						</dl>
						<p class="am-expire" data-expires="${esc(q.expires_at)}"></p>
						<label class="am-check"><input type="checkbox" id="am-create-ok" /> Charge ${esc(fmtUsd(q.price_usd))} and create ${esc(q.address)}</label>
						<div class="am-row">
							<button type="button" class="am-btn am-btn--primary" data-act="create-confirm" disabled>Create inbox</button>
							<button type="button" class="am-btn am-btn--ghost" data-act="create-cancel">Cancel</button>
						</div>
					</div>`
					: ''
			}
		</section>`;
	const form = el.querySelector('#am-create-form');
	form.addEventListener('input', () => {
		create.localPart = form.local_part.value.trim().toLowerCase();
		create.displayName = form.display_name.value;
		if (create.quote) {
			create.quote = null;
			renderCreate();
			el.querySelector('#am-lp')?.focus();
		}
	});
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		create.busy = true;
		create.error = null;
		renderCreate();
		try {
			create.quote = await api('/quote', {
				method: 'POST',
				body: { action: 'create', local_part: create.localPart || undefined, display_name: create.displayName || undefined },
			});
		} catch (err) {
			create.error = err;
		}
		create.busy = false;
		renderCreate();
	});
	if (q) {
		const ok = el.querySelector('#am-create-ok');
		const btn = el.querySelector('[data-act="create-confirm"]');
		ok.addEventListener('change', () => (btn.disabled = !ok.checked || create.busy));
		startExpiry(el.querySelector('.am-expire'), () => {
			btn.disabled = true;
			ok.disabled = true;
		});
		el.querySelector('[data-act="create-cancel"]').addEventListener('click', () => {
			create.quote = null;
			renderCreate();
		});
		btn.addEventListener('click', async () => {
			create.busy = true;
			btn.disabled = true;
			btn.textContent = 'Creating…';
			try {
				await api('/create', { method: 'POST', body: { quote_id: q.quote_id, confirm_spend: true } });
				create.quote = null;
				await mountMailbox();
				toast(`Inbox ready: ${state.mailbox?.address || 'created'}`);
			} catch (err) {
				create.error = err;
				create.quote = null;
				create.busy = false;
				renderCreate();
			}
		});
	}
}

const expiryTimers = new Set();
function startExpiry(el, onGone) {
	if (!el) return;
	const end = new Date(el.dataset.expires).getTime();
	const tick = () => {
		const s = Math.round((end - Date.now()) / 1000);
		if (!el.isConnected) {
			clearInterval(t);
			expiryTimers.delete(t);
			return;
		}
		if (s <= 0) {
			el.textContent = 'This quote expired. Get a new one.';
			el.classList.add('am-expire--gone');
			clearInterval(t);
			expiryTimers.delete(t);
			onGone?.();
			return;
		}
		el.textContent = `Quote holds for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
	const t = setInterval(tick, 1000);
	expiryTimers.add(t);
	tick();
}

// ── message list ─────────────────────────────────────────────────────────────

let listSeq = 0;
async function loadList({ append = false } = {}) {
	const seq = ++listSeq;
	if (!append) {
		state.listLoading = true;
		state.listError = null;
		state.items = [];
		state.cursor = null;
		renderList();
	}
	const params = new URLSearchParams({ folder: state.folder, limit: '30' });
	if (append && state.cursor) params.set('cursor', state.cursor);
	let path;
	if (state.query) {
		params.set('q', state.query);
		path = `/search?${params}`;
	} else {
		path = `/messages?${params}`;
	}
	try {
		const data = await api(path);
		if (seq !== listSeq) return;
		state.items = append ? [...state.items, ...(data.items || [])] : data.items || [];
		state.cursor = data.nextCursor || null;
		state.hasMore = Boolean(data.hasMore);
	} catch (err) {
		if (seq !== listSeq) return;
		state.listError = err;
	}
	state.listLoading = false;
	renderList();
}

function renderList() {
	const el = root.querySelector('#am-list');
	if (!el) return;
	if (state.listLoading) {
		el.innerHTML = `<ul class="am-list" aria-busy="true">${'<li class="am-item am-item--skel"></li>'.repeat(6)}</ul>`;
		return;
	}
	if (state.listError) {
		el.innerHTML = errorBlock(state.listError, 'retry-list');
		el.querySelector('[data-act="retry-list"]').addEventListener('click', () => loadList());
		return;
	}
	if (!state.items.length) {
		el.innerHTML = `<div class="am-state">${emptyListCopy()}</div>`;
		el.querySelector('[data-act="compose-empty"]')?.addEventListener('click', () => openCompose({ mode: 'new' }));
		el.querySelector('[data-act="copy-empty"]')?.addEventListener('click', copyAddress);
		return;
	}
	el.innerHTML = `
		<ul class="am-list" role="listbox" aria-label="Messages">
			${state.items.map(itemRow).join('')}
		</ul>
		${state.hasMore ? '<div class="am-more"><button type="button" class="am-btn am-btn--sm" data-act="more">Load more</button></div>' : ''}`;
	el.querySelectorAll('[data-msg]').forEach((b) => {
		b.addEventListener('click', () => openMessage(b.dataset.msg));
		b.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				const all = [...el.querySelectorAll('[data-msg]')];
				const next = all[all.indexOf(b) + (e.key === 'ArrowDown' ? 1 : -1)];
				next?.focus();
			}
		});
	});
	el.querySelector('[data-act="more"]')?.addEventListener('click', (e) => {
		e.currentTarget.disabled = true;
		e.currentTarget.textContent = 'Loading…';
		loadList({ append: true });
	});
}

function emptyListCopy() {
	if (state.query) return `<p>No mail matches “${esc(state.query)}” in ${esc(FOLDERS.find(([k]) => k === state.folder)?.[1] || 'this folder')}.</p>`;
	if (state.folder === 'inbox') {
		return `<p>No mail yet. Share <span class="am-mono">${esc(state.mailbox.address)}</span> with people or other agents, and new mail lands here.</p>
			<div class="am-row am-row--center"><button type="button" class="am-btn am-btn--sm" data-act="copy-empty">Copy address</button></div>`;
	}
	if (state.folder === 'sent') {
		return `<p>Nothing sent yet. Sends from this page, the API or the agent's MCP tools all show up here.</p>
			<div class="am-row am-row--center"><button type="button" class="am-btn am-btn--sm" data-act="compose-empty">Write the first email</button></div>`;
	}
	if (state.folder === 'spam') return '<p>No spam. Mail scored as spam is kept here and never shown to the agent as inbox mail.</p>';
	return '<p>This mailbox is empty.</p>';
}

function itemRow(m) {
	const incoming = m.direction === 'in';
	const who = incoming ? m.from_name || m.from : `To: ${(m.to || []).join(', ')}`;
	const unread = incoming && !m.read;
	return `
		<li role="none">
			<button type="button" role="option" class="am-item${unread ? ' am-item--unread' : ''}" data-msg="${esc(m.id)}" aria-selected="${state.selectedId === m.id}">
				<span class="am-item-top">
					<span class="am-item-who">${untrustedText(who)}</span>
					<time class="am-item-time" datetime="${esc(m.created_at)}" title="${esc(fullDate(m.created_at))}">${esc(timeAgo(m.created_at))}</time>
				</span>
				<span class="am-item-subj">${untrustedText(m.subject || '(no subject)')}</span>
				<span class="am-item-snip">${untrustedText(m.snippet || '')}</span>
				<span class="am-item-tags">
					${incoming ? '' : `<span class="am-tag" data-tone="${m.delivery_status === 'failed' || m.delivery_status === 'bounced' ? 'bad' : ''}">${esc(m.delivery_status || 'sent')}</span>`}
					${m.spam ? '<span class="am-tag" data-tone="bad">spam</span>' : ''}
					${m.attachment_count ? `<span class="am-tag">${esc(m.attachment_count)} attachment${m.attachment_count === 1 ? '' : 's'}</span>` : ''}
				</span>
			</button>
		</li>`;
}

// ── reader ───────────────────────────────────────────────────────────────────

let msgSeq = 0;
async function openMessage(id) {
	const seq = ++msgSeq;
	state.selectedId = id;
	state.msgLoading = true;
	state.msgError = null;
	state.message = null;
	syncUrl();
	root.querySelector('.am-split')?.setAttribute('data-open', 'reader');
	root.querySelectorAll('[data-msg]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.msg === id)));
	renderReader();
	try {
		const msg = await api(`/messages/${encodeURIComponent(id)}`);
		if (seq !== msgSeq) return;
		state.message = msg;
		const row = state.items.find((m) => m.id === id);
		if (row && msg.direction === 'in' && !row.read) {
			row.read = true;
			if (state.mailbox?.unread) state.mailbox.unread -= 1;
			renderUsage();
			root.querySelector(`[data-msg="${CSS.escape(id)}"]`)?.classList.remove('am-item--unread');
		}
	} catch (err) {
		if (seq !== msgSeq) return;
		state.msgError = err;
	}
	state.msgLoading = false;
	renderReader();
}

function closeReader() {
	state.selectedId = null;
	state.message = null;
	syncUrl();
	root.querySelector('.am-split')?.setAttribute('data-open', 'list');
	root.querySelectorAll('[data-msg]').forEach((b) => b.setAttribute('aria-selected', 'false'));
	renderReader();
}

function authBadges(m) {
	const a = m.auth_results || {};
	if (a.local) return '<span class="am-tag" data-tone="good">Delivered between agent mailboxes</span>';
	const badge = (k) => {
		const v = a[k];
		if (!v) return '';
		const tone = v === 'pass' ? 'good' : v === 'fail' ? 'bad' : '';
		return `<span class="am-tag" data-tone="${tone}">${k.toUpperCase()} ${esc(v)}</span>`;
	};
	return ['spf', 'dkim', 'dmarc'].map(badge).join('');
}

function renderReader() {
	const el = root.querySelector('#am-reader');
	if (!el) return;
	if (!state.selectedId) {
		el.innerHTML = '<div class="am-state am-state--quiet"><p>Pick a message to read it.</p><p class="am-dim-text">Shortcuts: <kbd>/</kbd> search, <kbd>c</kbd> compose, <kbd>Esc</kbd> close.</p></div>';
		return;
	}
	if (state.msgLoading) {
		el.innerHTML = '<div class="am-reader" aria-busy="true"><div class="am-skel-line am-skel-line--lg"></div><div class="am-skel-line"></div><div class="am-skel-block"></div></div>';
		return;
	}
	if (state.msgError) {
		el.innerHTML = `${backButton()}${errorBlock(state.msgError, 'retry-msg')}`;
		el.querySelector('[data-act="retry-msg"]')?.addEventListener('click', () => openMessage(state.selectedId));
		el.querySelector('[data-act="back"]').addEventListener('click', closeReader);
		return;
	}
	const m = state.message;
	const incoming = m.direction === 'in';
	const htmlOnly = !m.text && m.html;
	const body = m.text || (htmlOnly ? htmlToText(m.html) : '');
	const hidden = hasHiddenChars(body) || hasHiddenChars(m.subject);
	el.innerHTML = `
		<article class="am-reader" aria-labelledby="am-read-subj">
			${backButton()}
			<h2 id="am-read-subj" class="am-read-subj">${untrustedText(m.subject || '(no subject)')}</h2>
			<dl class="am-table am-table--compact">
				<div><dt>From</dt><dd>${m.from_name ? `${untrustedText(m.from_name)} ` : ''}<span class="am-mono">${untrustedText(m.from)}</span></dd></div>
				<div><dt>To</dt><dd class="am-mono">${untrustedText((m.to || []).join(', '))}</dd></div>
				${m.cc?.length ? `<div><dt>Cc</dt><dd class="am-mono">${untrustedText(m.cc.join(', '))}</dd></div>` : ''}
				${m.reply_to?.length ? `<div><dt>Reply to</dt><dd class="am-mono">${untrustedText(m.reply_to.join(', '))}</dd></div>` : ''}
				<div><dt>Date</dt><dd>${esc(fullDate(m.created_at))}</dd></div>
			</dl>
			<div class="am-read-tags">
				${incoming ? authBadges(m) : `<span class="am-tag">${esc(m.delivery_status || 'sent')}</span>`}
				${incoming && m.spam_score != null ? `<span class="am-tag" data-tone="${m.spam ? 'bad' : ''}">Spam score ${esc(m.spam_score)}</span>` : ''}
				${m.virus_verdict && m.virus_verdict !== 'PASS' ? `<span class="am-tag" data-tone="bad">Virus check ${esc(m.virus_verdict)}</span>` : ''}
				${m.send ? `<span class="am-tag">Cost ${esc(fmtUsd(m.send.cost_usd))} · ${esc(PAY_LABEL[m.send.payment_source] || m.send.payment_source)}</span>` : ''}
			</div>
			${
				incoming
					? `<div class="am-untrusted" role="note">
						<strong>Untrusted mail.</strong> Shown as plain text with links disabled. When the agent reads it, the text arrives fenced as data, and anything in it that looks like an instruction is ignored.
						${hidden ? ' This message contains hidden characters, marked below.' : ''}
						${htmlOnly ? ' It had only an HTML part; its text is shown without loading any images or links.' : ''}
					</div>`
					: ''
			}
			<div class="am-body">${body ? untrustedText(body) : '<span class="am-dim-text">(empty message)</span>'}</div>
			${m.attachments?.length ? attachmentList(m) : ''}
			<div class="am-row am-read-actions">
				<button type="button" class="am-btn am-btn--primary" data-act="reply">Reply</button>
				${(m.cc?.length || (m.to?.length ?? 0) > 1) ? '<button type="button" class="am-btn" data-act="reply-all">Reply all</button>' : ''}
				${incoming ? '<button type="button" class="am-btn am-btn--ghost" data-act="unread">Mark unread</button>' : ''}
				<button type="button" class="am-btn am-btn--ghost am-btn--danger" data-act="delete">Delete</button>
			</div>
			${m.thread?.length > 1 ? threadList(m) : ''}
		</article>`;
	el.querySelector('[data-act="back"]').addEventListener('click', closeReader);
	el.querySelector('[data-act="reply"]').addEventListener('click', () => openCompose({ mode: 'reply', parent: m }));
	el.querySelector('[data-act="reply-all"]')?.addEventListener('click', () => openCompose({ mode: 'reply', parent: m, replyAll: true }));
	el.querySelector('[data-act="unread"]')?.addEventListener('click', () => markUnread(m));
	el.querySelector('[data-act="delete"]').addEventListener('click', (e) => deleteMessage(m, e.currentTarget));
	el.querySelectorAll('[data-att]').forEach((b) => b.addEventListener('click', () => downloadAttachment(m, b)));
	el.querySelectorAll('[data-thread]').forEach((b) => b.addEventListener('click', () => openMessage(b.dataset.thread)));
}

function backButton() {
	return '<button type="button" class="am-btn am-btn--ghost am-btn--sm am-back" data-act="back" aria-label="Back to the message list">← Back</button>';
}

function attachmentList(m) {
	return `
		<ul class="am-atts" aria-label="Attachments">
			${m.attachments
				.map(
					(a) => `
				<li class="am-att">
					<span class="am-att-name">${untrustedText(a.filename || `attachment-${a.index + 1}`)}</span>
					<span class="am-dim-text">${esc(a.content_type || '')} ${esc(fmtBytes(a.size))}</span>
					${
						a.quarantined
							? '<span class="am-tag" data-tone="bad">Quarantined</span>'
							: a.stored
								? `<button type="button" class="am-btn am-btn--sm" data-att="${esc(a.index)}">Download</button>`
								: '<span class="am-dim-text">Not stored</span>'
					}
				</li>`,
				)
				.join('')}
		</ul>`;
}

function threadList(m) {
	return `
		<section class="am-thread" aria-label="Conversation">
			<h3 class="am-h3">Conversation (${esc(m.thread.length)})</h3>
			<ol>
				${m.thread
					.map(
						(t) => `
					<li><button type="button" class="am-thread-row" data-thread="${esc(t.id)}" ${t.id === m.id ? 'aria-current="true"' : ''}>
						<span class="am-tag">${t.direction === 'in' ? 'In' : 'Out'}</span>
						<span class="am-thread-from">${untrustedText(t.from)}</span>
						<span class="am-thread-subj">${untrustedText(t.subject || '(no subject)')}</span>
						<time datetime="${esc(t.created_at)}">${esc(timeAgo(t.created_at))}</time>
					</button></li>`,
					)
					.join('')}
			</ol>
		</section>`;
}

async function downloadAttachment(m, btn) {
	btn.disabled = true;
	try {
		const data = await api(`/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(btn.dataset.att)}`);
		const a = document.createElement('a');
		a.href = data.url;
		a.rel = 'noopener noreferrer';
		a.download = data.filename || '';
		document.body.appendChild(a);
		a.click();
		a.remove();
	} catch (err) {
		toast(err.message, 'error');
	}
	btn.disabled = false;
}

async function markUnread(m) {
	try {
		await api(`/messages/${encodeURIComponent(m.id)}/read`, { method: 'POST', body: { read: false } });
		const row = state.items.find((x) => x.id === m.id);
		if (row) row.read = false;
		if (state.mailbox) state.mailbox.unread = (state.mailbox.unread || 0) + 1;
		renderUsage();
		closeReader();
		renderList();
		toast('Marked unread');
	} catch (err) {
		toast(err.message, 'error');
	}
}

async function deleteMessage(m, btn) {
	if (btn.dataset.armed !== '1') {
		btn.dataset.armed = '1';
		btn.textContent = 'Click again to delete';
		setTimeout(() => {
			if (btn.isConnected) {
				btn.dataset.armed = '';
				btn.textContent = 'Delete';
			}
		}, 4000);
		return;
	}
	btn.disabled = true;
	try {
		await api(`/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
		state.items = state.items.filter((x) => x.id !== m.id);
		closeReader();
		renderList();
		toast('Message deleted');
	} catch (err) {
		btn.disabled = false;
		toast(err.message, 'error');
	}
}

// ── compose + confirm ────────────────────────────────────────────────────────

let compose = null;

function openCompose({ mode, parent = null, replyAll = false }) {
	if (!state.mailbox) return;
	const subject = parent ? (/^re:/i.test(parent.subject || '') ? parent.subject : `Re: ${parent.subject || ''}`.trim()) : '';
	compose = {
		mode,
		parent,
		replyAll,
		to: '',
		cc: '',
		subject,
		text: '',
		paymentSource: '',
		quote: null,
		error: null,
		busy: false,
		returnFocus: document.activeElement,
	};
	renderCompose();
	document.getElementById(mode === 'reply' ? 'am-c-text' : 'am-c-to')?.focus();
}

function closeCompose() {
	const back = compose?.returnFocus;
	compose = null;
	const host = root.querySelector('#am-modal-host');
	if (host) host.innerHTML = '';
	document.body.classList.remove('am-modal-open');
	back?.focus?.();
}

function composeDraft() {
	return { to: splitAddresses(compose.to), cc: splitAddresses(compose.cc), subject: compose.subject, text: compose.text };
}

function renderCompose() {
	const host = root.querySelector('#am-modal-host');
	if (!host || !compose) return;
	const c = compose;
	const isReply = c.mode === 'reply';
	const p = c.parent;
	const replyTo = isReply ? (p.direction === 'in' ? (p.reply_to?.[0] || p.from) : (p.to || []).join(', ')) : '';
	document.body.classList.add('am-modal-open');
	host.innerHTML = `
		<div class="am-modal-back" data-act="close"></div>
		<div class="am-modal" role="dialog" aria-modal="true" aria-labelledby="am-c-h">
			<div class="am-panel-head">
				<h2 id="am-c-h" class="am-h2">${isReply ? (c.replyAll ? 'Reply all' : 'Reply') : 'New email'}</h2>
				<button type="button" class="am-x" data-act="close" aria-label="Close">×</button>
			</div>
			<form id="am-c-form" class="am-form">
				<div class="am-field"><span>From</span><span class="am-mono">${esc(state.mailbox.display_name ? `${state.mailbox.display_name} <${state.mailbox.address}>` : state.mailbox.address)}</span></div>
				${
					isReply
						? `<div class="am-field"><span>To</span><span class="am-mono">${untrustedText(replyTo)}${c.replyAll ? ' and everyone on the thread' : ''}</span></div>
						   <div class="am-field"><span>Subject</span><span>${untrustedText(c.subject)}</span></div>`
						: `<label class="am-field"><span>To</span><input id="am-c-to" name="to" value="${esc(c.to)}" placeholder="name@example.com, agent@agents.three.ws" autocomplete="off" spellcheck="false" required /></label>
						   <label class="am-field"><span>Cc</span><input id="am-c-cc" name="cc" value="${esc(c.cc)}" placeholder="optional" autocomplete="off" spellcheck="false" /></label>
						   <label class="am-field"><span>Subject</span><input id="am-c-subj" name="subject" value="${esc(c.subject)}" maxlength="200" autocomplete="off" required /></label>`
				}
				<label class="am-field"><span>Message</span><textarea id="am-c-text" name="text" rows="9" required placeholder="Hi Sam,&#10;&#10;…&#10;&#10;Best,&#10;${esc(state.mailbox.display_name || state.agent.name || '')}">${esc(c.text)}</textarea></label>
				<p class="am-hint">Plain text. Open with a greeting, close with a sign-off and the agent's name, and write at least 12 words between them. Urgency and pressure language is refused.</p>
				<label class="am-field am-field--inline"><span>Pay with</span>
					<select name="payment_source">
						<option value="" ${!c.paymentSource ? 'selected' : ''}>Credits, then agent wallet</option>
						<option value="credits" ${c.paymentSource === 'credits' ? 'selected' : ''}>Account credits</option>
						<option value="wallet" ${c.paymentSource === 'wallet' ? 'selected' : ''}>Agent wallet (USDC on Solana)</option>
					</select>
				</label>
				<div class="am-row">
					<button type="submit" class="am-btn am-btn--primary" ${c.busy ? 'disabled' : ''}>${c.busy && !c.quote ? 'Checking…' : c.quote ? 'Re-check' : 'Review before sending'}</button>
					<button type="button" class="am-btn am-btn--ghost" data-act="close">Cancel</button>
				</div>
			</form>
			${c.error ? composeError(c.error) : ''}
			${c.quote ? confirmBlock(c.quote) : ''}
		</div>`;
	bindCompose(host);
}

function composeError(err) {
	const blocked = err.code === 'recipient_not_allowed' && err.details?.blocked?.length;
	const violations = err.code === 'content_rejected' && err.details?.violations?.length;
	return `
		<div class="am-state am-state--error" role="alert">
			<p>${esc(violations ? 'The message needs a few changes before it can be sent:' : err.message)}</p>
			${violations ? `<ul class="am-violations">${err.details.violations.map((v) => `<li>${esc(v.message)}</li>`).join('')}</ul>` : ''}
			${blocked ? '<p><a href="#am-settings-h">Edit the allowlist</a> to let this agent write to them.</p>' : ''}
			${err.code === 'daily_send_cap' ? '<p><a href="#am-settings-h">Raise the daily cap</a> or wait for the 24-hour window to roll.</p>' : ''}
			${['insufficient_credits', 'insufficient_funds'].includes(err.code) ? '<p><a href="/credits">Add credits</a> or fund the agent wallet.</p>' : ''}
		</div>`;
}

function confirmBlock(q) {
	const pv = q.preview || {};
	const d = q.delivery || {};
	const wallet = q.payment_source === 'wallet';
	return `
		<div class="am-confirm" role="group" aria-labelledby="am-confirm-h">
			<h3 id="am-confirm-h" class="am-h3">Send exactly this?</h3>
			<dl class="am-table">
				<div><dt>From</dt><dd class="am-mono">${esc(pv.from)}</dd></div>
				<div><dt>To</dt><dd class="am-mono">${esc((pv.to || []).join(', '))}</dd></div>
				${pv.cc?.length ? `<div><dt>Cc</dt><dd class="am-mono">${esc(pv.cc.join(', '))}</dd></div>` : ''}
				<div><dt>Subject</dt><dd>${untrustedText(pv.subject || '(no subject)')}</dd></div>
				<div><dt>Delivery</dt><dd>${deliveryLine(d)}</dd></div>
				<div><dt>Price</dt><dd>${esc(fmtUsd(q.price_usd))}${wallet ? ' USDC on Solana' : ''}</dd></div>
				<div><dt>Paid from</dt><dd>${esc(PAY_LABEL[q.payment_source] || q.payment_source)}${wallet && q.funding?.wallet_address ? ` <span class="am-mono">${esc(q.funding.wallet_address)}</span>` : ''}</dd></div>
			</dl>
			<div class="am-body am-body--preview" aria-label="Exact body">${untrustedText(pv.text)}</div>
			${pv.attachments?.length ? `<p class="am-dim-text">${esc(pv.attachments.length)} attachment(s): ${esc(pv.attachments.map((a) => a.filename).join(', '))}</p>` : ''}
			<p class="am-expire" data-expires="${esc(q.expires_at)}"></p>
			<label class="am-check"><input type="checkbox" id="am-send-ok" /> Send this message and charge ${esc(fmtUsd(q.price_usd))}</label>
			<div class="am-row">
				<button type="button" class="am-btn am-btn--primary" data-act="send" disabled>Send</button>
			</div>
		</div>`;
}

function deliveryLine(d) {
	const parts = [];
	if (d.agent_mailboxes?.length) parts.push(`Instant to agent mailbox${d.agent_mailboxes.length === 1 ? '' : 'es'}: <span class="am-mono">${esc(d.agent_mailboxes.join(', '))}</span>`);
	if (d.external?.length) parts.push(`Over the internet: <span class="am-mono">${esc(d.external.join(', '))}</span>`);
	return parts.join('<br />') || 'none';
}

function bindCompose(host) {
	const c = compose;
	host.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', closeCompose));
	const form = host.querySelector('#am-c-form');
	form.addEventListener('input', () => {
		if (form.to) c.to = form.to.value;
		if (form.cc) c.cc = form.cc.value;
		if (form.subject) c.subject = form.subject.value;
		c.text = form.text.value;
		c.paymentSource = form.payment_source.value;
		if (c.quote) {
			// Any edit voids the quote: the confirmation always matches the bytes sent.
			c.quote = null;
			host.querySelector('.am-confirm')?.remove();
			const submit = form.querySelector('[type="submit"]');
			submit.textContent = 'Review before sending';
		}
	});
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		c.busy = true;
		c.error = null;
		renderCompose();
		try {
			c.quote =
				c.mode === 'reply'
					? await api('/quote', {
							method: 'POST',
							body: { action: 'reply', message_id: c.parent.id, text: c.text, reply_all: c.replyAll, payment_source: c.paymentSource || undefined },
						})
					: await api('/quote', { method: 'POST', body: { action: 'send', ...composeDraft(), payment_source: c.paymentSource || undefined } });
		} catch (err) {
			c.error = err;
			c.quote = null;
		}
		c.busy = false;
		if (compose !== c) return;
		renderCompose();
		host.querySelector('#am-send-ok')?.focus();
	});
	if (!c.quote) return;
	const ok = host.querySelector('#am-send-ok');
	const btn = host.querySelector('[data-act="send"]');
	ok.addEventListener('change', () => (btn.disabled = !ok.checked || c.busy));
	startExpiry(host.querySelector('.am-expire'), () => {
		btn.disabled = true;
		ok.disabled = true;
	});
	btn.addEventListener('click', () => sendConfirmed(c, btn));
}

async function sendConfirmed(c, btn) {
	c.busy = true;
	btn.disabled = true;
	btn.textContent = 'Sending…';
	try {
		const result =
			c.mode === 'reply'
				? await api('/reply', {
						method: 'POST',
						body: { quote_id: c.quote.quote_id, confirm_send: true, message_id: c.parent.id, text: c.text, reply_all: c.replyAll },
					})
				: await api('/send', { method: 'POST', body: { quote_id: c.quote.quote_id, confirm_send: true, ...composeDraft() } });
		closeCompose();
		const local = result?.delivered_to_agents?.length;
		toast(local ? `Sent and delivered to ${result.delivered_to_agents.join(', ')}` : 'Sent');
		await refreshMailbox();
		if (state.folder === 'sent' || state.folder === 'all') loadList();
		if (c.mode === 'reply' && state.selectedId) openMessage(state.selectedId);
	} catch (err) {
		c.busy = false;
		c.error = err;
		// A quote is single use and bound to the draft; ask for a fresh one.
		c.quote = null;
		if (compose === c) renderCompose();
	}
}

// ── sending limits ───────────────────────────────────────────────────────────

async function loadSettings() {
	try {
		state.settings = await api('/settings');
		state.settingsError = null;
	} catch (err) {
		state.settingsError = err;
	}
	renderSettings();
	renderRules();
	renderUsage();
}

function renderSettings() {
	const el = root.querySelector('#am-settings');
	if (!el) return;
	if (state.settingsError) {
		el.innerHTML = errorBlock(state.settingsError, 'retry-settings');
		el.querySelector('[data-act="retry-settings"]').addEventListener('click', loadSettings);
		return;
	}
	if (!state.settings) {
		el.innerHTML = '<div class="am-skel-line"></div><div class="am-skel-line"></div><div class="am-skel-block am-skel-block--sm"></div>';
		return;
	}
	const { policy, usage, limits } = state.settings;
	el.innerHTML = `
		<form id="am-policy" class="am-form">
			<label class="am-switch">
				<input type="checkbox" name="allowlist_enabled" ${policy.allowlist_enabled ? 'checked' : ''} />
				<span>Only allow listed recipients</span>
			</label>
			<label class="am-field">
				<span>Allowlist <span class="am-dim-text">(one per line: an address, or @domain for a whole domain)</span></span>
				<textarea name="allowlist" rows="5" spellcheck="false" placeholder="sam@example.com&#10;@agents.three.ws">${esc((policy.allowlist || []).join('\n'))}</textarea>
			</label>
			<label class="am-field am-field--inline">
				<span>Daily send cap</span>
				<input type="number" name="daily_send_cap" min="0" max="${esc(limits.max_daily_send_cap)}" step="1" value="${policy.daily_send_cap ?? ''}" placeholder="no cap" />
			</label>
			<p class="am-hint">The platform also limits a new mailbox to ${esc(usage.warmup_per_hour)} per hour and ${esc(usage.warmup_per_day)} per day while it warms up. Sent in the last 24 hours: ${esc(usage.sent_last_day)}. These limits can only be changed here, signed in. The agent's API key cannot loosen them.</p>
			<div class="am-row">
				<button type="submit" class="am-btn am-btn--primary" disabled>Save limits</button>
				<span class="am-dim-text" id="am-policy-status" aria-live="polite">${policy.updated_at ? `Saved ${esc(timeAgo(policy.updated_at))}` : ''}</span>
			</div>
		</form>`;
	const form = el.querySelector('#am-policy');
	const save = form.querySelector('[type="submit"]');
	form.addEventListener('input', () => (save.disabled = false));
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		save.disabled = true;
		const status = form.querySelector('#am-policy-status');
		status.textContent = 'Saving…';
		const capRaw = form.daily_send_cap.value.trim();
		try {
			const data = await api('/policy', {
				method: 'PUT',
				body: {
					allowlist_enabled: form.allowlist_enabled.checked,
					allowlist: form.allowlist.value.split('\n').map((s) => s.trim()).filter(Boolean),
					daily_send_cap: capRaw === '' ? null : Number(capRaw),
				},
			});
			state.settings.policy = data.policy;
			renderSettings();
			renderUsage();
			toast('Sending limits saved');
		} catch (err) {
			status.textContent = '';
			save.disabled = false;
			toast(err.message, 'error');
		}
	});
}

// ── rules ────────────────────────────────────────────────────────────────────

function renderRules() {
	const el = root.querySelector('#am-rules');
	if (!el) return;
	if (state.settingsError) {
		el.innerHTML = '';
		return;
	}
	if (!state.settings) {
		el.innerHTML = '<ul class="am-rules"><li class="am-rule am-rule--skel"></li><li class="am-rule am-rule--skel"></li></ul>';
		return;
	}
	const list = state.settings.rules || [];
	const editing = state.editingRule;
	el.innerHTML = `
		${editing === 'new' ? ruleForm(null) : ''}
		${
			list.length
				? `<ul class="am-rules">${list.map((r) => (editing === r.id ? `<li>${ruleForm(r)}</li>` : ruleRow(r))).join('')}</ul>`
				: editing === 'new'
					? ''
					: `<div class="am-state"><p>No rules yet. A rule could say: when mail arrives from <span class="am-mono">billing@example.com</span>, ask me before the agent summarizes it.</p>
						<div class="am-row am-row--center"><button type="button" class="am-btn am-btn--sm" data-act="new-rule-empty">Create a rule</button></div></div>`
		}`;
	el.querySelector('[data-act="new-rule-empty"]')?.addEventListener('click', () => {
		state.editingRule = 'new';
		renderRules();
		root.querySelector('#am-rule-name')?.focus();
	});
	el.querySelectorAll('[data-rule-toggle]').forEach((input) =>
		input.addEventListener('change', () => patchRule(input.dataset.ruleToggle, { enabled: input.checked }, input)),
	);
	el.querySelectorAll('[data-rule-edit]').forEach((b) =>
		b.addEventListener('click', () => {
			state.editingRule = b.dataset.ruleEdit;
			renderRules();
		}),
	);
	el.querySelectorAll('[data-rule-delete]').forEach((b) => b.addEventListener('click', () => deleteRule(b)));
	const form = el.querySelector('#am-rule-form');
	if (form) bindRuleForm(form);
}

function ruleRow(r) {
	return `
		<li class="am-rule${r.enabled ? '' : ' am-rule--off'}">
			<div class="am-rule-top">
				<label class="am-switch am-switch--sm" title="${r.enabled ? 'Turn off' : 'Turn on'}">
					<input type="checkbox" data-rule-toggle="${esc(r.id)}" ${r.enabled ? 'checked' : ''} aria-label="Rule ${esc(r.name)} enabled" />
				</label>
				<span class="am-rule-name">${esc(r.name)}</span>
				<span class="am-tag" data-tone="${r.mode === 'auto' ? 'warn' : ''}">${r.mode === 'auto' ? 'Runs automatically' : 'Asks for approval'}</span>
			</div>
			<p class="am-rule-match">From <span class="am-mono">${esc(r.match_from)}</span>${r.match_subject ? `, subject contains “${esc(r.match_subject)}”` : ''}</p>
			<p class="am-rule-prompt">${esc(r.prompt)}</p>
			<div class="am-row am-rule-foot">
				<span class="am-dim-text">${r.fire_count ? `Fired ${esc(r.fire_count)} time${r.fire_count === 1 ? '' : 's'}, last ${esc(timeAgo(r.last_fired_at))}` : 'Not fired yet'}</span>
				<span class="am-grow"></span>
				<button type="button" class="am-btn am-btn--ghost am-btn--sm" data-rule-edit="${esc(r.id)}">Edit</button>
				<button type="button" class="am-btn am-btn--ghost am-btn--sm am-btn--danger" data-rule-delete="${esc(r.id)}">Delete</button>
			</div>
		</li>`;
}

function ruleForm(r) {
	const lim = state.settings.limits || {};
	return `
		<form id="am-rule-form" class="am-form am-rule-form" data-rule="${esc(r?.id || '')}">
			<label class="am-field"><span>Name</span><input id="am-rule-name" name="name" value="${esc(r?.name || '')}" maxlength="80" required placeholder="Summarize invoices" /></label>
			<label class="am-field"><span>When mail arrives from</span><input name="match_from" value="${esc(r?.match_from || '')}" required spellcheck="false" placeholder="billing@example.com or @example.com" /></label>
			<label class="am-field"><span>And the subject contains <span class="am-dim-text">(optional)</span></span><input name="match_subject" value="${esc(r?.match_subject || '')}" maxlength="120" placeholder="invoice" /></label>
			<fieldset class="am-field am-radios">
				<legend>Then</legend>
				<label class="am-check"><input type="radio" name="mode" value="approve" ${r?.mode !== 'auto' ? 'checked' : ''} /> Ask me first in <a href="/approvals">Approvals</a>, then run</label>
				<label class="am-check"><input type="radio" name="mode" value="auto" ${r?.mode === 'auto' ? 'checked' : ''} /> Run it automatically</label>
			</fieldset>
			<label class="am-field"><span>Run this prompt</span><textarea name="prompt" rows="3" required maxlength="${esc(lim.max_prompt_chars || 2000)}" placeholder="Summarize this email in two sentences and tell me whether it needs a reply.">${esc(r?.prompt || '')}</textarea></label>
			<p class="am-hint">The run uses free model lanes with read-only tools and no spending budget. The email is handed over fenced as untrusted data after your prompt, so nothing in it can redirect the agent.</p>
			<div class="am-row">
				<button type="submit" class="am-btn am-btn--primary">${r ? 'Save rule' : 'Create rule'}</button>
				<button type="button" class="am-btn am-btn--ghost" data-act="rule-cancel">Cancel</button>
			</div>
		</form>`;
}

function bindRuleForm(form) {
	form.querySelector('[data-act="rule-cancel"]').addEventListener('click', () => {
		state.editingRule = null;
		renderRules();
	});
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const btn = form.querySelector('[type="submit"]');
		btn.disabled = true;
		const body = {
			name: form.name.value.trim(),
			match_from: form.match_from.value.trim(),
			match_subject: form.match_subject.value.trim() || null,
			mode: form.mode.value,
			prompt: form.prompt.value.trim(),
		};
		const id = form.dataset.rule;
		try {
			if (id) await api(`/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body });
			else await api('/rules', { method: 'POST', body: { ...body, enabled: true } });
			state.editingRule = null;
			await loadSettings();
			toast(id ? 'Rule saved' : 'Rule created');
		} catch (err) {
			btn.disabled = false;
			toast(err.message, 'error');
		}
	});
}

async function patchRule(id, patch, input) {
	input.disabled = true;
	try {
		await api(`/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
		await loadSettings();
	} catch (err) {
		input.checked = !input.checked;
		input.disabled = false;
		toast(err.message, 'error');
	}
}

async function deleteRule(btn) {
	if (btn.dataset.armed !== '1') {
		btn.dataset.armed = '1';
		btn.textContent = 'Click again to delete';
		setTimeout(() => {
			if (btn.isConnected) {
				btn.dataset.armed = '';
				btn.textContent = 'Delete';
			}
		}, 4000);
		return;
	}
	btn.disabled = true;
	try {
		await api(`/rules/${encodeURIComponent(btn.dataset.ruleDelete)}`, { method: 'DELETE' });
		await loadSettings();
		toast('Rule deleted');
	} catch (err) {
		btn.disabled = false;
		toast(err.message, 'error');
	}
}

// ── rule activity ────────────────────────────────────────────────────────────

let eventsLoading = true;
async function loadEvents() {
	eventsLoading = true;
	renderEvents();
	try {
		const data = await api('/rule-events?limit=30');
		state.events = data.events || [];
		state.eventsError = null;
	} catch (err) {
		state.eventsError = err;
	}
	eventsLoading = false;
	renderEvents();
}

function renderEvents() {
	const el = root.querySelector('#am-events');
	if (!el) return;
	if (eventsLoading) {
		el.innerHTML = '<ul class="am-events"><li class="am-event am-event--skel"></li><li class="am-event am-event--skel"></li></ul>';
		return;
	}
	if (state.eventsError) {
		el.innerHTML = errorBlock(state.eventsError, 'retry-events');
		el.querySelector('[data-act="retry-events"]').addEventListener('click', loadEvents);
		return;
	}
	if (!state.events.length) {
		el.innerHTML = '<div class="am-state"><p>No rule has fired yet. When one does, the approval or run it started shows up here with its result.</p></div>';
		return;
	}
	el.innerHTML = `<ul class="am-events">${state.events.map(eventRow).join('')}</ul>`;
	el.querySelectorAll('[data-open-msg]').forEach((b) =>
		b.addEventListener('click', () => {
			openMessage(b.dataset.openMsg);
			root.querySelector('.am-panel--mail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}),
	);
}

function eventRow(e) {
	const run = e.run;
	return `
		<li class="am-event">
			<div class="am-event-top">
				<span class="am-status" data-status="${esc(e.status)}">${esc(EVENT_LABEL[e.status] || e.status)}</span>
				<span class="am-rule-name">${esc(e.rule.name)}</span>
				<time class="am-dim-text" datetime="${esc(e.created_at)}" title="${esc(fullDate(e.created_at))}">${esc(timeAgo(e.created_at))}</time>
			</div>
			<p class="am-event-msg">
				<button type="button" class="am-link" data-open-msg="${esc(e.message.id)}">${untrustedText(e.message.subject || '(no subject)')}</button>
				<span class="am-dim-text">from <span class="am-mono">${untrustedText(e.message.from)}</span></span>
			</p>
			<div class="am-row">
				${e.approval ? `<a class="am-btn am-btn--sm${e.approval.status === 'pending' ? ' am-btn--primary' : ''}" href="${esc(e.approval.link)}">${e.approval.status === 'pending' ? 'Review approval' : `Approval: ${esc(e.approval.status)}`}</a>` : ''}
				${run ? `<span class="am-tag">Run ${esc(RUN_LABEL[run.status] || run.status || 'unknown')}</span>` : ''}
			</div>
			${e.error ? `<p class="am-event-err">${esc(e.error)}</p>` : ''}
			${run?.result ? `<details class="am-event-result"><summary>What the agent concluded</summary><div class="am-body">${untrustedText(run.result)}</div></details>` : ''}
		</li>`;
}

// ── boot ─────────────────────────────────────────────────────────────────────

function resolveAgentId() {
	const fromQuery = new URLSearchParams(location.search).get('id');
	if (fromQuery) return fromQuery;
	const m = location.pathname.match(/\/agents\/([^/]+)\/mail/);
	return m ? decodeURIComponent(m[1]) : null;
}

async function currentUser() {
	const me = await fetch('/api/auth/me', { credentials: 'include', headers: { accept: 'application/json' } });
	if (me.status === 401) return null;
	if (!me.ok) throw new Error(`HTTP ${me.status}`);
	const j = await me.json();
	return j?.user?.id ? j.user : null;
}

async function mountMailbox() {
	const data = await api('');
	state.mailbox = data.mailbox;
	state.pricing = data.pricing;
	state.domain = data.domain;
	renderShell();
	if (!state.mailbox) return;
	const params = new URLSearchParams(location.search);
	const folder = params.get('folder');
	if (FOLDERS.some(([k]) => k === folder)) {
		state.folder = folder;
		root.querySelectorAll('[data-folder]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.folder === folder)));
	}
	const deep = params.get('m');
	loadList();
	loadSettings();
	loadEvents();
	if (deep && UUID_RE.test(deep)) openMessage(deep);
}

async function mountAgent(agentId) {
	renderLoading('Loading agent mail');
	const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { credentials: 'include', headers: { accept: 'application/json' } });
	if (res.status === 404) {
		renderMessage({
			title: 'Agent not found',
			body: 'This agent does not exist or was deleted by its owner.',
			actions: [{ href: '/agent-mail', label: 'Your agents', primary: true }],
		});
		setPageTitle('Agent not found · three.ws');
		return;
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const { agent } = await res.json();
	if (!agent?.is_owner) {
		renderMessage({
			title: 'Only the owner can open this inbox',
			body: "An agent's mail is private to its owner. Open your own agents to read their mail.",
			actions: [
				{ href: '/agent-mail', label: 'Your agents', primary: true },
				{ href: `/agents/${encodeURIComponent(agentId)}`, label: 'View this agent' },
			],
			tone: 'info',
		});
		return;
	}
	state.agent = agent;
	setPageTitle(`${agent.name || 'Agent'} mail · three.ws`);
	try {
		await mountMailbox();
	} catch (err) {
		renderMessage({ title: "Couldn't open this inbox", body: err.message, retry: true });
	}
}

function bindShortcuts() {
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			if (compose) closeCompose();
			else if (state.selectedId) closeReader();
			return;
		}
		const t = e.target;
		if (e.metaKey || e.ctrlKey || e.altKey || compose) return;
		if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if (e.key === '/') {
			const q = root.querySelector('#am-q');
			if (q) {
				e.preventDefault();
				q.focus();
			}
		} else if (e.key === 'c' && state.mailbox) {
			e.preventDefault();
			openCompose({ mode: 'new' });
		}
	});
}

async function boot() {
	renderLoading('Loading');
	try {
		const user = await currentUser();
		const agentId = resolveAgentId();
		if (!user) {
			const next = encodeURIComponent(location.pathname + location.search);
			renderMessage({
				title: 'Sign in to open agent mail',
				body: 'Every agent can have its own email inbox. Sign in to read and send mail for your agents.',
				actions: [
					{ href: `/login?next=${next}`, label: 'Sign in', primary: true },
					{ href: '/register', label: 'Create account' },
				],
				tone: 'info',
			});
			return;
		}
		if (agentId) {
			if (!UUID_RE.test(agentId)) {
				renderMessage({
					title: 'That agent link is not valid',
					body: 'Open mail from one of your agents.',
					actions: [{ href: '/agent-mail', label: 'Your agents', primary: true }],
				});
				return;
			}
			await mountAgent(agentId);
			return;
		}
		const r = await fetch('/api/agents', { credentials: 'include', headers: { accept: 'application/json' } });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const agents = (await r.json())?.agents || [];
		if (!agents.length) {
			renderMessage({
				title: 'No agents yet',
				body: 'Create an agent first, then give it an email address.',
				actions: [{ href: '/create-agent', label: 'Create an agent', primary: true }],
				tone: 'info',
			});
			return;
		}
		if (agents.length === 1) {
			history.replaceState(null, '', `/agents/${encodeURIComponent(agents[0].id)}/mail${location.search}`);
			await mountAgent(agents[0].id);
			return;
		}
		renderPicker(agents);
	} catch {
		renderMessage({
			title: "Couldn't load agent mail",
			body: 'We could not reach three.ws. This is usually temporary; check your connection and try again.',
			retry: true,
		});
	}
}

bindShortcuts();
boot();
