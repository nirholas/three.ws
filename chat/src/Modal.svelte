<script>
	import { createEventDispatcher } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicIn } from 'svelte/easing';
	import Icon from './Icon.svelte';
	import { feX } from './feather.js';

	const dispatch = createEventDispatcher();

	export let open = false;
	export let trigger = '';
	let className = '';
	export { className as class };
	export let buttonClass = '';
</script>

<svelte:window
	on:click={(event) => {
		if (!trigger) return;
		if (event.target.closest(`[data-trigger=${trigger}]`)) {
			open = !open;
			if (!open) {
				dispatch('close');
			}
		}
	}}
/>

{#if open}
	<div
		transition:fade={{ duration: 200, easing: cubicIn }}
		aria-hidden="true"
		class="fixed inset-0 z-[101] h-screen w-screen bg-black opacity-[0.1]"
		on:click={() => {
			open = false;
			dispatch('close');
		}}
	/>
	<div
		role="dialog"
		transition:scale={{ opacity: 0, start: 0.98, duration: 150, easing: cubicIn }}
		class="{className} fixed left-1/2 top-1/2 z-[101] max-h-[95vh] w-[95%] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-white px-5 py-6 shadow-2xl scrollbar-ultraslim md:w-[700px]"
	>
		<button
			on:click={() => {
				open = false;
				dispatch('close');
			}}
			class="{buttonClass} absolute right-4 top-3 flex rounded-full p-3 transition-colors hover:bg-gray-100"
		>
			<Icon icon={feX} class="ml-auto h-4 w-4 text-slate-700" />
		</button>

		<slot />
	</div>
{/if}
