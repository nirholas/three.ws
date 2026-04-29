<script>
	import Markdown from './svelte-marked/markdown/Markdown.svelte';

	export let message;

	export let contentHeight = undefined;
</script>

{#if message.error}
	<span class="text-slate-600">{message.error}</span>
{:else if message.content}
	<div
		bind:clientHeight={contentHeight}
		class="markdown prose prose-slate flex w-full max-w-none flex-col break-words prose-h1:font-semibold prose-h2:font-semibold prose-h3:font-semibold prose-h4:font-semibold prose-h1:!my-2 prose-h1:text-[22px] prose-h2:!my-1.5 prose-h2:text-xl prose-h3:!my-1.5 prose-h3:text-lg prose-p:whitespace-pre-wrap prose-p:text-slate-800 prose-a:[overflow-wrap:anywhere] prose-code:[overflow-wrap:anywhere] prose-pre:mb-4 prose-pre:mt-0 prose-pre:whitespace-pre-wrap prose-pre:rounded-lg prose-pre:rounded-t-none prose-pre:border-t-0 prose-pre:border prose-pre:border-slate-200 prose-pre:bg-white prose-pre:text-slate-800 prose-pre:[overflow-wrap:anywhere] prose-ul:my-0 prose-img:mb-2"
	>
		{#if message.contentParts}
			{#each message.contentParts as part}
				<img
					src={part.image_url.url}
					alt=""
					class="max-h-[400px] w-min rounded-lg object-contain object-[0]"
				/>
			{/each}
		{/if}
		<Markdown source={message.content} {message} />
	</div>
{:else if message.generatedImageUrl}
	<img
		src={message.generatedImageUrl}
		alt=""
		class="max-h-[400px] w-min rounded-lg object-contain object-[0]"
	/>
{/if}
