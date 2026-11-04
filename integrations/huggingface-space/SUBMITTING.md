# Publishing the Space

Spaces are created under a Hugging Face account or organization; the repo's `README.md` front matter is the Space config.

## Verified 2026-11-04

- `python3 -m pytest test_app.py`: 4 passed.
- `python3 app.py` served the UI on :7860 and the MCP schema at `/gradio_api/mcp/schema` lists one tool, `forge_text_to_3d(prompt, tier)`.
- A real MCP client (the `mcp` Python SDK over SSE at `http://127.0.0.1:7860/gradio_api/mcp/sse`) ran `initialize`, `tools/list` (`['forge_text_to_3d']`) and `tools/call forge_text_to_3d {"prompt": "a small wooden chair", "tier": "draft"}`. The call returned a downloaded `a-small-wooden-chair.glb` (1,754,688 bytes, `glTF` magic) from production Forge plus the viewer link.

## Owner steps

1. Create the Space (SDK Gradio) under the three.ws Hugging Face organization.
2. Push the contents of this folder as the Space repo root (`app.py`, `requirements.txt`, `three_ws_client.py`, `README.md`).
3. Confirm the build turns green and the Space appears under the `mcp-server` filter at <https://huggingface.co/spaces?filter=mcp-server>.
4. Add the Space URL to `marketing/growth/opportunities.md`.

No secrets are required. Order 938 owns this step.
