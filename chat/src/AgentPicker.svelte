<script>
	import { createEventDispatcher } from 'svelte';
	import { localAgentId, activeAgent, agentLibraryUrl } from './stores.js';

	const dispatch = createEventDispatcher();

	let query = '';
	let myAgents = [];
	let marketAgents = [];
	let libraryAgents = [];
	let loadingMine = false;
	let loadingMarket = false;
	let loadingLibrary = false;
	let debounceTimer;

	// Normalizes a pai-chat / lobehub library agent (index entry) into the local agent shape.
	function normalizeLibraryAgent(item) {
		const m = item.meta || {};
		const avatar = m.avatar || '';
		const isUrl = typeof avatar === 'string' && /^https?:\/\//.test(avatar);
		return {
			id: `lib:${item.identifier}`,
			identifier: item.identifier,
			name: m.title || item.identifier,
			description: m.description || '',
			thumbnail_url: isUrl ? avatar : null,
			avatar_emoji: isUrl ? null : avatar,
			tags: m.tags || [],
			category: m.category || '',
			source: 'library',
		};
	}

	async function loadLibrary() {
		loadingLibrary = true;
		try {
			const base = $agentLibraryUrl?.replace(/\/+$/, '') || '';
			if (!base) return;
			const res = await fetch(`${base}/index.en-US.json`);
			if (res.ok) {
				const json = await res.json();
				libraryAgents = (json.agents || []).map(normalizeLibraryAgent);
			}
		} catch {}
		loadingLibrary = false;
	}

	async function loadLibraryAgentDetail(agent) {
		const base = $agentLibraryUrl?.replace(/\/+$/, '') || '';
		const res = await fetch(`${base}/${agent.identifier}.json`);
		if (!res.ok) return agent;
		const data = await res.json();
		const cfg = data.config || {};
		return {
			...agent,
			system_prompt: cfg.systemRole || '',
			greeting: cfg.openingMessage || '',
			model: cfg.model || null,
			provider: cfg.provider || null,
			params: cfg.params || null,
		};
	}

	async function searchMarket(q) {
		loadingMarket = true;
		try {
			const url = `/api/marketplace/agents${q ? `?q=${encodeURIComponent(q)}` : ''}`;
			const res = await fetch(url);
			if (res.ok) {
				const json = await res.json();
				marketAgents = json.data?.items ?? [];
			}
		} catch {}
		loadingMarket = false;
	}

	async function loadMine() {
		loadingMine = true;
		try {
			const res = await fetch('/api/agents', { credentials: 'include' });
			if (res.ok) {
				const json = await res.json();
				myAgents = json.agents ?? [];
			}
		} catch {}
		loadingMine = false;
	}

	$: filteredMine = query
		? myAgents.filter((a) =>
				(a.name || '').toLowerCase().includes(query.toLowerCase()) ||
				(a.description || '').toLowerCase().includes(query.toLowerCase()),
		  )
		: myAgents;

	$: filteredLibrary = (query
		? libraryAgents.filter((a) => {
				const q = query.toLowerCase();
				return (
					(a.name || '').toLowerCase().includes(q) ||
					(a.description || '').toLowerCase().includes(q) ||
					(a.tags || []).some((t) => String(t).toLowerCase().includes(q)) ||
					(a.category || '').toLowerCase().includes(q)
				);
		  })
		: libraryAgents
	).slice(0, 60);

	function onInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => searchMarket(query), 300);
	}

	async function pick(agent) {
		if (agent.source === 'library') {
			const detail = await loadLibraryAgentDetail(agent);
			localAgentId.set(detail.id);
			activeAgent.set(detail);
			dispatch('pick', detail);
			return;
		}
		try {
			const res = await fetch(`/api/agents/${agent.id}`, { credentials: 'include' });
			if (res.ok) {
				const json = await res.json();
				const detail = json.agent ?? json.data?.agent ?? agent;
				localAgentId.set(detail.id);
				activeAgent.set(detail);
				dispatch('pick', detail);
				return;
			}
		} catch {}
		try {
			const res = await fetch(`/api/marketplace/agents/${agent.id}`);
			if (res.ok) {
				const json = await res.json();
				const detail = json.data?.agent ?? agent;
				localAgentId.set(detail.id);
				activeAgent.set(detail);
				dispatch('pick', detail);
				return;
			}
		} catch {}
		localAgentId.set(agent.id);
		activeAgent.set(agent);
		dispatch('pick', agent);
	}

	function clear() {
		localAgentId.set('');
		activeAgent.set(null);
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

	loadMine();
	searchMarket('');
	loadLibrary();
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

	<div class="flex items-center justify-between">
		{#if $localAgentId}
			<button
				class="text-left text-[12px] text-slate-400 underline hover:text-slate-600"
				on:click={clear}
			>Remove agent</button>
		{:else}
			<span></span>
		{/if}
		<a
			href="/dashboard"
			class="text-[12px] text-indigo-500 hover:text-indigo-700"
			target="_blank"
			rel="noopener"
		>+ Create agent</a>
	</div>

	<div class="max-h-[28rem] overflow-y-auto pr-0.5 flex flex-col gap-3">
		<!-- My Agents -->
		<div>
			<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">My Agents</p>
			{#if loadingMine}
				<p class="text-center text-[12px] text-slate-400 py-3">Loading…</p>
			{:else if filteredMine.length === 0}
				<p class="text-[12px] text-slate-400 py-2">
					{query ? 'No matches in your agents' : 'You haven\'t created any agents yet.'}
				</p>
			{:else}
				<div class="grid grid-cols-3 gap-2">
					{#each filteredMine as agent}
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

		<!-- Marketplace -->
		<div>
			<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Marketplace</p>
			{#if loadingMarket}
				<p class="text-center text-[12px] text-slate-400 py-3">Loading…</p>
			{:else if marketAgents.length === 0}
				<p class="text-[12px] text-slate-400 py-2">No agents found</p>
			{:else}
				<div class="grid grid-cols-3 gap-2">
					{#each marketAgents as agent}
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

		<!-- Public Library (LobeHub-compatible JSON index) -->
		<div>
			<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Public Library</p>
			{#if loadingLibrary}
				<p class="text-center text-[12px] text-slate-400 py-3">Loading…</p>
			{:else if filteredLibrary.length === 0}
				<p class="text-[12px] text-slate-400 py-2">{query ? 'No matches in library' : 'Library unavailable'}</p>
			{:else}
				<div class="grid grid-cols-3 gap-2">
					{#each filteredLibrary as agent}
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
							{:else if agent.avatar_emoji}
								<div class="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-50 text-[28px]">{agent.avatar_emoji}</div>
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
				{#if !query && libraryAgents.length > filteredLibrary.length}
					<p class="text-[11px] text-slate-400 py-1.5 text-center">Showing 60 of {libraryAgents.length} — search to filter</p>
				{/if}
			{/if}
		</div>
	</div>
</div>
