# A talking 3D avatar with Grok as its brain

A page with a live three.ws 3D avatar named Nova that you can chat with. Grok
writes each reply and picks the feeling behind it. The page shows that feeling
on the avatar through the documented `<agent-3d>` API. It sets the expression
with `setMood(valence, arousal)` and plays an emote with `playClip(name)`. For
a calm reply it moves the mouth with `speak(text)`.

No framework and no dependencies. A ~200-line Node server serves the page and
proxies chat to the xAI **Responses API**. The xAI key stays on the server and
never reaches the browser.

| Grok's mood | Expression (valence, arousal) | Emote |
|---|---|---|
| `happy` | 0.7, 0.4 | `nod` |
| `excited` | 0.9, 0.85 | `celebrate` |
| `thoughtful` | 0.1, 0.3 | `think` |
| `sad` | -0.6, 0.2 | `defeated` |
| `surprised` | 0.3, 0.9 | `reaction` |
| `neutral` | 0, 0.3 | speaks the reply |

## Prerequisites

- Node 22 or newer.
- `XAI_API_KEY`: an xAI API key from [console.x.ai](https://console.x.ai). The
  page and the avatar load without it, and chat tells you how to add one.
- A browser with WebGL.

## Run it

```bash
cd examples/grok-agent-avatar
npm ci            # nothing to download: it records the Node version only
XAI_API_KEY=... npm start
# open http://localhost:3277

npm test          # 8 tests, including a live call to api.x.ai with a rejected key
```

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for chat. Read on the server only. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that supports structured outputs. |
| `PORT` | `3277` | The server's port. |

## How it works

```text
browser                      server.mjs                      api.x.ai
  POST /api/chat {messages} ->  validate, rate-limit
                               POST /v1/responses ---------->  Grok
                               text.format json_schema
                               { reply, mood } <-------------
  <- { reply, mood }
  avatar.setMood(v, a)
  avatar.playClip('nod')
```

- `server.mjs` asks Grok for a strict JSON answer, `{ reply, mood }`, where
  `mood` must come from the six-value list above. A mood it does not know
  becomes `neutral`. Turns are capped at 24 messages of 2,000 characters, with
  20 messages a minute per IP.
- `public/moods.js` maps each mood to an expression and an emote. Both the page
  and the tests import it.
- `public/app.js` handles chat, the transcript, and loading and error states. It
  also reads the avatar's events: `agent:load-progress`, `agent:ready` and
  `agent:error`.
- The avatar is the published element, pinned to a version with a
  subresource-integrity hash:

```html
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"
  integrity="sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q"
  crossorigin="anonymous"></script>
<agent-3d id="avatar" body="https://three.ws/avatars/default.glb" brain="none" mode="section"></agent-3d>
```

`brain="none"` turns off the element's own chat runtime, so Grok on your
server is the only brain. To use your own character, point `body` at any
rigged GLB. You can make one for free with `forge_avatar` on the
[three.ws studio MCP server](https://three.ws/api/mcp-studio).

## Sample output

Captured 2026-11-20. Starting the server without a key, then `GET /api/health`
and one chat message:

```text
avatar   http://localhost:3277  (model grok-4.7, xAI key NOT set: chat answers 503 until you add XAI_API_KEY)
{"ok":true,"model":"grok-4.7","key":false}
{"error":"no_key","message":"This server has no xAI key. Stop it, then start it again with XAI_API_KEY=... node server.mjs (keys: https://console.x.ai)."}
```

With an xAI key that is not valid, the chat request really reaches `api.x.ai`.
The page shows xAI's own error with a retry button:

```text
avatar   http://localhost:3277  (model grok-4.7, xAI key set)
xai      HTTP 400: Incorrect API key provided. You can obtain an API key from https://console.x.ai.
{"error":"xai_error","status":400,"message":"xAI answered 400: Incorrect API key provided. You can obtain an API key from https://console.x.ai."} HTTP 502
```

`npm test`:

```text
✔ without a key: health says so and chat answers 503 with the fix
✔ static files are served and traversal is refused
✔ a rejected key is reported with xAI's own message (live call to api.x.ai)
✔ the load label reads agent:load-progress pct, a 0..1 fraction, as a percentage
✔ every mood maps to a known emote or to a spoken reply
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

## Cost

- **three.ws:** free. The `<agent-3d>` element, the default avatar and the
  animation clips load from the public CDN with no account.
- **xAI:** Grok's tokens at your model's [xAI rate](https://docs.x.ai/docs/models).
  Each message sends the conversation so far (up to 24 turns) plus a short system
  prompt, so a typical turn uses a few hundred tokens.
