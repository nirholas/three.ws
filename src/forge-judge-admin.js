// /admin/forge-judge: the current Forge quality judge and NVIDIA Cosmos Reason,
// side by side on the same models, disagreements first. A client of
// /api/admin/forge-judge, never a gate in front of it: the endpoint authorizes
// on the server (platform admin session or the ops secret).

const API = '/api/admin/forge-judge';
const VIEWS = [
	['disagree', 'Disagreements'],
	['unlabelled', 'Unlabelled disagreements'],
	['cosmos_reject', 'Cosmos rejected'],
	['all', 'All'],
];
const VIEW_NAMES = ['Front', 'Right', 'Back', 'Left'];

const statsEl = document.getElementById('fj-stats');
const tabsEl = document.getElementById('fj-tabs');
const listEl = document.getElementById('fj-list');
const sourceEl = document.getElementById('fj-source');
const issueEl = document.getElementById('fj-issue');
const refreshBtn = document.getElementById('fj-refresh');
const moreWrap = document.getElementById('fj-more-wrap');
const moreBtn = document.getElementById('fj-more');
const stamp = document.getElementById('fj-stamp');
const toastHost = document.getElementById('fj-toast-host');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'n/a');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
const issueLabel = (k) => k.replace(/_/g, ' ');

const params = new URLSearchParams(location.search);
const state = {
	view: VIEWS.some(([v]) => v === params.get('view')) ? params.get('view') : 'disagree',
	source: ['all', 'forge', 'eval'].includes(params.get('source')) ? params.get('source') : 'all',
	issue: params.get('issue') || '',
	rows: [],
	nextBefore: null,
	issuesLoaded: false,
};
sourceEl.value = state.source;

function toast(message, bad = false) {
	const t = document.createElement('div');
	t.className = `fj-toast${bad ? ' bad' : ''}`;
	t.textContent = message;
	toastHost.replaceChildren(t);
	setTimeout(() => t.remove(), 6000);
}

function syncUrl() {
	const p = new URLSearchParams();
	if (state.view !== 'disagree') p.set('view', state.view);
	if (state.source !== 'all') p.set('source', state.source);
	if (state.issue) p.set('issue', state.issue);
	const qs = p.toString();
	history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
}

async function api(path, init = {}) {
	const res = await fetch(path, {
		credentials: 'include',
		...init,
		headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(body.error_description || body.message || `status ${res.status}`);
		err.status = res.status;
		err.code = body.error;
		err.retryAfter = res.headers.get('retry-after');
		throw err;
	}
	return body;
}

function gateNote(err) {
	const next = encodeURIComponent(location.pathname + location.search);
	if (err.status === 401) return ['Sign in required', `This page takes a platform admin session. <a href="/login?next=${next}">Sign in</a>, then come back.`];
	if (err.code === 'mfa_required') return ['Two-step verification required', `Admin pages need a session that passed two-step verification. <a href="/login/verify?next=${next}">Verify now</a>, then come back.`];
	if (err.status === 403) return ['Admins only', `This account is not a platform admin. <a href="/login?next=${next}">Switch account</a>.`];
	if (err.status === 429) return ['Rate limited', `Retry in ${esc(err.retryAfter || 'a few')} seconds.`];
	return null;
}

function note(title, body, bad = false) {
	listEl.innerHTML = `<div class="fj-note${bad ? ' bad' : ''}"><h2>${esc(title)}</h2><p>${body}</p></div>`;
}

function renderTabs() {
	tabsEl.innerHTML = VIEWS.map(([v, label]) =>
		`<button class="fj-tab" type="button" data-view="${v}" aria-pressed="${state.view === v}">${esc(label)}</button>`).join('');
}

function renderStats(data) {
	const t = data.totals || {};
	const modeText = data.configured ? data.mode : 'off (COSMOS_REASON_URL unset)';
	const stat = (value, label) => `<div class="fj-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
	statsEl.innerHTML = [
		stat(modeText, 'FORGE_COSMOS_JUDGE on this server'),
		stat(t.rows ?? 0, 'models judged by both'),
		stat(`${t.disagree ?? 0} (${pct(t.disagree, t.both_answered)})`, 'disagreements'),
		stat(pct(t.current_agrees, t.current_labelled), `current judge agrees with people (n=${t.current_labelled ?? 0})`),
		stat(pct(t.cosmos_agrees, t.cosmos_labelled), `Cosmos agrees with people (n=${t.cosmos_labelled ?? 0})`),
		stat(t.cosmos_decided ?? 0, 'decisions Cosmos made'),
	].join('');
}

function renderIssues(issues) {
	if (state.issuesLoaded) return;
	issueEl.insertAdjacentHTML('beforeend', issues.map((k) => `<option value="${esc(k)}">${esc(issueLabel(k))}</option>`).join(''));
	issueEl.value = issues.includes(state.issue) ? state.issue : '';
	state.issuesLoaded = true;
}

function passPill(pass, available) {
	if (!available) return '<span class="fj-pill na">no verdict</span>';
	return pass ? '<span class="fj-pill pass">pass</span>' : '<span class="fj-pill fail">fail</span>';
}

function currentHtml(c) {
	if (!c) return '<p class="fj-muted">Not recorded.</p>';
	if (!c.available) return `${passPill(null, false)}<p class="fj-muted">${esc(c.reason || 'judge unavailable')}</p>`;
	const defects = (c.defects || []).map((d) => `<span class="fj-pill">${esc(issueLabel(d))}</span>`).join('');
	return `${passPill(c.pass, true)}<span class="fj-pill">score ${esc(c.score ?? 'n/a')}</span><span class="fj-pill">completeness ${esc(c.completeness ?? 'n/a')}</span>
		<div>${defects}</div>
		<p class="fj-muted">${esc(c.reason || '')}</p>
		<p class="fj-muted">${esc(c.model || c.provider || '')}${c.latency_ms ? ` · ${(c.latency_ms / 1000).toFixed(1)} s` : ''}</p>`;
}

function cosmosHtml(c) {
	if (!c) return '<p class="fj-muted">Not recorded.</p>';
	if (!c.available) return `${passPill(null, false)}<p class="fj-muted">${esc(c.error || 'judge unavailable')}</p>`;
	const issues = (c.issues || []).map((d) => `<span class="fj-pill fail">${esc(issueLabel(d))}</span>`).join('') || '<span class="fj-pill">no physical issues</span>';
	return `${passPill(c.pass, true)}<span class="fj-pill">${c.plausible ? 'plausible' : 'not plausible'}</span><span class="fj-pill">prompt match ${esc(c.prompt_match || 'n/a')}</span><span class="fj-pill">confidence ${c.confidence == null ? 'n/a' : Number(c.confidence).toFixed(2)}</span>
		<div>${issues}</div>
		<p class="fj-muted">${esc(c.model || '')}${c.latency_ms ? ` · ${(c.latency_ms / 1000).toFixed(1)} s` : ''}</p>`;
}

function viewsHtml(r) {
	const renders = r.renders || [];
	if (!renders.length) return '<p class="fj-muted">No views stored for this row (Cosmos did not render it).</p>';
	return `<div class="fj-views">${renders.map((v, i) => v.url
		? `<a class="fj-thumb" href="${esc(v.url)}" target="_blank" rel="noopener" aria-label="${esc(VIEW_NAMES[i] || 'View')} view, full size"><img src="${esc(v.url)}" alt="${esc(VIEW_NAMES[i] || 'View')} view of the model" loading="lazy" width="448" height="448" /></a>`
		: `<div class="fj-thumb missing">${esc(VIEW_NAMES[i] || 'View')} view unavailable</div>`).join('')}</div>`;
}

function cardHtml(r) {
	const label = r.human_label;
	const labelBtn = (value, text, cls) =>
		`<button class="fj-btn ${cls}" type="button" data-label="${value}" data-id="${esc(r.id)}" aria-pressed="${label === value}">${esc(text)}</button>`;
	return `<article class="fj-card" data-row="${esc(r.id)}">
		<div class="fj-card-top">
			<span class="fj-prompt">${esc(r.prompt || 'No prompt recorded')}</span>
			<span class="fj-muted">${esc(r.source)} · ${esc(when(r.created_at))} · mode ${esc(r.mode)}${r.applied === 'cosmos' ? ' · Cosmos decided' : ''}</span>
		</div>
		<div class="fj-muted"><a href="/viewer?src=${encodeURIComponent(r.glb_url)}" target="_blank" rel="noopener">Open the model in 3D</a>${r.subject ? ` · subject ${esc(r.subject)}` : ''}</div>
		${viewsHtml(r)}
		<div class="fj-verdicts">
			<section class="fj-verdict"><h3>Current judge</h3>${currentHtml(r.current)}</section>
			<section class="fj-verdict"><h3>Cosmos Reason</h3>${cosmosHtml(r.cosmos)}</section>
		</div>
		<div class="fj-label" role="group" aria-label="What a person would do with this model">
			<span>Person's call:</span>
			${labelBtn('accepted', 'Keep', 'keep')}
			${labelBtn('rejected', 'Throw away', 'reject')}
			${label ? `<span class="fj-muted">labelled by ${esc(r.labelled_by || 'unknown')}${r.labelled_at ? ` on ${esc(when(r.labelled_at))}` : ''}</span>` : '<span class="fj-muted">not labelled</span>'}
		</div>
	</article>`;
}

function renderList() {
	if (!state.rows.length) {
		if (state.view !== 'all' || state.issue || state.source !== 'all') {
			note('Nothing matches these filters', 'Pick another tab, source or issue. "All" shows every model both judges saw.');
		} else {
			note('No models judged by both yet',
				'Rows appear once the Cosmos worker is configured (<code>COSMOS_REASON_URL</code>) and the Forge quality gate runs, or after the eval: <code>node scripts/cosmos-judge-eval.mjs</code>. Setup is in <code>docs/forge-pipeline.md</code>.');
		}
		moreWrap.hidden = true;
		return;
	}
	listEl.innerHTML = state.rows.map(cardHtml).join('');
	moreWrap.hidden = !state.nextBefore;
}

function query(before) {
	const p = new URLSearchParams({ view: state.view, source: state.source });
	if (state.issue) p.set('issue', state.issue);
	if (before) p.set('before', before);
	return `${API}?${p}`;
}

async function load({ append = false } = {}) {
	listEl.setAttribute('aria-busy', 'true');
	if (!append) {
		listEl.innerHTML = '<div class="fj-skeleton"></div><div class="fj-skeleton"></div>';
		if (!statsEl.children.length) statsEl.innerHTML = '<div class="fj-skeleton stat"></div>'.repeat(4);
	}
	refreshBtn.disabled = true;
	moreBtn.disabled = true;
	try {
		const data = await api(query(append ? state.nextBefore : null));
		state.rows = append ? state.rows.concat(data.rows) : data.rows;
		state.nextBefore = data.nextBefore;
		renderStats(data);
		renderIssues(data.issues || []);
		renderList();
		stamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
	} catch (err) {
		const gate = gateNote(err);
		statsEl.innerHTML = '';
		if (gate) note(gate[0], gate[1], true);
		else note('Could not load the comparison', `${esc(err.message)}. Press Refresh to try again; if it keeps failing, check the server log for /api/admin/forge-judge.`, true);
		moreWrap.hidden = true;
	} finally {
		listEl.setAttribute('aria-busy', 'false');
		refreshBtn.disabled = false;
		moreBtn.disabled = false;
	}
}

async function setLabel(btn) {
	const id = btn.dataset.id;
	const row = state.rows.find((r) => String(r.id) === id);
	if (!row) return;
	const next = row.human_label === btn.dataset.label ? null : btn.dataset.label;
	const group = btn.parentElement.querySelectorAll('button');
	group.forEach((b) => { b.disabled = true; });
	try {
		const { row: saved } = await api(API, { method: 'POST', body: JSON.stringify({ id, label: next }) });
		Object.assign(row, saved);
		btn.closest('.fj-card').outerHTML = cardHtml(row);
		toast(next ? `Labelled ${next === 'accepted' ? 'keep' : 'throw away'}.` : 'Label cleared.');
	} catch (err) {
		group.forEach((b) => { b.disabled = false; });
		toast(`Could not save the label: ${err.message}`, true);
	}
}

tabsEl.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-view]');
	if (!btn || btn.dataset.view === state.view) return;
	state.view = btn.dataset.view;
	renderTabs();
	syncUrl();
	load();
});
sourceEl.addEventListener('change', () => { state.source = sourceEl.value; syncUrl(); load(); });
issueEl.addEventListener('change', () => { state.issue = issueEl.value; syncUrl(); load(); });
refreshBtn.addEventListener('click', () => load());
moreBtn.addEventListener('click', () => load({ append: true }));
listEl.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-label]');
	if (btn) setLabel(btn);
});

renderTabs();
load();
