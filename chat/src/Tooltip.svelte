<script lang="ts">
	import Icon from './Icon.svelte';
	import { feHelpCircle } from './feather.js';
	import { tooltip } from './tooltip.js';

	interface Props {
		icon?: any;
		content?: string;
		class?: string;
	}

	let { icon = feHelpCircle, content = '', class: className = '' }: Props = $props();
	
</script>

<Icon {icon} class="{className} h-3 w-3 text-slate-800" use={[tooltip, { content }]} />