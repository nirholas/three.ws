# Changelog — three.ws 3D Forge (Claude Code plugin)

All notable changes to this plugin are documented here. Versions follow [semver](https://semver.org).

## Unreleased

- Added Cursor manifests (`.cursor-plugin/plugin.json`, `mcp.json`) and applied to the Cursor Marketplace on 2026-11-21 (pending review). See `SUBMISSION.md`.

## 1.0.0 — 2026-07-01

Initial release. Generate textured 3D models and rigged, animation-ready avatars
from text or images, directly inside Claude Code.

### Skills
- `three-ws-3d:forge-3d` — free text → 3D GLB (NVIDIA NIM / TRELLIS); no key or wallet.
- `three-ws-3d:text-to-avatar` — text or 1–4 reference images → textured 3D avatar (paid, $0.15 USDC via x402).
- `three-ws-3d:mesh-forge` — directed text / single-image / multi-view → high-fidelity mesh (paid, $0.25 USDC via x402).
- `three-ws-3d:auto-rig` — add a humanoid skeleton + skin weights to an existing GLB, or go prompt → rigged avatar in one call (paid, $0.20 / $0.45 USDC via x402).

### Bundled MCP servers
- `@three-ws/mcp-server` — the full generation surface: `forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`. Paid tools settle over x402; set `MCP_SVM_PAYMENT_ADDRESS` to enable them.
- `@three-ws/scene-mcp` — `compose_scene` / `get_scene` / `list_scenes` (free, no key).
- `@three-ws/avatar-mcp` — live avatar render, paste-anywhere embed iframe, and avatar metadata (free, no key).

Every result returns a downloadable `glbUrl` plus a `https://three.ws/viewer?src=…` preview link.
