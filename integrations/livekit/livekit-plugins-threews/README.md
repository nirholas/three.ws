# LiveKit Plugins three.ws

Agent Framework avatar plugin for [three.ws](https://three.ws) 3D avatars.

## Client-side rendering

three.ws avatars render entirely on the visitor's own device: the `<agent-3d>`
web component already ships the humanoid model, its rig and its animation
clip library in the browser. This plugin never synthesizes a video track.
Instead it publishes small JSON messages over the LiveKit data channel
(topic `threews.avatar`) that drive the client's existing lip-sync and
gesture systems:

```json
{"type": "transcript", "text": "Hi, how can I help today?"}
{"type": "gesture", "name": "wave"}
{"type": "speech_started"}
{"type": "speech_ended", "transcript": "what can you do"}
```

A standard LiveKit video renderer attached to the agent's room sees no video
track from this plugin, because there is none to see: a three.ws avatar is
not server-rendered. Point your frontend at
[`<agent-3d voice="livekit">`](https://github.com/nirholas/three.ws/blob/main/src/element.js)
(or any embed that loads `src/runtime/livekit-voice.js`), which already
parses this message shape.

## Installation

```bash
pip install livekit-plugins-threews
```

## Usage

```python
from livekit.plugins import threews

avatar = threews.AvatarSession()
await avatar.start(session, room=ctx.room)
```

No API key, account or environment variable is required: the plugin reads
state from the `AgentSession` you already built (its conversation items and
user turn-taking events) and republishes it as motion data on the room the
agent is already in.

## How it decides what to show

- **Lip sync** comes from every finished assistant turn
  (`conversation_item_added`): the full text is sent once, and the browser
  times it into visemes the same way it already does for every other voice
  path in three.ws (`src/runtime/lipsync.js`), so there is nothing provider
  specific for the browser to learn.
- **Gestures** are a best-effort read of that same text
  (`threews.gesture_for_text`): a greeting or farewell triggers `wave`, an
  agreement triggers `nod`, a disagreement triggers `shrug`. A miss just
  means no gesture fires, never a wrong one.
- **Listening pose** comes from `user_state_changed`: the avatar gets
  `speech_started` / `speech_ended` events around the user's own turns.

## Grok Voice realtime (speech to speech)

[`examples/grok_realtime_agent.py`](examples/grok_realtime_agent.py) gives
the `AgentSession` a single model, `livekit-plugins-xai`'s
`xai.realtime.RealtimeModel` (xAI's Grok Voice realtime API). The caller's
audio goes straight to the model and its spoken reply comes straight back,
with no separate STT, LLM and TTS legs, and the avatar animates from the
same session events as a cascade pipeline.

```bash
pip install "livekit-plugins-threews[grok]"
export XAI_API_KEY=...   # GROK_VOICE picks the voice, default Ara
python examples/grok_realtime_agent.py connect --room grok-avatar
```

Realtime models only mark the caller's transcript final once the reply
starts, which is after the user has stopped speaking, so `speech_ended`
carries the latest transcript of the turn (interim or final) and resets at
the start of every user turn. Without `XAI_API_KEY` the session fails at
setup with a message naming the variable. The browser path, token broker
and measured latency are in
[`docs/voice-grok.md`](../../../docs/voice-grok.md).

See [`examples/avatar_agent.py`](examples/avatar_agent.py) for a complete
voice agent wired to this plugin, and
[`../../README.md`](../../README.md) for how to run it end to end against a
local `livekit-server`.
