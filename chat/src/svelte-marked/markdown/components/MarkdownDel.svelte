<script lang="ts">
  import type { Tokens } from 'marked'
  import type { MarkdownOptions, Renderers } from '../markedConfiguration'
  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  export const token: Tokens.Del = undefined
  export const options: MarkdownOptions = undefined
  export const renderers: Renderers = undefined
</script>

<del>
  {@render children?.()}
</del>
