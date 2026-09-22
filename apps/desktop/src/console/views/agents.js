// Agents: every agent on the account, searchable and sortable, each one a
// jump-off into chat, runs, its wallet, or its public page.

import { html, mount, onAction, emptyState, errorState, avatar } from '../lib/dom.js';
import { relativeTime, shortAddress } from '../../shared/normalize.js';

const SORTS = {
	recent: (a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0),
	name: (a, b) => a.name.localeCompare(b.name),
};

export function statusChip(agent) {
	if (agent.status === 'running') return html`<span class="chip chip-ok">Running</span>`;
	if (agent.status === 'stopped') return html`<span class="chip chip-warn">Stopped</span>`;
	if (agent.status === 'draft' || !agent.isPublished) return html`<span class="chip">Draft</span>`;
	return html`<span class="chip chip-info">Live</span>`;
}

export function agentCard(agent, { v1 = false } = {}) {
	const page = agent.homeUrl || `/agents/${encodeURIComponent(agent.id)}`;
	return html`<article class="card agent-card" data-agent="${agent.id}">
		<div class="agent-top">
			${avatar(agent)}
			<div class="meta">
				<h3 title="${agent.name}">${agent.name}</h3>
				<div class="sub">${statusChip(agent)}${agent.solanaAddress ? html`<span class="mono" title="${agent.solanaAddress}">${shortAddress(agent.solanaAddress)}</span>` : ''}</div>
			</div>
		</div>
		<p class="agent-desc">${agent.description || 'No description yet. Give this agent a persona on three.ws.'}</p>
		<div class="agent-actions">
			<button type="button" class="btn btn-sm btn-primary" data-action="chat" data-id="${agent.id}">Chat</button>
			<button type="button" class="btn btn-sm" data-action="runs" data-id="${agent.id}">Runs</button>
			<button type="button" class="btn btn-sm" data-action="wallet" data-id="${agent.id}">Wallet</button>
			${v1 && agent.status ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="toggle" data-id="${agent.id}" data-running="${agent.status === 'running'}">${agent.status === 'running' ? 'Stop' : 'Start'}</button>` : ''}
			<button type="button" class="btn btn-sm btn-ghost btn-icon" data-action="open" data-href="${page}" aria-label="Open ${agent.name} on three.ws" title="Open on three.ws"><span class="ico ico-out" aria-hidden="true"></span></button>
		</div>
		${agent.updatedAt ? html`<div class="sub" style="font-size:11.5px;color:var(--dim)">Updated ${relativeTime(agent.updatedAt)}</div>` : ''}
	</article>`;
}

export function filterAgents(list, query, sort = 'recent') {
	const q = String(query || '').trim().toLowerCase();
	const filtered = q ? list.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || (a.solanaAddress || '').toLowerCase().includes(q)) : list.slice();
	return filtered.sort(SORTS[sort] || SORTS.recent);
}

export function mountAgents(root, ctx) {
	const { bridge, agents, navigate, toast } = ctx;
	let state = { phase: 'loading', error: null, query: '', sort: 'recent', v1: false };

	function skeleton() {
		return html`<div class="grid">${Array.from({ length: 6 }, () => html`<div class="card agent-card" aria-hidden="true">
			<div class="agent-top"><div class="sk sk-avatar"></div><div class="meta"><div class="sk sk-line sk-title"></div><div class="sk sk-line" style="width:40%"></div></div></div>
			<div><div class="sk sk-line"></div><div class="sk sk-line" style="width:70%"></div></div>
			<div class="agent-actions"><div class="sk" style="width:60px;height:28px"></div><div class="sk" style="width:60px;height:28px"></div></div>
		</div>`)}</div>`;
	}

	function body() {
		if (state.phase === 'loading') return skeleton();
		if (state.phase === 'error') return errorState(state.error, { title: 'Your agents could not load' });
		const list = agents.list();
		if (!list.length) {
			return emptyState({
				icon: 'agents',
				title: 'No agents yet',
				message: 'An agent is an AI with its own 3D body, persona and Solana wallet. Create your first one on three.ws and it appears here.',
				actions: [{ action: 'create', label: 'Create an agent', primary: true }, { action: 'retry', label: 'Refresh' }],
			});
		}
		const shown = filterAgents(list, state.query, state.sort);
		return html`<div class="toolbar">
				<input class="input" type="search" id="agent-search" placeholder="Search agents" aria-label="Search agents" value="${state.query}" />
				<select class="select" id="agent-sort" aria-label="Sort agents">
					<option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Recently updated</option>
					<option value="name" ${state.sort === 'name' ? 'selected' : ''}>Name</option>
				</select>
				<span style="color:var(--dim);font-size:12.5px">${shown.length} of ${list.length}</span>
			</div>
			${shown.length
				? html`<div class="grid">${shown.map((a) => agentCard(a, { v1: state.v1 }))}</div>`
				: emptyState({ icon: 'empty', title: 'No agent matches', message: `Nothing matches "${state.query}". Try a name, a word from a description, or a wallet address.` })}`;
	}

	function render() {
		mount(root, html`<div class="view">
			<header class="head">
				<div><h1>Agents</h1><p>Everything you run on three.ws, in one place.</p></div>
				<div class="head-actions">
					<button type="button" class="btn btn-ghost" data-action="retry" aria-label="Refresh agents"><span class="ico ico-refresh" aria-hidden="true"></span>Refresh</button>
					<button type="button" class="btn btn-primary" data-action="create">New agent</button>
				</div>
			</header>
			<div id="agents-body">${body()}</div>
		</div>`);
		const search = root.querySelector('#agent-search');
		search?.addEventListener('input', (e) => {
			state.query = e.target.value;
			const pos = e.target.selectionStart;
			render();
			const next = root.querySelector('#agent-search');
			next.focus();
			next.setSelectionRange(pos, pos);
		});
		root.querySelector('#agent-sort')?.addEventListener('change', (e) => {
			state.sort = e.target.value;
			render();
		});
	}

	async function load(force) {
		state.phase = 'loading';
		render();
		try {
			const [, caps] = await Promise.all([agents.load(force), bridge.capabilities().catch(() => ({ v1: false }))]);
			state = { ...state, phase: 'ready', v1: Boolean(caps?.v1) };
		} catch (err) {
			state = { ...state, phase: 'error', error: err };
		}
		render();
	}

	const go = (view) => (el) => {
		agents.select(el.dataset.id);
		navigate(view);
	};

	const off = onAction(root, {
		retry: () => load(true),
		create: () => bridge.app.openExternal('/create'),
		chat: go('chat'),
		runs: go('runs'),
		wallet: go('wallet'),
		open: (el) => bridge.app.openExternal(el.dataset.href),
		toggle: async (el) => {
			const running = el.dataset.running === 'true';
			el.disabled = true;
			try {
				const updated = await bridge.agents.setStatus(el.dataset.id, !running);
				agents.replace(updated);
				toast(running ? 'Agent stopped. Its automations and runs are paused.' : 'Agent started.', 'ok');
				render();
			} catch (err) {
				toast(err.message, 'bad');
				el.disabled = false;
			}
		},
	});

	load(false);
	return off;
}
