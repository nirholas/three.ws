---
title: "Forge: AI 3D Model Generator"
emoji: 🧊
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: 6.31.0
app_file: app.py
pinned: false
license: apache-2.0
short_description: Text to textured 3D (GLB) by three.ws, with an MCP server
tags:
  - mcp-server
  - 3d
  - text-to-3d
  - glb
---

# Forge: AI 3D Model Generator (Gradio Space and MCP server)

Type a prompt, get a textured GLB and a three.ws viewer link. The same function is exposed as an MCP tool, so any MCP client can generate 3D models from this Space.

Generation runs on the free Forge lane at <https://three.ws/api/forge>. Making a model needs a free three.ws account: create an API key at <https://three.ws/dashboard/api-keys> and paste it into the **three.ws API key** field (MCP clients pass it as the tool's `api_key` argument). If you run your own copy of the Space, you can set a `THREE_WS_API_KEY` secret instead; generations without a caller key are then made under your account, so you answer for them. The lane is rate limited per account, and when it is busy the app says so instead of failing silently.

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

The server exposes one tool, `forge_text_to_3d(prompt, tier, api_key)`. Tiers: `draft` (fastest), `standard` (2K textures), `high` (maximum detail).

`three_ws_client.py` is a byte-identical vendored copy of `integrations/_pyclient/three_ws_client.py`; `integrations/_pyclient/test_no_drift.py` fails if it drifts.

License: Apache-2.0.
