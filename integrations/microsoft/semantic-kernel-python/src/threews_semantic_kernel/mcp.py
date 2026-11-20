"""Attach the hosted three.ws MCP server to a Semantic Kernel kernel.

The free 3D Studio server at ``https://three.ws/api/mcp-studio`` speaks MCP
over Streamable HTTP, which Semantic Kernel's ``MCPStreamableHttpPlugin``
connects to directly. Its tools (generation, rigging, catalog, docs search,
agent personas) then appear as kernel functions next to any native plugin.

Making or rigging a model there needs a three.ws account, so the plugin sends
``THREE_WS_API_KEY`` (or ``api_key``) as a bearer. Without a key the catalog
and docs tools still work and the generation tools answer ``sign_in_required``.
"""

from __future__ import annotations

import os
from typing import Any

from .client import DEFAULT_BASE_URL, FREE_MCP_PATH


def three_ws_mcp_url(base_url: str | None = None) -> str:
    """Return the Streamable HTTP URL of the free three.ws MCP server."""
    base = (base_url or os.environ.get("THREE_WS_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    return f"{base}{FREE_MCP_PATH}"


def create_three_ws_mcp_plugin(
    *,
    name: str = "threews_studio",
    base_url: str | None = None,
    api_key: str | None = None,
    request_timeout: int = 120,
    **kwargs: Any,
):
    """Build an ``MCPStreamableHttpPlugin`` for the three.ws 3D Studio server.

    Use it as an async context manager, then add it to the kernel::

        async with create_three_ws_mcp_plugin() as studio:
            kernel.add_plugin(studio)

    Args:
        name: The plugin name the tools are grouped under in the kernel.
        base_url: The three.ws origin, for a self-hosted deployment.
        api_key: A three.ws API key (default ``THREE_WS_API_KEY``), from
            https://three.ws/dashboard/api-keys. Needed by the tools that make
            or rig a model.
        request_timeout: Seconds to wait for one tool call. Generation tools
            can take a minute or more, so keep this generous.
        **kwargs: Passed through to ``MCPStreamableHttpPlugin``.

    Requires the ``mcp`` extra: ``pip install "threews-semantic-kernel[mcp]"``.
    """
    try:
        from semantic_kernel.connectors.mcp import MCPStreamableHttpPlugin
    except ImportError as err:
        raise ImportError(
            'the three.ws MCP helper needs the mcp extra: pip install "threews-semantic-kernel[mcp]"'
        ) from err
    key = api_key or os.environ.get("THREE_WS_API_KEY") or None
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    headers.update(kwargs.pop("headers", None) or {})
    return MCPStreamableHttpPlugin(
        name=name,
        url=three_ws_mcp_url(base_url),
        description="three.ws free 3D Studio: generate, rig, inspect and find 3D models.",
        request_timeout=request_timeout,
        headers=headers or None,
        **kwargs,
    )
