# three.ws 3D Forge — Claude Code plugin

Generate textured 3D models and rigged, animation-ready avatars from text or images, directly inside Claude Code.

## Install

```
/plugin marketplace add nirholas/three.ws
/plugin install three-ws-3d@three-ws
```

Then `/reload-plugins`. The plugin's skills appear under the `three-ws-3d:` namespace and the bundled MCP tools list automatically.

## Skills

| Skill | Tool | Lane |
| --- | --- | --- |
| `three-ws-3d:forge-3d` | `forge_free` | **Free** text → 3D (Microsoft TRELLIS) |
| `three-ws-3d:text-to-avatar` | `text_to_avatar` | Paid — $0.15 USDC |
| `three-ws-3d:mesh-forge` | `mesh_forge` | Paid — $0.25 USDC |
| `three-ws-3d:auto-rig` | `rig_mesh` / `forge_avatar` | Paid — $0.20 / $0.45 USDC |

Every skill returns a downloadable `glbUrl` plus a `https://three.ws/viewer?src=…` preview link.

## Bundled MCP servers

Installing the plugin wires three published servers with zero extra config:

- **`@three-ws/mcp-server`** — the full generation surface: `forge_free` (free), `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`. Paid tools settle over x402; set `MCP_SVM_PAYMENT_ADDRESS` to enable them.
- **`@three-ws/scene-mcp`** — `compose_scene` / `get_scene` / `list_scenes`: turn a sentence into a placed diorama plan. Free, no key.
- **`@three-ws/avatar-mcp`** — render a live, rotatable avatar inline, get a paste-anywhere embed iframe, or fetch avatar metadata. Free, no key.

## Free vs paid

- **Free, no wallet:** `forge_free` (draft/standard/high text→3D), plus all of `scene-mcp` and `avatar-mcp`.
- **Paid over x402 (USDC):** `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`. A call without a payment payload returns a `PaymentRequired` result describing the price.

`$THREE` (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only token of the three.ws platform.

## Links

- Forge web app: https://three.ws/forge
- Viewer: https://three.ws/viewer
- Source: https://github.com/nirholas/three.ws
