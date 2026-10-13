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

"""Regression test for the AvatarSession._publish asyncio bug.

``rtc.LocalParticipant.publish_data`` is a coroutine function. The event
handlers that call it (``_on_conversation_item_added`` and friends) are
invoked synchronously by ``rtc.EventEmitter.emit``, which does not await
or schedule whatever its callback returns. Calling the coroutine function
directly without ``await`` or ``asyncio.ensure_future`` therefore builds a
coroutine object that is never driven: ``publish_data`` never actually
runs, Python only raises a ``RuntimeWarning: coroutine ... was never
awaited`` at garbage-collection time, and no data ever reaches the room.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from livekit.agents.llm import ChatMessage
from livekit.agents.voice.events import ConversationItemAddedEvent
from livekit.plugins.threews.avatar import AvatarSession


class _FakeLocalParticipant:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []

    async def publish_data(self, payload, *, reliable=True, topic="") -> None:
        await asyncio.sleep(0)
        self.published.append((topic, json.loads(payload)))


class _FakeRoom:
    def __init__(self, local_participant: _FakeLocalParticipant) -> None:
        self.local_participant = local_participant


@pytest.mark.asyncio
async def test_conversation_item_actually_publishes_data():
    """The assistant turn must actually reach the room, not just build a coroutine."""
    local = _FakeLocalParticipant()
    session = AvatarSession()
    session._room = _FakeRoom(local)

    event = ConversationItemAddedEvent(
        item=ChatMessage(role="assistant", content=["Hello! I'm the three.ws avatar."])
    )
    session._on_conversation_item_added(event)

    # Let the scheduled publish task(s) actually run.
    await asyncio.gather(*session._publish_tasks)

    assert local.published, "publish_data was never actually awaited/executed"
    topic, payload = local.published[0]
    assert topic == "threews.avatar"
    assert payload == {"type": "transcript", "text": "Hello! I'm the three.ws avatar."}
    # A greeting also carries a wave gesture cue.
    assert any(p == {"type": "gesture", "name": "wave"} for _, p in local.published)


@pytest.mark.asyncio
async def test_publish_without_room_is_a_noop():
    session = AvatarSession()
    session._on_conversation_item_added(
        ConversationItemAddedEvent(item=ChatMessage(role="assistant", content=["hi"]))
    )
    assert session._publish_tasks == set()
