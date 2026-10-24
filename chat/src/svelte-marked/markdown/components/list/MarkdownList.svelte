<script lang="ts">
  import type { MarkdownOptions, Renderers } from '../../markedConfiguration'
  import type { Tokens } from 'marked'
  import MarkdownToken from '../../MarkdownToken.svelte'

  interface Props {
    token: Tokens.List;
    options: MarkdownOptions;
    renderers: Renderers;
  }

  let { token, options, renderers }: Props = $props();

  let component: 'ol' | 'ul' = $derived(token.ordered ? 'ol' : 'ul')
  
</script>

<svelte:element this={component} start={token.start || 1}>
  {#each token.items as item}
    <MarkdownToken token={{ ...item }} {options} {renderers} />
  {/each}
</svelte:element>
