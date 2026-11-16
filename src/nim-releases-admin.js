// /admin/nim-releases: the day-0 NIM adoption board. A client of
// /api/admin/nim-releases, never a gate in front of it: the endpoint authorizes
// on the server (platform admin session or the ops secret). Shows each catalog
// model's lane, verdict and numbers against the model the lane runs today, the
// exact config diff to apply by hand and the post draft. It cannot apply a diff.

const API = '/api/admin/nim-releases';

const statsEl = document.getElementById('nr-stats');
const listEl = document.getElementById('nr-list');
const detailEl = document.getElementById('nr-detail');
const refreshBtn = document.getElementById('nr-refresh');
const stamp = document.getElementById('nr-stamp');
const toastHost = document.getElementById('nr-toast-host');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'n/a');
const pct = (v) => (v == null || Number.isNaN(Number(v)) ? 'n/a' : `${Math.round(Number(v) * 100)}%`);
const ms = (v) => (v == null ? 'n/a' : `${Math.round(Number(v))} ms`);

const state = { rows: [], pins: {}, selected: new URLSearchParams(location.search).get('model') || null, detail: null };

function toast(message, bad = false) {
	const t = document.createElement('div');
	t.className = `nr-toast${bad ? ' bad' : ''}`;
	t.textContent = message;
	toastHost.replaceChildren(t);
	setTimeout(() => t.remove(), 6000);
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

const noteHtml = (title, body, bad = false) => `<div class="nr-note${bad ? ' bad' : ''}"><h2>${esc(title)}</h2><p>${body}</p></div>`;

function statusPill(r) {
	if (r.status === 'done') return `<span class="nr-pill ${esc(r.verdict)}">${esc(r.verdict)}</span>`;
	return `<span class="nr-pill ${esc(r.status)}">${esc(r.status)}${r.attempts ? ` (attempt ${esc(r.attempts)})` : ''}</span>`;
}

function syncUrl() {
	const qs = state.selected ? `?model=${encodeURIComponent(state.selected)}` : '';
	history.replaceState(null, '', `${location.pathname}${qs}`);
}

function renderStats() {
	const stat = (value, label) => `<div class="nr-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
	const pins = Object.entries(state.pins).map(([lane, p]) => stat(p.model || 'not set', `${lane} lane today`));
	const count = (pred) => state.rows.filter(pred).length;
	statsEl.innerHTML = [
		stat(`${count((r) => r.verdict === 'adopt')} adopt · ${count((r) => r.verdict === 'hold')} hold`, 'verdicts to review'),
		stat(`${count((r) => r.status === 'queued' || r.status === 'running')} queued · ${count((r) => r.status === 'failed')} failed`, 'queue'),
		...pins,
	].join('');
}

function renderList() {
	if (!state.rows.length) {
		listEl.innerHTML = noteHtml('No catalog releases evaluated yet',
			'The free-model audit cron queues every model that newly appears in the NIM catalog and <code>/api/cron/nim-release-eval</code> evaluates one per tick. To evaluate a model now, run <code>node scripts/nvidia-lane-eval.mjs --model &lt;id&gt;</code>.');
		detailEl.innerHTML = '';
		return;
	}
	listEl.innerHTML = state.rows.map((r) => {
		const versus = r.incumbent_quality != null ? `vs ${pct(r.incumbent_quality)} today` : 'baseline of the model the lane runs today';
		const numbers = r.candidate_quality != null
			? `${pct(r.candidate_quality)} ${versus} · p50 ${ms(r.candidate_p50)}`
			: (r.last_error ? esc(r.last_error).slice(0, 140) : 'not evaluated yet');
		return `<button class="nr-row" type="button" data-model="${esc(r.model_id)}" aria-current="${r.model_id === state.selected}">
			<div class="nr-row-id">${esc(r.model_id)}</div>
			<div>${statusPill(r)}${r.lane ? `<span class="nr-pill">${esc(r.lane)}</span>` : ''}${r.has_diff ? '<span class="nr-pill">diff</span>' : ''}${r.has_post ? '<span class="nr-pill">post draft</span>' : ''}</div>
			<div class="nr-muted">${numbers}</div>
			<div class="nr-muted">${esc(r.source)} · ${esc(when(r.completed_at || r.created_at))}</div>
		</button>`;
	}).join('');
}

function diffHtml(patch) {
	return patch.split('\n').map((line) => {
		const cls = line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : '';
		return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line);
	}).join('\n');
}

function runRow(label, run) {
	if (!run) return '';
	return `<tr><th scope="row">${esc(label)}</th><td>${esc(run.model)}${run.dim ? ` (${esc(run.dim)} dims)` : ''}</td><td>${pct(run.quality)}</td><td>${pct(run.formatAdherence)}</td><td>${pct(run.errorRate)}</td><td>${ms(run.latencyMs?.p50)} / ${ms(run.latencyMs?.p95)}</td></tr>`;
}

function itemsTable(report) {
	const cand = report.candidate?.results || [];
	if (!cand.length) return '';
	const inc = new Map((report.incumbent?.results || []).map((x) => [x.id, x]));
	const cell = (x) => (x ? `<td class="${x.pass ? '' : 'fail'}">${x.pass ? 'pass' : x.format ? 'fail' : 'fail (format)'}: ${esc(String(x.output ?? x.error ?? '').slice(0, 80))}</td>` : '<td>n/a</td>');
	return `<h3>Per item</h3><div class="nr-table-wrap"><table class="nr-table"><thead><tr><th>Item</th><th>Candidate</th><th>Today</th></tr></thead><tbody>${cand.map((x) => `<tr><td>${esc(x.id)}</td>${cell(x)}${cell(inc.get(x.id))}</tr>`).join('')}</tbody></table></div>`;
}

function renderDetail() {
	const row = state.detail;
	if (!row) {
		detailEl.innerHTML = state.rows.length ? noteHtml('Pick a model', 'Select a row to see its classification, numbers, config diff and post draft.') : '';
		return;
	}
	const report = row.report || {};
	const cls = row.classification || report.classification || {};
	const probes = Object.entries(cls.probes || {}).map(([k, p]) => `<li>${esc(k)}: ${p.ok ? 'ok' : 'failed'}${p.status != null ? ` HTTP ${esc(p.status)}` : ''}${p.ms != null ? ` in ${esc(p.ms)} ms` : ''}${p.sample ? `, "${esc(p.sample)}"` : p.error ? `, ${esc(p.error)}` : ''}</li>`).join('');
	const diff = row.config_diff
		? `<pre class="nr-pre">${diffHtml(row.config_diff)}</pre><div class="nr-actions"><button class="nr-btn" type="button" data-copy="diff">Copy diff</button></div>`
		: `<p class="nr-muted">${esc(report.diff?.note || (row.verdict === 'reject' ? 'No diff: rejected candidates are not proposed.' : 'No diff for this row.'))}</p>`;
	const post = row.post_draft
		? `<pre class="nr-pre nr-wrap-text">${esc(row.post_draft)}</pre><div class="nr-actions"><button class="nr-btn" type="button" data-copy="post">Copy post draft</button></div>`
		: '<p class="nr-muted">No post draft: drafts are written only for adopt and hold verdicts.</p>';
	detailEl.innerHTML = `<article class="nr-detail">
		<h2>${esc(row.model_id)}</h2>
		<div>${statusPill(row)}${row.lane ? `<span class="nr-pill">${esc(row.lane)} lane</span>` : ''}<span class="nr-pill">owner ${esc(row.owned_by || 'unknown')}</span></div>
		<p class="nr-muted">Queued ${esc(when(row.created_at))} by ${esc(row.source)} · evaluated ${esc(when(row.completed_at))}${row.last_error ? ` · last error: ${esc(row.last_error)}` : ''}</p>
		${(report.reasons || []).length ? `<h3>Why</h3><ul class="nr-muted">${report.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
		<h3>Classification</h3>
		<p class="nr-muted">${esc(cls.lane || 'no lane')} (${esc(cls.availability || 'unknown')}): ${esc(cls.reason || '')}</p>
		${probes ? `<ul class="nr-muted">${probes}</ul>` : ''}
		${report.candidate ? `<h3>Results${report.set ? `: ${esc(report.set.path)} v${esc(report.set.version)}, ${esc(report.candidate.items)} items` : ''}</h3>
		<div class="nr-table-wrap"><table class="nr-table"><thead><tr><th></th><th>Model</th><th>Quality</th><th>Format</th><th>Errors</th><th>p50 / p95</th></tr></thead><tbody>${runRow('Candidate', report.candidate)}${runRow('Today', report.incumbent)}</tbody></table></div>` : ''}
		${itemsTable(report)}
		<h3>Config diff${report.diff?.file ? ` (${esc(report.diff.file)})` : ''}, not applied</h3>
		${diff}
		<h3>Post draft (post only after the diff is deployed and verified)</h3>
		${post}
		<div class="nr-actions">
			${row.report_md ? `<a class="nr-btn" href="${API}?id=${encodeURIComponent(row.id)}&amp;format=md" target="_blank" rel="noopener">Open markdown report</a>` : ''}
			${row.status === 'running' ? '' : `<button class="nr-btn" type="button" data-requeue="${esc(row.id)}">Re-evaluate on the next tick</button>`}
		</div>
	</article>`;
}

async function loadDetail(model) {
	state.selected = model;
	syncUrl();
	renderList();
	detailEl.innerHTML = '<div class="nr-skeleton tall"></div>';
	try {
		const { row } = await api(`${API}?model=${encodeURIComponent(model)}`);
		if (state.selected !== model) return;
		state.detail = row;
		renderDetail();
	} catch (err) {
		const gate = gateNote(err);
		detailEl.innerHTML = gate ? noteHtml(gate[0], gate[1], true)
			: noteHtml('Could not load this model', `${esc(err.message)}. Pick it again to retry.`, true);
	}
}

async function load() {
	listEl.setAttribute('aria-busy', 'true');
	listEl.innerHTML = '<div class="nr-skeleton"></div>'.repeat(4);
	if (!statsEl.children.length) statsEl.innerHTML = '<div class="nr-skeleton stat"></div>'.repeat(4);
	refreshBtn.disabled = true;
	try {
		const data = await api(API);
		state.rows = data.rows || [];
		state.pins = data.pins || {};
		renderStats();
		if (state.selected && !state.rows.some((r) => r.model_id === state.selected)) {
			toast(`${state.selected} has not been evaluated yet.`, true);
			state.selected = null;
			syncUrl();
		}
		if (!state.selected && state.rows.length) state.selected = state.rows[0].model_id;
		renderList();
		if (state.selected) await loadDetail(state.selected);
		else renderDetail();
		stamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
	} catch (err) {
		const gate = gateNote(err);
		statsEl.innerHTML = '';
		detailEl.innerHTML = '';
		listEl.innerHTML = gate ? noteHtml(gate[0], gate[1], true)
			: noteHtml('Could not load the board', `${esc(err.message)}. Press Refresh to try again; if it keeps failing, check the server log for /api/admin/nim-releases.`, true);
	} finally {
		listEl.setAttribute('aria-busy', 'false');
		refreshBtn.disabled = false;
	}
}

async function copy(kind) {
	const text = kind === 'diff' ? state.detail?.config_diff : state.detail?.post_draft;
	try {
		await navigator.clipboard.writeText(text || '');
		toast(kind === 'diff' ? 'Diff copied. Save it and run git apply.' : 'Post draft copied.');
	} catch {
		toast('The browser blocked clipboard access. Select the text and copy it by hand.', true);
	}
}

async function requeue(btn) {
	btn.disabled = true;
	try {
		await api(API, { method: 'POST', body: JSON.stringify({ id: btn.dataset.requeue, action: 'requeue' }) });
		toast('Queued. The next nim-release-eval tick (every 15 minutes) re-evaluates it.');
		await load();
	} catch (err) {
		btn.disabled = false;
		toast(`Could not requeue: ${err.message}`, true);
	}
}

listEl.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-model]');
	if (btn && btn.dataset.model !== state.selected) loadDetail(btn.dataset.model);
});
detailEl.addEventListener('click', (e) => {
	const c = e.target.closest('[data-copy]');
	if (c) return copy(c.dataset.copy);
	const r = e.target.closest('[data-requeue]');
	if (r) requeue(r);
});
refreshBtn.addEventListener('click', () => load());

load();
