<script>
	import Icon from './Icon.svelte';
	import { feHelpCircle } from './feather.js';
	import { tooltip } from './tooltip.js';

	export let icon = feHelpCircle;
	export let content = '';
	let className = '';
	export { className as class };
</script>

<Icon {icon} class="{className} h-3 w-3 text-slate-800" use={[tooltip, { content }]} />