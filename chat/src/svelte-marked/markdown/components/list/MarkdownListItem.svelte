<script lang="ts">
  import type { MarkdownOptions, Renderers } from '../../markedConfiguration'

  import type { Tokens } from 'marked'
  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  export const token: Tokens.ListItem = undefined
  export const options: MarkdownOptions = undefined
  export const renderers: Renderers = undefined
</script>

<li>{@render children?.()}</li>
