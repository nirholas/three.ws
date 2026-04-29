<script>
	import { scale } from 'svelte/transition';
	import { cubicIn } from 'svelte/easing';
	import { params } from './stores.js';

	export let open = false;
	export let convo;

	let innerWidth;
</script>

<svelte:window
	bind:innerWidth
	on:click={(event) => {
		if (!event.target.closest('#reasoning-effort-dropdown')) {
			open = false;
		}
	}}
	on:touchstart={(event) => {
		if (!event.target.closest('#reasoning-effort-dropdown')) {
			open = false;
		}
	}}
/>

{#if open}
	{@const min = convo.models[0].reasoningEffortRange[0]}
	{@const max = convo.models[0].reasoningEffortRange[1]}
	<div class="absolute bottom-10 left-0 z-10 flex w-[max-content] translate-x-1/2">
		<div
			transition:scale={{ opacity: 0, start: 0.98, duration: 100, easing: cubicIn }}
			class="flex h-auto w-auto min-w-[250px] flex-col self-start overflow-y-auto rounded-xl border border-slate-300 bg-white px-3 py-2"
		>
			<div class="flex flex-col text-[10px] uppercase tracking-wide">
				<div class="mb-2 flex items-baseline justify-between">
					<button
						class="flex self-start rounded-full bg-gray-200 px-2 py-0.5 text-left transition-colors hover:bg-gray-300"
						on:click={() => {
							$params.reasoningEffort['range'] = min;
						}}
					>
						{min === 0 ? 'None' : min}
					</button>
					<button
						class="flex rounded-full bg-gray-200 px-2 py-0.5 text-left transition-colors hover:bg-gray-300"
						on:click={() => {
							$params.reasoningEffort['range'] = max;
						}}
					>
						{max}
					</button>
				</div>
				<input
					type="range"
					{min}
					{max}
					bind:value={$params.reasoningEffort['range']}
					step={1000}
					class="appearance-none overflow-hidden rounded-full border border-slate-300
				[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:appearance-none
				[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-slate-800 [&::-moz-range-thumb]:bg-slate-800 [&::-webkit-slider-runnable-track]:h-2.5
			[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-100 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
[&::-webkit-slider-thumb]:bg-slate-800"
				/>
			</div>
		</div>
	</div>
{/if}
