<script>
	import { feCheck } from './feather';
	import Icon from './Icon.svelte';

	export let checked;
	let className = '';
	export { className as class };
</script>

<!-- Hidden native checkbox -->
<input type="checkbox" bind:checked on:change class="group hidden" />

<!-- Custom checkbox -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<span
	on:click
	class="{className} {checked
		? 'border-slate-800 bg-slate-800'
		: 'bg-white'} relative flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 transition-colors focus:outline-none focus:ring-0"
>
	{#if checked}
		<Icon icon={feCheck} class="h-2.5 w-2.5 shrink-0 text-white" strokeWidth={3} />
	{/if}
</span>
