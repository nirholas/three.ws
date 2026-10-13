# LiveKit and Pipecat avatar integrations

A three.ws `<agent-3d>` avatar renders entirely on the visitor's own device: the
3D model, its rig, and its animation clip library already live in the browser.
When your voice agent runs on [LiveKit Agents](https://github.com/livekit/agents)
or [Pipecat](https://github.com/pipecat-ai/pipecat), you don't need a server
that renders video. Instead, a small package republishes the TTS and
user-turn frames your pipeline already has as JSON messages over the room's
data channel, and `<agent-3d voice="livekit">` lipsyncs and gestures to them
client-side.

**On this page:** [Message contract](#message-contract) · [LiveKit](#livekit-agents) · [Pipecat](#pipecat) · [Run the examples locally](#run-the-examples-locally)

---

## Message contract

Both packages publish the same shape, so the browser side never knows which
backend sent it:

```json
{"type": "transcript", "text": "Hi, how can I help today?"}
{"type": "gesture", "name": "wave"}
{"type": "speech_started"}
{"type": "speech_ended", "transcript": "what can you do"}
```

- `transcript` fires once per finished assistant turn; the browser times it
  into visemes locally (`src/runtime/lipsync.js`).
- `gesture` is a best-effort read of that same turn's text: a greeting or
  farewell triggers `wave`, an agreement triggers `nod`, a disagreement
  triggers `shrug`. A miss just means no gesture fires, never a wrong one.
- `speech_started` / `speech_ended` bracket the user's own turn, so the
  avatar can switch to a listening pose. `speech_ended.transcript` is the
  last finalized transcript captured since the matching `speech_started`;
  it is empty if the turn's STT result hasn't finalized yet.

Point your frontend at `<agent-3d voice="livekit">` (or any embed that loads
[`src/runtime/livekit-voice.js`](https://github.com/nirholas/three.ws/blob/main/src/runtime/livekit-voice.js)),
which already subscribes to this message shape over LiveKit's data channel.
Any transport whose implementation routes output messages to a real data
channel (LiveKit, Daily) works the same way.

## LiveKit Agents

[`livekit-plugins-threews`](https://github.com/nirholas/three.ws/tree/main/integrations/livekit/livekit-plugins-threews)
is an `AvatarSession` plugin: drop it into a LiveKit `AgentSession` and every
`say()`/TTS turn and VAD boundary republishes as avatar motion data.

```bash
pip install livekit-plugins-threews
```

```python
from livekit.plugins import threews

avatar = threews.AvatarSession()
await avatar.start(session, room=ctx.room)
```

Full reference: [`integrations/livekit/livekit-plugins-threews/README.md`](https://github.com/nirholas/three.ws/blob/main/integrations/livekit/livekit-plugins-threews/README.md).

## Pipecat

[`pipecat-threews`](https://github.com/nirholas/three.ws/tree/main/integrations/pipecat/pipecat-threews)
is a `FrameProcessor`: place it after your TTS service and before
`transport.output()` in any Pipecat `Pipeline`.

```bash
pip install pipecat-threews
```

```python
from pipecat.pipeline.pipeline import Pipeline
from pipecat_threews import ThreeWsAvatarProcessor

pipeline = Pipeline([
    transport.input(), stt, context_aggregator.user(), llm, tts,
    ThreeWsAvatarProcessor(),
    transport.output(), context_aggregator.assistant(),
])
```

Your TTS service must be constructed with `push_start_frame=True` and
`push_stop_frames=True` (Pipecat's `TTSService` base class defaults both to
`False`); otherwise `ThreeWsAvatarProcessor` never sees a `TTSStoppedFrame`
and silently never publishes. Full reference:
[`integrations/pipecat/pipecat-threews/README.md`](https://github.com/nirholas/three.ws/blob/main/integrations/pipecat/pipecat-threews/README.md).

## Run the examples locally

Both packages ship a runnable foundational example against a real local,
open-source `livekit-server`, no cloud account or API key required:

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="devkey: devsecret" \
  livekit/livekit-server --dev --bind 0.0.0.0
```

- LiveKit: `integrations/livekit/livekit-plugins-threews/examples/avatar_agent.py`
- Pipecat: `integrations/pipecat/pipecat-threews/examples/avatar_bot.py`

Each example speaks a short scripted sequence through a real local TTS
(`espeak-ng` for Pipecat's example), so you can point `<agent-3d
voice="livekit">` at the same room and watch the avatar lipsync and gesture
to a real agent with no cloud dependency on either side.
