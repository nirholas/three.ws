from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.model_output import generate


class Generate3dModelTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        prompt = str(tool_parameters.get("prompt") or "").strip()
        if len(prompt) < 3:
            yield self.create_text_message("Error: describe the object to generate in at least 3 characters.")
            return
        tier = tool_parameters.get("tier") or "standard"
        yield from generate(
            self,
            "forge_free",
            {"prompt": prompt[:1000], "tier": tier},
            "textured 3D model",
            bool(tool_parameters.get("attach_glb")),
        )
