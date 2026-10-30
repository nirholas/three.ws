<script lang="ts">
	import { feCheck } from './feather';
	import Icon from './Icon.svelte';

	interface Props {
		checked: any;
		class?: string;
		onchange?: (event: any) => void;
		onclick?: (event: any) => void;
	}

	let { checked = $bindable(), class: className = '', onchange, onclick }: Props = $props();
	
</script>

<!-- Hidden native checkbox -->
<input type="checkbox" bind:checked onchange={onchange} class="group hidden" />

<!-- Custom checkbox -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	onclick={onclick}
	class="{className} {checked
		? 'border-slate-800 bg-slate-800'
		: 'bg-white'} relative flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-300 transition-colors focus:outline-hidden focus:ring-0"
>
	{#if checked}
		<Icon icon={feCheck} class="h-2.5 w-2.5 shrink-0 text-white" strokeWidth={3} />
	{/if}
</span>
