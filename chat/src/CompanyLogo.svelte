<script>
	import { localAgentId, brandConfig } from './stores.js';

	export let model;
	export let size = 'h-7 w-7';
	export let rounded = null;
	export let live = true;

	$: effectiveAgentId = $localAgentId || $brandConfig?.agent_id || '';
</script>

{#if effectiveAgentId}
	<span class="{size} {rounded || 'rounded-sm'} overflow-hidden inline-block shrink-0">
		<!-- svelte-ignore custom-element-no-implicit-ns -->
		<agent-3d
			agent-id={effectiveAgentId}
			mode="inline"
			width="128"
			height="128"
			background="transparent"
			kiosk
			name-plate="off"
			style="width:100%;height:100%;display:block;"
		></agent-3d>
	</span>
{/if}
