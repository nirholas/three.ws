<script>
	import { scale, slide } from 'svelte/transition';
	import { cubicIn } from 'svelte/easing';
	import { toolSchema } from './stores.js';
	import Checkbox from './Checkbox.svelte';
	import Icon from './Icon.svelte';
	import { feChevronDown } from './feather.js';

	export let open = false;
	export let convo;
	export let saveConversation;

	let collapsed = {};
	let innerWidth;

	function setTools(newTools) {
		convo.tools = convo.tools.concat(newTools);
		saveConversation(convo);
	}

	function unsetTools(toolsToUnset) {
		convo.tools = convo.tools.filter((t) => !toolsToUnset.includes(t));
		saveConversation(convo);
	}

	function clearTools() {
		convo.tools = [];
		saveConversation(convo);
	}
</script>

<svelte:window
	bind:innerWidth
	on:click={(event) => {
		if (!event.target.closest('#tool-dropdown')) {
			open = false;
		}
	}}
	on:touchstart={(event) => {
		if (!event.target.closest('#tool-dropdown')) {
			open = false;
		}
	}}
/>

{#if open && $toolSchema.length > 0}
	<div class="absolute bottom-10 left-0 z-10 flex w-[max-content] rounded-[10px]">
		<div
			transition:scale={{ opacity: 0, start: 0.98, duration: 100, easing: cubicIn }}
			class="flex h-auto w-auto min-w-[250px] flex-col self-start overflow-y-auto rounded-lg border border-slate-300 bg-white"
		>
			<div class="w-full px-3 pb-2 pt-2.5">
				<div class="mb-1 flex items-center justify-between">
					<h3 class="text-sm font-medium text-slate-800">Tools</h3>
					<button
						class="text-xs text-gray-600 hover:text-gray-800"
						on:click={() => {
							clearTools();
						}}
					>
						Unselect all
					</button>
				</div>
<!--				<input-->
<!--					type="text"-->
<!--					value=""-->
<!--					placeholder="Search for tools"-->
<!--					class="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"-->
<!--					on:input={() => {}}-->
<!--				/>-->
			</div>
			<ul class="max-h-[300px] overflow-y-auto pb-1.5 scrollbar-ultraslim">
				{#each $toolSchema as group}
					<div class="relative w-full">
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label
							class="flex w-full items-center gap-x-3 whitespace-nowrap py-2 pl-4 pr-3 text-left text-xs transition-colors hover:bg-gray-100"
						>
							<Checkbox
								checked={group.schema.every((t) => convo.tools.includes(t.function.name))}
								on:change={(event) => {
									const names = group.schema.map((t) => t.function.name);
									if (event.target.checked) {
										setTools(names);
									} else {
										unsetTools(names);
									}
								}}
							/>
							<p class="w-full text-xs font-semibold text-slate-800">{group.name}</p>
						</label>

						<button
							on:click={() => (collapsed[group.name] = !collapsed[group.name])}
							class="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 rounded-full transition-colors hover:bg-gray-100"
						>
							<Icon
								icon={feChevronDown}
								class="{collapsed[group.name]
									? ''
									: 'rotate-180'} m-auto h-4 w-4 text-slate-600 transition-transform"
							/>
						</button>
					</div>

					{#if !collapsed[group.name]}
						<div transition:slide={{ duration: 300 }}>
							{#each group.schema as schema, i}
								<li class="flex w-full">
									<!-- svelte-ignore a11y-label-has-associated-control -->
									<label
										class="flex w-full items-center gap-x-3 whitespace-nowrap py-2 pl-6 pr-3 text-left text-xs transition-colors hover:bg-gray-100"
									>
										<Checkbox
											checked={convo.tools.includes(schema.function.name)}
											on:change={(event) => {
												if (event.target.checked) {
													setTools([schema.function.name]);
												} else {
													unsetTools([schema.function.name]);
												}
											}}
										/>
										<p class="w-full text-xs font-medium text-slate-800">
											{schema.function.name}
										</p>
									</label>
								</li>
							{/each}
						</div>
					{/if}
				{/each}
			</ul>
		</div>
	</div>
{/if}
