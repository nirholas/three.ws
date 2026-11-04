"""Shared output for the generation tools: a text summary, the viewer link, a
JSON result for workflow variables, and optionally the GLB itself as a file."""

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from three_ws_client import ThreeWsError, ThreeWsPending, download, model_urls, run_generation


def generate(
    tool: Tool, name: str, arguments: dict[str, Any], label: str, attach_glb: bool
) -> Generator[ToolInvokeMessage, None, None]:
    try:
        result = run_generation(name, arguments)
    except ThreeWsPending as pending:
        yield tool.create_text_message(str(pending))
        yield tool.create_json_message({"status": "pending", "job_id": pending.job_id, "viewer_url": pending.viewer_url})
        return
    except ThreeWsError as error:
        yield tool.create_text_message(f"Error: {error}")
        yield tool.create_json_message({"status": "error", "error": str(error)})
        return

    urls = model_urls(result)
    glb = urls.get("glb_url", "")
    lines = [f"Generated a {label} (GLB)."]
    if glb:
        lines.append(f"GLB: {glb}")
    if urls.get("viewer_url"):
        lines.append(f"View in the browser: {urls['viewer_url']}")
    if urls.get("ar_url"):
        lines.append(f"View in AR: {urls['ar_url']}")
    yield tool.create_text_message("\n".join(lines))
    if urls.get("viewer_url"):
        yield tool.create_link_message(urls["viewer_url"])
    yield tool.create_json_message({"status": "done", **urls, "rigged": bool(result.get("rigged"))})

    if attach_glb and glb:
        try:
            data = download(glb)
        except ThreeWsError as error:
            yield tool.create_text_message(f"The model was generated but not attached: {error}")
            return
        yield tool.create_blob_message(
            blob=data, meta={"mime_type": "model/gltf-binary", "filename": f"{name}.glb"}
        )
