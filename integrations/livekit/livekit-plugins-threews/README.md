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

See [`examples/avatar_agent.py`](examples/avatar_agent.py) for a complete
voice agent wired to this plugin, and
[`../../README.md`](../../README.md) for how to run it end to end against a
local `livekit-server`.
