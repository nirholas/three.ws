from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.model_output import generate


class Create3dAvatarTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        prompt = str(tool_parameters.get("prompt") or "").strip()
        image_url = str(tool_parameters.get("image_url") or "").strip()
        if not prompt and not image_url:
            yield self.create_text_message("Error: describe the character, or give a reference image URL.")
            return
        if image_url and not image_url.startswith(("https://", "http://")):
            yield self.create_text_message("Error: the reference image must be an http(s) URL.")
            return
        arguments: dict[str, Any] = {}
        if prompt:
            arguments["prompt"] = prompt[:1000]
        if image_url:
            arguments["image_url"] = image_url
        if tool_parameters.get("allow_non_humanoid"):
            arguments["allow_non_humanoid"] = True
        yield from generate(
            self, "forge_avatar", arguments, "rigged 3D avatar", bool(tool_parameters.get("attach_glb"))
        )
