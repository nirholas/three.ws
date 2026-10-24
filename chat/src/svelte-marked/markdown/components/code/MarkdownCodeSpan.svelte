<script lang="ts">
  import type { MarkdownOptions, Renderers } from '../../markedConfiguration'
  import type { Tokens } from 'marked'

  interface Props {
    token: Tokens.Codespan;
  }

  let { token }: Props = $props();
  export const options: MarkdownOptions = undefined
  export const renderers: Renderers = undefined
</script>

<code>{token.raw.slice(1, token.raw.length - 1)}</code>
