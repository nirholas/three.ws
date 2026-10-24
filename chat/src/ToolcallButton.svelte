<script lang="ts">
	import Icon from './Icon.svelte';
	import { feTerminal } from './feather.js';
	import { onMount } from 'svelte';

	interface Props {
		toolcall: any;
		toolresponse: any;
		active?: boolean;
		onclick?: (event: any) => void;
	}

	let { toolcall, toolresponse, active = false, onclick }: Props = $props();

	let flash = $state(false);

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
	onclick={onclick}
>
	<Icon icon={feTerminal} class="{active ? 'text-white' : 'text-slate-800'} h-4 w-4" />
	{#if toolcall}
		<span class="{active ? 'text-white' : ''} text-xs">
			{toolcall.name}
		</span>
	{/if}
</button>
