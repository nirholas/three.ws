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

"""``AvatarSession`` on an ``AgentSession`` driven by Grok Voice realtime.

``examples/grok_realtime_agent.py`` gives the session one model,
``livekit-plugins-xai``'s ``xai.realtime.RealtimeModel``. That plugin
reports the caller's words as interim transcripts while they speak and only
marks one final when the reply's first audio arrives, which is *after* the
session has already moved the user from ``speaking`` to ``listening``. The
sequences below are the order ``AgentActivity`` emits those events in for a
realtime model (``_on_input_speech_stopped`` updates the user state, then
emits an empty interim transcript; the final one lands with the reply), so
the avatar's ``speech_ended`` is checked against what Grok really sends.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest

from livekit.agents import AgentSession
from livekit.agents.voice.events import UserInputTranscribedEvent, UserStateChangedEvent
from livekit.plugins import threews, xai


class _RecordingParticipant:
    def __init__(self) -> None:
        self.identity = "agent-grok"
        self.published: list[dict] = []

    async def publish_data(self, payload, *, reliable=True, topic="") -> None:
        assert topic == "threews.avatar"
        self.published.append(json.loads(payload))


class _Room:
    def __init__(self) -> None:
        self.local_participant = _RecordingParticipant()


def _grok_user_turn(session: AgentSession, interim: list[str], final: str) -> None:
    session.emit(
        "user_state_changed", UserStateChangedEvent(old_state="listening", new_state="speaking")
    )
    for text in interim:
        session.emit(
            "user_input_transcribed", UserInputTranscribedEvent(transcript=text, is_final=False)
        )
    session.emit(
        "user_state_changed", UserStateChangedEvent(old_state="speaking", new_state="listening")
    )
    session.emit("user_input_transcribed", UserInputTranscribedEvent(transcript="", is_final=False))
    session.emit(
        "user_input_transcribed", UserInputTranscribedEvent(transcript=final, is_final=True)
    )


async def _started_avatar() -> tuple[AgentSession, threews.AvatarSession, _Room]:
    session = AgentSession(llm=xai.realtime.RealtimeModel(api_key="replay-only"))
    avatar = threews.AvatarSession()
    room = _Room()
    await avatar.start(session, room=room)
    return session, avatar, room


@pytest.mark.asyncio
async def test_speech_ended_carries_what_the_caller_said_this_turn():
    """The final transcript arrives late; the turn's interim text must be used."""
    session, avatar, room = await _started_avatar()

    _grok_user_turn(
        session,
        interim=["what is the", "what is the tallest mountain"],
        final="What is the tallest mountain?",
    )
    await asyncio.gather(*avatar._publish_tasks)
    await avatar.aclose()

    assert room.local_participant.published == [
        {"type": "speech_started"},
        {"type": "speech_ended", "transcript": "what is the tallest mountain"},
    ]


@pytest.mark.asyncio
async def test_speech_ended_never_reports_the_previous_turn():
    """The late final transcript of turn one must not be attributed to turn two."""
    session, avatar, room = await _started_avatar()

    _grok_user_turn(session, interim=["hello there"], final="Hello there.")
    session.emit(
        "user_state_changed", UserStateChangedEvent(old_state="listening", new_state="speaking")
    )
    session.emit(
        "user_state_changed", UserStateChangedEvent(old_state="speaking", new_state="listening")
    )
    await asyncio.gather(*avatar._publish_tasks)
    await avatar.aclose()

    assert room.local_participant.published[-1] == {"type": "speech_ended", "transcript": ""}


def _load_example():
    path = Path(__file__).resolve().parent.parent / "examples" / "grok_realtime_agent.py"
    spec = importlib.util.spec_from_file_location("grok_realtime_agent", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_example_session_runs_on_grok_voice_realtime(monkeypatch):
    """The example's only model is xAI's Grok Voice realtime, with the chosen voice."""
    monkeypatch.setenv("XAI_API_KEY", "key-from-env")
    example = _load_example()

    session = example.build_session(voice="Rex")

    assert isinstance(session.llm, xai.realtime.RealtimeModel)
    assert session.llm.model == "grok-voice-latest"
    assert session.llm._opts.voice == "Rex"


def test_example_fails_fast_without_an_xai_key(monkeypatch):
    """No key is a setup error naming XAI_API_KEY, not a websocket failure later."""
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    example = _load_example()

    with pytest.raises(ValueError, match="XAI_API_KEY"):
        example.build_session()
