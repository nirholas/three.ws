<script>
	import Icon from './Icon.svelte';
	import { feTerminal, feBox } from './feather.js';
	import { onMount } from 'svelte';

	export let xml;
	export let active = false;
</script>

<button
	data-trigger="artifact"
	class="{active
		? 'bg-slate-800'
		: 'bg-gray-200 hover:bg-gray-300'} group/artifact relative flex items-center gap-2 self-start rounded-full px-3.5 py-2 transition-[background-color,box-shadow] duration-500"
	on:click
>
	<Icon icon={feBox} class="{active ? 'text-white' : 'text-slate-800'} h-4 w-4" />

	<span class="{active ? 'text-white' : ''} text-xs">
		{xml.attributes.title || 'Untitled artifact'}
	</span>
</button>
