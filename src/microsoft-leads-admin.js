// /admin/microsoft/leads: Microsoft Marketplace leads, their drafted replies and
// the follow-up status. A client of /api/ops/microsoft-leads, never a gate in
// front of it: the endpoint authorizes on the server (platform admin session).
// Nothing on this page sends anything to a customer.

const API = '/api/ops/microsoft-leads';
const STATUSES = ['new', 'contacted', 'qualified', 'closed'];
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', closed: 'Closed' };
const ACTION_LABEL = { PLT: 'Contact me', INS: 'Acquired', Create: 'Portal purchase', DNC: 'Do not contact' };
const SOURCE_LABEL = { AzureMarketplace: 'Azure Marketplace', AppSource: 'AppSource', AzurePortal: 'Azure portal', other: 'Other' };
const DRAFT_LABEL = { pending: 'Draft pending', ready: 'Draft ready', failed: 'Draft failed', skipped: 'No draft' };

const listEl = document.getElementById('ml-list');
const detailEl = document.getElementById('ml-detail');
const tabsEl = document.getElementById('ml-tabs');
const sourceEl = document.getElementById('ml-source');
const actionEl = document.getElementById('ml-action');
const qEl = document.getElementById('ml-q');
const refreshBtn = document.getElementById('ml-refresh');
const moreWrap = document.getElementById('ml-more-wrap');
const moreBtn = document.getElementById('ml-more');
const stamp = document.getElementById('ml-stamp');
const toastHost = document.getElementById('ml-toast-host');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'n/a');
const nameOf = (l) => [l.first_name, l.last_name].filter(Boolean).join(' ') || (l.redacted_at ? 'Redacted lead' : 'Unnamed lead');

const params = new URLSearchParams(location.search);
const state = {
	status: STATUSES.includes(params.get('status')) ? params.get('status') : '',
	source: params.get('source') || '',
	action: params.get('action') || '',
	q: params.get('q') || '',
	selected: params.get('id') || '',
	leads: [],
	counts: {},
	nextBefore: null,
	lead: null,
};
sourceEl.value = state.source;
actionEl.value = state.action;
qEl.value = state.q;

function toast(message, bad = false) {
	const t = document.createElement('div');
	t.className = `ml-toast${bad ? ' bad' : ''}`;
	t.textContent = message;
	toastHost.replaceChildren(t);
	setTimeout(() => t.remove(), 6000);
}

function syncUrl() {
	const p = new URLSearchParams();
	for (const k of ['status', 'source', 'action', 'q']) if (state[k]) p.set(k, state[k]);
	if (state.selected) p.set('id', state.selected);
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
	if (err.status === 403) return ['Admins only', `This account is not a platform admin. <a href="/login?next=${next}">Switch account</a>.`];
	if (err.status === 429) return ['Rate limited', `Retry in ${esc(err.retryAfter || 'a few')} seconds.`];
	if (err.code === 'migration_pending') return ['Migration pending', esc(err.message)];
	return null;
}

function note(target, title, body, bad = false) {
	target.innerHTML = `<div class="ml-note${bad ? ' bad' : ''}"><h2>${esc(title)}</h2><p>${body}</p></div>`;
}

function renderTabs() {
	const total = STATUSES.reduce((n, s) => n + (state.counts[s] || 0), 0);
	const tab = (value, label, n) =>
		`<button class="ml-tab" type="button" data-status="${value}" aria-pressed="${state.status === value}">${esc(label)}<b>${n}</b></button>`;
	tabsEl.innerHTML = tab('', 'All', total) + STATUSES.map((s) => tab(s, STATUS_LABEL[s], state.counts[s] || 0)).join('');
}

function rowHtml(l) {
	const pills = [
		`<span class="ml-pill ${esc(l.status)}">${esc(STATUS_LABEL[l.status] || l.status)}</span>`,
		l.action ? `<span class="ml-pill ${esc(l.action)}">${esc(ACTION_LABEL[l.action] || l.action)}</span>` : '',
		`<span class="ml-pill">${esc(SOURCE_LABEL[l.source] || l.source)}</span>`,
		l.draft_status === 'failed' ? '<span class="ml-pill failed">Draft failed</span>' : '',
	].join('');
	const sub = [l.company, l.job_title, l.country].filter(Boolean).join(' · ');
	return `<button class="ml-row" type="button" data-id="${esc(l.id)}" aria-current="${l.id === state.selected}">
		<div class="ml-row-top"><span class="ml-name">${esc(nameOf(l))}</span><span class="ml-muted">${esc(when(l.received_at))}</span></div>
		<div class="ml-muted">${esc(sub || 'No company given')}${l.offer_title ? ` · ${esc(l.offer_title)}` : ''}</div>
		<div class="ml-pills">${pills}</div>
	</button>`;
}

function filtersActive() {
	return Boolean(state.status || state.source || state.action || state.q);
}

function renderList() {
	if (!state.leads.length) {
		if (filtersActive()) {
			note(listEl, 'No leads match these filters', 'Clear the search or pick another status, source or action.');
		} else {
			note(
				listEl,
				'No leads yet',
				'Leads arrive when Partner Center posts them to the HTTPS endpoint lead destination. Set it up under the offer, Offer setup, Customer leads, then press Validate to send a test lead. The steps are in <code>docs/ops/microsoft-marketplace-leads.md</code>.',
			);
		}
		moreWrap.hidden = true;
		return;
	}
	listEl.innerHTML = state.leads.map(rowHtml).join('');
	moreWrap.hidden = !state.nextBefore;
}

function listQuery(before) {
	const p = new URLSearchParams();
	for (const k of ['status', 'source', 'action', 'q']) if (state[k]) p.set(k, state[k]);
	if (before) p.set('before', before);
	return `${API}?${p}`;
}

let listSeq = 0;
async function loadList({ append = false } = {}) {
	const seq = ++listSeq;
	refreshBtn.disabled = true;
	moreBtn.disabled = true;
	listEl.setAttribute('aria-busy', 'true');
	if (!append) listEl.innerHTML = '<div class="ml-skeleton"></div>'.repeat(5);
	try {
		const d = await api(listQuery(append ? state.nextBefore : null));
		if (seq !== listSeq) return;
		state.leads = append ? state.leads.concat(d.leads) : d.leads;
		state.counts = d.counts || {};
		state.nextBefore = d.next_before;
		renderTabs();
		renderList();
		stamp.textContent = `Read ${when(new Date().toISOString())}`;
		if (!state.selected && !append) renderDetailEmpty();
	} catch (err) {
		if (seq !== listSeq) return;
		const gate = gateNote(err);
		if (gate) note(listEl, gate[0], gate[1], err.status !== 401);
		else note(listEl, 'Could not load leads', `${esc(err.message)}. Check your connection and press Refresh.`, true);
		moreWrap.hidden = true;
		if (gate) detailEl.hidden = true;
	} finally {
		if (seq === listSeq) {
			refreshBtn.disabled = false;
			moreBtn.disabled = false;
			listEl.setAttribute('aria-busy', 'false');
		}
	}
}

function renderDetailEmpty() {
	detailEl.hidden = false;
	note(detailEl, 'Pick a lead', 'Select a lead on the left to see who it is, the drafted reply, the raw payload Partner Center sent, and to record your follow-up.');
}

function draftSection(l) {
	if (l.draft_status === 'skipped') {
		return `<p class="ml-muted">${l.action === 'DNC' ? 'This customer asked not to be contacted, so no reply is drafted.' : 'No reply is drafted for this lead.'}</p>`;
	}
	if (l.redacted_at) return '<p class="ml-muted">This lead is past retention. Its personal details and draft basis were removed.</p>';
	const retry = `<button class="ml-btn" type="button" data-op="draft">${l.draft_status === 'ready' ? 'Draft again' : 'Retry draft'}</button>`;
	if (l.draft_status === 'ready' && l.draft_body) {
		return `${l.draft_subject ? `<div class="ml-draft-subject">Subject: ${esc(l.draft_subject)}</div>` : ''}
			<pre class="ml-draft" id="ml-draft-body">${esc(l.draft_body)}</pre>
			<div class="ml-actions">
				<button class="ml-btn primary" type="button" data-op="copy">Copy reply</button>
				${retry}
				<span class="ml-muted">Drafted ${esc(when(l.draft_updated_at))}${l.draft_provider ? ` by ${esc(l.draft_provider)}` : ''}. Review before sending.</span>
			</div>
			${l.draft_error ? `<div class="ml-callout bad">The last redraft failed: ${esc(l.draft_error)}. The draft above is the earlier one.</div>` : ''}`;
	}
	if (l.draft_status === 'failed') {
		return `<div class="ml-callout bad">The draft could not be generated${l.draft_error ? `: ${esc(l.draft_error)}` : ''}. Attempt ${l.draft_attempts}. The cron retries every ten minutes up to five times, or retry now.</div>
			<div class="ml-actions">${retry}</div>`;
	}
	return `<p class="ml-muted">The draft is still being written. The cron finishes it within ten minutes, or draft it now.</p><div class="ml-actions">${retry}</div>`;
}

function renderDetail(l) {
	detailEl.hidden = false;
	const sub = [l.job_title, l.company].filter(Boolean).join(', ');
	const email = l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : 'n/a';
	const callout =
		l.action === 'PLT' && l.status === 'new'
			? '<div class="ml-callout">This customer pressed Contact me. Microsoft expects a reply within 24 hours of the lead.</div>'
			: l.action === 'DNC'
				? '<div class="ml-callout bad">Do not contact. Record it and close the lead; it is redacted 30 days after it arrived.</div>'
				: '';
	const statusOptions = STATUSES.map((s) => `<option value="${s}"${s === l.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('');
	detailEl.innerHTML = `
		<h2>${esc(nameOf(l))}</h2>
		<div class="ml-muted">${esc(sub || 'No company given')}</div>
		<div class="ml-pills">
			<span class="ml-pill ${esc(l.status)}">${esc(STATUS_LABEL[l.status])}</span>
			${l.action ? `<span class="ml-pill ${esc(l.action)}">${esc(ACTION_LABEL[l.action] || l.action)}</span>` : ''}
			<span class="ml-pill ${esc(l.draft_status)}">${esc(DRAFT_LABEL[l.draft_status] || l.draft_status)}</span>
		</div>
		${callout}
		<div class="ml-h3">Lead</div>
		<dl class="ml-facts">
			<dt>Email</dt><dd>${email}</dd>
			<dt>Phone</dt><dd>${esc(l.phone || 'n/a')}</dd>
			<dt>Country</dt><dd>${esc(l.country || 'n/a')}</dd>
			<dt>Source</dt><dd>${esc(SOURCE_LABEL[l.source] || l.source)}${l.lead_source_raw ? ` <span class="ml-muted">(${esc(l.lead_source_raw)})</span>` : ''}</dd>
			<dt>Offer</dt><dd>${esc(l.offer_title || l.offer_id || 'n/a')}</dd>
			<dt>Received</dt><dd>${esc(when(l.received_at))}</dd>
			<dt>Notified</dt><dd>${l.notified_at ? esc(when(l.notified_at)) : 'Not yet, the cron retries'}</dd>
			${l.description ? `<dt>Customer note</dt><dd>${esc(l.description)}</dd>` : ''}
		</dl>
		<div class="ml-h3">Drafted reply</div>
		${draftSection(l)}
		<div class="ml-h3">Follow-up</div>
		<div class="ml-actions">
			<label class="visually-hidden" for="ml-status">Status</label>
			<select class="ml-select" id="ml-status">${statusOptions}</select>
			${l.status === 'new' && l.action !== 'DNC' ? '<button class="ml-btn primary" type="button" data-op="contacted">Mark contacted</button>' : ''}
		</div>
		<label class="visually-hidden" for="ml-notes">Owner notes</label>
		<textarea class="ml-textarea" id="ml-notes" placeholder="Notes for this lead: what you sent, next step, deal size" style="margin-top:0.6rem">${esc(l.owner_notes || '')}</textarea>
		<div class="ml-actions"><button class="ml-btn" type="button" data-op="save">Save</button>${l.status_changed_at ? `<span class="ml-muted">Status changed ${esc(when(l.status_changed_at))}</span>` : ''}</div>
		<div class="ml-h3">Raw payload</div>
		<pre class="ml-raw">${esc(JSON.stringify(l.raw_payload, null, 2))}</pre>`;
}

let detailSeq = 0;
async function loadDetail(id) {
	const seq = ++detailSeq;
	state.selected = id;
	syncUrl();
	for (const row of listEl.querySelectorAll('.ml-row')) row.setAttribute('aria-current', String(row.dataset.id === id));
	detailEl.hidden = false;
	detailEl.setAttribute('aria-busy', 'true');
	detailEl.innerHTML = '<div class="ml-skeleton"></div><div class="ml-skeleton tall"></div>';
	try {
		const { lead } = await api(`${API}?id=${encodeURIComponent(id)}`);
		if (seq !== detailSeq) return;
		state.lead = lead;
		renderDetail(lead);
	} catch (err) {
		if (seq !== detailSeq) return;
		const gate = gateNote(err);
		if (gate) note(detailEl, gate[0], gate[1], err.status !== 401);
		else if (err.status === 404) note(detailEl, 'Lead not found', 'It may have been removed. Pick another lead on the left.', true);
		else note(detailEl, 'Could not load this lead', `${esc(err.message)}. Select it again to retry.`, true);
	} finally {
		if (seq === detailSeq) detailEl.setAttribute('aria-busy', 'false');
	}
}

function mergeIntoList(lead) {
	const i = state.leads.findIndex((l) => l.id === lead.id);
	if (i >= 0) {
		state.leads[i] = { ...state.leads[i], ...lead };
		const row = listEl.querySelector(`.ml-row[data-id="${CSS.escape(lead.id)}"]`);
		if (row) row.outerHTML = rowHtml(state.leads[i]);
	}
}

async function patch(fields, btn, okMessage) {
	btn.disabled = true;
	try {
		const before = state.lead.status;
		const { lead } = await api(API, { method: 'PATCH', body: JSON.stringify({ id: state.lead.id, ...fields }) });
		state.lead = lead;
		renderDetail(lead);
		mergeIntoList(lead);
		if (lead.status !== before) {
			state.counts[before] = Math.max(0, (state.counts[before] || 0) - 1);
			state.counts[lead.status] = (state.counts[lead.status] || 0) + 1;
			renderTabs();
		}
		toast(okMessage);
	} catch (err) {
		toast(err.message, true);
		btn.disabled = false;
	}
}

async function redraft(btn) {
	btn.disabled = true;
	btn.textContent = 'Drafting...';
	try {
		const { lead } = await api(API, { method: 'POST', body: JSON.stringify({ id: state.lead.id, op: 'draft' }) });
		state.lead = lead;
		renderDetail(lead);
		mergeIntoList(lead);
		if (lead.draft_error) toast(`Draft failed: ${lead.draft_error}.${lead.draft_body ? ' The earlier draft is kept.' : ''}`, true);
		else toast('New draft ready');
	} catch (err) {
		toast(err.message, true);
		btn.disabled = false;
		btn.textContent = 'Retry draft';
	}
}

async function copyDraft(btn) {
	const l = state.lead;
	const text = `${l.draft_subject ? `Subject: ${l.draft_subject}\n\n` : ''}${l.draft_body}`;
	try {
		await navigator.clipboard.writeText(text);
		btn.textContent = 'Copied';
		setTimeout(() => {
			btn.textContent = 'Copy reply';
		}, 2000);
	} catch {
		const range = document.createRange();
		range.selectNodeContents(document.getElementById('ml-draft-body'));
		const sel = getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
		toast('Clipboard access was blocked, so the reply is selected. Press Ctrl+C or Cmd+C to copy it.', true);
	}
}

detailEl.addEventListener('click', (ev) => {
	const btn = ev.target.closest('button[data-op]');
	if (!btn || !state.lead) return;
	const op = btn.dataset.op;
	if (op === 'copy') copyDraft(btn);
	else if (op === 'draft') redraft(btn);
	else if (op === 'contacted') patch({ status: 'contacted' }, btn, 'Marked contacted');
	else if (op === 'save') {
		patch({ status: document.getElementById('ml-status').value, owner_notes: document.getElementById('ml-notes').value }, btn, 'Saved');
	}
});

listEl.addEventListener('click', (ev) => {
	const row = ev.target.closest('.ml-row');
	if (row) loadDetail(row.dataset.id);
});

tabsEl.addEventListener('click', (ev) => {
	const tab = ev.target.closest('.ml-tab');
	if (!tab) return;
	state.status = tab.dataset.status;
	syncUrl();
	renderTabs();
	loadList();
});

sourceEl.addEventListener('change', () => {
	state.source = sourceEl.value;
	syncUrl();
	loadList();
});
actionEl.addEventListener('change', () => {
	state.action = actionEl.value;
	syncUrl();
	loadList();
});
let searchTimer = null;
qEl.addEventListener('input', () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		state.q = qEl.value.trim();
		syncUrl();
		loadList();
	}, 300);
});
refreshBtn.addEventListener('click', () => {
	loadList();
	if (state.selected) loadDetail(state.selected);
});
moreBtn.addEventListener('click', () => loadList({ append: true }));

renderTabs();
loadList();
if (state.selected) loadDetail(state.selected);
else renderDetailEmpty();
