<script>
	import { createEventDispatcher } from 'svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import { feEdit2, feTrash } from './feather.js';

	const dispatch = createEventDispatcher();

	export let definition;
</script>

<div class="flex items-center rounded-lg border border-slate-300 pl-4 pr-2 py-2">
	<code class="text-xs leading-relaxed mr-3">{definition.name}({'{ '}{definition.arguments.map(arg => `${arg.name}: ${arg.type}`).join(', ')}{' }'})</code>

	<Button
		class="ml-auto w-7 h-7 !p-0 justify-center shrink-0"
		on:click={() => {
			dispatch('edit');
		}}
	>
		<Icon icon={feEdit2} class="text-slate-700 w-3 h-3" />
	</Button>
	<Button
		class="ml-2 w-7 h-7 !p-0 justify-center shrink-0"
		on:click={() => {
			dispatch('delete');
		}}
	>
		<Icon icon={feTrash} class="text-slate-700 w-3 h-3" />
	</Button>
</div>
