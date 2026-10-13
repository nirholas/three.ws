# OpenCode (anomalyco/opencode, formerly sst/opencode) MCP docs submission

Target: `https://github.com/anomalyco/opencode` (the repo was renamed from `sst/opencode`; GitHub's API
redirects the old slug to this one), file `packages/web/src/content/docs/docs/mcp-servers.mdx`, default
branch `dev`.

Confirmed 2026-10-13: OpenCode's own MCP servers doc page (`https://opencode.ai/docs/mcp-servers/`) states
"You can submit a PR if you want to document other servers" in its Examples section, which currently lists
Sentry, Context7, and Grep by Vercel. There is no separate issue template or form: a documentation PR against
`mcp-servers.mdx` is the whole mechanism. The directory listing of
`packages/web/src/content/docs/docs/` was fetched live and confirmed `mcp-servers.mdx` exists at that path.

## What ships

A new Examples entry for three.ws, in the same style as the existing Context7 entry: a short description plus
the `opencode.json` / global config snippet a user pastes in to add the server.

## Proposed Markdown addition to `mcp-servers.mdx`'s Examples section

```markdown
### three.ws

Generate, rig, and render 3D models (GLB) from a text prompt. Free, no API key required.

\`\`\`json title="opencode.json"
{
  "mcp": {
    "three-ws": {
      "type": "remote",
      "url": "https://three.ws/api/mcp-studio",
      "enabled": true
    }
  }
}
\`\`\`
```

## Verification packet

- Submission mechanism (PR against `mcp-servers.mdx`) confirmed by fetching the live OpenCode docs page.
- Repo rename (`sst/opencode` -> `anomalyco/opencode`) and the exact doc file path confirmed via the GitHub
  API, 2026-10-13.
- Tool schema confirmed live against production in this session's test runs.

## Owner steps (not automatable here)

1. Fork `anomalyco/opencode`, add the Examples entry above to
   `packages/web/src/content/docs/docs/mcp-servers.mdx`.
2. Open a pull request titled "docs: add three.ws to MCP server examples".
