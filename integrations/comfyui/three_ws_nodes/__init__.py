"""Forge by three.ws nodes for ComfyUI.

Drop this folder into ``ComfyUI/custom_nodes/`` and restart ComfyUI. Two nodes
appear under the "three.ws" category: Text→3D and Image→3D.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
