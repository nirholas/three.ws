// /skills/community: browse the community skills registry, preview a skill's
// full SKILL.md, import it onto one of your agents, and manage every custom
// skill on an agent (enable, edit, update from the registry, delete) against
// the agent's prompt budget.
//
// Data:
//   GET  /api/skills/community                      registry (public)
//   GET  /api/skills/community/:slug                one skill + SKILL.md (public)
//   GET  /api/auth/me                               session
//   GET  /api/agents                                the viewer's agents
//   *    /api/agents/:id/custom-skills[/:skillId]   the agent's skills + budget
//
// URL state (shareable, restored on load): ?q= &tag= &author= &skill=<slug>
// &view=mine &agent=<id>.

import { apiFetch, noteSession } from './api.js';
import { renderMarkdown } from './shared/markdown.js';

const $ = (id) => document.getElementById(id);
const MAX_CONTENT = 24000;

const state = {
	registry: null,
	details: new Map(),
	q: '',
	tag: '',
	author: '',
	view: 'browse',
	user: undefined,
	agents: null,
	agentId: '',
	installed: null,
	openSlug: null,
	editing: null,
};

// ── helpers ────────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function announce(msg) {
	const live = $('sc-live');
	live.textContent = '';
	requestAnimationFrame(() => { live.textContent = msg; });
}

function fmtTokens(n) {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
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

function loginHref() {
	return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function syncUrl() {
	const p = new URLSearchParams();
	if (state.q) p.set('q', state.q);
	if (state.tag) p.set('tag', state.tag);
	if (state.author) p.set('author', state.author);
	if (state.openSlug) p.set('skill', state.openSlug);
	if (state.view === 'mine') p.set('view', 'mine');
	if (state.view === 'mine' && state.agentId) p.set('agent', state.agentId);
	const qs = p.toString();
	history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

function stateBlock({ title, body, actions = '' , tone = '' }) {
	return `<div class="sc-state ${tone ? `sc-state-${tone}` : ''}" role="${tone === 'error' ? 'alert' : 'status'}">
		<h3 class="sc-state-title">${title}</h3>
		<p class="sc-state-body">${body}</p>
		${actions ? `<div class="sc-ctas">${actions}</div>` : ''}
	</div>`;
}

// ── session + agents (shared by import and manager) ───────────────────────

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
	return state.agents;
}

// ── browse ─────────────────────────────────────────────────────────────────

function renderSkeleton() {
	$('sc-grid').innerHTML = Array.from({ length: 6 }, () => '<div class="sc-card sc-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>').join('');
}

async function loadRegistry() {
	renderSkeleton();
	$('sc-browse-state').innerHTML = '';
	try {
		state.registry = await readJson(await apiFetch('/api/skills/community?limit=500', { allowAnonymous: true }));
	} catch (err) {
		$('sc-grid').innerHTML = '';
		$('sc-grid').setAttribute('aria-busy', 'false');
		$('sc-browse-state').innerHTML = stateBlock({
			tone: 'error',
			title: 'The registry did not load',
			body: `${esc(err.message)}. Your connection or our API hiccuped; nothing was changed.`,
			actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="retry-registry">Try again</button>',
		});
		return;
	}
	renderStats();
	renderFilters();
	renderGrid();
}

function renderStats() {
	const r = state.registry;
	const scripts = r.skills.filter((s) => s.files.some((f) => f.startsWith('scripts/'))).length;
	$('sc-stats').innerHTML = [
		[r.total, r.total === 1 ? 'skill' : 'skills'],
		[r.tags.length, 'tags'],
		[r.authors.length, r.authors.length === 1 ? 'author' : 'authors'],
		[scripts, 'with runnable scripts'],
	].map(([n, label]) => `<div><dt>${esc(label)}</dt><dd>${n}</dd></div>`).join('');
}

function renderFilters() {
	const r = state.registry;
	const chips = [{ tag: '', count: r.total, label: 'All' }, ...r.tags.map((t) => ({ ...t, label: t.tag }))];
	$('sc-tags').innerHTML = chips
		.map((c) => `<button type="button" class="sc-chip${state.tag === c.tag ? ' is-active' : ''}" data-tag="${esc(c.tag)}" aria-pressed="${state.tag === c.tag}">${esc(c.label)} <span class="sc-chip-count">${c.count}</span></button>`)
		.join('');
	const sel = $('sc-author');
	sel.innerHTML = `<option value="">All authors</option>${r.authors.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}`;
	sel.value = r.authors.includes(state.author) ? state.author : '';
}

function matches(s) {
	if (state.tag && !s.tags.includes(state.tag)) return false;
	if (state.author && s.author !== state.author) return false;
	if (!state.q) return true;
	const hay = `${s.slug} ${s.name} ${s.description} ${s.tags.join(' ')} ${s.author}`.toLowerCase();
	return state.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function cardHtml(s) {
	const hasScripts = s.files.some((f) => f.startsWith('scripts/'));
	return `<article class="sc-card">
		<button type="button" class="sc-card-hit" data-open="${esc(s.slug)}" aria-label="Preview ${esc(s.name)}"></button>
		<header class="sc-card-head">
			<h3 class="sc-card-title">${esc(s.name)}</h3>
			<span class="sc-card-version">v${esc(s.version)}</span>
		</header>
		<p class="sc-card-desc">${esc(s.description)}</p>
		<ul class="sc-card-tags">${s.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
		<footer class="sc-card-foot">
			<span>by ${esc(s.author)}</span>
			<span title="Approximate prompt size">~${fmtTokens(s.tokens)} tokens</span>
			${hasScripts ? '<span class="sc-badge">scripts</span>' : ''}
		</footer>
	</article>`;
}

function renderGrid() {
	const grid = $('sc-grid');
	const list = state.registry.skills.filter(matches);
	grid.setAttribute('aria-busy', 'false');
	grid.innerHTML = list.map(cardHtml).join('');
	$('sc-browse-state').innerHTML = list.length
		? ''
		: stateBlock({
				title: 'No skills match',
				body: `Nothing in the registry matches${state.q ? ` "${esc(state.q)}"` : ''}${state.tag ? ` tagged ${esc(state.tag)}` : ''}${state.author ? ` by ${esc(state.author)}` : ''}. Clear the filters, or write the skill yourself and contribute it.`,
				actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="clear-filters">Clear filters</button><a class="sc-btn" href="https://github.com/nirholas/three.ws/blob/main/community-skills/CONTRIBUTING.md" rel="noopener">Contribute a skill</a>',
			});
	announce(`${list.length} of ${state.registry.total} skills shown`);
}

// ── preview + import ──────────────────────────────────────────────────────

async function skillDetail(slug) {
	if (state.details.has(slug)) return state.details.get(slug);
	const { skill } = await readJson(await apiFetch(`/api/skills/community/${encodeURIComponent(slug)}`, { allowAnonymous: true }));
	state.details.set(slug, skill);
	return skill;
}

async function openPreview(slug) {
	const dlg = $('sc-preview');
	state.openSlug = slug;
	syncUrl();
	$('sc-preview-kicker').textContent = 'Loading…';
	$('sc-preview-title').textContent = slug;
	$('sc-preview-desc').textContent = '';
	$('sc-preview-meta').innerHTML = '';
	$('sc-import').innerHTML = '';
	$('sc-preview-body').innerHTML = '<div class="sc-md-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
	if (!dlg.open) dlg.showModal();
	let skill;
	try {
		skill = await skillDetail(slug);
	} catch (err) {
		$('sc-preview-kicker').textContent = '';
		$('sc-preview-body').innerHTML = stateBlock({
			tone: 'error',
			title: err.status === 404 ? 'That skill is not in the registry' : 'The skill did not load',
			body: err.status === 404 ? 'It may have been renamed or removed. Browse the registry for the current list.' : esc(err.message),
			actions: err.status === 404 ? '' : `<button type="button" class="sc-btn sc-btn-primary" data-open="${esc(slug)}">Try again</button>`,
		});
		return;
	}
	if (state.openSlug !== slug) return;
	$('sc-preview-kicker').textContent = `${skill.slug} · v${skill.version}`;
	$('sc-preview-title').textContent = skill.name;
	$('sc-preview-desc').textContent = skill.description;
	const files = [...skill.scripts, ...skill.references];
	$('sc-preview-meta').innerHTML = `
		<span class="sc-meta">by <strong>${esc(skill.author)}</strong></span>
		<span class="sc-meta">${esc(skill.license)}</span>
		<span class="sc-meta" title="Counted against the agent's prompt budget">~${fmtTokens(skill.tokens)} tokens</span>
		${files.length ? `<span class="sc-meta">${files.map((f) => `<code>${esc(f)}</code>`).join(' ')}</span>` : ''}
		<span class="sc-meta-actions">
			<button type="button" class="sc-btn sc-btn-sm" data-action="copy-skill">Copy SKILL.md</button>
			<a class="sc-btn sc-btn-sm" href="/api/skills/community/${esc(skill.slug)}?format=md" download="${esc(skill.slug)}-SKILL.md">Download</a>
			<a class="sc-btn sc-btn-sm" href="${esc(skill.source_url)}" rel="noopener" target="_blank">Source</a>
		</span>`;
	$('sc-preview-body').innerHTML = renderMarkdown(skill.body, { demoteHeadings: 1 });
	renderImport(skill);
}

function closePreview() {
	const dlg = $('sc-preview');
	if (dlg.open) dlg.close();
}

async function renderImport(skill) {
	const box = $('sc-import');
	box.innerHTML = '<div class="sc-import-row"><span class="sc-spinner" aria-hidden="true"></span> Checking your agents…</div>';
	const user = await loadSession();
	if (state.openSlug !== skill.slug) return;
	if (!user) {
		box.innerHTML = `<div class="sc-import-row"><span>Sign in to import this skill onto one of your agents.</span><a class="sc-btn sc-btn-primary" href="${loginHref()}">Sign in to import</a></div>`;
		return;
	}
	let agents;
	try {
		agents = await loadAgents();
	} catch (err) {
		box.innerHTML = `<div class="sc-import-row sc-import-error"><span>Your agents did not load: ${esc(err.message)}</span><button type="button" class="sc-btn" data-action="retry-import">Try again</button></div>`;
		return;
	}
	if (!agents.length) {
		box.innerHTML = `<div class="sc-import-row"><span>You do not have an agent yet. Create one, then come back to give it this skill.</span><a class="sc-btn sc-btn-primary" href="/create-agent">Create an agent</a></div>`;
		return;
	}
	const preselect = agents.some((a) => a.id === state.agentId) ? state.agentId : agents[0].id;
	box.innerHTML = `<form class="sc-import-row" data-import="${esc(skill.slug)}">
		<label class="sr-only" for="sc-import-agent">Agent to import onto</label>
		<select class="sc-select" id="sc-import-agent">${agents.map((a) => `<option value="${esc(a.id)}"${a.id === preselect ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
		<button type="submit" class="sc-btn sc-btn-primary" id="sc-import-go">Import to agent</button>
	</form>
	<p class="sc-import-note" id="sc-import-note" role="status"></p>`;
}

async function doImport(slug, agentId) {
	const btn = $('sc-import-go');
	const note = $('sc-import-note');
	btn.disabled = true;
	btn.textContent = 'Importing…';
	note.className = 'sc-import-note';
	const agentName = state.agents.find((a) => a.id === agentId)?.name || 'your agent';
	const manage = `<a href="/skills/community?view=mine&agent=${esc(agentId)}" data-manage="${esc(agentId)}">Manage ${esc(agentName)}'s skills</a>`;
	try {
		const { data } = await readJson(await apiFetch(`/api/agents/${agentId}/custom-skills`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ source: 'community', slug }),
		}));
		const { skill, budget } = data;
		if (skill.injected) {
			note.classList.add('is-ok');
			note.innerHTML = `Imported. ${esc(agentName)} follows it from its next reply (${budget.used_tokens.toLocaleString()} of ${budget.cap_tokens.toLocaleString()} tokens used). ${manage}`;
		} else {
			note.classList.add('is-warn');
			note.innerHTML = `Imported, but it does not fit ${esc(agentName)}'s ${budget.cap_tokens.toLocaleString()}-token budget, so it is not active yet. Turn another skill off to make room. ${manage}`;
		}
		announce(`${skill.name} imported onto ${agentName}`);
		if (state.agentId === agentId) state.installed = null;
	} catch (err) {
		note.classList.add(err.code === 'already_installed' ? 'is-warn' : 'is-error');
		note.innerHTML = err.code === 'already_installed'
			? `${esc(agentName)} already has this skill. ${manage}`
			: `${esc(err.message)}${err.code === 'limit_reached' ? ` ${manage}` : ''}`;
	} finally {
		btn.disabled = false;
		btn.textContent = 'Import to agent';
	}
}

async function copySkill() {
	const skill = state.details.get(state.openSlug);
	if (!skill) return;
	const btn = document.querySelector('[data-action="copy-skill"]');
	try {
		await navigator.clipboard.writeText(skill.content);
		btn.textContent = 'Copied';
	} catch {
		btn.textContent = 'Copy blocked';
	}
	setTimeout(() => { btn.textContent = 'Copy SKILL.md'; }, 1600);
}

// ── manager (your agents' skills) ─────────────────────────────────────────

async function showMine() {
	const gate = $('sc-mine-gate');
	const body = $('sc-mine-body');
	body.hidden = true;
	gate.innerHTML = '<div class="sc-installed-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
	const user = await loadSession();
	if (!user) {
		gate.innerHTML = stateBlock({
			title: 'Sign in to manage your agents\' skills',
			body: 'Custom skills belong to an agent you own. Sign in to see what each of your agents has installed and how much of its prompt budget is in use.',
			actions: `<a class="sc-btn sc-btn-primary" href="${loginHref()}">Sign in</a>`,
		});
		return;
	}
	let agents;
	try {
		agents = await loadAgents();
	} catch (err) {
		gate.innerHTML = stateBlock({ tone: 'error', title: 'Your agents did not load', body: esc(err.message), actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="retry-mine">Try again</button>' });
		return;
	}
	if (!agents.length) {
		gate.innerHTML = stateBlock({
			title: 'No agents yet',
			body: 'Skills are installed on an agent. Create your first agent, then import skills from the registry or write your own.',
			actions: '<a class="sc-btn sc-btn-primary" href="/create-agent">Create an agent</a><button type="button" class="sc-btn" data-view="browse">Browse skills</button>',
		});
		return;
	}
	gate.innerHTML = '';
	body.hidden = false;
	if (!agents.some((a) => a.id === state.agentId)) state.agentId = agents[0].id;
	$('sc-agent').innerHTML = agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
	$('sc-agent').value = state.agentId;
	syncUrl();
	await loadInstalled();
}

async function loadInstalled() {
	const list = $('sc-installed');
	list.innerHTML = '<li class="sc-installed-skeleton" aria-hidden="true"><span></span><span></span><span></span></li>';
	$('sc-budget').innerHTML = '';
	const agentId = state.agentId;
	try {
		const { data } = await readJson(await apiFetch(`/api/agents/${agentId}/custom-skills`));
		if (agentId !== state.agentId) return;
		state.installed = data;
		renderInstalled();
	} catch (err) {
		list.innerHTML = `<li>${stateBlock({ tone: 'error', title: 'This agent\'s skills did not load', body: esc(err.message), actions: '<button type="button" class="sc-btn sc-btn-primary" data-action="retry-installed">Try again</button>' })}</li>`;
	}
}

function renderBudget(budget, count) {
	const pct = Math.min(100, Math.round((budget.used_tokens / budget.cap_tokens) * 100));
	const over = budget.skipped_over_budget.length;
	const tone = over ? 'is-over' : pct >= 85 ? 'is-high' : '';
	$('sc-budget').innerHTML = `
		<div class="sc-budget-head">
			<span><strong>${budget.used_tokens.toLocaleString()}</strong> of ${budget.cap_tokens.toLocaleString()} prompt tokens in use</span>
			<span>${budget.injected_count} of ${count} skill${count === 1 ? '' : 's'} active</span>
		</div>
		<div class="sc-meter ${tone}" role="meter" aria-valuemin="0" aria-valuemax="${budget.cap_tokens}" aria-valuenow="${budget.used_tokens}" aria-label="Prompt budget used">
			<span style="transform: scaleX(${pct / 100})"></span>
		</div>
		<p class="sc-budget-note">${over
			? `${over} enabled skill${over === 1 ? ' does' : 's do'} not fit and ${over === 1 ? 'is' : 'are'} skipped. Skills load oldest first; turn one off to make room.`
			: 'Enabled skills load into the agent\'s prompt oldest first. A skill that would overflow the budget is skipped whole, never cut off.'}</p>`;
}

function installedHtml(s, i) {
	const status = s.injected
		? '<span class="sc-status is-on">Active</span>'
		: s.skip_reason === 'over_budget'
			? '<span class="sc-status is-over" title="Enabled, but it does not fit the prompt budget">Over budget</span>'
			: '<span class="sc-status">Off</span>';
	const update = s.registry?.update_available
		? `<button type="button" class="sc-btn sc-btn-sm" data-resync="${esc(s.id)}" title="Replace with the latest registry version ${esc(s.registry.latest_version)}">Update to v${esc(s.registry.latest_version)}</button>`
		: '';
	const origin = s.source === 'community'
		? `<a href="/skills/community?skill=${esc(s.source_slug)}" data-open="${esc(s.source_slug)}">from the registry</a>${s.registry?.removed ? ' (no longer listed)' : ''}`
		: 'written by you';
	return `<li class="sc-item${s.enabled ? '' : ' is-disabled'}" data-id="${esc(s.id)}">
		<span class="sc-item-order" aria-hidden="true">${i + 1}</span>
		<div class="sc-item-main">
			<div class="sc-item-head">
				<h3 class="sc-item-title">${esc(s.name)}</h3>
				${status}
			</div>
			<p class="sc-item-meta">v${esc(s.version)} · ~${fmtTokens(s.tokens)} tokens · ${origin}</p>
			${s.description ? `<p class="sc-item-desc">${esc(s.description)}</p>` : ''}
		</div>
		<div class="sc-item-actions">
			<label class="sc-switch">
				<input type="checkbox" role="switch" data-toggle="${esc(s.id)}" ${s.enabled ? 'checked' : ''} aria-label="${s.enabled ? 'Disable' : 'Enable'} ${esc(s.name)}" />
				<span aria-hidden="true"></span>
			</label>
			${update}
			<button type="button" class="sc-btn sc-btn-sm" data-edit="${esc(s.id)}">Edit</button>
			<button type="button" class="sc-btn sc-btn-sm sc-btn-danger" data-delete="${esc(s.id)}">Delete</button>
		</div>
	</li>`;
}

function renderInstalled() {
	const { skills, budget } = state.installed;
	renderBudget(budget, skills.length);
	const list = $('sc-installed');
	if (!skills.length) {
		list.innerHTML = `<li>${stateBlock({
			title: 'No custom skills on this agent',
			body: 'Import one from the registry, or write your own instructions. They apply to this agent\'s very next reply.',
			actions: '<button type="button" class="sc-btn sc-btn-primary" data-view="browse">Browse the registry</button><button type="button" class="sc-btn" data-action="new-skill">Write a custom skill</button>',
		})}</li>`;
		return;
	}
	list.innerHTML = skills.map(installedHtml).join('');
}

async function mutate(path, init, { success }) {
	const res = await apiFetch(path, { headers: { 'content-type': 'application/json' }, ...init });
	const { data } = await readJson(res);
	state.installed = { skills: data.skills ?? state.installed.skills, budget: data.budget ?? state.installed.budget };
	if (!data.skills) await loadInstalled();
	else renderInstalled();
	if (success) announce(success);
	return data;
}

async function toggleSkill(id, enabled, input) {
	input.disabled = true;
	try {
		await mutate(`/api/agents/${state.agentId}/custom-skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }, { success: enabled ? 'Skill enabled' : 'Skill disabled' });
	} catch (err) {
		input.checked = !enabled;
		input.disabled = false;
		announce(`Could not update the skill: ${err.message}`);
		flashItemError(id, err.message);
	}
}

async function resyncSkill(id, btn) {
	btn.disabled = true;
	btn.textContent = 'Updating…';
	try {
		await mutate(`/api/agents/${state.agentId}/custom-skills/${id}`, { method: 'PATCH', body: JSON.stringify({ resync: true }) }, { success: 'Skill updated to the latest registry version' });
	} catch (err) {
		btn.disabled = false;
		btn.textContent = 'Retry update';
		flashItemError(id, err.message);
	}
}

// Delete is irreversible, so it takes two presses: the first arms the button
// for a few seconds and says so, the second deletes.
function armDelete(id, btn) {
	if (btn.dataset.armed === '1') return deleteSkill(id, btn);
	btn.dataset.armed = '1';
	btn.textContent = 'Press again to delete';
	btn.classList.add('is-armed');
	setTimeout(() => {
		if (!btn.isConnected || btn.dataset.armed !== '1') return;
		btn.dataset.armed = '';
		btn.textContent = 'Delete';
		btn.classList.remove('is-armed');
	}, 4000);
}

async function deleteSkill(id, btn) {
	btn.disabled = true;
	btn.textContent = 'Deleting…';
	try {
		await mutate(`/api/agents/${state.agentId}/custom-skills/${id}`, { method: 'DELETE' }, { success: 'Skill deleted' });
	} catch (err) {
		btn.disabled = false;
		btn.textContent = 'Delete';
		btn.dataset.armed = '';
		flashItemError(id, err.message);
	}
}

function flashItemError(id, message) {
	const item = document.querySelector(`.sc-item[data-id="${CSS.escape(id)}"]`);
	if (!item) return;
	item.querySelector('.sc-item-error')?.remove();
	item.querySelector('.sc-item-main').insertAdjacentHTML('beforeend', `<p class="sc-item-error" role="alert">${esc(message)}</p>`);
}

function bindCounter(textarea, counter) {
	const update = () => {
		const n = textarea.value.length;
		counter.textContent = `${n.toLocaleString()} / ${MAX_CONTENT.toLocaleString()} characters · ~${fmtTokens(Math.ceil(n / 4))} tokens`;
		counter.classList.toggle('is-high', n > MAX_CONTENT * 0.9);
	};
	textarea.addEventListener('input', update);
	update();
}

function toggleNewForm(open) {
	const form = $('sc-new');
	form.hidden = !open;
	$('sc-new-toggle').setAttribute('aria-expanded', String(open));
	$('sc-new-note').textContent = '';
	if (open) $('sc-new-name').focus();
}

async function submitNew(e) {
	e.preventDefault();
	const name = $('sc-new-name').value.trim();
	const content = $('sc-new-content').value.trim();
	const note = $('sc-new-note');
	note.className = 'sc-form-note';
	if (name.length < 2) { note.classList.add('is-error'); note.textContent = 'Give the skill a name of at least 2 characters.'; $('sc-new-name').focus(); return; }
	if (!content) { note.classList.add('is-error'); note.textContent = 'Write the instructions the agent should follow.'; $('sc-new-content').focus(); return; }
	const btn = $('sc-new-save');
	btn.disabled = true;
	btn.textContent = 'Saving…';
	try {
		const data = await mutate(`/api/agents/${state.agentId}/custom-skills`, {
			method: 'POST',
			body: JSON.stringify({ name, description: $('sc-new-desc').value.trim(), content }),
		}, { success: 'Custom skill saved' });
		$('sc-new').reset();
		bindCounter($('sc-new-content'), $('sc-new-count'));
		toggleNewForm(false);
		if (data.skill && !data.skill.injected && data.skill.skip_reason === 'over_budget') announce('Saved, but it does not fit the prompt budget yet');
	} catch (err) {
		note.classList.add('is-error');
		note.textContent = err.message;
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save skill';
	}
}

function openEditor(id) {
	const skill = state.installed?.skills.find((s) => s.id === id);
	if (!skill) return;
	state.editing = id;
	$('sc-edit-name').value = skill.name;
	$('sc-edit-desc').value = skill.description || '';
	$('sc-edit-content').value = skill.content;
	$('sc-edit-note').textContent = '';
	$('sc-edit-title').textContent = `Edit ${skill.name}`;
	bindCounter($('sc-edit-content'), $('sc-edit-count'));
	$('sc-edit').showModal();
}

async function submitEdit(e) {
	e.preventDefault();
	const note = $('sc-edit-note');
	note.className = 'sc-form-note';
	const name = $('sc-edit-name').value.trim();
	const content = $('sc-edit-content').value.trim();
	if (name.length < 2 || !content) {
		note.classList.add('is-error');
		note.textContent = 'A skill needs a name of at least 2 characters and some instructions.';
		return;
	}
	const btn = $('sc-edit-save');
	btn.disabled = true;
	btn.textContent = 'Saving…';
	try {
		await mutate(`/api/agents/${state.agentId}/custom-skills/${state.editing}`, {
			method: 'PATCH',
			body: JSON.stringify({ name, description: $('sc-edit-desc').value.trim(), content }),
		}, { success: 'Skill saved' });
		$('sc-edit').close();
	} catch (err) {
		note.classList.add('is-error');
		note.textContent = err.message;
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save changes';
	}
}

// ── view switching ────────────────────────────────────────────────────────

function setView(view) {
	state.view = view;
	for (const tab of document.querySelectorAll('.sc-tab')) {
		const active = tab.dataset.view === view;
		tab.classList.toggle('is-active', active);
		tab.setAttribute('aria-selected', String(active));
		tab.tabIndex = active ? 0 : -1;
	}
	$('sc-browse').hidden = view !== 'browse';
	$('sc-mine').hidden = view !== 'mine';
	syncUrl();
	if (view === 'mine') showMine();
}

// ── events ────────────────────────────────────────────────────────────────

function bind() {
	let searchTimer;
	$('sc-q').addEventListener('input', (e) => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.q = e.target.value.trim();
			syncUrl();
			if (state.registry) renderGrid();
		}, 120);
	});
	$('sc-author').addEventListener('change', (e) => {
		state.author = e.target.value;
		syncUrl();
		renderGrid();
	});
	$('sc-agent').addEventListener('change', (e) => {
		state.agentId = e.target.value;
		syncUrl();
		loadInstalled();
	});
	$('sc-new-toggle').addEventListener('click', () => toggleNewForm($('sc-new').hidden));
	$('sc-new-cancel').addEventListener('click', () => toggleNewForm(false));
	$('sc-new').addEventListener('submit', submitNew);
	$('sc-edit-form').addEventListener('submit', submitEdit);
	$('sc-edit-close').addEventListener('click', () => $('sc-edit').close());
	$('sc-edit-cancel').addEventListener('click', () => $('sc-edit').close());
	$('sc-preview-close').addEventListener('click', closePreview);
	$('sc-preview').addEventListener('close', () => {
		state.openSlug = null;
		syncUrl();
	});
	for (const dlg of [$('sc-preview'), $('sc-edit')]) {
		// A click on the backdrop lands on the <dialog> itself.
		dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
	}
	bindCounter($('sc-new-content'), $('sc-new-count'));

	// Keyboard: tabs move with arrow keys; "/" focuses search.
	$('sc-tab-browse').parentElement.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const next = state.view === 'browse' ? 'mine' : 'browse';
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
		$('sc-q').focus();
	});

	document.addEventListener('click', (e) => {
		const el = e.target.closest('[data-open],[data-tag],[data-view],[data-action],[data-edit],[data-delete],[data-resync],[data-manage]');
		if (!el) return;
		if (el.dataset.manage) {
			e.preventDefault();
			closePreview();
			state.agentId = el.dataset.manage;
			state.installed = null;
			setView('mine');
			return;
		}
		if (el.dataset.open) {
			e.preventDefault();
			openPreview(el.dataset.open);
		} else if (el.dataset.tag !== undefined) {
			state.tag = state.tag === el.dataset.tag ? '' : el.dataset.tag;
			syncUrl();
			renderFilters();
			renderGrid();
		} else if (el.dataset.view) {
			setView(el.dataset.view);
		} else if (el.dataset.edit) {
			openEditor(el.dataset.edit);
		} else if (el.dataset.delete) {
			armDelete(el.dataset.delete, el);
		} else if (el.dataset.resync) {
			resyncSkill(el.dataset.resync, el);
		} else {
			const action = el.dataset.action;
			if (action === 'retry-registry') loadRegistry();
			else if (action === 'clear-filters') {
				state.q = state.tag = state.author = '';
				$('sc-q').value = '';
				syncUrl();
				renderFilters();
				renderGrid();
			} else if (action === 'copy-skill') copySkill();
			else if (action === 'retry-import') renderImport(state.details.get(state.openSlug));
			else if (action === 'retry-mine') { state.agents = null; showMine(); }
			else if (action === 'retry-installed') loadInstalled();
			else if (action === 'new-skill') toggleNewForm(true);
		}
	});

	document.addEventListener('change', (e) => {
		const input = e.target.closest('[data-toggle]');
		if (input) toggleSkill(input.dataset.toggle, input.checked, input);
	});

	document.addEventListener('submit', (e) => {
		const form = e.target.closest('[data-import]');
		if (!form) return;
		e.preventDefault();
		doImport(form.dataset.import, $('sc-import-agent').value);
	});
}

// ── boot ──────────────────────────────────────────────────────────────────

function readUrl() {
	const p = new URLSearchParams(location.search);
	state.q = (p.get('q') || '').trim();
	state.tag = (p.get('tag') || '').trim().toLowerCase();
	state.author = (p.get('author') || '').trim();
	state.agentId = p.get('agent') || '';
	$('sc-q').value = state.q;
	return { skill: p.get('skill'), view: p.get('view') === 'mine' || p.get('agent') ? 'mine' : 'browse' };
}

bind();
const initial = readUrl();
loadRegistry();
setView(initial.view);
if (initial.skill) openPreview(initial.skill);
