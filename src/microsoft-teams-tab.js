/**
 * /microsoft/teams-tab: the "Agents" personal tab of the three.ws Teams app
 * (integrations/microsoft/copilot-teams/manifest.template.json).
 *
 * Teams and the other Microsoft 365 hosts load this page in an iframe, where
 * third-party cookies are unreliable, so it needs no session: everything it
 * shows is public.
 *   - The list is /api/agents/public with avatar=1 (only agents with a 3D body
 *     anyone may load), popular first, or the search results for the box.
 *   - The stage is a live <agent-3d agent-id>, the same embed any site uses.
 *   - The stats are the Glance card (/api/glance/card), the same numbers the
 *     Teams message extension and the Windows widget board show.
 * The agent shown on open is, in order: ?agent= in the URL, the agent this
 * person last picked in the tab (localStorage), then the most popular one.
 */

import './microsoft-teams-tab.css';
import { resolveDevR2Url } from './shared/dev-r2-proxy.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_KEY = 'twx_teams_tab_agent';
const LIST_LIMIT = 24;
const SEARCH_DEBOUNCE_MS = 250;
const TIMEOUT_MS = 10_000;

const $ = (id) => document.getElementById(id);
const els = {
	form: $('tt-search'),
	q: $('tt-q'),
	live: $('tt-live'),
	stage: $('tt-stage'),
	stageSkel: $('tt-stage-skel'),
	stageNote: $('tt-stage-note'),
	card: $('tt-card'),
	listTitle: $('tt-list-title'),
	list: $('tt-list'),
	empty: $('tt-empty'),
};

const state = { agentId: null, agents: [], query: '', searchSeq: 0, cardSeq: 0 };

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function announce(text) {
	els.live.textContent = text;
}

function readStored() {
	try {
		const id = localStorage.getItem(STORE_KEY);
		return id && UUID_RE.test(id) ? id : null;
	} catch {
		return null;
	}
}

function store(id) {
	try {
		localStorage.setItem(STORE_KEY, id);
	} catch {
		// Storage is blocked in some Teams webviews; the tab still works, it just
		// opens on the popular agent next time.
	}
}

async function getJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const err = new Error(body?.error_description || `${res.status}`);
		err.status = res.status;
		throw err;
	}
	return body;
}

// ── List ─────────────────────────────────────────────────────────────────────

function thumbHtml(agent) {
	if (agent.avatar_thumbnail) {
		return `<img class="tt-thumb" src="${esc(resolveDevR2Url(agent.avatar_thumbnail))}" alt="" loading="lazy" decoding="async" />`;
	}
	return `<span class="tt-thumb" aria-hidden="true">${esc((agent.name || '?').trim().charAt(0).toUpperCase())}</span>`;
}

function renderList() {
	els.list.removeAttribute('aria-busy');
	els.list.innerHTML = state.agents.map((a) => `
		<li>
			<button type="button" class="tt-item" data-id="${esc(a.id)}" aria-current="${a.id === state.agentId}">
				${thumbHtml(a)}
				<span class="tt-item-text">
					<span class="tt-item-name">${esc(a.name || 'Unnamed agent')}</span>
					${a.description ? `<span class="tt-item-desc">${esc(a.description)}</span>` : ''}
				</span>
			</button>
		</li>`).join('');
	for (const img of els.list.querySelectorAll('img.tt-thumb')) {
		img.addEventListener('error', () => {
			const span = document.createElement('span');
			span.className = 'tt-thumb';
			span.setAttribute('aria-hidden', 'true');
			span.textContent = (img.closest('.tt-item')?.querySelector('.tt-item-name')?.textContent || '?').charAt(0).toUpperCase();
			img.replaceWith(span);
		}, { once: true });
	}
}

function renderListEmpty(html) {
	els.list.removeAttribute('aria-busy');
	els.list.innerHTML = '';
	els.empty.innerHTML = html;
	els.empty.hidden = false;
}

async function loadList(query) {
	const seq = ++state.searchSeq;
	state.query = query;
	els.empty.hidden = true;
	els.list.setAttribute('aria-busy', 'true');
	els.listTitle.textContent = query ? `Agents matching "${query}"` : 'Popular agents';
	const params = new URLSearchParams({ avatar: '1', sort: 'popular', limit: String(LIST_LIMIT) });
	if (query) params.set('q', query);
	let body;
	try {
		body = await getJson(`/api/agents/public?${params}`);
	} catch (err) {
		if (seq !== state.searchSeq) return [];
		const wait = err.status === 429 ? 'Too many searches in a row. Wait a few seconds, then search again.' : 'The agent directory did not answer. Check your connection, then search again.';
		renderListEmpty(`<p>${esc(wait)}</p><p><button type="button" class="tt-btn is-ghost" data-retry>Try again</button></p>`);
		announce(wait);
		return [];
	}
	if (seq !== state.searchSeq) return [];
	state.agents = Array.isArray(body?.agents) ? body.agents : [];
	if (!state.agents.length) {
		renderListEmpty(query
			? `<p>No agent with a 3D body matches "${esc(query)}".</p><p>Try a shorter name, or <a href="https://three.ws/agents" target="_blank" rel="noopener">browse every agent on three.ws</a>.</p>`
			: '<p>No public agents with a 3D body yet.</p><p><a href="https://three.ws/create" target="_blank" rel="noopener">Create the first one on three.ws</a>.</p>');
		announce(query ? `No agents match ${query}.` : 'No public agents yet.');
		return [];
	}
	renderList();
	announce(`${state.agents.length} agent${state.agents.length === 1 ? '' : 's'} listed.`);
	return state.agents;
}

// ── Stage and card ───────────────────────────────────────────────────────────

let elementReady = null;
function loadElement() {
	elementReady ??= import('./element.js').then(() => true, () => false);
	return elementReady;
}

function stageNote(title, text) {
	els.stageSkel.hidden = true;
	els.stageNote.innerHTML = `<strong>${esc(title)}</strong><span>${esc(text)}</span>`;
	els.stageNote.hidden = false;
}

async function mountStage(id) {
	els.stage.querySelector('agent-3d')?.remove();
	els.stageNote.hidden = true;
	els.stageSkel.hidden = false;
	if (!(await loadElement())) {
		stageNote('The 3D viewer did not load', 'Reload the tab. If it keeps happening, your network may be blocking three.ws scripts.');
		return;
	}
	if (state.agentId !== id) return;
	const el = document.createElement('agent-3d');
	el.setAttribute('agent-id', id);
	el.setAttribute('mode', 'inline');
	el.setAttribute('responsive', '');
	el.setAttribute('background', 'transparent');
	el.setAttribute('name-plate', 'off');
	el.setAttribute('aria-label', 'Selected agent in 3D');
	el.addEventListener('agent:ready', () => {
		el.classList.add('is-ready');
		els.stageSkel.hidden = true;
	}, { once: true });
	el.addEventListener('agent:error', () => {
		el.remove();
		stageNote('This agent could not be shown in 3D', 'Its body may have been made private. Pick another agent from the list.');
	}, { once: true });
	els.stage.append(el);
}

function statsHtml(card) {
	const stats = [card.metric, ...(Array.isArray(card.stats) ? card.stats : [])].filter((s) => s && s.label);
	if (!stats.length) return '';
	return `<dl class="tt-stats">${stats.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(Number.isFinite(s.value) ? s.value.toLocaleString() : s.value)}</dd></div>`).join('')}</dl>`;
}

async function loadCard(id) {
	const seq = ++state.cardSeq;
	els.card.setAttribute('aria-busy', 'true');
	els.card.innerHTML = '<div class="tt-skel is-line"></div><div class="tt-skel is-line is-short"></div>';
	let card;
	try {
		card = await getJson(`/api/glance/card?agent=${encodeURIComponent(id)}&format=json`);
	} catch (err) {
		if (seq !== state.cardSeq) return;
		els.card.removeAttribute('aria-busy');
		els.card.innerHTML = err.status === 404
			? '<p class="tt-headline">This agent is no longer on three.ws. Pick another one from the list.</p>'
			: `<p class="tt-headline">Live numbers for this agent did not load. <button type="button" class="tt-btn is-ghost" data-card-retry>Try again</button></p>`;
		return;
	}
	if (seq !== state.cardSeq) return;
	els.card.removeAttribute('aria-busy');
	const url = `https://three.ws/agents/${encodeURIComponent(id)}`;
	els.card.innerHTML = `
		<div class="tt-card-top">
			<div>
				<h1>${esc(card.name)}</h1>
				${card.headline ? `<p class="tt-headline">${esc(card.headline)}${card.lastAction?.relative ? ` Last move ${esc(card.lastAction.relative)}.` : ''}</p>` : ''}
			</div>
			<a class="tt-btn" href="${esc(url)}" target="_blank" rel="noopener">Open on three.ws</a>
		</div>
		${card.description ? `<p class="tt-desc">${esc(card.description)}</p>` : ''}
		${statsHtml(card)}`;
	announce(`Showing ${card.name}.`);
}

function select(id, { remember = true } = {}) {
	if (!UUID_RE.test(id || '')) return;
	state.agentId = id;
	if (remember) store(id);
	for (const btn of els.list.querySelectorAll('.tt-item')) btn.setAttribute('aria-current', String(btn.dataset.id === id));
	const url = new URL(location.href);
	url.searchParams.set('agent', id);
	history.replaceState(null, '', url);
	mountStage(id);
	loadCard(id);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

els.list.addEventListener('click', (e) => {
	const btn = e.target.closest('.tt-item');
	if (btn) select(btn.dataset.id);
});

els.empty.addEventListener('click', (e) => {
	if (e.target.closest('[data-retry]')) loadList(state.query);
});

els.card.addEventListener('click', (e) => {
	if (e.target.closest('[data-card-retry]') && state.agentId) loadCard(state.agentId);
});

let debounce = 0;
els.q.addEventListener('input', () => {
	clearTimeout(debounce);
	const q = els.q.value.trim();
	debounce = setTimeout(() => {
		if (q !== state.query) loadList(q);
	}, SEARCH_DEBOUNCE_MS);
});

els.form.addEventListener('submit', (e) => {
	e.preventDefault();
	clearTimeout(debounce);
	loadList(els.q.value.trim());
});

async function boot() {
	const fromUrl = new URLSearchParams(location.search).get('agent');
	const initial = UUID_RE.test(fromUrl || '') ? fromUrl : readStored();
	if (initial) select(initial, { remember: Boolean(fromUrl) });
	const agents = await loadList('');
	if (!initial) {
		if (agents.length) select(agents[0].id, { remember: false });
		else {
			stageNote('No agent to show yet', 'Search for an agent above, or create one on three.ws.');
			els.card.removeAttribute('aria-busy');
			els.card.innerHTML = '<p class="tt-headline">Agents with a public 3D body appear here.</p>';
		}
	}
}

boot();
