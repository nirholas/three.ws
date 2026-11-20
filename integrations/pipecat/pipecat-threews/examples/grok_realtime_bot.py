#
# Copyright (c) 2026, three.ws
#
# SPDX-License-Identifier: Apache-2.0
#

"""Grok Voice realtime driving a three.ws avatar through Pipecat.

Pipecat ships its own speech-to-speech service for xAI's Grok Voice
realtime API (``pipecat.services.xai.realtime.llm.GrokRealtimeLLMService``):
the caller's microphone streams straight to the model and its spoken reply
streams straight back, with no separate STT, LLM and TTS hops. This example
puts ``ThreeWsAvatarProcessor`` after that service, so the same room also
receives the transcript, gesture and listening data a three.ws
``<agent-3d voice="livekit">`` embed animates the avatar from.

Nothing in the processor is Grok specific. It reads the TTS and user-turn
frames the realtime service already emits (``TTSStartedFrame``,
``TTSTextFrame``, ``TTSStoppedFrame``, and the ``UserStartedSpeakingFrame`` /
``UserStoppedSpeakingFrame`` pair the context aggregator resolves from
Grok's server-side voice activity detection).

Needs ``XAI_API_KEY`` plus a LiveKit server (``LIVEKIT_URL``,
``LIVEKIT_API_KEY``, ``LIVEKIT_API_SECRET``, ``LIVEKIT_ROOM_NAME``); the
open-source ``livekit-server --dev`` works. Grok Voice is billed per minute
of session by xAI.

    pip install "pipecat-threews[grok]"
    python grok_realtime_bot.py
"""

import asyncio
import os
import sys

from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.runner.livekit import configure
from pipecat.services.xai.realtime import events
from pipecat.services.xai.realtime.llm import GrokRealtimeLLMService
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport

from pipecat_threews import ThreeWsAvatarProcessor

INSTRUCTIONS = (
    "You are a friendly 3D avatar on three.ws. You are speaking out loud, so keep "
    "every reply to one or two short sentences, with no lists, markdown or emoji. "
    "Greet the visitor when they arrive."
)


def build_grok_service(api_key: str, voice: str = "eve") -> GrokRealtimeLLMService:
    """Grok Voice realtime with the avatar's persona and voice."""
    return GrokRealtimeLLMService(
        api_key=api_key,
        settings=GrokRealtimeLLMService.Settings(
            session_properties=events.SessionProperties(voice=voice, instructions=INSTRUCTIONS),
        ),
    )


def build_pipeline(transport: LiveKitTransport, llm: GrokRealtimeLLMService) -> Pipeline:
    """Room audio in, Grok, avatar data alongside Grok's audio, room out."""
    aggregators = LLMContextAggregatorPair(LLMContext())
    return Pipeline(
        [
            transport.input(),
            aggregators.user(),
            llm,
            ThreeWsAvatarProcessor(),
            transport.output(),
            aggregators.assistant(),
        ]
    )


async def main() -> None:
    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        sys.exit("Set XAI_API_KEY to an xAI API key to run the Grok Voice realtime example.")

    url, token, room_name = await configure()
    transport = LiveKitTransport(
        url,
        token,
        room_name,
        params=LiveKitParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    llm = build_grok_service(api_key, voice=os.getenv("GROK_VOICE", "eve"))
    task = PipelineTask(build_pipeline(transport, llm))

    @transport.event_handler("on_first_participant_joined")
    async def greet(_transport, _participant_id):
        await task.queue_frames([LLMRunFrame()])

    await PipelineRunner().run(task)


if __name__ == "__main__":
    asyncio.run(main())
