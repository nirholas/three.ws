"""Kit entry point for threews.forge.

The core (controller, service, stage import) works in any Kit app, headless
included. The panel and its Window menu entry load only when ``omni.ui`` is
present, so a farm node or a ``--no-window`` test run can still script
``threews.forge.generate_and_import``.
"""

from __future__ import annotations

from typing import Optional

import carb
import omni.ext

from .controller import ForgeController

MENU_PATH = "Window"
MENU_NAME = "three.ws Forge"

_controller: Optional[ForgeController] = None
_extension: Optional["ThreeWSForgeExtension"] = None


def get_window():
    """The open panel, or None (headless, or closed and never reopened)."""
    return _extension._window if _extension is not None else None


def get_controller() -> ForgeController:
    """The running extension's controller (creates one when used as a library)."""
    global _controller
    if _controller is None:
        _controller = ForgeController()
    return _controller


class ThreeWSForgeExtension(omni.ext.IExt):
    def on_startup(self, ext_id: str) -> None:
        global _controller, _extension
        _controller = ForgeController()
        _extension = self
        self._window = None
        self._menu = None
        try:
            import omni.ui  # noqa: F401  (probe: the panel needs a UI-capable app)
        except ImportError:
            carb.log_info("[threews.forge] omni.ui not available, running headless (scripting API only)")
            return
        self._register_menu()
        self.show_window(True)

    def _register_menu(self) -> None:
        try:
            import omni.kit.menu.utils as menu_utils
            from omni.kit.menu.utils import MenuItemDescription
        except ImportError:
            return
        self._menu = [
            MenuItemDescription(
                name=MENU_NAME,
                ticked=True,
                ticked_fn=lambda: self._window is not None and self._window.visible,
                onclick_fn=lambda *_: self.show_window(not (self._window is not None and self._window.visible)),
            )
        ]
        menu_utils.add_menu_items(self._menu, MENU_PATH)

    def show_window(self, visible: bool) -> None:
        if visible and self._window is None:
            from .window import ForgeWindow

            self._window = ForgeWindow(get_controller())
            self._window.set_visibility_changed_fn(self._on_visibility)
        if self._window is not None:
            self._window.visible = visible

    def _on_visibility(self, visible: bool) -> None:
        try:
            import omni.kit.menu.utils as menu_utils

            menu_utils.refresh_menu_items(MENU_PATH)
        except ImportError:
            pass

    def on_shutdown(self) -> None:
        global _controller, _extension
        _extension = None
        if self._menu:
            import omni.kit.menu.utils as menu_utils

            menu_utils.remove_menu_items(self._menu, MENU_PATH)
            self._menu = None
        if self._window is not None:
            self._window.destroy()
            self._window = None
        if _controller is not None:
            _controller.shutdown()
            _controller = None
