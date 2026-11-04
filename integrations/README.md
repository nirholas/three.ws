# three.ws integrations

First-party plugins that drive the public **three.ws Forge** generation pipeline
(`/api/forge`) from inside the tools artists already use — so a model can be
generated without leaving the DCC.

| Plugin | Folder | Host |
|---|---|---|
| Blender extension | [`blender/three_ws/`](blender/three_ws/) | Blender 4.2+ |
| ComfyUI nodes | [`comfyui/three_ws_nodes/`](comfyui/three_ws_nodes/) | ComfyUI |
| Modly extensions | [`modly/`](modly/) (`three-ws/` cloud nodes, `three-ws-publish/` publish node) | [Modly](https://github.com/lightningpixel/modly) |

Agent harnesses get plugin folders of their own, which connect a hosted MCP
server and bundle skills rather than calling `/api/forge` directly:

| Plugin | Folder | Host |
|---|---|---|
| Grok Build plugin | [`grok/three-ws/`](grok/three-ws/) | [Grok Build](https://github.com/xai-org/grok-build) (xAI) |
| Hermes plugin | [`hermes/three-ws/`](hermes/three-ws/) (Agent Plugins v1: `mcp.json` + four skills) | [Hermes Agent](https://github.com/NousResearch/hermes-agent) (Nous Research) |
| Cursor plugin | [`cursor/three-ws/`](cursor/three-ws/) (Open Plugins: `.cursor-plugin/plugin.json`, `mcp.json`, four skills; mirrored to [nirholas/three-ws-cursor-plugin](https://github.com/nirholas/three-ws-cursor-plugin) for cursor.directory) | [Cursor](https://cursor.com) |
| Dify tool plugin | [`dify/three_ws/`](dify/three_ws/) (four Python tools over the studio server; packaged with `dify-plugin plugin package`) | [Dify](https://github.com/langgenius/dify) |

Listing packages for developer-tool stores each carry a README and a `SUBMITTING.md` with the exact registry steps (the submission itself is an owner action). Verify all of them with `npm run check:integrations`:

| Package | Folder | Host |
|---|---|---|
| Zed extension (MCP context server running `@three-ws/mcp-server`) | [`zed/`](zed/) | [Zed](https://zed.dev) |
| Raycast extension (Forge a 3D Model command) | [`raycast/`](raycast/) | [Raycast](https://raycast.com) |
| Gradio Space and MCP server | [`huggingface-space/`](huggingface-space/) | [Hugging Face Spaces](https://huggingface.co/spaces) |
| Poe server bot | [`poe/`](poe/) | [Poe](https://poe.com) |
| n8n community node | [`n8n/`](n8n/) | [n8n](https://n8n.io) |

Microsoft 365 and Power Platform get packages of their own, each built and validated by a script in `scripts/`:

| Package | Folder | Host |
|---|---|---|
| Microsoft 365 app (Copilot agent, Teams tabs and the Agents search command) | [`microsoft/copilot-teams/`](microsoft/copilot-teams/) (built by `npm run package:microsoft-app`) | Microsoft 365 Copilot, Teams, Outlook |
| Power Platform connector (five actions over `/api/3d/studio` and the agents API, OAuth 2.0 with PKCE) | [`microsoft/power-platform-connector/`](microsoft/power-platform-connector/) (built by `npm run package:power-platform-connector`) | Power Automate, Power Apps, Logic Apps, Copilot Studio |

Driving Blender from an **agent** rather than by hand is a different job, and it
has its own package: [`packages/blender-mcp/`](../packages/blender-mcp) is an MCP
server that runs Blender headlessly (no GUI, no add-on) so an assistant can
inspect, convert, render, and script 3D files, and pull a Forge generation
straight into a scene. The add-on below is the artist-facing surface; the two
install side by side.

All of them speak to the same auth-free endpoints:

- `POST /api/forge` — text→3D and image→3D
- `GET /api/forge?job=<id>` — poll
- `GET /api/forge?catalog` — tier/backend matrix
- `POST /api/forge-upload` — presigned image upload (image→3D)
- `POST /api/scene-glb-upload`: presigned GLB upload, so a local mesh can be rigged or remeshed
- `POST /api/forge?action=rig` and `POST /api/forge-remesh`: auto-rig and remesh a GLB by URL

Publishing to an account (`POST /api/avatars`) is the one call that needs a
three.ws API key.

The **image pipeline** (FLUX→TRELLIS) is free and platform-keyed. The
**geometry pipeline** (Meshy/Tripo) is BYOK — supply your own provider key in
the add-on preferences / node input and it travels as `x-forge-provider-key`.

## Single source of truth

The Forge contract lives in exactly one file:
[`_pyclient/three_ws_client.py`](_pyclient/three_ws_client.py) — stdlib-only
(`urllib`), so it runs unmodified in Blender's bundled Python and in ComfyUI with
no `pip install`. Each plugin ships a **byte-identical vendored copy** so it stays
self-contained and distributable (a Blender zip / a ComfyUI clone).

`_pyclient/test_no_drift.py` fails CI if a copy drifts. To update the client,
edit the canonical file and re-copy:

```bash
cp integrations/_pyclient/three_ws_client.py integrations/blender/three_ws/three_ws_client.py
cp integrations/_pyclient/three_ws_client.py integrations/comfyui/three_ws_nodes/three_ws_client.py
cp integrations/_pyclient/three_ws_client.py integrations/modly/three-ws/three_ws_client.py
cp integrations/_pyclient/three_ws_client.py integrations/modly/three-ws-publish/three_ws_client.py
cp integrations/_pyclient/three_ws_client.py integrations/huggingface-space/three_ws_client.py
cp integrations/_pyclient/three_ws_client.py integrations/poe/three_ws_client.py
```

## Tests

No live network — every test runs an in-process stub of the Forge contract.

```bash
# shared client + drift guard
python -m unittest discover -s integrations/_pyclient -p 'test_*.py'

# comfyui nodes
( cd integrations/comfyui/three_ws_nodes && python -m unittest test_nodes )

# modly extensions (loads generator.py the way Modly does)
python -m unittest discover -s integrations/modly/tests -p 'test_*.py'
```

The Blender add-on is import-guarded on `bpy` (only present inside Blender); its
syntax is validated in CI via `ast.parse`.
