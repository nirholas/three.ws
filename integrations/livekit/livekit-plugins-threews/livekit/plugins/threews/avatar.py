# Copyright 2026 three.ws
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from livekit import rtc
from livekit.agents import AgentSession, get_job_context
from livekit.agents.voice.avatar import AvatarSession as BaseAvatarSession
from livekit.agents.voice.events import (
    ConversationItemAddedEvent,
    UserInputTranscribedEvent,
    UserStateChangedEvent,
)

from .log import logger

DEFAULT_TOPIC = "threews.avatar"

# Gesture cues are a best-effort read of the assistant's own final text, the
# same heuristic family the browser widget already uses for lip sync
# (src/runtime/lipsync.js): no NLU model, just the opening/closing words a
# turn is likely to use. A miss just means no gesture fires, never a wrong
# one, so the pattern favors precision over recall.
_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey there|hey|greetings|good (morning|afternoon|evening))\b",
    re.IGNORECASE,
)
_FAREWELL_RE = re.compile(
    r"\b(goodbye|bye for now|take care|farewell)[.!]?\s*$",
    re.IGNORECASE,
)
_AGREEMENT_RE = re.compile(
    r"^\s*(yes|yeah|yep|absolutely|definitely|of course)\b",
    re.IGNORECASE,
)
_DISAGREEMENT_RE = re.compile(
    r"^\s*(no|nope|not quite|not really|unfortunately)\b",
    re.IGNORECASE,
)


def gesture_for_text(text: str) -> str | None:
    """Best-effort gesture slot name for a line of assistant speech, or ``None``.

    Returns one of the animation slot names three.ws avatars already know
    (``wave``, ``nod``, ``shrug``), matched against
    `src/runtime/animation-slots.js` in the three.ws client.
    """
    if _GREETING_RE.search(text) or _FAREWELL_RE.search(text):
        return "wave"
    if _AGREEMENT_RE.search(text):
        return "nod"
    if _DISAGREEMENT_RE.search(text):
        return "shrug"
    return None


class ThreeWsException(Exception):
    """Exception raised for three.ws avatar integration errors."""


class AvatarSession(BaseAvatarSession):
    """A three.ws avatar session.

    three.ws avatars (the `<agent-3d>` web component) render on the visitor's
    own device: the 3D model, its rig and its clip library already live in the
    browser. This plugin never synthesizes video. Instead it publishes small
    JSON messages over the LiveKit data channel that drive the browser's
    existing lip-sync and gesture systems:

    - ``{"type": "transcript", "text": "..."}`` for every finished assistant
      turn, which the browser times into visemes locally.
    - ``{"type": "gesture", "name": "wave" | "nod" | "shrug"}`` when the turn's
      text reads like a greeting, farewell, agreement or disagreement.
    - ``{"type": "speech_started"}`` / ``{"type": "speech_ended", "transcript": "..."}``
      around the user's own turns, so the avatar can switch to a listening pose.

    There is no separate avatar worker process and no dedicated avatar
    participant: the data is published from the agent's own identity, so
    `avatar_identity` returns the local participant's identity rather than a
    synthesized one.
    """

    def __init__(self, *, topic: str = DEFAULT_TOPIC) -> None:
        super().__init__()
        self._topic = topic
        self._room: rtc.Room | None = None
        self._agent_session: AgentSession | None = None
        self._last_user_transcript = ""
        self._closed = False
        self._publish_tasks: set[asyncio.Task[None]] = set()

    @property
    def avatar_identity(self) -> str:
        if self._room is None:
            raise ThreeWsException("avatar session has not started yet")
        return self._room.local_participant.identity

    @property
    def provider(self) -> str:
        return "threews"

    async def start(self, agent_session: AgentSession, room: rtc.Room) -> None:
        """Start publishing avatar motion data for ``agent_session`` into ``room``."""
        if self._closed:
            raise ThreeWsException("three.ws avatar session is closed")
        if self._room is not None:
            logger.warning("three.ws avatar session already started")
            return

        self._room = room
        self._agent_session = agent_session

        agent_session.on("conversation_item_added", self._on_conversation_item_added)
        agent_session.on("user_input_transcribed", self._on_user_input_transcribed)
        agent_session.on("user_state_changed", self._on_user_state_changed)

        job_ctx = get_job_context(required=False)
        if job_ctx is not None:
            job_ctx.add_shutdown_callback(self.aclose)
        else:
            logger.debug(
                "three.ws AvatarSession started outside a job context; "
                "call aclose() manually to release resources when the job shuts down"
            )

    async def aclose(self) -> None:
        if self._agent_session is not None:
            self._agent_session.off("conversation_item_added", self._on_conversation_item_added)
            self._agent_session.off("user_input_transcribed", self._on_user_input_transcribed)
            self._agent_session.off("user_state_changed", self._on_user_state_changed)
            self._agent_session = None
        self._room = None
        self._closed = True
        for task in list(self._publish_tasks):
            task.cancel()

    def _on_conversation_item_added(self, ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if getattr(item, "type", None) != "message" or getattr(item, "role", None) != "assistant":
            return
        text = item.text_content
        if not text:
            return
        self._publish({"type": "transcript", "text": text})
        gesture = gesture_for_text(text)
        if gesture:
            self._publish({"type": "gesture", "name": gesture})

    def _on_user_input_transcribed(self, ev: UserInputTranscribedEvent) -> None:
        if ev.is_final:
            self._last_user_transcript = ev.transcript

    def _on_user_state_changed(self, ev: UserStateChangedEvent) -> None:
        if ev.new_state == "speaking":
            self._publish({"type": "speech_started"})
        elif ev.old_state == "speaking":
            self._publish({"type": "speech_ended", "transcript": self._last_user_transcript})

    def _publish(self, payload: dict[str, Any]) -> None:
        if self._room is None:
            return
        local = self._room.local_participant
        if local is None:
            return
        # Event handlers fire synchronously (rtc.EventEmitter.emit does not
        # await coroutine results), so publish_data (an async RPC to the
        # rtc engine) must be scheduled as a task rather than called inline.
        task = asyncio.ensure_future(self._publish_async(local, payload))
        self._publish_tasks.add(task)
        task.add_done_callback(self._publish_tasks.discard)

    async def _publish_async(self, local: rtc.LocalParticipant, payload: dict[str, Any]) -> None:
        try:
            await local.publish_data(json.dumps(payload), reliable=True, topic=self._topic)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("failed to publish three.ws avatar data", exc_info=True)
