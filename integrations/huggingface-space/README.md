---
title: three.ws Forge
emoji: 🧊
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: 6.31.0
app_file: app.py
pinned: false
license: apache-2.0
short_description: Text to textured 3D (GLB) on the free three.ws Forge lane, with an MCP server.
tags:
  - mcp-server
  - 3d
  - text-to-3d
  - glb
---

# three.ws Forge (Gradio Space and MCP server)

Type a prompt, get a textured GLB and a three.ws viewer link. The same function is exposed as an MCP tool, so any MCP client can generate 3D models from this Space.

Generation runs on the free, auth-free Forge lane at <https://three.ws/api/forge>. No key is needed. The lane is rate limited per IP, and when it is busy the app says so instead of failing silently.

## Run it

```bash
pip install -r requirements.txt
python app.py            # web UI on :7860, MCP server at /gradio_api/mcp/sse
python -m unittest test_app.py
```

## Use it as an MCP server

```json
{
  "mcpServers": {
    "three-ws-forge": { "url": "https://<your-space>.hf.space/gradio_api/mcp/sse" }
  }
}
```

The server exposes one tool, `forge_text_to_3d(prompt, tier)`. Tiers: `draft` (fastest), `standard` (2K textures), `high` (maximum detail).

`three_ws_client.py` is a byte-identical vendored copy of `integrations/_pyclient/three_ws_client.py`; `integrations/_pyclient/test_no_drift.py` fails if it drifts.

License: Apache-2.0.
