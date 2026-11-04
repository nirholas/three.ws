from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from three_ws_client import ThreeWsError, call_tool

FIELDS = ("id", "kind", "title", "license", "categories", "tags", "glb_url", "viewer_url", "poster_png_url", "embed_html")


class Search3dAssetsTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        arguments: dict[str, Any] = {}
        query = str(tool_parameters.get("query") or "").strip()
        if query:
            arguments["q"] = query[:200]
        kind = tool_parameters.get("kind")
        if kind in ("object", "character", "animation"):
            arguments["kind"] = kind
        try:
            limit = int(tool_parameters.get("limit") or 8)
        except (TypeError, ValueError):
            limit = 8
        arguments["limit"] = min(max(limit, 1), 50)

        try:
            result = call_tool("search_catalog", arguments)
        except ThreeWsError as error:
            yield self.create_text_message(f"Error: {error}")
            yield self.create_json_message({"items": [], "matched": 0, "error": str(error)})
            return

        items = [{k: item[k] for k in FIELDS if item.get(k) not in (None, "", [])} for item in result.get("items", [])]
        matched = int(result.get("matched") if result.get("matched") is not None else len(items))
        if not items:
            yield self.create_text_message(
                f'No ready-made assets matched "{query}". Try a broader word, or generate one with the'
                " Generate 3D Model or Create 3D Avatar tool."
            )
        else:
            lines = [f"Found {matched} matching CC0 assets. Showing {len(items)}:"]
            for item in items:
                lines.append(f"- {item.get('title') or item.get('id')} ({item.get('kind', 'asset')}): {item.get('viewer_url') or item.get('glb_url')}")
            if result.get("relaxed"):
                lines.append("Not every word matched, so these are the closest results.")
            yield self.create_text_message("\n".join(lines))
        yield self.create_json_message({"items": items, "matched": matched, "next_offset": result.get("next_offset")})
