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

"""Regression test for ``ThreeWsAvatarProcessor``'s TTS-turn publish contract.

A real deployment ships a demo bot (``examples/avatar_bot.py``) that was
found, via a real local LiveKit run, to publish an assistant turn's gesture
cue only if the TTS service is constructed with ``push_stop_frames=True``
(Pipecat's ``TTSService`` defaults it to ``False``, so ``TTSStoppedFrame``
never fires and the processor never publishes, silently). This test drives
the processor directly with a real ``TTSStartedFrame`` /
``TTSTextFrame`` / ``TTSStoppedFrame`` sequence through Pipecat's own test
pipeline (``pipecat.tests.utils.run_test``), so a regression in the
processor's own frame handling, independent of any particular TTS service's
construction, fails this test rather than silently publishing nothing.
"""

from __future__ import annotations

import pytest
from pipecat.frames.frames import (
    AggregationType,
    OutputTransportMessageUrgentFrame,
    TranscriptionFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.tests.utils import SleepFrame, run_test

from pipecat_threews.avatar import ThreeWsAvatarProcessor


@pytest.mark.asyncio
async def test_finished_tts_turn_publishes_transcript_and_gesture():
    """A full TTSStarted/TTSText/TTSStopped turn must publish both messages."""
    processor = ThreeWsAvatarProcessor()

    down_frames, _ = await run_test(
        processor,
        frames_to_send=[
            TTSStartedFrame(),
            TTSTextFrame("Hello! ", aggregated_by=AggregationType.SENTENCE),
            TTSTextFrame("I'm the three.ws avatar.", aggregated_by=AggregationType.SENTENCE),
            TTSStoppedFrame(),
        ],
    )

    published = [f.message for f in down_frames if isinstance(f, OutputTransportMessageUrgentFrame)]
    assert published == [
        {"type": "transcript", "text": "Hello! I'm the three.ws avatar."},
        {"type": "gesture", "name": "wave"},
    ]


@pytest.mark.asyncio
async def test_tts_text_outside_a_turn_is_not_published():
    """Without a TTSStoppedFrame, no buffered text is ever published."""
    processor = ThreeWsAvatarProcessor()

    down_frames, _ = await run_test(
        processor,
        frames_to_send=[
            TTSStartedFrame(),
            TTSTextFrame("Hello there", aggregated_by=AggregationType.SENTENCE),
        ],
    )

    published = [f for f in down_frames if isinstance(f, OutputTransportMessageUrgentFrame)]
    assert published == []


@pytest.mark.asyncio
async def test_user_speech_boundaries_publish_listen_events():
    """User VAD boundaries publish speech_started/speech_ended with the transcript.

    ``UserStartedSpeakingFrame``/``UserStoppedSpeakingFrame`` are Pipecat
    ``SystemFrame``s, processed immediately on a fast path that bypasses the
    processor's regular frame queue; ``TranscriptionFrame`` is not, so it
    queues behind other work on a separately-scheduled task. Sent back to
    back with no gap, ``UserStoppedSpeakingFrame`` can finish processing
    before the ``TranscriptionFrame`` just ahead of it does, so the
    ``SleepFrame`` here (Pipecat's own test-only frame for this exact
    purpose) gives the regular queue a chance to drain first, matching how a
    real STT service's finalized transcript has normally already landed by
    the time VAD reports the user stopped talking.
    """
    processor = ThreeWsAvatarProcessor()

    down_frames, _ = await run_test(
        processor,
        frames_to_send=[
            UserStartedSpeakingFrame(),
            TranscriptionFrame(
                text="what can you do", user_id="user-1", timestamp="", finalized=True
            ),
            SleepFrame(sleep=0.05),
            UserStoppedSpeakingFrame(),
        ],
    )

    published = [f.message for f in down_frames if isinstance(f, OutputTransportMessageUrgentFrame)]
    assert published == [
        {"type": "speech_started"},
        {"type": "speech_ended", "transcript": "what can you do"},
    ]


@pytest.mark.asyncio
async def test_user_stopped_speaking_does_not_leak_prior_turn_transcript():
    """A turn with no finalized transcript yet must not report the previous turn's.

    ``_last_user_transcript`` is set whenever a finalized ``TranscriptionFrame``
    arrives and, before this test's fix, was never cleared. If a second
    turn's own transcript is slow to finalize (the STT race described in
    ``test_user_speech_boundaries_publish_listen_events``), the processor
    must not attribute the first turn's leftover text to the second turn's
    ``speech_ended``.
    """
    processor = ThreeWsAvatarProcessor()

    down_frames, _ = await run_test(
        processor,
        frames_to_send=[
            UserStartedSpeakingFrame(),
            TranscriptionFrame(text="first turn", user_id="user-1", timestamp="", finalized=True),
            SleepFrame(sleep=0.05),
            UserStoppedSpeakingFrame(),
            UserStartedSpeakingFrame(),
            UserStoppedSpeakingFrame(),
        ],
    )

    published = [f.message for f in down_frames if isinstance(f, OutputTransportMessageUrgentFrame)]
    assert published == [
        {"type": "speech_started"},
        {"type": "speech_ended", "transcript": "first turn"},
        {"type": "speech_started"},
        {"type": "speech_ended", "transcript": ""},
    ]
