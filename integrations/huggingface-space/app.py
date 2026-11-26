"""Forge by three.ws as a Gradio app and a Model Context Protocol server.

``demo.launch(mcp_server=True)`` publishes the ``forge_text_to_3d`` function as
an MCP tool at ``/gradio_api/mcp/sse`` (and ``/gradio_api/mcp/``), next to the
web UI with a 3D model viewer. Generation runs on the free Forge lane at
https://three.ws/api/forge through the shared stdlib client.

Making a model needs a free three.ws account. Each caller can paste their own
API key (from https://three.ws/dashboard/api-keys) into the key field or pass
``api_key`` to the MCP tool. A Space operator can instead set a
``THREE_WS_API_KEY`` secret, in which case every generation without a caller key
is made under the operator's account.
"""

from __future__ import annotations

import os
import tempfile
import time

import gradio as gr

from three_ws_client import TIERS, ThreeWSClient, ThreeWSError, slugify

BASE_URL = os.environ.get("THREEWS_BASE_URL", "https://three.ws")
POLL_TIMEOUT = float(os.environ.get("FORGE_POLL_TIMEOUT", "240"))
NO_KEY = (
    "Making a model needs a free three.ws account. Create an API key at "
    "https://three.ws/dashboard/api-keys and paste it into the API key field."
)


def _viewer_url(glb_url: str) -> str:
    from urllib.parse import quote

    return f"{BASE_URL.rstrip('/')}/viewer?src={quote(glb_url, safe='')}"


def forge_text_to_3d(prompt: str, tier: str = "draft", api_key: str = "", progress=gr.Progress()):
    """Generate a textured 3D model (GLB) from a text prompt with Forge by three.ws.

    Args:
        prompt: Plain-language description of one object, for example "a small wooden chair".
        tier: Quality tier, one of "draft" (fastest), "standard" (2K textures) or "high" (maximum detail).
        api_key: Your three.ws API key from https://three.ws/dashboard/api-keys. Making a model needs a free account. Leave empty to use the Space's THREE_WS_API_KEY secret when it has one.

    Returns:
        The generated GLB file, the three.ws viewer link and a one-line status.
    """
    if tier not in TIERS:
        raise gr.Error(f"tier must be one of {', '.join(TIERS)}.")
    # None falls back to the THREE_WS_API_KEY secret inside the client.
    client = ThreeWSClient(BASE_URL, timeout=90, api_key=(api_key or "").strip() or None)
    if not client.api_key:
        raise gr.Error(NO_KEY)
    started = time.monotonic()
    try:
        progress(0, desc="Submitting to Forge")
        submission = client.submit_text_to_3d(prompt, tier=tier)

        def on_progress(status: str, elapsed: float) -> None:
            label = "Waiting for a free GPU" if status == "queued" else "Generating mesh and textures"
            progress(min(elapsed / POLL_TIMEOUT, 0.95), desc=f"{label} ({int(elapsed)}s)")

        glb_url = client.wait(submission, on_progress=on_progress, timeout=POLL_TIMEOUT)
        dest = os.path.join(tempfile.mkdtemp(prefix="forge-"), f"{slugify(prompt) or 'model'}.glb")
        client.download(glb_url, dest)
    except ThreeWSError as exc:
        hint = {
            "timeout": " The free lane is busy, try again in a minute or pick the draft tier.",
            "unreachable": " Check that the Space can reach three.ws.",
        }.get(exc.code, "")
        if exc.status == 429:
            hint = " The free rate limit was hit, wait a few minutes and retry."
        raise gr.Error(f"{exc}{hint}") from exc
    return dest, _viewer_url(glb_url), f"Done in {int(time.monotonic() - started)}s via {submission.get('backend', 'forge')}: {glb_url}"


with gr.Blocks(title="Forge: AI 3D Model Generator") as demo:
    gr.Markdown(
        "# Forge: AI 3D Model Generator\nText to textured 3D (GLB) on the free engine grid. "
        "Making a model needs a free three.ws account: paste an API key from "
        "[three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). "
        "This Space is also an MCP server: point an MCP client at `/gradio_api/mcp/sse`."
    )
    with gr.Row():
        with gr.Column():
            prompt_in = gr.Textbox(label="Prompt", placeholder="a small wooden chair", lines=2)
            tier_in = gr.Dropdown(list(TIERS), value="draft", label="Quality tier")
            key_in = gr.Textbox(
                label="three.ws API key",
                type="password",
                placeholder="sk_live_... (leave empty if this Space has its own key)",
            )
            go = gr.Button("Forge model", variant="primary")
        with gr.Column():
            model_out = gr.Model3D(label="Model", clear_color=(0.1, 0.1, 0.12, 1.0))
            link_out = gr.Textbox(label="three.ws viewer link", interactive=False)
            status_out = gr.Textbox(label="Status", interactive=False)
    go.click(forge_text_to_3d, [prompt_in, tier_in, key_in], [model_out, link_out, status_out], api_name="forge_text_to_3d")
    prompt_in.submit(forge_text_to_3d, [prompt_in, tier_in, key_in], [model_out, link_out, status_out], api_name=False)

demo.queue(default_concurrency_limit=2)

if __name__ == "__main__":
    demo.launch(mcp_server=True, server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
