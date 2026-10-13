# pipecat-threews

A [Pipecat](https://github.com/pipecat-ai/pipecat) frame processor that publishes
[three.ws](https://three.ws) 3D avatar motion data from any Pipecat pipeline.

**Maintainer:** three.ws ([github.com/nirholas/three.ws](https://github.com/nirholas/three.ws)).
This is a community integration maintained by the three.ws team, not by Daily
(the maintainers of Pipecat).

## What it does

three.ws avatars (the `<agent-3d>` web component) render entirely on the
visitor's own device: the 3D model, its rig and its animation clip library
already live in the browser. `ThreeWsAvatarProcessor` never synthesizes video
or audio of its own. Instead it taps the TTS and user-turn frames already
flowing through your pipeline and republishes them as small JSON messages
over the active transport's data channel:

```json
{"type": "transcript", "text": "Hi, how can I help today?"}
{"type": "gesture", "name": "wave"}
{"type": "speech_started"}
{"type": "speech_ended", "transcript": "what can you do"}
```

Point your frontend at
[`<agent-3d voice="livekit">`](https://github.com/nirholas/three.ws/blob/main/src/element.js)
(or any embed that loads
[`src/runtime/livekit-voice.js`](https://github.com/nirholas/three.ws/blob/main/src/runtime/livekit-voice.js)),
which already parses this message shape over LiveKit's data channel. Any
transport whose Pipecat implementation routes `OutputTransportMessageFrame`/
`OutputTransportMessageUrgentFrame` to a real data channel (LiveKit, Daily)
works the same way.

## Installation

```bash
pip install pipecat-threews
```

## Usage with a Pipecat Pipeline

Add `ThreeWsAvatarProcessor()` after your TTS service and before
`transport.output()`, so it observes both the assistant's `TTSTextFrame`s and
the user's `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame` /
`TranscriptionFrame`s on their way out:

```python
from pipecat.pipeline.pipeline import Pipeline
from pipecat_threews import ThreeWsAvatarProcessor

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
```

No API key, account or environment variable is required: the processor reads
state from frames already in your pipeline and republishes it as motion data
on whatever room or call the transport is already connected to.

**Your TTS service must be constructed with `push_start_frame=True` and
`push_stop_frames=True`.** `ThreeWsAvatarProcessor` buffers `TTSTextFrame`
text between the `TTSStartedFrame`/`TTSStoppedFrame` pair and publishes on
`TTSStoppedFrame`. Pipecat's `TTSService` base class defaults both flags to
`False`, so a TTS service built without them never emits a `TTSStoppedFrame`
and the processor silently never publishes. See `examples/avatar_bot.py`'s
`EspeakTTSService` for the correct construction.

### How it decides what to show

- **Lip sync** comes from every finished assistant turn: the full text is
  sent once (buffered between `TTSStartedFrame` and `TTSStoppedFrame`), and
  the browser times it into visemes the same way it already does for every
  other voice path in three.ws (`src/runtime/lipsync.js`), so there is
  nothing provider specific for the browser to learn.
- **Gestures** are a best-effort read of that same text
  (`pipecat_threews.gesture_for_text`): a greeting or farewell triggers
  `wave`, an agreement triggers `nod`, a disagreement triggers `shrug`. A
  miss just means no gesture fires, never a wrong one.
- **Listening pose** comes from `UserStartedSpeakingFrame` /
  `UserStoppedSpeakingFrame`, with the last finalized `TranscriptionFrame`
  attached to the `speech_ended` message.

## How to run the example

[`examples/avatar_bot.py`](examples/avatar_bot.py) is a complete,
runnable foundational example: a bot that joins a LiveKit room and speaks a
scripted demo sequence through a real local `espeak-ng` text-to-speech
service (no cloud TTS, no API keys), with `ThreeWsAvatarProcessor` wired in
to publish the matching transcript and gesture data.

1. Install `espeak-ng` (`apt install espeak-ng` or equivalent).
2. Run a local, open-source LiveKit server:

   ```bash
   docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
     -e LIVEKIT_KEYS="devkey: devsecret" \
     livekit/livekit-server --dev --bind 0.0.0.0
   ```

3. Install this package and its example dependencies:

   ```bash
   pip install -e ".[dev]"
   ```

4. Run the bot:

   ```bash
   LIVEKIT_URL=ws://localhost:7880 \
   LIVEKIT_API_KEY=devkey \
   LIVEKIT_API_SECRET=devsecret \
   LIVEKIT_ROOM_NAME=pipecat-threews-demo \
   python examples/avatar_bot.py
   ```

5. Join `pipecat-threews-demo` with any LiveKit client (or three.ws's own
   `<agent-3d voice="livekit">` pointed at the same server) to hear the bot
   speak and watch the avatar data arrive on the room's data channel.

## Pipecat version compatibility

Tested with Pipecat v1.12.0.

## License

Apache-2.0, matching the three.ws monorepo this package ships inside. See
the repository [LICENSE](../../../LICENSE). Apache-2.0 is a permissive
OSI-approved license and satisfies Pipecat's community-integration
requirement of "a permissive license (BSD-2 like Pipecat, or equivalent
open source terms)".
