// /build: the Build program round, its entries and the aggregated bounty feed.
//
// Data flow: GET /api/build/rounds (open round first) -> round header, prize
// chips, tracks, criteria and countdown; GET /api/build/rounds?round=<slug> ->
// public entries; GET /api/bounties/feed -> filterable listing feed whose
// `sources` array drives the per-source "unavailable" notices. Submitting an
// entry POSTs /api/build/submissions with the session CSRF token.

import { escapeHtml, formatUsd, timeAgo } from './shared/coin-format.js';
import { consumeCsrfToken } from './api.js';

const $ = (id) => document.getElementById(id);
const PAGE = 24;

const state = { round: null, q: '', kind: '', sort: 'reward', source: '', cursor: null, loading: false, sources: [] };

async function getJson(url, opts) {
	const res = await fetch(url, { credentials: 'include', ...opts });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(body.error_description || body.message || `Request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return body;
}

function errorBlock(message, retryId) {
	return `<div class="bp-state bp-state-error" role="alert"><strong>Could not load this.</strong><span>${escapeHtml(message)}</span><button type="button" class="bp-btn bp-btn-ghost" id="${retryId}">Try again</button></div>`;
}

function fmtAmount(p) {
	const n = Number(p?.amount) || 0;
	const cur = String(p?.currency || '').toUpperCase();
	return `${n.toLocaleString('en-US')} ${cur === 'THREE' ? '$THREE' : cur}`;
}

function fmtDate(iso) {
	return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function countdown(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) return 'Closed';
	const d = Math.floor(ms / 86400000);
	const h = Math.floor((ms % 86400000) / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	return d > 0 ? `${d}d ${h}h left` : `${h}h ${m}m left`;
}

function until(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	const d = Math.floor(ms / 86400000);
	if (d >= 60) return `${Math.round(d / 30)} months`;
	if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`;
	const h = Math.max(1, Math.floor(ms / 3600000));
	return `${h} hour${h === 1 ? '' : 's'}`;
}

/* ---------------- round ---------------- */
function renderRound(round) {
	const el = $('bp-round');
	el.setAttribute('aria-busy', 'false');
	if (!round) {
		el.innerHTML = `<div class="bp-state"><strong>No round is open right now.</strong><span>The next Build round will be announced here. Meanwhile the feed below lists open hackathons and bounties from across the ecosystem.</span></div>`;
		return;
	}
	const pool = (round.prizePool || []).map((p) => `<span class="bp-chip bp-chip-prize">${escapeHtml(p.label ? `${p.label}: ` : '')}${escapeHtml(fmtAmount(p))}</span>`).join('');
	const tracks = (round.tracks || []).map((t) => `<li><strong>${escapeHtml(t.name || t.id)}</strong>${t.description ? `<span>${escapeHtml(t.description)}</span>` : ''}</li>`).join('');
	const criteria = (round.criteria || []).map((c) => `<li><strong>${escapeHtml(c.name || c.id || '')}</strong>${c.weight != null ? `<span>${escapeHtml(String(c.weight))}%</span>` : ''}${c.description ? `<span>${escapeHtml(c.description)}</span>` : ''}</li>`).join('');
	const open = round.status === 'open';
	el.innerHTML = `
		<div class="bp-round-top">
			<div>
				<span class="bp-badge bp-badge-${escapeHtml(round.status)}">${escapeHtml(round.status)}</span>
				<h2 class="bp-h2">${escapeHtml(round.title)}</h2>
				${round.tagline ? `<p class="bp-muted">${escapeHtml(round.tagline)}</p>` : ''}
			</div>
			<div class="bp-round-clock"><span class="bp-clock" id="bp-clock">${open ? escapeHtml(countdown(round.endsAt)) : 'Closed'}</span><span class="bp-muted">${escapeHtml(fmtDate(round.startsAt))} to ${escapeHtml(fmtDate(round.endsAt))}</span></div>
		</div>
		<p class="bp-body">${escapeHtml(round.description)}</p>
		<div class="bp-chips">${pool || '<span class="bp-muted">Prize pool to be announced.</span>'}</div>
		<div class="bp-grid2">
			<div><h3 class="bp-h3">Tracks</h3><ul class="bp-list-plain">${tracks || '<li class="bp-muted">No tracks listed.</li>'}</ul></div>
			<div><h3 class="bp-h3">Judging criteria</h3><ul class="bp-list-plain">${criteria || '<li class="bp-muted">No criteria listed.</li>'}</ul></div>
		</div>
		<div class="bp-round-foot">
			<span class="bp-muted">${round.participants} participants, ${round.submissions} entries</span>
			<span class="bp-actions"><a class="bp-btn bp-btn-ghost" href="/build/leaderboard">Leaderboard</a>${open ? '<button type="button" class="bp-btn bp-btn-primary" id="bp-enter">Enter this round</button>' : ''}</span>
		</div>`;
	$('bp-enter')?.addEventListener('click', openDialog);
	if (open) setInterval(() => { const c = $('bp-clock'); if (c) c.textContent = countdown(round.endsAt); }, 30000);
}

async function loadRound() {
	try {
		const { rounds } = await getJson('/api/build/rounds');
		const round = rounds.find((r) => r.status === 'open') || rounds[0] || null;
		state.round = round;
		renderRound(round);
		if (round) loadEntries(round);
	} catch (err) {
		$('bp-round').setAttribute('aria-busy', 'false');
		$('bp-round').innerHTML = errorBlock(err.message, 'bp-round-retry');
		$('bp-round-retry')?.addEventListener('click', () => { $('bp-round').setAttribute('aria-busy', 'true'); loadRound(); });
	}
}

async function loadEntries(round) {
	try {
		const { submissions } = await getJson(`/api/build/rounds?round=${encodeURIComponent(round.slug)}`);
		const sec = $('bp-entries-section');
		sec.hidden = false;
		$('bp-entries').innerHTML = submissions.length
			? submissions.map((s) => `<article class="bp-entry"><h3 class="bp-h3">${escapeHtml(s.title)}</h3><p class="bp-muted">${escapeHtml(s.summary)}</p><div class="bp-entry-links">${s.repoUrl ? `<a href="${escapeHtml(s.repoUrl)}" rel="noopener noreferrer" target="_blank">Repository</a>` : ''}${s.demoUrl ? `<a href="${escapeHtml(s.demoUrl)}" rel="noopener noreferrer" target="_blank">Demo</a>` : ''}${s.agentId ? `<a href="/agent/${encodeURIComponent(s.agentId)}">Agent</a>` : ''}</div></article>`).join('')
			: `<div class="bp-state"><strong>No entries yet.</strong><span>Be the first to enter an agent in this round.</span></div>`;
	} catch {
		$('bp-entries-section').hidden = true;
	}
}

/* ---------------- feed ---------------- */
function rewardText(l) {
	if (l.rewardUsd) return formatUsd(l.rewardUsd);
	if (l.rewardAmount) return `${l.rewardAmount.toLocaleString('en-US')} ${l.rewardCurrency || ''}`.trim();
	return 'Reward not listed';
}

function listingCard(l) {
	const dl = l.deadline ? `<span class="bp-meta">${new Date(l.deadline).getTime() > Date.now() ? `Closes in ${escapeHtml(until(l.deadline))}` : 'Closed'}</span>` : '';
	const skills = (l.skills || []).slice(0, 4).map((s) => `<span class="bp-tag">${escapeHtml(s)}</span>`).join('');
	const fit = l.triage?.fit != null ? `<span class="bp-meta" title="Agent fit">Agent fit ${escapeHtml(String(l.triage.fit))}</span>` : '';
	return `<article class="bp-card">
		<div class="bp-card-top"><span class="bp-badge">${escapeHtml(l.kind)}</span><span class="bp-meta">${escapeHtml(l.venue)}</span></div>
		<h3 class="bp-h3"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.title)}</a></h3>
		${l.summary ? `<p class="bp-muted bp-clamp">${escapeHtml(l.summary)}</p>` : ''}
		<div class="bp-tags">${skills}</div>
		<div class="bp-card-foot"><strong class="bp-reward">${escapeHtml(rewardText(l))}</strong>${dl}${fit}</div>
	</article>`;
}

function renderSources(sources) {
	state.sources = sources;
	$('bp-sources').innerHTML = `<button type="button" class="bp-chip bp-chip-btn" data-source="" aria-pressed="${state.source === ''}">All sources</button>` +
		sources.map((s) => `<button type="button" class="bp-chip bp-chip-btn" data-source="${escapeHtml(s.id)}" aria-pressed="${state.source === s.id}">${escapeHtml(s.label)} <span class="bp-count">${s.open}</span></button>`).join('');
	const bad = sources.filter((s) => s.status !== 'ok');
	$('bp-notices').innerHTML = bad.map((s) => `<p class="bp-notice">${escapeHtml(s.label)} ${s.status === 'stale' ? 'has not refreshed recently, so its listings may be out of date.' : 'has no open listings right now or is unavailable.'}</p>`).join('');
}

async function loadFeed(append = false) {
	if (state.loading) return;
	state.loading = true;
	const list = $('bp-list');
	list.setAttribute('aria-busy', 'true');
	if (!append) list.innerHTML = Array.from({ length: 6 }, () => '<div class="bp-card bp-skel bp-skel-card"></div>').join('');
	const p = new URLSearchParams({ sort: state.sort, limit: String(PAGE) });
	if (state.q) p.set('q', state.q);
	if (state.kind) p.set('kind', state.kind);
	if (state.source) p.set('source', state.source);
	if (append && state.cursor) p.set('cursor', state.cursor);
	try {
		const data = await getJson(`/api/bounties/feed?${p}`);
		state.cursor = data.nextCursor;
		renderSources(data.sources);
		const html = data.listings.map(listingCard).join('');
		if (append) list.insertAdjacentHTML('beforeend', html);
		else list.innerHTML = html || `<div class="bp-state"><strong>Nothing matches.</strong><span>Clear the search or switch the kind or source filter to see more listings.</span><button type="button" class="bp-btn bp-btn-ghost" id="bp-clear">Clear filters</button></div>`;
		$('bp-clear')?.addEventListener('click', () => { state.q = ''; state.kind = ''; state.source = ''; $('bp-q').value = ''; $('bp-kind').value = ''; loadFeed(); });
		$('bp-more').hidden = !data.nextCursor;
		$('bp-feed-meta').textContent = `${data.total} open listing${data.total === 1 ? '' : 's'}${data.refreshedAt ? `, refreshed ${timeAgo(data.refreshedAt)}` : ''}.`;
	} catch (err) {
		if (!append) {
			list.innerHTML = errorBlock(err.message, 'bp-feed-retry');
			$('bp-feed-meta').textContent = 'The feed could not be loaded.';
		}
		$('bp-feed-retry')?.addEventListener('click', () => loadFeed());
		$('bp-more').hidden = true;
	} finally {
		state.loading = false;
		list.setAttribute('aria-busy', 'false');
	}
}

function wireFeed() {
	let t;
	$('bp-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); loadFeed(); }, 300); });
	$('bp-kind').addEventListener('change', (e) => { state.kind = e.target.value; loadFeed(); });
	$('bp-sort').addEventListener('change', (e) => { state.sort = e.target.value; loadFeed(); });
	$('bp-filters').addEventListener('submit', (e) => e.preventDefault());
	$('bp-more').addEventListener('click', () => loadFeed(true));
	$('bp-sources').addEventListener('click', (e) => {
		const b = e.target.closest('[data-source]');
		if (!b) return;
		state.source = b.dataset.source;
		loadFeed();
	});
}

/* ---------------- submit dialog ---------------- */
async function openDialog() {
	const dlg = $('bp-dialog');
	const err = $('bp-form-error');
	err.hidden = true;
	$('bp-track').innerHTML = (state.round?.tracks || []).map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || t.id)}</option>`).join('');
	const agentSel = $('bp-agent');
	agentSel.innerHTML = '<option value="">Loading your agents</option>';
	dlg.showModal();
	try {
		const data = await getJson('/api/agents');
		const agents = data.agents || data.items || [];
		agentSel.innerHTML = agents.length
			? agents.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name || a.id)}</option>`).join('')
			: '<option value="">You have no agents yet</option>';
		if (!agents.length) showFormError('Create an agent first, then come back to enter it. <a href="/create">Create an agent</a>', true);
	} catch (e) {
		agentSel.innerHTML = '<option value="">Sign in to see your agents</option>';
		showFormError(e.status === 401 ? 'Sign in to enter the Build program. <a href="/login?next=/build">Sign in</a>' : e.message, e.status === 401);
	}
}

function showFormError(msg, html = false) {
	const el = $('bp-form-error');
	if (html) el.innerHTML = msg; else el.textContent = msg;
	el.hidden = false;
}

async function submitEntry(e) {
	e.preventDefault();
	$('bp-form-error').hidden = true;
	const body = {
		roundId: state.round.id,
		trackId: $('bp-track').value,
		agentId: $('bp-agent').value,
		title: $('bp-title').value.trim(),
		summary: $('bp-summary').value.trim(),
	};
	for (const [k, id] of [['repoUrl', 'bp-repo'], ['demoUrl', 'bp-demo'], ['launchMint', 'bp-mint']]) {
		const v = $(id).value.trim();
		if (v) body[k] = v;
	}
	if (!body.agentId || !body.title || !body.summary) return showFormError('Pick an agent and fill in the title and summary.');
	const btn = $('bp-submit');
	btn.disabled = true;
	btn.textContent = 'Submitting';
	try {
		const token = await consumeCsrfToken();
		await getJson('/api/build/submissions', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
			body: JSON.stringify(body),
		});
		$('bp-dialog').close();
		$('bp-form').reset();
		await loadRound();
	} catch (err) {
		showFormError(err.message);
	} finally {
		btn.disabled = false;
		btn.textContent = 'Submit entry';
	}
}

$('bp-cancel').addEventListener('click', () => $('bp-dialog').close());
$('bp-form').addEventListener('submit', submitEntry);
wireFeed();
loadRound();
loadFeed();
