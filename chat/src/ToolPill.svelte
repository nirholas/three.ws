<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		selected?: boolean;
		icon: any;
		children?: import('svelte').Snippet;
		onclick?: (event: any) => void;
	}

	let { selected = false, icon, children, onclick }: Props = $props();
</script>

<button
	class="{selected
		? 'text-white bg-slate-800'
		: 'bg-white hover:bg-gray-200'} shrink-0 flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-sm transition-colors"
	onclick={onclick}
>
	<Icon
		{icon}
		strokeWidth={2}
		class="{selected
			? 'text-white'
			: 'text-slate-800'} m-auto h-3.5 w-3.5 transition-colors group-disabled:text-slate-400"
	/>
	{@render children?.()}
</button>
