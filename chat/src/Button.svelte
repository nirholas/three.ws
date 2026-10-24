<script lang="ts">
	import { flash } from './actions.js';

	

	interface Props {
		variant?: string;
		class?: string;
		trigger?: any;
		disabled?: boolean;
		el?: any;
		use?: any;
		children?: import('svelte').Snippet;
		onclick?: (event: any) => void;
	}

	let {
		variant = 'outline',
		class: className = '',
		trigger = null,
		disabled = false,
		el = $bindable(undefined),
		use = [() => {}, {}],
		children,
		onclick
	}: Props = $props();

	let useFn = $derived(use[0]);
	let useParams = $derived(use[1]);

	const variantClass = $derived({
		outline:
			'border bg-white border-slate-300 hover:border-slate-400 transition-colors text-slate-700 text-sm px-3 py-1.5 rounded-lg',
		dark: 'bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-lg transition-colors',
		transparent: 'rounded-full p-3 transition-colors hover:bg-gray-100',
	}[variant]);
</script>

<button
	bind:this={el}
	data-trigger={trigger}
	{disabled}
	class="{className} {variantClass} flex items-center"
	use:flash
	use:useFn={useParams}
	onclick={onclick}
>
	{@render children?.()}
</button>
