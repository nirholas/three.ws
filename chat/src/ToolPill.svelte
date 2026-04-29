<script>
	import Icon from './Icon.svelte';

	export let selected = false;
	export let icon;
</script>

<button
	class="{selected
		? 'text-white bg-slate-800'
		: 'bg-white hover:bg-gray-200'} shrink-0 flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-sm transition-colors"
	on:click
>
	<Icon
		{icon}
		strokeWidth={2}
		class="{selected
			? 'text-white'
			: 'text-slate-800'} m-auto h-3.5 w-3.5 transition-colors group-disabled:text-slate-400"
	/>
	<slot />
</button>
