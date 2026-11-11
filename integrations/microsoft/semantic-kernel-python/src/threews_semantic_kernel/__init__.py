"""three.ws plugin for Semantic Kernel: 3D generation, asset search and agent messaging."""

from .client import DEFAULT_BASE_URL, ThreeWsClient, ThreeWsError, viewer_url
from .mcp import create_three_ws_mcp_plugin, three_ws_mcp_url
from .plugin import ThreeWsPlugin

__all__ = [
    "DEFAULT_BASE_URL",
    "ThreeWsClient",
    "ThreeWsError",
    "ThreeWsPlugin",
    "create_three_ws_mcp_plugin",
    "three_ws_mcp_url",
    "viewer_url",
]

__version__ = "0.1.0"
