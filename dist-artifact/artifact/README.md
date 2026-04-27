# Citing a three.ws artifact in Claude.ai

`GET https://three.ws/api/artifact?agent=<agentId>`

Paste the URL into a Claude.ai conversation. Claude recognises it as an HTML artifact and renders the interactive three.ws inline.

## Worked example

```
Here's my agent for this conversation:
https://three.ws/api/artifact?agent=alice
```

Claude will embed the artifact and display the live 3D character.

## Parameters

| Param | Description |
|---|---|
| `agent` | Agent ID (required unless `model` is set) |
| `model` | Absolute `https://` URL to a GLB from a whitelisted CDN |
| `theme` | `dark` (default) or `light` |
| `idle` | Animation clip name to play while idle |
| `bg` | Background hex colour (without `#`), e.g. `bg=1a0533` |

## Notes

- The document returned is a single self-contained HTML page — no external requests except the UMD bundle and your agent's GLB asset.
- `frame-ancestors *` is set in the CSP so Claude.ai's sandboxed iframe can render it.
- Rate-limited at 600 req/min per IP (shared with widget reads).
