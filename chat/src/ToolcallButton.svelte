<script>
	import Icon from './Icon.svelte';
	import { feTerminal } from './feather.js';
	import { onMount } from 'svelte';

	export let toolcall;
	export let toolresponse;
	export let active = false;

	let flash = false;

	onMount(() => {
		flash = true;
		setTimeout(() => {
			flash = false;
		}, 1000);
	});
</script>

<button
	data-trigger="toolcall"
	class="{toolresponse ? '' : 'animate-pulse'} {active
		? 'bg-slate-800'
		: 'bg-gray-200 hover:bg-gray-300'} {flash
		? 'ring-2 ring-gray-400 ring-offset-1'
		: ''} group/toolcall relative flex items-center gap-2 self-start rounded-full px-3.5 py-2 transition-[background-color,box-shadow] duration-500"
	on:click
>
	<Icon icon={feTerminal} class="{active ? 'text-white' : 'text-slate-800'} h-4 w-4" />
	{#if toolcall}
		<span class="{active ? 'text-white' : ''} text-xs">
			{toolcall.name}
		</span>
	{/if}
</button>
