---
mode: agent
description: "Self-contained HTML build for Claude.ai Artifacts — one file, no external fetches"
---

# Stack Layer 5: Claude Artifacts Single-File Embed

## Problem

Claude.ai Artifacts run user-supplied HTML in a sandboxed iframe with restricted network access. To make an agent appear inside a Claude conversation, we need a single self-contained HTML file that renders the agent — no external CDN calls for JS, no cross-origin fetches that would be blocked.

## Implementation

### Build target

Add a new Vite build output: `npm run build:artifact` → produces `dist-artifact/agent.html` — a single HTML file with:
- Inline JS (three.js, viewer, agent runtime, all in one `<script type="module">`).
- Inline CSS.
- Inline base64-encoded or HTTP-fetched GLB (see hydration below).

Vite config: new entry `src/artifact-entry.js`, `viteStaticCopy` or `rollup-plugin-html-literals` to inline everything. Target < 2MB gzipped (three.js alone is ~600KB gzipped — monitor).

### Hydration modes

The single HTML accepts an agent spec via URL hash OR inlined JSON:

Mode A (hash-injected by the host):
```
agent.html#agent={"slug":"satoshi","glb":"data:...","skills":[...]}
```

Mode B (inline, for static Artifacts):
```html
<script type="application/json" id="agent-spec">{...full spec...}</script>
```

On load, read spec, boot viewer + agent runtime, render.

### GLB handling

Claude Artifacts block many cross-origin fetches. Three options:
1. **Inline base64** — GLB embedded in the HTML (bloats the file; only for demo avatars).
2. **Use Claude's allowed origins** — if R2 public URL is on an allowed list, fetch normally.
3. **Host-proxied** — Claude's environment might proxy fetches; document the constraint and test.

For v1: support inline base64 AND allow a passthrough URL. Document which works in Artifacts.

### No auth / no writes

Artifact mode is read-only:
- No login UI.
- No memory writes.
- Skills that need the network are disabled (grayed out).
- Only rendering + local-only skills (animation, emotion) work.

### MCP tool that emits this

Add an MCP tool `render_agent_artifact` to [api/mcp.js](api/mcp.js): given a slug, returns an `artifact` payload with the single HTML pre-filled for that agent. Claude picks it up and emits the Artifact.

## Validation

- `npm run build:artifact` produces `dist-artifact/agent.html` under 2MB.
- Open the file directly in a browser → avatar renders, animates.
- Paste into Claude.ai as an Artifact with an agent hash → renders embedded in the chat.
- No external fetches in devtools Network tab (all inline).
- `npm run build` passes.

## Do not do this

- Do NOT ship write-capable skills into the artifact.
- Do NOT inline megabyte-scale GLBs by default — that's a demo mode, not production.
