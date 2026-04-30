<script>
	import { createEventDispatcher } from 'svelte';
	import { localAgentId } from './stores.js';

	const dispatch = createEventDispatcher();

	let query = '';
	let agents = [];
	let loading = false;
	let debounceTimer;

	async function search(q) {
		loading = true;
		try {
			const url = `/api/marketplace/agents${q ? `?q=${encodeURIComponent(q)}` : ''}`;
			const res = await fetch(url);
			if (res.ok) {
				const json = await res.json();
				agents = json.data?.agents ?? [];
			}
		} catch {}
		loading = false;
	}

	function onInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => search(query), 300);
	}

	function pick(agent) {
		localAgentId.set(agent.id);
		dispatch('pick', agent);
	}

	function clear() {
		localAgentId.set('');
		dispatch('pick', null);
	}

	function initials(name) {
		return name?.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
	}

	const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444'];
	function color(id) {
		let h = 0;
		for (let i = 0; i < (id?.length ?? 0); i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
		return COLORS[h % COLORS.length];
	}

	search('');
</script>

<div class="flex flex-col gap-3 p-1">
	<input
		type="text"
		bind:value={query}
		on:input={onInput}
		placeholder="Search agents…"
		class="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-400"
		autofocus
	/>

	{#if $localAgentId}
		<button
			class="text-left text-[12px] text-slate-400 underline hover:text-slate-600"
			on:click={clear}
		>Remove agent</button>
	{/if}

	{#if loading}
		<p class="text-center text-[12px] text-slate-400">Loading…</p>
	{:else if agents.length === 0}
		<p class="text-center text-[12px] text-slate-400">No agents found</p>
	{:else}
		<div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
			{#each agents as agent}
				<button
					class="flex items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-gray-50
						{$localAgentId === agent.id ? 'bg-indigo-50 ring-1 ring-indigo-200' : ''}"
					on:click={() => pick(agent)}
				>
					<div
						class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
						style="background:{color(agent.id)}"
					>{initials(agent.name)}</div>
					<div class="min-w-0">
						<p class="truncate text-[13px] font-medium text-slate-800">{agent.name}</p>
						{#if agent.description}
							<p class="truncate text-[11px] text-slate-500">{agent.description}</p>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
