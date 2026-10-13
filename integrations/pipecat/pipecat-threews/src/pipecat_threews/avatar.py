#
# Copyright (c) 2026, three.ws
#
# SPDX-License-Identifier: Apache-2.0
#

"""Frame processor publishing three.ws avatar motion data from a pipeline."""

import re

from pipecat.frames.frames import (
    Frame,
    OutputTransportMessageUrgentFrame,
    TranscriptionFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

DEFAULT_TOPIC = "threews.avatar"

# Gesture cues are a best-effort read of the assistant's own final text, the
# same heuristic family three.ws's browser widget already uses for lip sync
# (src/runtime/lipsync.js) and the one its LiveKit plugin uses
# (livekit-plugins-threews): no NLU model, just the opening/closing words a
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
    """Best-effort gesture slot name for a line of assistant speech.

    Args:
        text: The assistant's finished turn, as spoken by the TTS service.

    Returns:
        One of the animation slot names three.ws avatars already know
        (``wave``, ``nod``, ``shrug``), matched against
        ``src/runtime/animation-slots.js`` in the three.ws client, or
        ``None`` if the text does not read like a greeting, farewell,
        agreement or disagreement.
    """
    if _GREETING_RE.search(text) or _FAREWELL_RE.search(text):
        return "wave"
    if _AGREEMENT_RE.search(text):
        return "nod"
    if _DISAGREEMENT_RE.search(text):
        return "shrug"
    return None


class ThreeWsAvatarProcessor(FrameProcessor):
    """Publishes three.ws avatar motion data alongside a Pipecat pipeline.

    three.ws avatars (the ``<agent-3d>`` web component) render entirely on
    the visitor's own device: the 3D model, its rig and its animation clip
    library already live in the browser. This processor never synthesizes
    video or audio of its own. Instead it taps the TTS and user-turn frames
    already flowing through the pipeline and republishes them as small JSON
    messages via ``OutputTransportMessageUrgentFrame``, which any transport
    with a data channel (LiveKit, Daily, a WebSocket transport) delivers to
    connected clients:

    - ``{"type": "transcript", "text": "..."}`` for every finished assistant
      turn, which the browser times into visemes locally
      (``src/runtime/lipsync.js``).
    - ``{"type": "gesture", "name": "wave" | "nod" | "shrug"}`` when the
      turn's text reads like a greeting, farewell, agreement or
      disagreement.
    - ``{"type": "speech_started"}`` / ``{"type": "speech_ended", "transcript": "..."}``
      around the user's own turns, so the avatar can switch to a listening
      pose.

    Place one instance late in the pipeline, after the TTS service and
    before ``transport.output()``, so it observes both the assistant's
    ``TTSTextFrame`` frames and the user's ``UserStartedSpeakingFrame``,
    ``UserStoppedSpeakingFrame`` and ``TranscriptionFrame`` frames on their
    way out.

    Example::

        pipeline = Pipeline(
            [
                transport.input(),
                stt,
                context_aggregator.user(),
                llm,
                tts,
                ThreeWsAvatarProcessor(),
                transport.output(),
                context_aggregator.assistant(),
            ]
        )
    """

    def __init__(self, *, topic: str = DEFAULT_TOPIC) -> None:
        """Initialize the processor.

        Args:
            topic: The transport data-channel topic to publish on. Defaults
                to ``"threews.avatar"``, the topic three.ws's LiveKit client
                (``src/runtime/livekit-voice.js``) already subscribes to.
        """
        super().__init__()
        self._topic = topic
        self._tts_text_buffer = ""
        self._speaking_tts = False
        self._last_user_transcript = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Observe TTS and user-turn frames, then forward every frame unchanged.

        Args:
            frame: The frame being processed.
            direction: The direction the frame is flowing in the pipeline.
        """
        await super().process_frame(frame, direction)

        if isinstance(frame, TTSStartedFrame):
            self._speaking_tts = True
            self._tts_text_buffer = ""
        elif isinstance(frame, TTSTextFrame) and self._speaking_tts:
            self._tts_text_buffer += frame.text
        elif isinstance(frame, TTSStoppedFrame) and self._speaking_tts:
            self._speaking_tts = False
            text = self._tts_text_buffer.strip()
            self._tts_text_buffer = ""
            if text:
                await self._publish({"type": "transcript", "text": text})
                gesture = gesture_for_text(text)
                if gesture:
                    await self._publish({"type": "gesture", "name": gesture})
        elif isinstance(frame, TranscriptionFrame) and frame.finalized:
            self._last_user_transcript = frame.text
        elif isinstance(frame, UserStartedSpeakingFrame):
            self._last_user_transcript = ""
            await self._publish({"type": "speech_started"})
        elif isinstance(frame, UserStoppedSpeakingFrame):
            await self._publish({"type": "speech_ended", "transcript": self._last_user_transcript})

        await self.push_frame(frame, direction)

    async def _publish(self, payload: dict) -> None:
        await self.push_frame(
            OutputTransportMessageUrgentFrame(message=payload),
            FrameDirection.DOWNSTREAM,
        )
