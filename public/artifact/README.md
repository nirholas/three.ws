# Citing a three.ws artifact in Claude.ai

`GET https://three.ws/api/artifact?agent=<agentId>`

Paste the URL into a Claude.ai conversation. Claude fetches the document and renders it inside an artifact iframe.

The response is a **single self-contained HTML page** — three.js, GLTFLoader, the viewer code, and the GLB are all inlined. No external requests at runtime, which is mandatory: Claude's sandbox CSP forbids fetch to anywhere except `cdn.jsdelivr.net/pyodide/`.

## Worked example

```
Here's my agent for this conversation:
https://three.ws/api/artifact?agent=alice
```

Claude embeds the artifact and the live 3D character renders inline.

## Parameters

| Param   | Description                                             |
| ------- | ------------------------------------------------------- |
| `agent` | Agent ID (required unless `model` is set)               |
| `model` | Absolute `https://` URL to a GLB from a whitelisted CDN |
| `theme` | `dark` (default) or `light`                             |
| `idle`  | Animation clip name to play while idle                  |
| `bg`    | Background hex colour (without `#`), e.g. `bg=1a0533`   |

## Constraints

- **GLB size cap: 6 MB** — larger avatars return 413. Slimmer GLBs paste faster and render sooner.
- **Viewer overhead: ~565 KB** — three.js + GLTFLoader + viewer code, inlined into every response.
- **Rate limit: 600 req/min per IP** — shared with the widget-read preset.

## How to test before pasting

The page at [`/artifact/`](https://three.ws/artifact/) renders the response inside a sandboxed iframe whose CSP mirrors Claude's. If it works there, it works in Claude.

## Behaviour and contract

See [`specs/CLAUDE_ARTIFACT.md`](../../specs/CLAUDE_ARTIFACT.md) for the full contract, error envelope, and the locked-in CSP we test against.
