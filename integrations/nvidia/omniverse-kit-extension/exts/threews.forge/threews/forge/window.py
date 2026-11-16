"""The three.ws Forge panel.

Sections, top to bottom: Account (API key, balance), Generate (text or image,
lane, placement, Generate/Cancel, real progress), and My models (the key
owner's saved models with Import). The window only renders state; every
action goes through ``ForgeController``.
"""

from __future__ import annotations

import asyncio
import os
import webbrowser
from typing import List, Optional

import omni.ui as ui

from . import settings
from .controller import ForgeController, Outcome
from .service import LANES, Account, is_image_url, ForgeError, GenerationRequest, LibraryModel, Progress

WINDOW_TITLE = "three.ws Forge"

LANE_IDS = ["draft", "standard", "high"]
PLACEMENT_IDS = ["origin", "selection", "camera"]
PLACEMENT_LABELS = ["World origin", "At the selected prim", "In front of the camera"]

ACCENT = 0xFF4FB3FF
ERROR = 0xFF5C5CFF
OK = 0xFF7BD88F
MUTED = 0xFF9A9A9A

STYLE = {
    "Button": {"padding": 6, "border_radius": 4, "background_color": 0xFF3A3A3A},
    "Button:hovered": {"background_color": 0xFF4A4A4A},
    "Button:pressed": {"background_color": 0xFF2A2A2A},
    "Button:disabled": {"background_color": 0xFF2C2C2C},
    "Button.Label:disabled": {"color": 0xFF6A6A6A},
    "Button::primary": {"background_color": 0xFFB86B1F},
    "Button::primary:hovered": {"background_color": 0xFFD07E2B},
    "Button::primary:pressed": {"background_color": 0xFF9A5714},
    "Field": {"padding": 4, "border_radius": 3},
    "Field:hovered": {"border_color": 0xFF6A6A6A, "border_width": 1},
    "Label::section": {"font_size": 16, "color": 0xFFDDDDDD},
    "Label::muted": {"color": MUTED},
    "Label::status": {"color": MUTED},
    "Label::status_error": {"color": ERROR},
    "Label::status_ok": {"color": OK},
    "ProgressBar": {"color": ACCENT, "border_radius": 3, "secondary_color": 0xFF2A2A2A},
}


class ForgeWindow(ui.Window):
    def __init__(self, controller: ForgeController, **kwargs):
        super().__init__(WINDOW_TITLE, width=420, height=720, **kwargs)
        self.controller = controller
        self.frame.style = STYLE
        self._unsubscribe = controller.subscribe(self._on_event)
        self._library: List[LibraryModel] = []
        self._library_note = "Your saved three.ws models appear here."
        self._next_cursor = ""
        self._mode = ui.SimpleIntModel(0)
        self._key_model = ui.SimpleStringModel(settings.api_key() if settings.key_source() == "settings" else "")
        self._prompt_model = ui.SimpleStringModel("")
        self._image_model = ui.SimpleStringModel("")
        self._name_model = ui.SimpleStringModel("")
        self._save_model = ui.SimpleBoolModel(settings.save_to_account())
        self._built = False
        self._account_status = (self._account_text(), False, False)
        self.frame.set_build_fn(self._build)
        asyncio.ensure_future(self._refresh_account(silent=True))

    def destroy(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None
        super().destroy()

    # -- layout -----------------------------------------------------------

    def _build(self) -> None:
        with ui.ScrollingFrame(horizontal_scrollbar_policy=ui.ScrollBarPolicy.SCROLLBAR_ALWAYS_OFF):
            with ui.VStack(spacing=8, height=0):
                ui.Spacer(height=2)
                self._build_account()
                ui.Separator(height=6)
                self._build_generate()
                ui.Separator(height=6)
                self._build_library()
        self._built = True
        text, error, ok = self._account_status
        self._set_account_status(text, error=error, ok=ok)
        self._render_library()

    def _build_account(self) -> None:
        with ui.CollapsableFrame("Account", collapsed=False, height=0):
            with ui.VStack(spacing=6, height=0):
                ui.Label(
                    "Draft and Standard need no account. A three.ws API key adds High, My models and saving to your account.",
                    name="muted",
                    word_wrap=True,
                )
                with ui.HStack(height=26, spacing=4):
                    self._key_field = ui.StringField(self._key_model, password_mode=True, tooltip="sk_live_... from three.ws/dashboard/api")
                    ui.Button("Save", width=60, clicked_fn=self._save_key, tooltip="Store the key in Kit settings and check it")
                    ui.Button("Clear", width=60, clicked_fn=self._clear_key, tooltip="Remove the stored key")
                with ui.HStack(height=20, spacing=6):
                    self._account_label = ui.Label("", name="status", word_wrap=True)
                    ui.Button("Get a key", width=90, height=20, clicked_fn=lambda: webbrowser.open(f"{settings.base_url()}/dashboard/api"))

    def _build_generate(self) -> None:
        with ui.CollapsableFrame("Generate", collapsed=False, height=0):
            with ui.VStack(spacing=6, height=0):
                with ui.HStack(height=24, spacing=4):
                    ui.Label("Input", width=80)
                    combo = ui.ComboBox(self._mode.as_int, "Text prompt", "Reference image")
                    combo.model.get_item_value_model().add_value_changed_fn(lambda m: self._set_mode(m.as_int))
                self._prompt_stack = ui.VStack(spacing=4, height=0)
                with self._prompt_stack:
                    ui.Label("Describe one subject", name="muted")
                    self._prompt_field = ui.StringField(self._prompt_model, multiline=True, height=60, tooltip="For example: a weathered brass ship lantern")
                self._image_stack = ui.VStack(spacing=4, height=0, visible=False)
                with self._image_stack:
                    ui.Label("A PNG, JPEG or WebP file, or a public https:// image URL, of one object on a plain background", name="muted", word_wrap=True)
                    with ui.HStack(height=24, spacing=4):
                        self._image_field = ui.StringField(self._image_model, tooltip="Path to a local image, or a public https:// image URL")
                        ui.Button("Browse", width=70, clicked_fn=self._browse_image)
                with ui.HStack(height=24, spacing=4):
                    ui.Label("Name", width=80)
                    ui.StringField(self._name_model, tooltip="Prim name in the stage (optional)")
                with ui.HStack(height=24, spacing=4):
                    ui.Label("Quality", width=80)
                    self._lane_combo = ui.ComboBox(LANE_IDS.index(settings.lane()), *[LANES[l]["label"] for l in LANE_IDS])
                    self._lane_combo.model.get_item_value_model().add_value_changed_fn(
                        lambda m: settings.set_lane(LANE_IDS[m.as_int])
                    )
                with ui.HStack(height=24, spacing=4):
                    ui.Label("Place", width=80)
                    self._place_combo = ui.ComboBox(PLACEMENT_IDS.index(settings.placement()), *PLACEMENT_LABELS)
                    self._place_combo.model.get_item_value_model().add_value_changed_fn(
                        lambda m: settings.set_placement(PLACEMENT_IDS[m.as_int])
                    )
                with ui.HStack(height=22, spacing=4):
                    ui.CheckBox(self._save_model, width=20)
                    self._save_model.add_value_changed_fn(lambda m: settings.set_save_to_account(m.as_bool))
                    ui.Label("Also save to my three.ws models (needs a key)", name="muted")
                with ui.HStack(height=32, spacing=6):
                    self._generate_btn = ui.Button("Generate", name="primary", clicked_fn=self._generate, tooltip="Generate and import into the stage")
                    self._cancel_btn = ui.Button("Cancel", width=90, clicked_fn=self.controller.cancel, enabled=False)
                self._progress_model = ui.SimpleFloatModel(0.0)
                self._progress = ui.ProgressBar(self._progress_model, height=8, visible=False)
                self._status = ui.Label("Ready. Type a prompt and press Generate.", name="status", word_wrap=True)
                with ui.HStack(height=22, spacing=6):
                    self._fix_btn = ui.Button("Fix this", width=90, visible=False)

    def _build_library(self) -> None:
        with ui.CollapsableFrame("My models", collapsed=False, height=0):
            with ui.VStack(spacing=6, height=0):
                with ui.HStack(height=24, spacing=4):
                    self._library_label = ui.Label(self._library_note, name="muted", word_wrap=True)
                    ui.Button("Refresh", width=80, clicked_fn=lambda: asyncio.ensure_future(self._load_library(reset=True)))
                self._library_stack = ui.VStack(spacing=4, height=0)
                self._more_btn = ui.Button("Load more", height=24, visible=False, clicked_fn=lambda: asyncio.ensure_future(self._load_library()))

    # -- account ----------------------------------------------------------

    def _account_text(self, account: Optional[Account] = None) -> str:
        source = settings.key_source()
        if source == "none":
            return "No key. Free lanes only."
        redacted = settings.redact(settings.api_key())
        if account is None:
            return f"Key {redacted} ({source})"
        price = f", High costs ${account.high_price_usd:.2f}" if account.high_price_usd is not None else ""
        return f"Key {redacted} accepted. Balance ${account.balance_usd:.2f}{price}."

    def _save_key(self) -> None:
        value = self._key_model.as_string.strip()
        if value and not settings.looks_like_key(value):
            self._set_account_status("That is not a three.ws API key. Keys start with sk_live_ or sk_test_.", error=True)
            return
        settings.set_api_key(value)
        self.controller.reload()
        asyncio.ensure_future(self._refresh_account())

    def _clear_key(self) -> None:
        settings.clear_api_key()
        self._key_model.set_value("")
        self.controller.reload()
        self._library = []
        self._next_cursor = ""
        self._library_note = "Add an API key to browse the models saved in your three.ws account."
        self._render_library()
        self._set_account_status(self._account_text())

    async def _refresh_account(self, silent: bool = False) -> None:
        if settings.key_source() == "none":
            self._set_account_status(self._account_text())
            return
        self._set_account_status("Checking the key...")
        try:
            account = await self.controller.refresh_account()
        except ForgeError as exc:
            self._set_account_status(str(exc), error=True)
            return
        self._set_account_status(self._account_text(account), ok=True)
        if not silent or not self._library:
            await self._load_library(reset=True)

    def _set_account_status(self, text: str, *, error: bool = False, ok: bool = False) -> None:
        self._account_status = (text, error, ok)
        if not self._built:
            return
        self._account_label.text = text
        self._account_label.name = "status_error" if error else ("status_ok" if ok else "status")

    # -- generate ---------------------------------------------------------

    def _set_mode(self, mode: int) -> None:
        self._prompt_stack.visible = mode == 0
        self._image_stack.visible = mode == 1

    def _browse_image(self) -> None:
        try:
            from omni.kit.window.filepicker import FilePickerDialog
        except ImportError:
            self._set_status("Paste the image path into the field (the file picker extension is not loaded).", error=True)
            return

        def on_click(filename: str, dirname: str) -> None:
            self._image_model.set_value(os.path.join(dirname, filename) if dirname else filename)
            dialog.hide()

        dialog = FilePickerDialog(
            "Choose a reference image",
            apply_button_label="Use image",
            click_apply_handler=on_click,
            item_filter_options=["Images (*.png, *.jpg, *.jpeg, *.webp)"],
        )
        dialog.show()

    def _request(self) -> GenerationRequest:
        image = self._image_model.as_string.strip() if self._mode.as_int == 1 else ""
        return GenerationRequest(
            prompt=self._prompt_model.as_string,
            image_path=image,
            lane=settings.lane(),
            name=self._name_model.as_string,
        )

    def _generate(self) -> None:
        request = self._request()
        if request.image_path and not is_image_url(request.image_path) and not os.path.isfile(request.image_path):
            self._set_status(f"Image not found: {request.image_path}", error=True)
            return
        try:
            self.controller.start(request)
        except ForgeError as exc:
            self._show_error(exc)

    def _set_busy(self, busy: bool) -> None:
        self._generate_btn.enabled = not busy
        self._cancel_btn.enabled = busy
        self._progress.visible = busy

    def _set_status(self, text: str, *, error: bool = False, ok: bool = False) -> None:
        self._status.text = text
        self._status.name = "status_error" if error else ("status_ok" if ok else "status")

    def _show_error(self, exc: Exception) -> None:
        self._set_status(str(exc), error=True)
        url = getattr(exc, "url", "")
        self._fix_btn.visible = bool(url)
        if url:
            self._fix_btn.set_clicked_fn(lambda: webbrowser.open(url))

    def _on_event(self, event: str, payload: object) -> None:
        if not self._built:
            return
        if event == "started":
            self._fix_btn.visible = False
            self._progress_model.set_value(0.0)
            self._set_busy(True)
            self._set_status("Starting...")
        elif event == "progress" and isinstance(payload, Progress):
            if payload.fraction is not None:
                self._progress_model.set_value(payload.fraction)
            self._set_status(f"{payload.message} ({payload.elapsed:.0f}s)")
        elif event == "done" and isinstance(payload, Outcome):
            self._set_busy(False)
            g, imp = payload.generation, payload.imported
            where = f" at {imp.prim_path}" if imp else ""
            saved = " Saved to My models." if g and g.saved_model else ""
            self._set_status(f"Imported{where} in {g.seconds:.0f}s ({g.lane}).{saved}", ok=True)
            if g and g.saved_model:
                asyncio.ensure_future(self._load_library(reset=True))
        elif event == "cancelled":
            self._set_busy(False)
            self._set_status("Cancelled. Nothing was imported.")
        elif event == "error":
            self._set_busy(False)
            self._show_error(payload)
        elif event == "imported":
            self._set_status(f"Imported at {payload.prim_path}.", ok=True)
        elif event == "account_error":
            self._set_account_status(str(payload), error=True)

    # -- library ----------------------------------------------------------

    async def _load_library(self, reset: bool = False) -> None:
        if settings.key_source() == "none":
            self._library = []
            self._next_cursor = ""
            self._library_note = "Add an API key to browse the models saved in your three.ws account."
            self._render_library()
            return
        if reset:
            self._library = []
            self._next_cursor = ""
        self._library_note = "Loading your models..."
        self._render_library()
        try:
            models, cursor = await self.controller.list_models(cursor=self._next_cursor)
        except ForgeError as exc:
            self._library_note = str(exc)
            self._render_library()
            return
        self._library.extend(models)
        self._next_cursor = cursor
        if not self._library:
            self._library_note = "No saved models yet. Generate one with 'Also save to my three.ws models' ticked."
        else:
            self._library_note = f"{len(self._library)} model{'s' if len(self._library) != 1 else ''}"
        self._render_library()

    def _render_library(self) -> None:
        if not self._built:
            return
        self._library_label.text = self._library_note
        self._library_stack.clear()
        with self._library_stack:
            for model in self._library:
                with ui.HStack(height=26, spacing=6):
                    ui.Label(model.name, elided_text=True, tooltip=f"{model.visibility}, {model.size_bytes // 1024} KB, {model.created_at[:10]}")
                    ui.Label(f"{model.size_bytes / 1_048_576:.1f} MB", width=60, name="muted")
                    ui.Button("Import", width=70, clicked_fn=lambda m=model: asyncio.ensure_future(self._import_model(m)))
        self._more_btn.visible = bool(self._next_cursor)

    async def _import_model(self, model: LibraryModel) -> None:
        if self.controller.busy:
            self._set_status("Wait for the running generation to finish, or cancel it.", error=True)
            return
        self._generate_btn.enabled = False
        self._fix_btn.visible = False
        try:
            await self.controller.import_library_model(model)
        except Exception as exc:
            self._show_error(exc)
        finally:
            self._generate_btn.enabled = True
