<script lang="ts">
  import MarkdownTokens from '../../MarkdownTokens.svelte'
  import type { MarkdownOptions, Renderers } from '../../markedConfiguration'
  import type { Tokens } from 'marked'

  interface Props {
    token: Tokens.Table;
    options: MarkdownOptions;
    renderers: Renderers;
  }

  let { token, options, renderers }: Props = $props();
</script>

<table>
  <thead>
    <tr>
      {#each token.header as item}
        <th scope="col">
          <MarkdownTokens tokens={item.tokens} {options} {renderers} />
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each token.rows as row}
      <tr>
        {#each row as col}
          <td>
            <MarkdownTokens tokens={col.tokens} {options} {renderers} />
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>
