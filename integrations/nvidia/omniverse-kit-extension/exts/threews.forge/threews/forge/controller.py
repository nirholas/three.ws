"""The extension's single source of truth: one service, one running job, events out.

The window and scripts both drive this object. Blocking network work runs in a
thread executor so the Kit UI never stalls; progress callbacks are marshalled
back onto Kit's asyncio loop before any listener sees them, so listeners may
touch ``omni.ui`` and USD directly.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from dataclasses import dataclass
from typing import Callable, List, Optional

import carb.tokens

from . import settings
from .service import (
    Account,
    ForgeError,
    ForgeService,
    GenerationRequest,
    GenerationResult,
    LibraryModel,
    Progress,
)
from .stage_import import ImportResult, StageImportError, import_glb, import_usd

log = logging.getLogger("threews.forge")

Listener = Callable[[str, object], None]


@dataclass
class Outcome:
    generation: Optional[GenerationResult]
    imported: Optional[ImportResult]


def cache_dir() -> str:
    data = carb.tokens.get_tokens_interface().resolve("${data}")
    if not data or data.startswith("${"):
        data = os.path.join(os.path.expanduser("~"), ".cache")
    path = os.path.join(data, "threews.forge")
    os.makedirs(path, exist_ok=True)
    return path


class ForgeController:
    def __init__(self):
        self._listeners: List[Listener] = []
        self._cancel: Optional[threading.Event] = None
        self._task: Optional[asyncio.Future] = None
        self.account: Optional[Account] = None
        self.last_error: Optional[Exception] = None
        self.service = self._build_service()

    # -- wiring -----------------------------------------------------------

    def _build_service(self) -> ForgeService:
        return ForgeService(
            settings.base_url(),
            api_key=settings.api_key(),
            client_handle=settings.client_handle(),
            cache_dir=cache_dir(),
        )

    def reload(self) -> None:
        """Pick up a changed key or base URL."""
        self.service = self._build_service()
        self.account = None

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def _emit(self, event: str, payload: object = None) -> None:
        for listener in list(self._listeners):
            try:
                listener(event, payload)
            except Exception as exc:  # a broken listener must not break the job
                carb.log_error(f"[threews.forge] listener failed on {event}: {exc}")

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    async def _in_thread(self, fn, *args):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, fn, *args)

    def _progress_bridge(self) -> Callable[[Progress], None]:
        loop = asyncio.get_event_loop()

        def on_progress(progress: Progress) -> None:
            loop.call_soon_threadsafe(self._emit, "progress", progress)

        return on_progress

    # -- account ----------------------------------------------------------

    async def refresh_account(self) -> Optional[Account]:
        if not self.service.client.has_key:
            self.account = None
            self._emit("account", None)
            return None
        try:
            self.account = await self._in_thread(self.service.account)
        except ForgeError as exc:
            self.account = None
            self._emit("account_error", exc)
            raise
        log.info("three.ws key %s accepted", settings.redact(settings.api_key()))
        self._emit("account", self.account)
        return self.account

    # -- library ----------------------------------------------------------

    async def list_models(self, cursor: str = "", limit: int = 24):
        return await self._in_thread(lambda: self.service.list_models(cursor=cursor, limit=limit))

    async def import_library_model(self, model: LibraryModel, placement: Optional[str] = None) -> ImportResult:
        cancel = threading.Event()
        self._emit("progress", Progress("downloading", None, 0.0, f"Downloading {model.name}"))
        meta = {"model_id": model.id, "name": model.name}
        if model.usdz_url:
            path = await self._in_thread(lambda: self.service.fetch_usdz(model, cancel))
            result = import_usd(path, name=model.name, placement=placement or settings.placement(), metadata=meta)
        else:
            path = await self._in_thread(lambda: self.service.fetch_library_model(model, cancel))
            self._emit("progress", Progress("importing", None, 0.0, "Converting with the Kit asset converter"))
            result = await import_glb(path, name=model.name, placement=placement or settings.placement(), metadata=meta)
        self._emit("imported", result)
        return result

    # -- generation -------------------------------------------------------

    def cancel(self) -> None:
        if self._cancel is not None:
            self._cancel.set()
            self._emit("progress", Progress("cancelling", None, 0.0, "Cancelling"))

    def start(self, request: GenerationRequest, *, placement: Optional[str] = None, import_into_stage: bool = True) -> asyncio.Future:
        """Start a generation and return its future. One job at a time."""
        if self.busy:
            raise ForgeError("A generation is already running.", code="busy", hint="Wait for it or press Cancel.")
        self._task = asyncio.ensure_future(self.generate(request, placement=placement, import_into_stage=import_into_stage))
        return self._task

    async def generate(self, request: GenerationRequest, *, placement: Optional[str] = None, import_into_stage: bool = True) -> Outcome:
        self._cancel = threading.Event()
        cancel = self._cancel
        self.last_error = None
        self._emit("started", request)
        try:
            on_progress = self._progress_bridge()
            generation = await self._in_thread(
                lambda: self.service.generate(
                    request,
                    on_progress=on_progress,
                    cancel=cancel,
                    save_to_account=settings.save_to_account(),
                )
            )
            imported = None
            if import_into_stage:
                if cancel.is_set():
                    raise ForgeError("Cancelled.", code="cancelled", hint="Nothing was imported.")
                self._emit("progress", Progress("importing", 0.96, generation.seconds, "Converting with the Kit asset converter"))
                imported = await import_glb(
                    generation.glb_path,
                    name=generation.name,
                    placement=placement or settings.placement(),
                    metadata={
                        "glb_url": generation.glb_url,
                        "job_id": generation.job_id,
                        "lane": generation.lane,
                        "backend": generation.backend,
                        "prompt": request.prompt[:500],
                    },
                )
            outcome = Outcome(generation, imported)
            self._emit("done", outcome)
            return outcome
        except (ForgeError, StageImportError) as exc:
            self.last_error = exc
            self._emit("cancelled" if getattr(exc, "code", "") == "cancelled" else "error", exc)
            raise
        finally:
            self._cancel = None

    def shutdown(self) -> None:
        self.cancel()
        self._listeners.clear()
