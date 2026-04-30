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
				agents = json.data?.items ?? [];
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
		<p class="text-center text-[12px] text-slate-400 py-4">Loading…</p>
	{:else if agents.length === 0}
		<p class="text-center text-[12px] text-slate-400 py-4">No agents found</p>
	{:else}
		<div class="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-0.5">
			{#each agents as agent}
				<button
					class="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition hover:bg-gray-50
						{$localAgentId === agent.id ? 'bg-indigo-50 ring-2 ring-indigo-300' : 'ring-1 ring-gray-100'}"
					on:click={() => pick(agent)}
					title={agent.description || agent.name}
				>
					{#if agent.thumbnail_url}
						<img
							src={agent.thumbnail_url}
							alt={agent.name}
							class="h-14 w-14 rounded-lg object-cover"
							loading="lazy"
						/>
					{:else}
						<div
							class="flex h-14 w-14 items-center justify-center rounded-lg text-[14px] font-bold text-white"
							style="background:{color(agent.id)}"
						>{initials(agent.name)}</div>
					{/if}
					<p class="w-full truncate text-[11px] font-medium text-slate-700 leading-tight">{agent.name}</p>
				</button>
			{/each}
		</div>
	{/if}
</div>
