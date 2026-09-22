// The agent list every view shares, and which agent is selected. One fetch
// feeds Agents, Chat, Runs and Wallet, and picking an agent in one view keeps
// it picked in the others (remembered across launches when storage allows).

import { html } from './dom.js';

const KEY = 'console:selected-agent';

export function createAgentStore(bridge, storage = globalThis.localStorage) {
	let agents = null;
	let inflight = null;
	let selected = null;
	try {
		selected = storage?.getItem(KEY) || null;
	} catch {
		selected = null;
	}

	async function load(force = false) {
		if (agents && !force) return agents;
		if (inflight) return inflight;
		inflight = bridge.agents.list().then((list) => {
			agents = list;
			if (!agents.some((a) => a.id === selected)) selected = agents[0]?.id || null;
			return agents;
		}).finally(() => {
			inflight = null;
		});
		return inflight;
	}

	function select(id) {
		if (!agents?.some((a) => a.id === id)) return;
		selected = id;
		try {
			storage?.setItem(KEY, id);
		} catch {
			// Storage blocked: the selection lasts for this session only.
		}
	}

	function replace(agent) {
		if (!agents) return;
		agents = agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a));
	}

	return {
		load,
		select,
		replace,
		reset: () => {
			agents = null;
		},
		list: () => agents || [],
		selectedId: () => selected,
		selected: () => agents?.find((a) => a.id === selected) || null,
	};
}

export function agentPicker(agents, selectedId, label = 'Agent') {
	return html`<label class="sr-label" hidden for="agent-picker">${label}</label>
		<select class="select" id="agent-picker" data-role="agent-picker" aria-label="${label}">
			${agents.map((a) => html`<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.name}</option>`)}
		</select>`;
}

// Wires a view's agent picker to the shared store.
export function bindPicker(root, store, onPick) {
	const listener = (event) => {
		if (event.target?.dataset?.role !== 'agent-picker') return;
		store.select(event.target.value);
		onPick(event.target.value);
	};
	root.addEventListener('change', listener);
	return () => root.removeEventListener('change', listener);
}
