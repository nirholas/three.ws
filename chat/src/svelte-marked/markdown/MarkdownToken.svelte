<script lang="ts">
  import type { Token } from 'marked'
  import MarkdownTokens from './MarkdownTokens.svelte'
  import type { MarkdownOptions, Renderers } from './markedConfiguration'


  interface Props {
    token: Token;
    renderers: Renderers;
    options: MarkdownOptions;
    message: any;
  }

  let {
    token,
    renderers,
    options,
    message
  }: Props = $props();
</script>

{#if renderers[token.type]}
  {@const SvelteComponent = renderers[token.type]}
  <SvelteComponent {token} {options} {renderers} {message}>
    {#if 'tokens' in token && token['tokens']}
      <MarkdownTokens tokens={token['tokens']} {renderers} {options} {message} />
    {:else}
      {token.raw}
    {/if}
  </SvelteComponent>
{/if}
