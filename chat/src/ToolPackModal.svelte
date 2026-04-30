<script>
	import Modal from './Modal.svelte';
	import { toolSchema } from './stores.js';
	import { curatedToolPacks } from './tools.js';

	export let open = false;

	function isInstalled(pack) {
		return $toolSchema.some((g) => g.name === pack.name);
	}

	function install(pack) {
		$toolSchema = [...$toolSchema, { name: pack.name, schema: pack.schema }];
	}

	function remove(pack) {
		$toolSchema = $toolSchema.filter((g) => g.name !== pack.name);
	}
</script>

<Modal bind:open>
	<div class="flex flex-col gap-y-4">
		<h2 class="text-base font-semibold text-slate-800">Tool packs</h2>
		<ul class="flex flex-col gap-y-3">
			{#each curatedToolPacks as pack}
				<li class="flex items-start justify-between gap-x-4 rounded-lg border border-slate-200 px-4 py-3">
					<div class="min-w-0">
						<p class="text-[13px] font-medium text-slate-800">{pack.name}</p>
						<p class="mt-0.5 text-[12px] text-slate-500">{pack.description}</p>
						<p class="mt-1 text-[11px] text-slate-400">
							{pack.schema.length}
							{pack.schema.length === 1 ? 'tool' : 'tools'}
						</p>
					</div>
					{#if isInstalled(pack)}
						<button
							class="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
							on:click={() => remove(pack)}
						>
							Remove
						</button>
					{:else}
						<button
							class="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-700 transition-colors hover:bg-slate-100"
							on:click={() => install(pack)}
						>
							Install
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</Modal>
