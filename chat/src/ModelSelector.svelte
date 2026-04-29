<script>
	import { createEventDispatcher, tick } from 'svelte';
	import { scale, slide } from 'svelte/transition';
	import { cubicIn } from 'svelte/easing';
	import { formatModelName, formatMultipleModelNames } from './providers.js';
	import { toolSchema } from './stores.js';
	import CompanyLogo from './CompanyLogo.svelte';
	import { feCheckCircle, feChevronDown, feImage, feLoader, feTool } from './feather.js';
	import Icon from './Icon.svelte';
	import Checkbox from './Checkbox.svelte';

	const dispatch = createEventDispatcher();

	export let convo;
	export let models = [];
	let className = '';
	export { className as class };

	let id = 'tool-selector';
	let open = false;
	let query = '';

	$: filteredModels =
		query.length > 0
			? models.filter((model) => {
					if (model.provider.toLowerCase() === query.toLowerCase()) {
						return true;
					}
					// Only search through the model id aka the `id` in `provider/id`.
					if (model.provider === 'OpenRouter') {
						const modelId = model.id.split('/')[1] || model.id;
						return modelId.toLowerCase().includes(query.toLowerCase());
					}
					model.name.toLowerCase().includes(query.toLowerCase());
				})
			: models;

	let inputEl;
	let innerWidth;
</script>

<svelte:window
	bind:innerWidth
	on:click={(event) => {
		if (!event.target.closest(`#${id}`)) {
			open = false;
			query = '';
		}
	}}
	on:touchstart={(event) => {
		if (!event.target.closest(`#${id}`)) {
			open = false;
			query = '';
		}
	}}
/>

<div {id} class="{className} flex gap-1.5 sm:gap-x-2">
	<div class="relative">
		<button
			class="flex h-9 w-full min-w-[190px] max-w-[200px] items-center gap-2.5 rounded-[10px] border border-slate-200 px-2 text-left transition-colors hover:border-slate-400 sm:h-10 sm:min-w-[280px] sm:pl-4 sm:pr-9"
			on:click={async () => {
				open = !open;
				if (open && innerWidth > 640) {
					await tick();
					inputEl.focus();
				}
			}}
		>
			<CompanyLogo model={convo.models[0]} size="w-5 h-5" rounded="rounded" />
			<div class="flex items-center gap-x-1.5">
				<p class="line-clamp-1 text-xs text-slate-700">
					{formatMultipleModelNames(convo.models, true)}
				</p>
				{#if convo.models[0].modality === 'text->image'}
					<Icon icon={feImage} class="mt-px h-3 w-3 text-slate-800" />
				{/if}
			</div>
			<Icon
				icon={feChevronDown}
				class="{$toolSchema.length > 0
					? 'hidden sm:inline'
					: ''} pointer-events-none absolute right-4 top-1/2 h-4 w-4 shrink-0 -translate-y-1/2 text-slate-600"
			/>
		</button>
	</div>
	{#if open}
		<div
			class="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-10 flex w-[max-content] -translate-x-1/2 rounded-lg"
		>
			<div
				transition:scale={{ opacity: 0, start: 0.98, duration: 100, easing: cubicIn }}
				class="pointer-events-auto min-w-[240px] max-w-[350px] rounded-lg border border-slate-300 bg-white"
			>
				<input
					bind:this={inputEl}
					type="text"
					placeholder="Search models..."
					class="w-full appearance-none rounded-t-lg border-0 border-b border-slate-300 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-700 focus:outline-none focus:ring-0"
					bind:value={query}
					on:keydown={(event) => {
						if (event.key === 'Enter') {
							dispatch('change', filteredModels[0]);
							open = false;
							query = '';
						}
					}}
				/>
				<ul class="flex max-h-[400px] w-full flex-col overflow-y-auto scrollbar-none">
					{#each filteredModels as model, i}
						<li>
							<button
								class="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100"
								on:click={() => {
									dispatch('change', model);
									open = false;
									query = '';
								}}
							>
								<CompanyLogo {model} />
								<span class="line-clamp-1">{formatModelName(model)}</span>
								{#if model.modality === 'text->image'}
									<Icon icon={feImage} class="mt-px h-3 w-3 text-slate-800" />
								{/if}

								<!--								TODO: Consensus-->
								<!--								<Checkbox-->
								<!--									checked={convo.models?.find((m) => m.id === model.id)}-->
								<!--									on:change={() => {}}-->
								<!--									on:click={(event) => {-->
								<!--										event.stopPropagation();-->
								<!--										dispatch('changeMulti', model);-->
								<!--									}}-->
								<!--									class="ml-auto"-->
								<!--								/>-->
							</button>
						</li>
					{:else}
						<div class="px-4 py-2.5 text-sm">No results.</div>
					{/each}
				</ul>
			</div>
		</div>
	{/if}
</div>
