<script lang="ts">
  import type { Token } from 'marked'
  import MarkdownToken from './MarkdownToken.svelte'
  import type { MarkdownOptions, Renderers } from './markedConfiguration'


  interface Props {
    tokens: Token[] | null;
    renderers: Renderers;
    options: MarkdownOptions;
    message: any;
  }

  let {
    tokens,
    renderers,
    options,
    message
  }: Props = $props();
</script>

{#if tokens}
  {#each tokens as token}
    <MarkdownToken {token} {renderers} {options} {message} />
  {/each}
{/if}
