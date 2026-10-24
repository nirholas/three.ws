<script lang="ts">
  import { isRelative, joinUrlPaths } from '../../utils/url'
  import type { Tokens } from 'marked'
  import type { MarkdownOptions, Renderers } from '../markedConfiguration'

  interface Props {
    token: Tokens.Link;
    options: MarkdownOptions;
    children?: import('svelte').Snippet;
  }

  let { token, options, children }: Props = $props();
  export const renderers: Renderers = undefined
</script>

<a
  href={isRelative(token.href)
    ? joinUrlPaths(options.baseUrl, token.href)
    : token.href}
  title={token.title}
>
  {@render children?.()}
</a>
