// X mention bot operator console: /x/ops.
//
// A client of /api/x/ops/*, never a gate in front of it: every action
// authorizes server-side (requireAdmin), so this file owes the real admin
// speed and accurate state, nothing more. Two rules follow:
//
//   - The list reloads after every mutation, so what the admin sees is what
//     the database holds. An admin deciding whether to send a reply live
//     needs the current row, not a stale optimistic one.
//   - `send` is the one action that posts to X for real. It gets its own
//     confirm() naming the account and the exact text, on top of the
//     page-level "posts publicly" warning in the drawer, because this is the
//     one button on this console an admin must never click by habit.

import { apiFetch } from './api.js';

// Mirrors INTENTS in api/_lib/x-mention-intents.js. Kept as a plain list here
// rather than importing that module: it is server-only (reached through
// api/_lib), and the intent set changes rarely enough that duplicating seven
// short strings costs less than pulling a server module into this bundle.
const INTENTS = ['make', 'image3d', 'avatar', 'help', 'launch', 'chat', 'ignore'];

const shell = document.getElementById('xo-app');
const railEl = document.getElementById('xo-rail');
const tableBody = document.getElementById('xo-rows');
const laneTitle = document.getElementById('xo-lane-title');
const refreshBtn = document.getElementById('xo-refresh');
const loadMoreBtn = document.getElementById('xo-load-more');
const updatedEl = document.getElementById('xo-updated');
const statusDot = document.getElementById('xo-status-dot');
const statusText = document.getElementById('xo-status-text');
const togglePauseBtn = document.getElementById('xo-toggle-pause');
const filterAccount = document.getElementById('xo-filter-account');
const filterIntent = document.getElementById('xo-filter-intent');
const filterAuthor = document.getElementById('xo-filter-author');
const drawer = document.getElementById('xo-drawer');
const scrim = document.getElementById('xo-scrim');
const drawerBody = document.getElementById('xo-drawer-body');
const drawerTitle = document.getElementById('xo-drawer-title');
const closeBtn = document.getElementById('xo-close');

filterIntent.innerHTML += INTENTS.map((i) => `<option value="${i}">${i}</option>`).join('');

// The lanes an admin reviews, in the order they matter: a reply still in dry
// run is the thing that might need sending; a live reply and a skip are
// history. Account/intent/author filters stack on top of whichever lane is
// active.
const RAIL = [
	{ key: 'all', label: 'All mentions', decision: null, dryRun: null },
	{ key: 'review', label: 'Awaiting send', decision: 'reply', dryRun: true },
	{ key: 'sent', label: 'Sent live', decision: 'reply', dryRun: false },
	{ key: 'skip', label: 'Skipped', decision: 'skip', dryRun: null },
	{ key: 'blocked', label: 'Paused / blocked', decision: 'paused', dryRun: null },
	{ key: 'error', label: 'Errors', decision: 'error', dryRun: null },
];

let activeLane = RAIL[0];
let rows = [];
let total = 0;
let offset = 0;
const PAGE = 50;
let openTweetId = null;
let lastFocused = null;
let botPaused = false;
let blocklist = [];

const esc = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtDate(value) {
	if (!value) return 'not yet';
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return 'unknown';
	return d.toISOString().slice(0, 16).replace('T', ' ');
}

function shortText(v, max = 80) {
	const s = String(v || '');
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function api(path, options = {}) {
	const res = await apiFetch(`/api/x/ops/${path}`, {
		...options,
		headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	if (!res.ok) {
		const err = new Error(body?.error_description || body?.error || `request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return body;
}

// ── status + rail ────────────────────────────────────────────────────────────

function renderStatus() {
	statusDot.dataset.paused = String(botPaused);
	statusText.textContent = botPaused ? 'Bot paused' : 'Bot live';
	togglePauseBtn.textContent = botPaused ? 'Resume bot' : 'Pause bot';
}

async function loadStatus() {
	try {
		const data = await api('status');
		botPaused = !!data.paused;
		blocklist = data.blocklist || [];
		renderStatus();
	} catch {
		statusText.textContent = 'status unknown';
	}
}

function renderRail() {
	railEl.innerHTML =
		`<p class="xo-rail-head">Lanes</p>` +
		RAIL.map(
			(lane) => `<button type="button" class="xo-rail-btn" data-lane="${lane.key}" aria-pressed="${lane.key === activeLane.key}">
			<span>${esc(lane.label)}</span>
		</button>`,
		).join('');
}

// ── the list ─────────────────────────────────────────────────────────────────

function decisionPill(r) {
	const label = r.decision === 'reply' && r.dry_run ? 'reply (dry run)' : r.decision === 'reply' ? 'replied' : r.decision || 'pending';
	return `<span class="xo-pill" data-decision="${esc(r.decision)}">${esc(label)}</span>`;
}

function skeletonRows(n = 6) {
	tableBody.innerHTML = `<tr><td colspan="6" style="padding:0">${'<div class="xo-skeleton"></div>'.repeat(n)}</td></tr>`;
}

function emptyState() {
	tableBody.innerHTML = `<tr><td colspan="6"><div class="xo-state">
		<strong>Nothing in ${esc(activeLane.label.toLowerCase())}</strong>
		Pick another lane, or widen the account/intent/author filters above the table.
	</div></td></tr>`;
}

function errorState(err) {
	const denied = err.status === 403 || err.status === 401;
	const body = denied
		? `<strong>You are not signed in as an admin</strong>Sign in with a platform admin wallet to open this console.`
		: err.status === 503
			? `<strong>The console needs a configured database</strong>This deployment has no <code>DATABASE_URL</code>, so there is nothing to show.`
			: `<strong>Could not load mentions</strong>${esc(err.message)}`;
	tableBody.innerHTML = `<tr><td colspan="6"><div class="xo-state">${body}</div></td></tr>`;
}

function currentFilters() {
	return {
		account_kind: filterAccount.value || '',
		intent: filterIntent.value || '',
		author_id: filterAuthor.value.trim() || '',
		decision: activeLane.decision || '',
		dry_run: activeLane.dryRun == null ? '' : activeLane.dryRun ? '1' : '0',
	};
}

function rowHtml(r) {
	return `<tr class="xo-row" tabindex="0" role="button" data-id="${esc(r.tweet_id)}"
			aria-selected="${r.tweet_id === openTweetId}" aria-label="Mention from ${esc(r.author_username || r.author_id)}, ${esc(r.decision)}">
		<td class="xo-mono">${esc(fmtDate(r.created_at))}</td>
		<td>${esc(r.account_kind)}${r.account_kind === 'agent' ? ` <span class="xo-mono">${esc(r.account_ref.slice ? r.account_ref.slice(0, 8) : r.account_ref)}</span>` : ''}</td>
		<td>@${esc(r.author_username || r.author_id)}</td>
		<td>${esc(r.intent || '-')}</td>
		<td>${decisionPill(r)}</td>
		<td>${esc(shortText(r.reply_text || r.reason || ''))}</td>
	</tr>`;
}

async function loadList({ reset = true } = {}) {
	laneTitle.textContent = activeLane.label;
	if (reset) {
		offset = 0;
		skeletonRows();
	}
	try {
		const params = new URLSearchParams();
		const filters = currentFilters();
		for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
		params.set('limit', String(PAGE));
		params.set('offset', String(offset));
		const data = await api(`list?${params.toString()}`);
		total = data.total || 0;
		rows = reset ? data.mentions : [...rows, ...data.mentions];
		updatedEl.textContent = `updated ${new Date().toLocaleTimeString()}`;
		if (!rows.length) return emptyState();
		tableBody.innerHTML = rows.map(rowHtml).join('');
		loadMoreBtn.style.display = rows.length < total ? '' : 'none';
	} catch (err) {
		errorState(err);
		updatedEl.textContent = '';
	}
}

// ── the drawer ───────────────────────────────────────────────────────────────

function openDrawer(tweetId) {
	lastFocused = document.activeElement;
	openTweetId = tweetId;
	drawer.dataset.open = 'true';
	scrim.dataset.open = 'true';
	drawer.setAttribute('aria-hidden', 'false');
	drawerTitle.textContent = `Mention ${tweetId}`;
	closeBtn.focus();
	renderDrawer();
}

function closeDrawer() {
	openTweetId = null;
	drawer.dataset.open = 'false';
	scrim.dataset.open = 'false';
	drawer.setAttribute('aria-hidden', 'true');
	drawerBody.innerHTML = '';
	if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
	for (const row of tableBody.querySelectorAll('.xo-row')) row.setAttribute('aria-selected', 'false');
}

function mediaHtml(url) {
	if (!url) return '';
	const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url);
	return isVideo
		? `<video class="xo-media" src="${esc(url)}" controls></video>`
		: `<img class="xo-media" src="${esc(url)}" alt="Reply media" loading="lazy" />`;
}

function drawerHtml(r) {
	const blocked = blocklist.includes(String(r.author_id));
	const canSend = r.decision === 'reply' && r.dry_run && !r.reply_tweet_id;
	return `
		<section>
			<h3 class="xo-section-title">Mention</h3>
			<dl class="xo-kv">
				<dt>Tweet</dt><dd class="xo-mono">${esc(r.tweet_id)}</dd>
				<dt>Account</dt><dd>${esc(r.account_kind)} · ${esc(r.account_ref)}</dd>
				<dt>Author</dt><dd>@${esc(r.author_username || r.author_id)} <span class="xo-mono">${esc(r.author_id)}</span>${blocked ? ' (blocked)' : ''}</dd>
				<dt>Intent</dt><dd>${esc(r.intent || '-')}</dd>
				<dt>Decision</dt><dd>${decisionPill(r)}</dd>
				<dt>Reason</dt><dd>${esc(r.reason || 'none recorded')}</dd>
				<dt>When</dt><dd>${esc(fmtDate(r.created_at))}</dd>
			</dl>
		</section>

		<section>
			<h3 class="xo-section-title">Mention text</h3>
			<p class="xo-quote">${esc(r.mention_text || '(no text)')}</p>
		</section>

		<section>
			<h3 class="xo-section-title">${r.dry_run ? 'Would reply' : 'Replied'}</h3>
			${r.reply_text ? `<p class="xo-quote">${esc(r.reply_text)}</p>` : `<p class="xo-note">No reply text recorded.</p>`}
			${mediaHtml(r.reply_media_url)}
			${r.reply_tweet_id ? `<p class="xo-note">Live reply id: <span class="xo-mono">${esc(r.reply_tweet_id)}</span></p>` : ''}
			${r.error ? `<p class="xo-note" data-tone="error">${esc(r.error)}</p>` : ''}
		</section>

		${canSend ? `<section>
			<h3 class="xo-section-title">Send this reply</h3>
			<p class="xo-warning"><strong>This posts publicly on X.</strong> Sending replies the text above, as @${esc(r.account_kind === 'company' ? 'trythreews' : `agent ${r.account_ref}`)}, in reply to tweet ${esc(r.tweet_id)}. This cannot be undone.</p>
			<div class="xo-actions" style="margin-top:8px">
				<button type="button" class="xo-btn xo-btn-primary" data-act="send">Send this reply live</button>
			</div>
		</section>` : ''}

		<section>
			<h3 class="xo-section-title">Author</h3>
			<div class="xo-actions">
				${blocked
					? `<button type="button" class="xo-btn" data-act="unblock">Unblock this author</button>`
					: `<button type="button" class="xo-btn xo-btn-danger" data-act="block">Block this author</button>`}
			</div>
		</section>

		<p class="xo-note" id="xo-drawer-result" role="status" aria-live="polite"></p>`;
}

function rowFor(tweetId) {
	return rows.find((r) => r.tweet_id === tweetId) || null;
}

function renderDrawer() {
	const r = rowFor(openTweetId);
	if (!r) {
		drawerBody.innerHTML = `<div class="xo-state"><strong>Mention not loaded</strong>Refresh the list and reopen it.</div>`;
		return;
	}
	drawerBody.innerHTML = drawerHtml(r);
}

function sayDrawer(message, tone = '') {
	const el = drawerBody.querySelector('#xo-drawer-result');
	if (!el) return;
	el.textContent = message;
	if (tone) el.dataset.tone = tone;
	else delete el.dataset.tone;
}

let actionInFlight = false;

async function runDrawerAction(work) {
	if (actionInFlight) return;
	actionInFlight = true;
	for (const b of drawerBody.querySelectorAll('button[data-act]')) b.disabled = true;
	sayDrawer('Working…');
	try {
		await work();
		await loadStatus();
		await loadList({ reset: true });
		renderDrawer();
	} catch (err) {
		sayDrawer(err.message, 'error');
		for (const b of drawerBody.querySelectorAll('button[data-act]')) b.disabled = false;
	} finally {
		actionInFlight = false;
	}
}

drawerBody.addEventListener('click', (event) => {
	const button = event.target.closest('button[data-act]');
	if (!button) return;
	const r = rowFor(openTweetId);
	if (!r) return;

	if (button.dataset.act === 'block') {
		if (!window.confirm(`Block @${r.author_username || r.author_id} from ever getting an automatic reply?`)) return;
		return runDrawerAction(async () => {
			await api('block', { method: 'POST', body: JSON.stringify({ author_id: r.author_id }) });
		});
	}
	if (button.dataset.act === 'unblock') {
		return runDrawerAction(async () => {
			await api('unblock', { method: 'POST', body: JSON.stringify({ author_id: r.author_id }) });
		});
	}
	if (button.dataset.act === 'send') {
		const account = r.account_kind === 'company' ? '@trythreews' : `agent ${r.account_ref}`;
		const confirmed = window.confirm(
			`Post this reply publicly on X as ${account}, in reply to tweet ${r.tweet_id}?\n\n"${r.reply_text}"\n\nThis cannot be undone.`,
		);
		if (!confirmed) return;
		return runDrawerAction(async () => {
			await api('send', { method: 'POST', body: JSON.stringify({ tweet_id: r.tweet_id }) });
		});
	}
});

// ── events ───────────────────────────────────────────────────────────────────

railEl.addEventListener('click', (event) => {
	const button = event.target.closest('[data-lane]');
	if (!button) return;
	activeLane = RAIL.find((l) => l.key === button.dataset.lane) || RAIL[0];
	renderRail();
	loadList({ reset: true });
});

tableBody.addEventListener('click', (event) => {
	const row = event.target.closest('.xo-row');
	if (row) openDrawer(row.dataset.id);
});

tableBody.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter' && event.key !== ' ') return;
	const row = event.target.closest('.xo-row');
	if (!row) return;
	event.preventDefault();
	openDrawer(row.dataset.id);
});

refreshBtn.addEventListener('click', () => {
	loadStatus();
	loadList({ reset: true });
});

loadMoreBtn.addEventListener('click', () => {
	offset += PAGE;
	loadList({ reset: false });
});

for (const el of [filterAccount, filterIntent]) el.addEventListener('change', () => loadList({ reset: true }));
let authorTimer = null;
filterAuthor.addEventListener('input', () => {
	clearTimeout(authorTimer);
	authorTimer = setTimeout(() => loadList({ reset: true }), 350);
});

togglePauseBtn.addEventListener('click', async () => {
	const next = !botPaused;
	const verb = next ? 'pause' : 'resume';
	if (!window.confirm(`${next ? 'Pause' : 'Resume'} the mention-reply bot across every account?`)) return;
	togglePauseBtn.disabled = true;
	try {
		await api(verb, { method: 'POST' });
		await loadStatus();
	} catch (err) {
		statusText.textContent = err.message;
	} finally {
		togglePauseBtn.disabled = false;
	}
});

closeBtn.addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && openTweetId) closeDrawer();
	if (event.key === 'r' && !openTweetId && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
		loadStatus();
		loadList({ reset: true });
	}
});

renderRail();
loadStatus();
loadList({ reset: true });

shell.dataset.ready = 'true';
