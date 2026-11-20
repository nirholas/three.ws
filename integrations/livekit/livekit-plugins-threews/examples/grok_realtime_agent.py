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

"""Grok Voice realtime driving a three.ws avatar through LiveKit Agents.

LiveKit already ships an xAI plugin (``livekit-plugins-xai``) whose
``xai.realtime.RealtimeModel`` speaks xAI's Grok Voice realtime API: the
caller's audio goes straight to the speech-to-speech model and its spoken
reply comes straight back, with no separate STT, LLM and TTS legs. This
example hands that model to an ``AgentSession`` and starts the three.ws
``AvatarSession`` on the same session, so a ``<agent-3d voice="livekit">``
embed in the room animates the avatar from the reply transcript, gesture
cues and the caller's speaking state.

The avatar plugin needs nothing Grok specific: it listens to the session's
``conversation_item_added``, ``user_input_transcribed`` and
``user_state_changed`` events, which a realtime model fires the same way a
cascade pipeline does.

Needs ``XAI_API_KEY`` (Grok Voice is billed per minute of session by xAI)
plus a LiveKit server (``LIVEKIT_URL``, ``LIVEKIT_API_KEY``,
``LIVEKIT_API_SECRET``); the open-source ``livekit-server --dev`` works:

    pip install "livekit-plugins-threews[grok]"
    python grok_realtime_agent.py connect --room grok-avatar
"""

from __future__ import annotations

import os

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import threews, xai

INSTRUCTIONS = (
    "You are a friendly 3D avatar on three.ws. You are speaking out loud, so keep "
    "every reply to one or two short sentences, with no lists, markdown or emoji."
)


class GrokAvatarAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=INSTRUCTIONS)

    async def on_enter(self) -> None:
        self.session.generate_reply(instructions="Greet the visitor in one sentence.")


def build_session(voice: str | None = None) -> AgentSession:
    """An ``AgentSession`` whose only model is Grok Voice realtime.

    ``xai.realtime.RealtimeModel`` reads ``XAI_API_KEY`` from the environment
    and raises if it is missing, so a misconfigured worker fails at session
    setup with a clear message instead of a websocket auth error later.
    """
    return AgentSession(
        llm=xai.realtime.RealtimeModel(voice=voice or os.getenv("GROK_VOICE", "Ara")),
    )


server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    session = build_session()
    avatar = threews.AvatarSession()
    await avatar.start(session, room=ctx.room)

    await session.start(agent=GrokAvatarAgent(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
