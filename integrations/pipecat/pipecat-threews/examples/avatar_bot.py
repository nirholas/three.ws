#
# Copyright (c) 2026, three.ws
#
# SPDX-License-Identifier: Apache-2.0
#

"""Foundational example: a Pipecat bot publishing three.ws avatar data.

Speech-to-text and the LLM are skipped on purpose: this example proves the
``ThreeWsAvatarProcessor`` end to end (a real local TTS speaks, the
processor republishes synced transcript and gesture data over the room's
data channel) without needing a cloud account for any leg of the pipeline.

Text-to-speech is a thin wrapper around the ``espeak-ng`` command line
(``EspeakTTSService`` below), a real open-source offline synthesizer, not a
mock: every audio frame the room receives came out of an actual
``espeak-ng`` subprocess.

Run it against a local open-source ``livekit-server``
(see ``../../../livekit/livekit-plugins-threews/README.md`` for the docker
command) with ``LIVEKIT_URL``, ``LIVEKIT_API_KEY`` and ``LIVEKIT_API_SECRET``
set in the environment:

    python avatar_bot.py
"""

import asyncio
import io
import shutil
import wave
from collections.abc import AsyncGenerator

from loguru import logger
from pipecat.frames.frames import EndFrame, ErrorFrame, Frame, TTSAudioRawFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.runner.livekit import configure
from pipecat.services.tts_service import TTSService
from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport

from pipecat_threews import ThreeWsAvatarProcessor

ESPEAK_SAMPLE_RATE = 22050
DEMO_LINES = [
    "Hello! I'm the three.ws avatar, speaking through Pipecat.",
    "Yes, this processor publishes a gesture cue with that line.",
    "Goodbye, and thanks for watching the demo!",
]


class EspeakTTSService(TTSService):
    """Offline TTS backed by the ``espeak-ng`` binary.

    No network call, no API key: every utterance is synthesized locally by
    shelling out to ``espeak-ng --stdout``, which writes a WAV file this
    service decodes into the PCM frames Pipecat's audio pipeline expects.
    """

    def __init__(self, *, voice: str = "en-us", rate_wpm: int = 165, **kwargs) -> None:
        """Initialize the service.

        Args:
            voice: The ``espeak-ng`` voice name, forwarded to its ``-v`` flag.
            rate_wpm: Speech rate in words per minute, forwarded to ``-s``.
            **kwargs: Additional arguments passed to the parent ``TTSService``.
        """
        super().__init__(
            sample_rate=ESPEAK_SAMPLE_RATE,
            push_start_frame=True,
            push_stop_frames=True,
            **kwargs,
        )
        if shutil.which("espeak-ng") is None:
            raise RuntimeError(
                "espeak-ng is not installed; install it (e.g. `apt install espeak-ng`) "
                "to run this example"
            )
        self._voice = voice
        self._rate_wpm = rate_wpm

    def can_generate_metrics(self) -> bool:
        """Check if this service can generate processing metrics.

        Returns:
            True, as this service supports metrics.
        """
        return True

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        """Synthesize ``text`` with ``espeak-ng`` and yield PCM audio frames.

        Args:
            text: The text to synthesize into speech.
            context_id: The context ID for tracking audio frames.

        Yields:
            Frame: Audio frames containing the synthesized speech.
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "espeak-ng",
                "-v",
                self._voice,
                "-s",
                str(self._rate_wpm),
                "--stdout",
                text,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            wav_bytes, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"espeak-ng failed: {stderr.decode(errors='replace')}")

            with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
                pcm = wav_file.readframes(wav_file.getnframes())

            await self.start_tts_usage_metrics(text)

            chunk_size = self.sample_rate // 5 * 2  # ~200ms of 16-bit mono PCM per chunk
            for offset in range(0, len(pcm), chunk_size):
                chunk = pcm[offset : offset + chunk_size]
                if chunk:
                    await self.stop_ttfb_metrics()
                    yield TTSAudioRawFrame(chunk, self.sample_rate, 1, context_id=context_id)
        except Exception as error:
            logger.exception("espeak-ng synthesis failed")
            yield ErrorFrame(error=f"espeak-ng TTS error: {error}")


async def main() -> None:
    """Join a local LiveKit room and speak a scripted demo sequence."""
    url, token, room_name = await configure()

    transport = LiveKitTransport(
        url,
        token,
        room_name,
        params=LiveKitParams(audio_out_enabled=True),
    )

    tts = EspeakTTSService()
    avatar = ThreeWsAvatarProcessor()

    pipeline = Pipeline([tts, avatar, transport.output()])
    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))

    async def speak_demo_lines() -> None:
        # Queuing every line at once would let the TTS service (near-instant
        # for espeak-ng) race through all three turns before any audio
        # actually plays, publishing avatar data for the whole script in a
        # single burst. A real conversational bot is never this instant: a
        # turn takes as long as it takes to actually speak before the next
        # one starts. Pace it the same way so the demo matches real usage.
        for line in DEMO_LINES:
            await task.queue_frames([TTSSpeakFrame(line)])
            await asyncio.sleep(2)
        await task.queue_frames([EndFrame()])

    runner = PipelineRunner()
    await asyncio.gather(runner.run(task), speak_demo_lines())


if __name__ == "__main__":
    asyncio.run(main())
