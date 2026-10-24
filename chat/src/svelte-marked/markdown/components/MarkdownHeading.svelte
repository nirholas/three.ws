<script lang="ts">
  import { generatePathSegment } from '../../utils/url'

  import type { Tokens } from 'marked'
  import type { MarkdownOptions, Renderers } from '../markedConfiguration'

  interface Props {
    token: Tokens.Heading;
    options: MarkdownOptions;
    children?: import('svelte').Snippet;
  }

  let { token, options, children }: Props = $props();
  export const renderers: Renderers = undefined

  let id: string | undefined = $derived(generatePathSegment(token.text, options.slugger))
  
</script>

<svelte:element this={`h${token.depth}`} {id}>
  {@render children?.()}
</svelte:element>
