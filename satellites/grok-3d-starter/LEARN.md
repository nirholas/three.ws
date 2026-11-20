# Ten minutes to a model on the stage

This walks you from a fresh clone to a Grok-made 3D model you can orbit, then shows the three
places to change when you make the starter your own. Most of the ten minutes is the GPU render.

## 1. Get the two keys (2 minutes)

- **xAI:** sign in at [console.x.ai](https://console.x.ai), open API Keys, create a key.
- **three.ws:** making a model needs a three.ws account, and a free one is enough. Sign up at
  [three.ws](https://three.ws), then create a key at
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys).

## 2. Run it (1 minute)

```bash
git clone https://github.com/nirholas/grok-3d-starter.git
cd grok-3d-starter
npm ci
cp .env.example .env
```

Paste the keys after `XAI_API_KEY=` and `THREE_WS_API_KEY=` in `.env`, then:

```bash
npm start
```

Open <http://localhost:8080>. Start the server without keys first if you like: the page shows
the setup panel, which names each missing key and the line to add. Click **Check again** after
you fix `.env` and restart.

## 3. Make a model (about 3 to 5 minutes)

Click the first example, "A small brass desk lamp with a round green glass shade". Watch the
timeline:

1. **Grok is thinking**, then a `forge_free` row appears with the exact arguments Grok chose.
2. The tool answers that the model is rendering. A progress bar fills from real `get_job`
   status, and a viewer link appears so you can watch from another tab.
3. The GLB loads on the stage and starts its turntable. Drag to orbit, scroll to zoom.
   **Download GLB** saves the file; **Open in viewer** opens it on three.ws.

Now type `make it chrome`. Grok calls `refine_model` on the model that is on the stage, and the
new version joins the strip above the chat. Click any version to put it back on the stage.

## 4. Read the code in this order (3 minutes)

1. `lib/xai.mjs`, `buildRequest`: the whole Grok integration is one request body. The MCP tool
   carries your three.ws key in `authorization` and the five tool names in `allowed_tools`.
2. `lib/chat.mjs`, `runTurn`: a turn is a loop of rounds. When a render is still going, the
   server follows it and starts the next round with `previous_response_id`.
3. `public/app.js`: each server-sent event (`tool`, `job`, `model`, `error`...) updates one part
   of the page.

## 5. Make it yours

- **Change what Grok is told:** `SYSTEM_PROMPT` in `lib/xai.mjs`.
- **Change the example prompts:** the three buttons in `public/index.html`.
- **Change the stage:** lights, environment and camera are in `public/stage.js`.
- **Use another model:** set `XAI_MODEL` in `.env`.

Run `npm test` after each change. When you are ready to share it, the README's Deploy section
puts it on Cloud Run with one command.
