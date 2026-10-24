<script lang="ts">
  import { mode } from '../stores.js';
  import SlidesFlow from './flows/SlidesFlow.svelte';
  import DesignFlow from './flows/DesignFlow.svelte';
  import UtilityFlows from './flows/UtilityFlows.svelte';
	interface Props {
		composer?: import('svelte').Snippet;
		chips?: import('svelte').Snippet;
	}

	let { composer, chips }: Props = $props();
</script>

<section class="w-full flex flex-col items-center px-6 pt-[18vh] md:pt-[22vh] pb-32">
	<h1 class="three-ui-hero text-center mb-9">What can I do for you?</h1>
	<div class="w-full max-w-[760px]">
		{@render composer?.()}
	</div>
	<div class="w-full max-w-[760px] mt-4">
		{@render chips?.()}
	</div>
	{#if $mode === 'slides'}
		<SlidesFlow />
	{:else if $mode === 'design'}
		<DesignFlow />
	{:else}
		<div class="w-full max-w-[760px]">
			<UtilityFlows />
		</div>
	{/if}
</section>
