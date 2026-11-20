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

"""``ThreeWsAvatarProcessor`` behind Pipecat's own Grok Voice realtime service.

``examples/grok_realtime_bot.py`` puts the processor after
``GrokRealtimeLLMService`` (speech to speech, no separate STT or TTS). That
service does not emit frames in the order a cascade TTS service does: it
turns xAI's ``response.output_audio_transcript.delta`` events into
``TTSTextFrame`` s as they arrive and only pushes ``TTSStartedFrame`` on the
first ``response.output_audio.delta``. xAI streams the transcript ahead of
the audio, so the opening words of a reply reach the processor *before* the
turn has started.

These tests replay a recorded xAI server event sequence (the documented
Grok Voice realtime event shapes, no network) through the real upstream
service's receive loop, then hand the exact frames it produced to the
processor, so an upstream change in frame order fails here instead of
silently clipping what the avatar says.
"""

from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
from pathlib import Path

import pytest
from pipecat.frames.frames import (
    Frame,
    InterruptionFrame,
    OutputTransportMessageUrgentFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.xai.realtime import events
from pipecat.services.xai.realtime.llm import GrokRealtimeLLMService
from pipecat.tests.utils import SleepFrame, run_test
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport

from pipecat_threews.avatar import ThreeWsAvatarProcessor

# 10 ms of 24 kHz 16-bit mono silence, the shape of one xAI audio delta.
_AUDIO_DELTA = base64.b64encode(b"\x00\x00" * 240).decode()


def _assistant_turn(response_id: str, item_id: str, words: list[str]) -> list[dict]:
    """A reply as xAI streams it: first transcript delta, then audio, then the rest."""
    first, *rest = words
    seq: list[dict] = [
        {
            "type": "response.output_audio_transcript.delta",
            "event_id": f"{response_id}-t0",
            "response_id": response_id,
            "item_id": item_id,
            "delta": first,
        },
        {
            "type": "response.output_audio.delta",
            "event_id": f"{response_id}-a0",
            "response_id": response_id,
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "delta": _AUDIO_DELTA,
        },
    ]
    for i, word in enumerate(rest, start=1):
        seq.append(
            {
                "type": "response.output_audio_transcript.delta",
                "event_id": f"{response_id}-t{i}",
                "response_id": response_id,
                "item_id": item_id,
                "delta": word,
            }
        )
    seq += [
        {
            "type": "response.output_audio.done",
            "event_id": f"{response_id}-ad",
            "response_id": response_id,
            "item_id": item_id,
        },
        {
            "type": "response.output_audio_transcript.done",
            "event_id": f"{response_id}-td",
            "response_id": response_id,
            "item_id": item_id,
        },
    ]
    return seq


class _RecordedSocket:
    """Async-iterable stand-in for the websocket, yielding recorded server events."""

    def __init__(self, server_events: list[dict]) -> None:
        self._messages = [json.dumps(e) for e in server_events]

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for message in self._messages:
            yield message


async def _frames_grok_emits(server_events: list[dict]) -> list[Frame]:
    """Run the real ``GrokRealtimeLLMService`` receive loop over recorded events."""
    service = GrokRealtimeLLMService(
        api_key="replay-only",
        settings=GrokRealtimeLLMService.Settings(
            session_properties=events.SessionProperties(
                voice="eve",
                audio=events.AudioConfiguration(
                    input=events.AudioInput(format=events.PCMAudioFormat(rate=16000)),
                    output=events.AudioOutput(format=events.PCMAudioFormat(rate=24000)),
                ),
            )
        ),
    )
    emitted: list[Frame] = []

    async def capture(frame, direction=None):
        emitted.append(frame)

    async def capture_broadcast(frame_cls, **kwargs):
        emitted.append(frame_cls(**kwargs))

    service.push_frame = capture
    service.broadcast_frame = capture_broadcast
    service._websocket = _RecordedSocket(server_events)
    await service._receive_task_handler()
    return emitted


def _published(frames) -> list[dict]:
    return [f.message for f in frames if isinstance(f, OutputTransportMessageUrgentFrame)]


@pytest.mark.asyncio
async def test_grok_emits_the_opening_words_before_the_turn_starts():
    """Pin the upstream frame order the processor has to cope with."""
    frames = await _frames_grok_emits(_assistant_turn("r1", "a1", ["Hello! ", "I'm here."]))
    kinds = [
        type(f) for f in frames if isinstance(f, TTSStartedFrame | TTSTextFrame | TTSStoppedFrame)
    ]
    assert kinds == [TTSTextFrame, TTSStartedFrame, TTSTextFrame, TTSStoppedFrame]


@pytest.mark.asyncio
async def test_grok_reply_publishes_the_whole_transcript_and_its_gesture():
    """The first transcript delta must not be lost to the late TTSStartedFrame."""
    frames = await _frames_grok_emits(
        _assistant_turn("r1", "a1", ["Hello! ", "Mount Everest ", "is the tallest mountain."])
    )

    down_frames, _ = await run_test(ThreeWsAvatarProcessor(), frames_to_send=frames)

    assert _published(down_frames) == [
        {"type": "transcript", "text": "Hello! Mount Everest is the tallest mountain."},
        {"type": "gesture", "name": "wave"},
    ]


@pytest.mark.asyncio
async def test_interrupted_grok_reply_does_not_leak_into_the_next_one():
    """Text from a reply the user talked over is dropped, not prefixed to the next."""
    interrupted = await _frames_grok_emits(_assistant_turn("r1", "a1", ["Well, ", "the answer"]))
    # Barge-in lands before xAI's audio.done: keep everything up to the
    # TTSStoppedFrame, which a truncated response never sends.
    cut = next(i for i, f in enumerate(interrupted) if isinstance(f, TTSStoppedFrame))
    second = await _frames_grok_emits(_assistant_turn("r2", "a2", ["Yes, ", "go ahead."]))

    down_frames, _ = await run_test(
        ThreeWsAvatarProcessor(),
        frames_to_send=[*interrupted[:cut], SleepFrame(sleep=0.05), InterruptionFrame(), *second],
    )

    assert _published(down_frames) == [
        {"type": "transcript", "text": "Yes, go ahead."},
        {"type": "gesture", "name": "nod"},
    ]


@pytest.mark.asyncio
async def test_grok_server_vad_reaches_the_avatar_as_listening_events():
    """Grok's speech_started/stopped become the avatar's listen events.

    The service only *proposes* user-turn boundaries; the user context
    aggregator, configured by the metadata frame the service announces
    itself with, resolves them into ``UserStartedSpeakingFrame`` /
    ``UserStoppedSpeakingFrame``, which flow on past the LLM to the processor.
    """
    service = GrokRealtimeLLMService(api_key="replay-only")
    proposals = await _frames_grok_emits(
        [
            {
                "type": "input_audio_buffer.speech_started",
                "event_id": "u-s",
                "audio_start_ms": 0,
                "item_id": "u1",
            },
            {
                "type": "input_audio_buffer.speech_stopped",
                "event_id": "u-e",
                "audio_end_ms": 1400,
                "item_id": "u1",
            },
        ]
    )
    aggregators = LLMContextAggregatorPair(LLMContext())

    down_frames, _ = await run_test(
        Pipeline([aggregators.user(), ThreeWsAvatarProcessor()]),
        frames_to_send=[
            service.service_metadata_frame(),
            SleepFrame(sleep=0.05),
            proposals[0],
            SleepFrame(sleep=0.05),
            proposals[1],
            SleepFrame(sleep=0.2),
        ],
    )

    assert _published(down_frames) == [
        {"type": "speech_started"},
        {"type": "speech_ended", "transcript": ""},
    ]


def _load_example():
    path = Path(__file__).resolve().parent.parent / "examples" / "grok_realtime_bot.py"
    spec = importlib.util.spec_from_file_location("grok_realtime_bot", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_example_configures_grok_voice_with_the_avatar_persona():
    """The example's service is Grok Voice realtime with its voice and instructions."""
    example = _load_example()
    llm = example.build_grok_service("key-from-env", voice="rex")

    assert isinstance(llm, GrokRealtimeLLMService)
    assert llm._settings.model == "grok-voice-latest"
    assert llm._settings.session_properties.voice == "rex"
    assert llm._settings.session_properties.instructions == example.INSTRUCTIONS


def test_example_places_the_avatar_processor_right_after_grok():
    """The processor must sit between Grok and the transport output."""
    example = _load_example()
    transport = LiveKitTransport(
        "ws://127.0.0.1:7880",
        "unused-token",
        "grok-avatar",
        params=LiveKitParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    llm = example.build_grok_service("key-from-env")

    stages = example.build_pipeline(transport, llm).processors
    at = stages.index(llm)

    assert isinstance(stages[at + 1], ThreeWsAvatarProcessor)
    assert stages[at + 2] is transport.output()


def test_example_refuses_to_start_without_an_xai_key(monkeypatch):
    """No key is a clear exit message, not a websocket auth failure later."""
    example = _load_example()
    monkeypatch.delenv("XAI_API_KEY", raising=False)

    with pytest.raises(SystemExit, match="XAI_API_KEY"):
        asyncio.run(example.main())
