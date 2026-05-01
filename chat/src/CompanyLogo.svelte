<script>
	import { talkingHeadAvatarUrl, localAgentId, brandConfig } from './stores.js';
	import AvatarIcon from './AvatarIcon.svelte';

	export let model;
	export let size = 'h-7 w-7';
	export let rounded = null;
	/** Live-animated walking avatar. Set false for dense lists (dropdown rows) — uses still frame. */
	export let live = true;

	// Remember to update hasCompanyLogo from convo.js when adding new logos.
	const base = import.meta.env.BASE_URL;

	$: effectiveAgentId = $localAgentId || $brandConfig?.agent_id || '';
</script>

{#if $talkingHeadAvatarUrl}
	<span class="{size} {rounded || 'rounded-sm'} overflow-hidden inline-block shrink-0">
		<AvatarIcon avatarUrl={$talkingHeadAvatarUrl} {live} />
	</span>
{:else if effectiveAgentId}
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
{:else if model && model.provider}
	{#if model.provider === 'OpenAI' || model.id.startsWith('openai')}
		<img src="{base}logos/openai.ico" loading="lazy" class="{size} {rounded || 'rounded-sm'}" alt="" />
	{:else if model.provider === 'Anthropic' || model.id.startsWith('anthropic')}
		<img
			src="{base}logos/anthropic.jpeg"
			loading="lazy"
			class="{size} {rounded || 'rounded-sm'}"
			alt=""
		/>
	{:else if model.id.startsWith('meta-llama')}
		<img src="{base}logos/meta.png" loading="lazy" class={size} alt="" />
	{:else if model.provider === 'Mistral' || model.id.startsWith('mistralai')}
		<img src="{base}logos/mistral.png" loading="lazy" class={size} alt="" />
	{:else if model.id.startsWith('cohere')}
		<img src="{base}logos/cohere.png" loading="lazy" class={size} alt="" />
	{:else if model.provider === 'Groq'}
		<img src="{base}logos/groq.png" loading="lazy" class="{size} {rounded || 'rounded-sm'}" alt="" />
	{:else if model.id.startsWith('nous')}
		<img src="{base}logos/nous.png" loading="lazy" class={size} alt="" />
	{:else if model.id.startsWith('google')}
		<img src="{base}logos/google.png" loading="lazy" class={size} alt="" />
	{:else if model.id.startsWith('perplexity')}
		<img
			src="{base}logos/perplexity.svg"
			loading="lazy"
			class="{size} {rounded || 'rounded-sm'}"
			alt=""
		/>
	{:else if model.id.startsWith('deepseek')}
		<img src="{base}logos/deepseek.ico" loading="lazy" class={size} alt="" />
	{:else if model.id.startsWith('qwen')}
		<img src="{base}logos/qwen.svg" loading="lazy" class={size} alt="" />
	{/if}
{/if}
