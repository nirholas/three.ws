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

"""A minimal voice agent wired to the three.ws avatar plugin.

Speech-to-text and the LLM are skipped on purpose: this example proves the
plugin end to end (a real local TTS speaks, the avatar plugin publishes
synced transcript and gesture data) without needing a cloud account for any
leg of the pipeline, per the plugin's own README.

Text-to-speech is a thin wrapper around the ``espeak-ng`` command line
(``EspeakTTS`` below), a real open-source offline synthesizer, not a mock:
every audio frame the room receives came out of an actual ``espeak-ng``
subprocess.

Run it against a local open-source ``livekit-server``
(see ``../../README.md`` for the docker command) with:

    python avatar_agent.py connect --room demo-room
"""

from __future__ import annotations

import asyncio
import io
import shutil
import wave
from dataclasses import dataclass

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.agents.tts import TTS, ChunkedStream, TTSCapabilities
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.plugins import threews

ESPEAK_SAMPLE_RATE = 22050


@dataclass
class _EspeakVoice:
    """``espeak-ng`` voice selection, forwarded to its ``-v`` flag."""

    name: str = "en-us"
    rate_wpm: int = 165


class EspeakTTS(TTS):
    """Offline TTS backed by the ``espeak-ng`` binary.

    No network call, no API key: every utterance is synthesized locally by
    shelling out to ``espeak-ng --stdout``, which writes a WAV file we decode
    into PCM frames for the LiveKit audio pipeline.
    """

    def __init__(self, *, voice: _EspeakVoice | None = None) -> None:
        super().__init__(
            capabilities=TTSCapabilities(streaming=False),
            sample_rate=ESPEAK_SAMPLE_RATE,
            num_channels=1,
        )
        if shutil.which("espeak-ng") is None:
            raise RuntimeError(
                "espeak-ng is not installed; install it (e.g. `apt install espeak-ng`) "
                "to run this example"
            )
        self._voice = voice or _EspeakVoice()

    @property
    def provider(self) -> str:
        return "espeak-ng"

    @property
    def model(self) -> str:
        return self._voice.name

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> ChunkedStream:
        return _EspeakChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class _EspeakChunkedStream(ChunkedStream):
    async def _run(self, output_emitter) -> None:  # noqa: ANN001
        assert isinstance(self._tts, EspeakTTS)
        voice = self._tts._voice

        proc = await asyncio.create_subprocess_exec(
            "espeak-ng",
            "-v",
            voice.name,
            "-s",
            str(voice.rate_wpm),
            "--stdout",
            self._input_text,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        wav_bytes, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"espeak-ng failed: {stderr.decode(errors='replace')}")

        with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
            pcm = wav_file.readframes(wav_file.getnframes())
            sample_rate = wav_file.getframerate()

        output_emitter.initialize(
            request_id=f"espeak-{abs(hash(self._input_text))}",
            sample_rate=sample_rate,
            num_channels=1,
            mime_type="audio/pcm",
        )
        chunk_size = sample_rate // 5 * 2  # ~200ms of 16-bit mono PCM per push
        for offset in range(0, len(pcm), chunk_size):
            output_emitter.push(pcm[offset : offset + chunk_size])
            await asyncio.sleep(0)
        output_emitter.flush()


class AvatarDemoAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are the three.ws demo avatar. Greet the visitor, confirm you can "
                "hear yourself speak, then say goodbye."
            )
        )

    async def on_enter(self) -> None:
        await self.session.say("Hello! I'm the three.ws avatar, speaking through LiveKit.")
        await self.session.say("Yes, this plugin publishes a gesture cue with that line.")
        await self.session.say("Goodbye, and thanks for watching the demo!")


server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    session: AgentSession = AgentSession(tts=EspeakTTS())
    avatar = threews.AvatarSession()
    await avatar.start(session, room=ctx.room)

    await session.start(agent=AvatarDemoAgent(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
