// /skills/import: browse external SKILL.md registries (GitHub repositories and
// registry manifests) by category with install counts, scan a skill pinned to
// its exact upstream revision, approve or refuse the install, check installed
// imports for upstream updates as a diff, fork any skill, and publish your own.
//
// Data (api/skill-imports.js):
//   GET    /api/skill-imports/browse               registries, categories, skills, excluded
//   POST   /api/skill-imports/registries           add a registry
//   POST   /api/skill-imports/scan                 scan into a pending request
//   GET    /api/skill-imports/requests[/:id]       scan history / one scan
//   POST   /api/skill-imports/requests/:id         approve or refuse
//   POST   /api/skill-imports/updates              upstream diff + update request
//   POST   /api/skill-imports/fork | publish       fork / publish
//   GET    /api/skill-imports/publications         your publications
//   *      /api/agents/:id/custom-skills           the agent's skills
//
// URL state (restored on load): ?q= &registry= &category= &skill=<key or slug>
// &view=installed|requests &agent=<id> &request=<id>.

import { apiFetch, noteSession } from './api.js';
import { renderMarkdown } from './shared/markdown.js';

const $ = (id) => document.getElementById(id);
const API = '/api/skill-imports';
const CATEGORY_LABELS = {
	defi: 'DeFi',
	intelligence: 'Intelligence',
	social: 'Social',
	infrastructure: 'Infrastructure',
	security: 'Security',
	data: 'Data',
	other: 'Other',
};
const LICENSES = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'CC-BY-4.0', 'MPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-3.0', 'CC-BY-SA-4.0'];
const CAPABILITY_LABELS = { spend: 'Spending', sign: 'Signing', message: 'Outbound messaging' };

const params = new URLSearchParams(location.search);
const state = {
	view: ['installed', 'requests'].includes(params.get('view')) ? params.get('view') : 'browse',
	q: params.get('q') || '',
	registry: params.get('registry') || '',
	category: params.get('category') || '',
	openKey: params.get('skill') || null,
	openRequest: params.get('request') || null,
	agentId: params.get('agent') || '',
	data: null,
	user: undefined,
	agents: null,
	installed: null,
};

// ── helpers ────────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function announce(msg) {
	const live = $('si-live');
	live.textContent = '';
	requestAnimationFrame(() => { live.textContent = msg; });
}

function fmtTokens(n) {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function short(sha) {
	return sha ? String(sha).slice(0, 7) : '';
}

async function readJson(res) {
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const err = new Error(body?.error_description || body?.error?.message || `Request failed (${res.status})`);
		err.status = res.status;
		err.code = body?.error;
		err.body = body;
		throw err;
	}
	return body;
}

function post(path, payload) {
	return apiFetch(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(readJson);
}

function loginHref() {
	return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function syncUrl() {
	const p = new URLSearchParams();
	if (state.view !== 'browse') p.set('view', state.view);
	if (state.q) p.set('q', state.q);
	if (state.registry) p.set('registry', state.registry);
	if (state.category) p.set('category', state.category);
	if (state.openKey) p.set('skill', state.openKey);
	if (state.openRequest) p.set('request', state.openRequest);
	if (state.view === 'installed' && state.agentId) p.set('agent', state.agentId);
	const qs = p.toString();
	history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

function stateBlock({ title, body, actions = '', tone = '' }) {
	return `<div class="sc-state ${tone ? `sc-state-${tone}` : ''}" role="${tone === 'error' ? 'alert' : 'status'}">
		<h3 class="sc-state-title">${title}</h3>
		<p class="sc-state-body">${body}</p>
		${actions ? `<div class="sc-ctas">${actions}</div>` : ''}
	</div>`;
}

function spinner(label) {
	return `<div class="sc-import-row"><span class="sc-spinner" aria-hidden="true"></span> ${esc(label)}</div>`;
}

function setBusy(btn, busy, label) {
	if (!btn) return;
	if (busy) {
		btn.dataset.label = btn.textContent;
		btn.textContent = label;
		btn.disabled = true;
	} else {
		btn.textContent = btn.dataset.label || btn.textContent;
		btn.disabled = false;
	}
}

// ── session + agents ───────────────────────────────────────────────────────

async function loadSession() {
	if (state.user !== undefined) return state.user;
	try {
		const body = await readJson(await apiFetch('/api/auth/me', { allowAnonymous: true }));
		state.user = body?.user || null;
	} catch {
		state.user = null;
	}
	noteSession(Boolean(state.user));
	return state.user;
}

async function loadAgents() {
	if (state.agents) return state.agents;
	const body = await readJson(await apiFetch('/api/agents'));
	state.agents = (body?.agents || []).map((a) => ({ id: a.id, name: a.name || 'Untitled agent' }));
	if (!state.agents.some((a) => a.id === state.agentId)) state.agentId = state.agents[0]?.id || '';
	return state.agents;
}

function agentOptions(selected) {
	return state.agents.map((a) => `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
}

/** Sign-in or create-agent prompt, or null when the viewer has agents. */
async function agentGate() {
	const user = await loadSession();
	if (!user) {
		return stateBlock({
			title: 'Sign in to install skills',
			body: 'Skills install onto your agents, so you need to be signed in. Browsing and reading every skill stays open.',
			actions: `<a class="sc-btn sc-btn-primary" href="${loginHref()}">Sign in</a>`,
		});
	}
	try {
		await loadAgents();
	} catch (err) {
		return stateBlock({ tone: 'error', title: 'Your agents did not load', body: esc(err.message), actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="reload">Try again</button>' });
	}
	if (!state.agents.length) {
		return stateBlock({
			title: 'You have no agents yet',
			body: 'A skill is instructions for an agent. Create one first, then come back to give it skills.',
			actions: '<a class="sc-btn sc-btn-primary" href="/create-agent">Create an agent</a>',
		});
	}
	return null;
}

// ── browse ─────────────────────────────────────────────────────────────────

function renderSkeleton() {
	$('si-grid').innerHTML = Array.from({ length: 6 }, () => '<div class="sc-card sc-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>').join('');
	$('si-grid').setAttribute('aria-busy', 'true');
}

async function loadBrowse({ reopen = true } = {}) {
	renderSkeleton();
	$('si-browse-state').innerHTML = '';
	await loadSession();
	try {
		const { data } = await readJson(await apiFetch(`${API}/browse`, { allowAnonymous: true }));
		state.data = data;
	} catch (err) {
		$('si-grid').innerHTML = '';
		$('si-grid').setAttribute('aria-busy', 'false');
		$('si-browse-state').innerHTML = stateBlock({
			tone: 'error',
			title: 'The registries did not load',
			body: `${esc(err.message)}. Nothing was changed.`,
			actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="reload">Try again</button>',
		});
		return;
	}
	renderBrowse();
	if (!reopen) return;
	if (state.openKey) {
		const hit = findSkill(state.openKey);
		if (hit) openSkill(hit.key);
	}
	if (state.openRequest) openRequest(state.openRequest);
}

function findSkill(keyOrSlug) {
	const skills = state.data?.skills || [];
	return skills.find((s) => s.key === keyOrSlug) || skills.find((s) => s.slug === keyOrSlug && (!state.registry || s.registry.key === state.registry));
}

function renderBrowse() {
	renderStats();
	renderRegistries();
	renderCategories();
	renderGrid();
	renderExcluded();
}

function renderStats() {
	const d = state.data;
	const installs = d.skills.reduce((n, s) => n + s.installs, 0);
	$('si-stats').innerHTML = [
		[d.registries.length, d.registries.length === 1 ? 'registry' : 'registries'],
		[d.skills.length, 'skills listed'],
		[installs, installs === 1 ? 'install' : 'installs'],
		[d.excluded.length, 'not offered'],
	].map(([n, label]) => `<div><dt>${esc(label)}</dt><dd>${n}</dd></div>`).join('');
}

function renderRegistries() {
	const d = state.data;
	const sel = $('si-registry');
	sel.innerHTML = `<option value="">All registries</option>${d.registries.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join('')}`;
	sel.value = d.registries.some((r) => r.key === state.registry) ? state.registry : '';
	$('si-registries').innerHTML = d.registries
		.map((r) => {
			const status = r.error
				? `<span class="si-reg-status is-error" title="${esc(r.error)}">unreachable</span>`
				: `<span class="si-reg-status">${r.skills} skill${r.skills === 1 ? '' : 's'}${r.commit ? ` @ <code>${esc(short(r.commit))}</code>` : ''}</span>`;
			const link = r.url && /^https:/.test(r.url) ? `<a href="${esc(r.url)}" rel="noopener" target="_blank">${esc(r.label)}</a>` : esc(r.label);
			const remove = r.builtin ? '' : `<button type="button" class="si-reg-remove" data-remove-registry="${esc(r.key)}" aria-label="Remove ${esc(r.label)}">Remove</button>`;
			return `<span class="si-reg${r.error ? ' is-error' : ''}">${link} ${status}${remove}</span>`;
		})
		.join('');
}

function visibleSkills() {
	const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
	return state.data.skills.filter((s) => {
		if (state.registry && s.registry.key !== state.registry) return false;
		if (!words.length) return true;
		const hay = `${s.slug} ${s.name} ${s.description} ${s.tags.join(' ')} ${s.author || ''}`.toLowerCase();
		return words.every((w) => hay.includes(w));
	});
}

function renderCategories() {
	const base = visibleSkills();
	const counts = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((c) => [c, 0]));
	for (const s of base) counts[s.category] = (counts[s.category] || 0) + 1;
	const chips = [{ key: '', label: 'All', count: base.length }, ...Object.entries(CATEGORY_LABELS).filter(([k]) => k !== 'other' || counts.other).map(([key, label]) => ({ key, label, count: counts[key] }))];
	$('si-cats').innerHTML = chips
		.map((c) => `<button type="button" class="sc-chip${state.category === c.key ? ' is-active' : ''}" data-category="${esc(c.key)}" aria-pressed="${state.category === c.key}"${c.count === 0 && c.key ? ' disabled' : ''}>${esc(c.label)} <span class="sc-chip-count">${c.count}</span></button>`)
		.join('');
}

function cardHtml(s) {
	const tools = s.requested_tools.length;
	return `<article class="sc-card">
		<button type="button" class="sc-card-hit" data-skill="${esc(s.key)}" aria-label="Open ${esc(s.name)}"></button>
		<header class="sc-card-head">
			<h3 class="sc-card-title">${esc(s.name)}</h3>
			<span class="si-cat si-cat-${esc(s.category)}">${esc(CATEGORY_LABELS[s.category] || s.category)}</span>
		</header>
		<p class="sc-card-desc">${esc(s.description)}</p>
		<footer class="sc-card-foot">
			<span title="Source registry">${esc(s.registry.label)}</span>
			<span title="Licence">${esc(s.license.spdx || 'licence')}</span>
			<span title="Agents with this skill installed">${s.installs} install${s.installs === 1 ? '' : 's'}</span>
			${tools ? `<span class="sc-badge" title="Tools the skill asks for">${tools} tool${tools === 1 ? '' : 's'}</span>` : ''}
		</footer>
	</article>`;
}

function renderGrid() {
	const grid = $('si-grid');
	const list = visibleSkills().filter((s) => !state.category || s.category === state.category);
	grid.setAttribute('aria-busy', 'false');
	grid.innerHTML = list.map(cardHtml).join('');
	$('si-browse-state').innerHTML = list.length
		? ''
		: stateBlock({
				title: 'No skills match',
				body: state.q || state.category || state.registry ? 'Clear the search or pick another category or registry.' : 'None of these registries list an installable skill right now. Add a registry to bring in more.',
				actions: state.q || state.category || state.registry ? '<button type="button" class="sc-btn sc-btn-primary" data-action="clear-filters">Clear filters</button>' : '<button type="button" class="sc-btn sc-btn-primary" data-action="add-registry">Add a registry</button>',
			});
	announce(`${list.length} skill${list.length === 1 ? '' : 's'} shown`);
}

function renderExcluded() {
	const ex = state.data.excluded.filter((e) => !state.registry || state.data.registries.find((r) => r.key === state.registry)?.label === e.registry);
	$('si-excluded').hidden = !ex.length;
	$('si-excluded-summary').textContent = `${ex.length} skill${ex.length === 1 ? ' is' : 's are'} not offered, and why`;
	$('si-excluded-list').innerHTML = ex
		.map((e) => `<li><strong>${esc(e.name)}</strong> <span class="si-muted">${esc(e.registry)}</span><br /><span class="si-reason">${esc(e.reason)}</span>${e.source_url ? ` <a href="${esc(e.source_url)}" rel="noopener" target="_blank">source</a>` : ''}</li>`)
		.join('');
}

async function addRegistry(e) {
	e.preventDefault();
	const input = $('si-add-input');
	const note = $('si-add-note');
	const value = input.value.trim();
	if (!value) {
		note.textContent = 'Enter owner/repo, a GitHub URL, or a manifest URL.';
		input.focus();
		return;
	}
	if (!(await loadSession())) {
		location.href = loginHref();
		return;
	}
	const btn = $('si-add-save');
	setBusy(btn, true, 'Reading the registry…');
	note.textContent = '';
	try {
		const { data } = await post('registries', { registry: value });
		note.textContent = `Added ${data.label}: ${data.skills} skill${data.skills === 1 ? '' : 's'} at ${short(data.commit) || 'its current revision'}.`;
		input.value = '';
		state.registry = data.key;
		await loadBrowse();
		syncUrl();
		toggleAdd(false);
		announce(`Registry ${data.label} added`);
	} catch (err) {
		note.textContent = err.message;
	} finally {
		setBusy(btn, false);
	}
}

async function removeRegistry(key, btn) {
	setBusy(btn, true, 'Removing…');
	try {
		await readJson(await apiFetch(`${API}/registries?key=${encodeURIComponent(key)}`, { method: 'DELETE' }));
		if (state.registry === key) state.registry = '';
		await loadBrowse();
		syncUrl();
		announce('Registry removed');
	} catch (err) {
		setBusy(btn, false);
		announce(err.message);
	}
}

function toggleAdd(show) {
	const form = $('si-add');
	form.hidden = !show;
	$('si-add-toggle').setAttribute('aria-expanded', String(show));
	if (show) $('si-add-input').focus();
}

// ── dialog: one skill ──────────────────────────────────────────────────────

function openDialog({ kicker, title, desc }) {
	$('si-dialog-kicker').textContent = kicker || '';
	$('si-dialog-title').textContent = title || '';
	$('si-dialog-desc').textContent = desc || '';
	const dlg = $('si-dialog');
	if (!dlg.open) dlg.showModal();
	return $('si-dialog-body');
}

function provenanceHtml(s) {
	const pin = s.pin.commit
		? `commit <code>${esc(short(s.pin.commit))}</code> · blob <code>${esc(short(s.pin.blob_sha))}</code>`
		: `sha256 <code>${esc(short(s.pin.sha256))}</code>${s.pin.revision ? ` · revision ${esc(s.pin.revision)}` : ''}`;
	const rows = [
		['Registry', esc(s.registry.label)],
		['Source', s.source_url ? `<a href="${esc(s.source_url)}" rel="noopener" target="_blank">${esc(s.path || s.slug)}</a>` : esc(s.path || s.slug)],
		['Repository', s.repo_url ? `<a href="${esc(s.repo_url)}" rel="noopener" target="_blank">${esc(s.repo_url.replace(/^https:\/\//, ''))}</a>` : '<span class="si-muted">none given</span>'],
		['Pinned to', pin],
		['Licence', `${esc(s.license.spdx || 'unknown')} <span class="si-muted">(${esc(s.license.class)}, from ${esc(s.license.source || 'unknown')})</span>${s.license.notice ? `<br /><span class="si-muted">${esc(s.license.notice)}</span>` : ''}`],
		['Author', esc(s.author || 'not stated')],
		['Version', esc(s.version || 'not stated')],
		['Category', esc(CATEGORY_LABELS[s.category] || s.category)],
	];
	return `<dl class="si-prov">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function requestsHtml(s) {
	const tools = s.requested_tools || [];
	const perms = s.requested_permissions || [];
	const files = (s.files || []).filter((f) => !/(^|\/)SKILL\.md$/i.test(f));
	if (!tools.length && !perms.length && !files.length) return '<p class="si-muted">Asks for no tools or permissions, and ships no other files.</p>';
	return `<div class="si-asks">
		${tools.length ? `<p><strong>Tools it asks for:</strong> ${tools.map((t) => `<code>${esc(t)}</code>`).join(' ')}</p>` : ''}
		${perms.length ? `<p><strong>Permissions it asks for:</strong> ${perms.map((t) => `<code>${esc(t)}</code>`).join(' ')}</p>` : ''}
		${files.length ? `<p><strong>Other files</strong> (listed, never installed or run): ${files.slice(0, 12).map((f) => `<code>${esc(f)}</code>`).join(' ')}${files.length > 12 ? ` and ${files.length - 12} more` : ''}</p>` : ''}
	</div>`;
}

async function openSkill(key) {
	const s = findSkill(key);
	if (!s) return;
	state.openKey = s.key;
	state.openRequest = null;
	syncUrl();
	const body = openDialog({ kicker: `${s.registry.label} · ${CATEGORY_LABELS[s.category] || s.category}`, title: s.name, desc: s.description });
	body.innerHTML = `
		<section class="si-block"><h3 class="si-h3">Provenance</h3>${provenanceHtml(s)}</section>
		<section class="si-block"><h3 class="si-h3">What it asks for</h3>${requestsHtml(s)}</section>
		<section class="si-block" id="si-install-box">${spinner('Checking your agents…')}</section>`;
	const gate = await agentGate();
	const box = $('si-install-box');
	if (!box || state.openKey !== s.key) return;
	if (gate) {
		box.innerHTML = gate;
		return;
	}
	box.innerHTML = `<h3 class="si-h3">Install</h3>
		<p class="sc-note">Scanning reads this skill at the pinned revision and checks it before anything is installed. You decide after you see the report.</p>
		<div class="sc-import-row">
			<label class="sr-only" for="si-install-agent">Agent</label>
			<select class="sc-select" id="si-install-agent">${agentOptions(state.agentId)}</select>
			<button type="button" class="sc-btn sc-btn-primary" data-scan="${esc(s.key)}">Scan for install</button>
		</div>`;
}

async function scanSkill(key, btn) {
	const s = findSkill(key);
	const agentId = $('si-install-agent')?.value;
	if (!s || !agentId) return;
	state.agentId = agentId;
	setBusy(btn, true, 'Scanning…');
	try {
		const { data } = await post('scan', { agent_id: agentId, registry: s.registry.key, skill: s.key });
		renderRequest(data.request);
		announce(`Scan finished: ${data.request.verdict}`);
	} catch (err) {
		setBusy(btn, false);
		const box = $('si-install-box');
		box.insertAdjacentHTML('beforeend', `<p class="sc-form-note" role="alert">${esc(err.message)}</p>`);
	}
}

// ── dialog: a scan request ─────────────────────────────────────────────────

const VERDICT_COPY = {
	clean: ['Passed the scan', 'No rule fired. Read the instructions below, then decide.'],
	flagged: ['Passed with warnings', 'Nothing blocking was found, but read the warnings before you approve.'],
	refused: ['Refused by the scan', 'This skill broke a blocking rule and cannot be installed.'],
};

function capabilitiesHtml(scan) {
	const caps = Object.entries(scan.capabilities || {}).filter(([, c]) => c.requested);
	if (!caps.length) return '<p class="si-muted">Does not ask to spend, sign or send messages.</p>';
	return `<ul class="si-caps">${caps
		.map(([k, c]) => `<li><strong>${esc(CAPABILITY_LABELS[k] || k)}</strong> <span class="si-muted">${c.evidence.slice(0, 3).map(esc).join('; ')}</span></li>`)
		.join('')}</ul>
		<p class="si-gate-note">Runs under the spend gate: while it is active, any transfer the agent proposes is held unless your own message asked for that exact amount and recipient.</p>`;
}

function findingsHtml(findings) {
	if (!findings.length) return '<p class="si-muted">No findings.</p>';
	const order = { block: 0, warn: 1, info: 2 };
	return `<ul class="si-findings">${[...findings]
		.sort((a, b) => order[a.severity] - order[b.severity])
		.map((f) => `<li class="si-finding is-${esc(f.severity)}">
			<span class="si-sev">${esc(f.severity)}</span>
			<div><strong>${esc(f.rule)}</strong> ${esc(f.message)}${f.line ? ` <span class="si-muted">line ${f.line}</span>` : ''}
			${f.excerpt ? `<pre class="si-excerpt">${esc(f.excerpt)}</pre>` : ''}</div>
		</li>`)
		.join('')}</ul>`;
}

function guardianHtml(g) {
	if (!g) return '';
	if (g.status === 'ok') return `<p class="si-muted">Granite Guardian (${esc(g.model)}): ${esc(g.decision)}.</p>`;
	return `<p class="si-muted">Granite Guardian: ${esc(g.note || g.status)}</p>`;
}

function decisionHtml(r) {
	if (r.status === 'approved') {
		return `<div class="si-decided is-approved" role="status">Approved and installed${r.decided_at ? ` ${new Date(r.decided_at).toLocaleString()}` : ''}. <a href="/skills/import?view=installed&amp;agent=${esc(r.agent_id)}">See it on the agent</a></div>`;
	}
	if (r.status === 'refused') {
		return `<div class="si-decided is-refused" role="status">${r.decided_by === 'scanner' ? 'Refused by the scanner. It was never installed.' : 'You refused this install.'}</div>`;
	}
	const expired = new Date(r.expires_at).getTime() < Date.now();
	if (expired) return '<div class="si-decided" role="status">This scan expired. Scan the skill again to install it.</div>';
	return `<form class="si-decide" data-request="${esc(r.id)}">
		${r.gated ? `<label class="si-ack"><input type="checkbox" id="si-ack" required /> I understand this skill asks for ${esc(Object.entries(r.scan.capabilities).filter(([, c]) => c.requested).map(([k]) => (CAPABILITY_LABELS[k] || k).toLowerCase()).join(', '))} and will run under the spend gate.</label>` : ''}
		<div class="sc-ctas">
			<button type="submit" class="sc-btn sc-btn-primary" data-decision="approve">${r.replaces_skill_id ? 'Approve update' : 'Approve and install'}</button>
			<button type="button" class="sc-btn sc-btn-danger" data-decide-refuse="${esc(r.id)}">Refuse</button>
		</div>
		<p class="sc-form-note" id="si-decide-note" role="status" aria-live="polite"></p>
	</form>`;
}

function renderRequest(r, { diff = null } = {}) {
	state.openRequest = r.id;
	syncUrl();
	const [headline, sub] = VERDICT_COPY[r.verdict];
	const agent = state.agents?.find((a) => a.id === r.agent_id);
	const body = openDialog({
		kicker: `${r.provenance.registry?.label || 'external'} · scan ${new Date(r.created_at).toLocaleString()}`,
		title: r.skill.name,
		desc: r.replaces_skill_id ? `Update for ${agent ? agent.name : 'your agent'}` : `Install on ${agent ? agent.name : 'your agent'}`,
	});
	const p = r.provenance;
	const pin = p.commit ? `commit <code>${esc(short(p.commit))}</code>` : `sha256 <code>${esc(short(p.sha256))}</code>`;
	body.innerHTML = `
		<div class="si-verdict is-${esc(r.verdict)}" role="status">
			<strong>${headline}</strong>
			<span>${sub}</span>
			<span class="si-muted">~${fmtTokens(r.scan.tokens)} tokens · ${pin} · ${esc(p.license?.spdx || 'licence unknown')}${p.source_url ? ` · <a href="${esc(p.source_url)}" rel="noopener" target="_blank">source</a>` : ''}</span>
		</div>
		${decisionHtml(r)}
		${diff || ''}
		<section class="si-block"><h3 class="si-h3">Spending, signing and messaging</h3>${capabilitiesHtml(r.scan)}</section>
		<section class="si-block"><h3 class="si-h3">Findings</h3>${findingsHtml(r.scan.findings)}${guardianHtml(r.scan.guardian)}</section>
		<section class="si-block">
			<h3 class="si-h3">The exact instructions that would be installed</h3>
			<details class="si-raw"><summary>Show the raw SKILL.md (${r.content.length.toLocaleString()} characters)</summary><pre>${esc(r.content)}</pre></details>
			<article class="sc-md">${renderMarkdown(r.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), { demoteHeadings: 1 })}</article>
		</section>`;
}

async function openRequest(id) {
	const gate = await agentGate();
	if (gate) return;
	const body = openDialog({ kicker: 'Scan', title: 'Loading…' });
	body.innerHTML = spinner('Loading the scan…');
	try {
		const { data } = await readJson(await apiFetch(`${API}/requests/${encodeURIComponent(id)}`));
		renderRequest(data.request);
	} catch (err) {
		body.innerHTML = stateBlock({ tone: 'error', title: 'That scan did not load', body: esc(err.message) });
	}
}

async function decide(id, decision, btn) {
	const ack = $('si-ack');
	const note = $('si-decide-note');
	if (decision === 'approve' && ack && !ack.checked) {
		note.textContent = 'Tick the acknowledgement to install a skill that runs under the spend gate.';
		ack.focus();
		return;
	}
	setBusy(btn, true, decision === 'approve' ? 'Installing…' : 'Refusing…');
	try {
		const { data } = await post(`requests/${encodeURIComponent(id)}`, { decision, acknowledge_gated: Boolean(ack?.checked) });
		renderRequest(data.request);
		announce(decision === 'approve' ? 'Skill installed' : 'Install refused');
		state.installed = null;
		// Refresh install counts behind the dialog without replacing the receipt.
		if (decision === 'approve') loadBrowse({ reopen: false });
	} catch (err) {
		setBusy(btn, false);
		note.textContent = err.message;
	}
}

// ── installed, updates, fork, publish ─────────────────────────────────────

async function showInstalled() {
	const gate = await agentGate();
	$('si-installed-gate').innerHTML = gate || '';
	$('si-installed-body').hidden = Boolean(gate);
	if (gate) return;
	$('si-agent').innerHTML = agentOptions(state.agentId);
	$('si-manage-link').href = `/skills/community?view=mine&agent=${encodeURIComponent(state.agentId)}`;
	syncUrl();
	await Promise.all([loadInstalled(), loadPublications()]);
}

async function loadInstalled() {
	const list = $('si-installed-list');
	list.innerHTML = `<li>${spinner('Loading skills…')}</li>`;
	try {
		const { data } = await readJson(await apiFetch(`/api/agents/${state.agentId}/custom-skills`));
		state.installed = data;
	} catch (err) {
		list.innerHTML = `<li>${stateBlock({ tone: 'error', title: 'Skills did not load', body: esc(err.message), actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="reload-installed">Try again</button>' })}</li>`;
		return;
	}
	renderInstalled();
}

function originLine(s) {
	if (s.source === 'external' && s.external) {
		const e = s.external;
		return `from ${e.source_url ? `<a href="${esc(e.source_url)}" rel="noopener" target="_blank">${esc(e.registry?.label || 'an external registry')}</a>` : esc(e.registry?.label || 'an external registry')} ${e.commit ? `@ <code>${esc(short(e.commit))}</code>` : e.sha256 ? `sha256 <code>${esc(short(e.sha256))}</code>` : ''}${e.license?.spdx ? ` · ${esc(e.license.spdx)}` : ''}${e.locally_modified ? ' · edited locally' : ''}`;
	}
	if (s.source === 'community') return 'from the three.ws community registry';
	if (s.fork) return `forked from ${esc(s.fork.slug || 'a skill')}${s.fork.license?.spdx ? ` · ${esc(s.fork.license.spdx)}` : ''}`;
	return 'written by you';
}

function installedHtml(s) {
	const canPublish = s.source === 'custom';
	return `<li class="sc-item${s.enabled ? '' : ' is-disabled'}" data-id="${esc(s.id)}">
		<div class="sc-item-main">
			<div class="sc-item-head">
				<h3 class="sc-item-title">${esc(s.name)}</h3>
				${s.injected ? '<span class="sc-status is-on">Active</span>' : '<span class="sc-status">Off</span>'}
				${s.gated ? '<span class="sc-status is-gated" title="Asked for spending, signing or messaging; runs under the spend gate">Spend gate</span>' : ''}
			</div>
			<p class="sc-item-meta">v${esc(s.version)} · ~${fmtTokens(s.tokens)} tokens · ${originLine(s)}</p>
			<div class="si-item-out" id="si-out-${esc(s.id)}"></div>
		</div>
		<div class="sc-item-actions">
			${s.source === 'external' ? `<button type="button" class="sc-btn sc-btn-sm" data-update="${esc(s.id)}">Check for update</button>` : ''}
			<button type="button" class="sc-btn sc-btn-sm" data-fork="${esc(s.id)}">Fork</button>
			${canPublish ? `<button type="button" class="sc-btn sc-btn-sm" data-publish="${esc(s.id)}">Publish</button>` : ''}
		</div>
	</li>`;
}

function renderInstalled() {
	const { skills } = state.installed;
	const list = $('si-installed-list');
	if (!skills.length) {
		list.innerHTML = `<li>${stateBlock({
			title: 'No skills on this agent yet',
			body: 'Browse a registry and scan a skill to install it, or write your own on the community page.',
			actions: '<button type="button" class="sc-btn sc-btn-primary" data-view="browse">Browse skills</button>',
		})}</li>`;
		return;
	}
	list.innerHTML = skills.map(installedHtml).join('');
}

function diffHtml(u) {
	const lines = u.diff.split('\n').slice(2);
	return `<section class="si-block">
		<h3 class="si-h3">What changed upstream <span class="si-muted">+${u.stats.added} / -${u.stats.removed} lines</span></h3>
		${u.locally_modified ? '<p class="si-gate-note">You edited this skill after installing it. Approving the update replaces your edits with the upstream text; fork it first if you want to keep them.</p>' : ''}
		<pre class="si-diff">${lines
			.map((l) => `<span class="${l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : ''}">${esc(l)}</span>`)
			.join('\n')}</pre>
	</section>`;
}

async function checkUpdate(skillId, btn) {
	const out = $(`si-out-${skillId}`);
	setBusy(btn, true, 'Checking…');
	try {
		const { data } = await post('updates', { agent_id: state.agentId, skill_id: skillId });
		setBusy(btn, false);
		if (data.removed) {
			out.innerHTML = '<p class="sc-note">The registry no longer lists this skill. Your pinned copy keeps working; nothing changed.</p>';
		} else if (!data.changed) {
			out.innerHTML = `<p class="sc-note">Up to date with ${data.installed.commit ? `commit <code>${esc(short(data.installed.commit))}</code>` : 'the registry'}.</p>`;
		} else {
			out.innerHTML = `<p class="sc-note">Upstream changed: +${data.stats.added} / -${data.stats.removed} lines. <button type="button" class="sc-btn sc-btn-sm" data-request-open="${esc(data.request.id)}">Review the diff</button></p>`;
			state.diffs = { ...(state.diffs || {}), [data.request.id]: diffHtml(data) };
			renderRequest(data.request, { diff: state.diffs[data.request.id] });
		}
	} catch (err) {
		setBusy(btn, false);
		out.innerHTML = `<p class="sc-form-note" role="alert">${esc(err.message)}</p>`;
	}
}

function openFork(skillId) {
	const s = state.installed.skills.find((x) => x.id === skillId);
	if (!s) return;
	const body = openDialog({ kicker: 'Fork', title: `Fork ${s.name}`, desc: 'An editable copy on any of your agents. It keeps its source and licence, and a fork of a gated skill stays gated.' });
	body.innerHTML = `<form class="si-form" id="si-fork-form" data-skill="${esc(s.id)}">
		<div class="sc-field"><label for="si-fork-agent">Copy onto</label><select class="sc-select" id="si-fork-agent">${agentOptions(state.agentId)}</select></div>
		<div class="sc-field"><label for="si-fork-name">Name</label><input class="sc-input" id="si-fork-name" maxlength="80" value="${esc(s.name)}" /></div>
		<div class="sc-ctas"><button type="submit" class="sc-btn sc-btn-primary" id="si-fork-save">Fork skill</button></div>
		<p class="sc-form-note" id="si-fork-note" role="status" aria-live="polite"></p>
	</form>`;
}

async function submitFork(form) {
	const btn = $('si-fork-save');
	const note = $('si-fork-note');
	setBusy(btn, true, 'Forking…');
	try {
		const agentId = $('si-fork-agent').value;
		const name = $('si-fork-name').value.trim();
		const { data } = await post('fork', { agent_id: agentId, skill_id: form.dataset.skill, ...(name ? { name } : {}) });
		note.innerHTML = `Forked as <strong>${esc(data.skill.name)}</strong>. <a href="/skills/community?view=mine&amp;agent=${esc(agentId)}">Edit it</a>, then publish it from here.`;
		setBusy(btn, false);
		if (agentId === state.agentId) loadInstalled();
		announce('Skill forked');
	} catch (err) {
		setBusy(btn, false);
		note.textContent = err.message;
	}
}

function openPublish(skillId) {
	const s = state.installed.skills.find((x) => x.id === skillId);
	if (!s) return;
	const inherited = s.fork?.license?.class === 'copyleft' ? s.fork.license.spdx : null;
	const body = openDialog({ kicker: 'Publish', title: `Publish ${s.name}`, desc: 'Anyone can then import it from the three.ws published registry, with you credited as the author.' });
	body.innerHTML = `<form class="si-form" id="si-publish-form" data-skill="${esc(s.id)}">
		<div class="sc-field"><label for="si-pub-license">Licence</label><select class="sc-select" id="si-pub-license">${LICENSES.map((l) => `<option${l === (inherited || 'MIT') ? ' selected' : ''}>${l}</option>`).join('')}</select>
		${inherited ? `<span class="sc-note">This derives from ${esc(inherited)} work, so it must stay ${esc(inherited)}.</span>` : ''}</div>
		<div class="sc-field"><label for="si-pub-cat">Category</label><select class="sc-select" id="si-pub-cat">${Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
		<label class="si-ack"><input type="checkbox" id="si-pub-confirm" /> Publish these exact instructions publicly. Publishing again later replaces the public copy.</label>
		<div class="sc-ctas"><button type="submit" class="sc-btn sc-btn-primary" id="si-pub-save">Publish</button></div>
		<p class="sc-form-note" id="si-pub-note" role="status" aria-live="polite"></p>
	</form>`;
}

async function submitPublish(form) {
	const note = $('si-pub-note');
	if (!$('si-pub-confirm').checked) {
		note.textContent = 'Tick the box to confirm you want this public.';
		$('si-pub-confirm').focus();
		return;
	}
	const btn = $('si-pub-save');
	setBusy(btn, true, 'Scanning and publishing…');
	try {
		const { data } = await post('publish', {
			agent_id: state.agentId,
			skill_id: form.dataset.skill,
			license: $('si-pub-license').value,
			category: $('si-pub-cat').value,
			confirm_publish: true,
		});
		note.innerHTML = `Published as <code>${esc(data.slug)}</code>. <a href="${esc(data.url)}" rel="noopener" target="_blank">SKILL.md</a> · <a href="${esc(data.page)}">see it in the registry</a>`;
		setBusy(btn, false);
		loadPublications();
		announce('Skill published');
	} catch (err) {
		setBusy(btn, false);
		const findings = err.body?.findings;
		note.innerHTML = `${esc(err.message)}${findings?.length ? `<ul>${findings.map((f) => `<li>${esc(f.rule)}: ${esc(f.message)}</li>`).join('')}</ul>` : ''}`;
	}
}

async function loadPublications() {
	const list = $('si-pubs');
	try {
		const { data } = await readJson(await apiFetch(`${API}/publications`));
		const live = data.publications.filter((p) => !p.unpublished_at);
		list.innerHTML = live.length
			? live
					.map((p) => `<li><strong>${esc(p.name)}</strong> <code>${esc(p.slug)}</code> <span class="si-muted">${esc(p.license)} · ${esc(CATEGORY_LABELS[p.category] || p.category)}${p.sha256 ? ` · sha256 <code>${esc(short(p.sha256))}</code>` : ''} · updated ${new Date(p.updated_at).toLocaleDateString()}</span>
						<a class="sc-btn sc-btn-sm" href="${API}/published/${esc(p.slug)}/SKILL.md" rel="noopener" target="_blank">SKILL.md</a>
						<button type="button" class="sc-btn sc-btn-sm sc-btn-danger" data-unpublish="${esc(p.slug)}">Unpublish</button></li>`)
					.join('')
			: '<li class="si-muted">Nothing published yet. Publish one of your own skills (or a fork you changed) and anyone can import it.</li>';
	} catch (err) {
		list.innerHTML = `<li class="sc-form-note" role="alert">${esc(err.message)}</li>`;
	}
}

async function unpublish(slug, btn) {
	setBusy(btn, true, 'Unpublishing…');
	try {
		await readJson(await apiFetch(`${API}/publications?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' }));
		loadPublications();
		announce('Unpublished');
	} catch (err) {
		setBusy(btn, false);
		announce(err.message);
	}
}

// ── scan history ───────────────────────────────────────────────────────────

async function showRequests() {
	const list = $('si-requests-list');
	const gate = await agentGate();
	$('si-requests-gate').innerHTML = gate || '';
	if (gate) {
		list.innerHTML = '';
		return;
	}
	list.innerHTML = `<li>${spinner('Loading your scans…')}</li>`;
	try {
		const { data } = await readJson(await apiFetch(`${API}/requests`));
		list.innerHTML = data.requests.length
			? data.requests
					.map((r) => `<li class="si-req">
						<button type="button" class="si-req-hit" data-request-open="${esc(r.id)}" aria-label="Open the scan of ${esc(r.skill.name)}"></button>
						<span class="si-verdict-dot is-${esc(r.verdict)}" aria-hidden="true"></span>
						<strong>${esc(r.skill.name)}</strong>
						<span class="si-muted">${esc(r.provenance.registry?.label || '')} · ${esc(state.agents.find((a) => a.id === r.agent_id)?.name || 'agent')}${r.replaces_skill_id ? ' · update' : ''}</span>
						<span class="si-req-status is-${esc(r.status)}">${esc(r.status)}</span>
						<span class="si-muted">${new Date(r.created_at).toLocaleString()}</span>
					</li>`)
					.join('')
			: `<li>${stateBlock({ title: 'No scans yet', body: 'Open any skill in Browse and scan it. Every scan, approval and refusal is kept here.', actions: '<button type="button" class="sc-btn sc-btn-primary" data-view="browse">Browse skills</button>' })}</li>`;
	} catch (err) {
		list.innerHTML = `<li>${stateBlock({ tone: 'error', title: 'Scans did not load', body: esc(err.message) })}</li>`;
	}
}

// ── views + events ─────────────────────────────────────────────────────────

function setView(view) {
	state.view = view;
	for (const tab of document.querySelectorAll('.sc-tab')) {
		const active = tab.dataset.view === view;
		tab.classList.toggle('is-active', active);
		tab.setAttribute('aria-selected', String(active));
		tab.tabIndex = active ? 0 : -1;
	}
	$('si-browse').hidden = view !== 'browse';
	$('si-installed').hidden = view !== 'installed';
	$('si-requests').hidden = view !== 'requests';
	syncUrl();
	if (view === 'installed') showInstalled();
	if (view === 'requests') showRequests();
}

function closeDialog() {
	const dlg = $('si-dialog');
	if (dlg.open) dlg.close();
}

function bind() {
	let qTimer;
	$('si-q').value = state.q;
	$('si-q').addEventListener('input', (e) => {
		clearTimeout(qTimer);
		qTimer = setTimeout(() => {
			state.q = e.target.value.trim();
			syncUrl();
			if (state.data) {
				renderCategories();
				renderGrid();
			}
		}, 120);
	});
	$('si-registry').addEventListener('change', (e) => {
		state.registry = e.target.value;
		syncUrl();
		renderCategories();
		renderGrid();
		renderExcluded();
	});
	$('si-agent').addEventListener('change', (e) => {
		state.agentId = e.target.value;
		showInstalled();
	});
	$('si-add-toggle').addEventListener('click', () => toggleAdd($('si-add').hidden));
	$('si-add-cancel').addEventListener('click', () => toggleAdd(false));
	$('si-add').addEventListener('submit', addRegistry);
	$('si-dialog-close').addEventListener('click', closeDialog);
	const dlg = $('si-dialog');
	dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
	dlg.addEventListener('close', () => {
		state.openKey = null;
		state.openRequest = null;
		syncUrl();
		if (state.view === 'installed' && state.installed === null) loadInstalled();
		if (state.view === 'requests') showRequests();
	});

	$('si-tab-browse').parentElement.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const views = ['browse', 'installed', 'requests'];
		const next = views[(views.indexOf(state.view) + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length];
		setView(next);
		document.querySelector(`.sc-tab[data-view="${next}"]`).focus();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target;
		if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if (document.querySelector('dialog[open]')) return;
		e.preventDefault();
		if (state.view !== 'browse') setView('browse');
		$('si-q').focus();
	});

	dlg.addEventListener('submit', (e) => {
		e.preventDefault();
		const form = e.target;
		if (form.id === 'si-fork-form') submitFork(form);
		else if (form.id === 'si-publish-form') submitPublish(form);
		else if (form.dataset.request) decide(form.dataset.request, 'approve', form.querySelector('[data-decision="approve"]'));
	});

	document.addEventListener('click', (e) => {
		const el = e.target.closest('[data-skill],[data-category],[data-view],[data-action],[data-scan],[data-decide-refuse],[data-update],[data-fork],[data-publish],[data-unpublish],[data-request-open],[data-remove-registry]');
		if (!el) return;
		const d = el.dataset;
		if (d.skill) openSkill(d.skill);
		else if (d.category !== undefined) {
			state.category = state.category === d.category ? '' : d.category;
			syncUrl();
			renderCategories();
			renderGrid();
		} else if (d.view) {
			closeDialog();
			setView(d.view);
		} else if (d.scan) scanSkill(d.scan, el);
		else if (d.decideRefuse) decide(d.decideRefuse, 'refuse', el);
		else if (d.update) checkUpdate(d.update, el);
		else if (d.fork) openFork(d.fork);
		else if (d.publish) openPublish(d.publish);
		else if (d.unpublish) unpublish(d.unpublish, el);
		else if (d.removeRegistry) removeRegistry(d.removeRegistry, el);
		else if (d.requestOpen) {
			const diff = state.diffs?.[d.requestOpen];
			if (diff) {
				apiFetch(`${API}/requests/${encodeURIComponent(d.requestOpen)}`).then(readJson).then(({ data }) => renderRequest(data.request, { diff }), (err) => announce(err.message));
			} else openRequest(d.requestOpen);
		} else if (d.action === 'reload') loadBrowse();
		else if (d.action === 'reload-installed') loadInstalled();
		else if (d.action === 'add-registry') toggleAdd(true);
		else if (d.action === 'clear-filters') {
			state.q = '';
			state.category = '';
			state.registry = '';
			$('si-q').value = '';
			$('si-registry').value = '';
			syncUrl();
			renderCategories();
			renderGrid();
			renderExcluded();
		}
	});
}

bind();
setView(state.view);
loadBrowse();
