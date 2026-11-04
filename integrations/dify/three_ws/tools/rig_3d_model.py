from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.model_output import generate


class Rig3dModelTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        glb_url = str(tool_parameters.get("glb_url") or "").strip()
        if not glb_url.startswith(("https://", "http://")):
            yield self.create_text_message("Error: give the http(s) URL of the GLB model to rig.")
            return
        yield from generate(
            self, "rig_mesh", {"glb_url": glb_url}, "rigged 3D model", bool(tool_parameters.get("attach_glb"))
        )
