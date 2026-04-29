<script lang="ts">
	import { flash } from './actions.js';

	export let variant = 'outline';
	let className = '';
	export { className as class };
	export let trigger = null;
	export let disabled = false;

	export let el = undefined;
	export let use = [() => {}, {}];

	$: useFn = use[0];
	$: useParams = use[1];

	const variantClass = {
		outline:
			'border bg-white border-slate-300 hover:border-slate-400 transition-colors text-slate-700 text-sm px-3 py-1.5 rounded-lg',
		dark: 'bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-lg transition-colors',
		transparent: 'rounded-full p-3 transition-colors hover:bg-gray-100',
	}[variant];
</script>

<button
	bind:this={el}
	data-trigger={trigger}
	{disabled}
	class="{className} {variantClass} flex items-center"
	use:flash
	use:useFn={useParams}
	on:click
>
	<slot />
</button>
