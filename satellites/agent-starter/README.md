# Your first three.ws agent

A one-click starting point for putting a live, animated 3D agent on a web page. Open the
repository in GitHub Codespaces and the demo starts automatically.

## Start in Codespaces

Use **Code > Codespaces > Create codespace on main**. When the forwarded port opens, the page
shows a real `<agent-3d>` component using the production three.ws CDN.

For a local checkout:

```bash
npm ci
npm run dev
```

Open <http://localhost:4173>.

## Make the character yours

Run this in the terminal:

```bash
export THREE_WS_API_KEY=sk_live_...   # from https://three.ws/dashboard/api-keys
npm create @three-ws/agent "a friendly robot guide"
```

Making a model needs a three.ws account (a free one is enough), so set `THREE_WS_API_KEY` to a key
from [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) first. The command uses the
free generation lane, downloads the finished GLB, and creates a working page. The model is saved to
your account, unlisted until you share it. Replace the `body` URL in `index.html` with
the generated model URL or a path to the downloaded `agent.glb`.

## The whole integration

```html
<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js"></script>
<agent-3d body="https://three.ws/avatars/default.glb" name="Nova"></agent-3d>
```

`app.js` adds two real interactions: it finds a wave in the live animation catalog and calls
`playClip()`, and it calls `speak()` for a talking gesture.

## Verify

```bash
npm test
```

Continue with [LEARN.md](./LEARN.md), then explore the
[web component API](https://three.ws/docs/web-component) and the
[visual creator](https://three.ws/create).

## License

Apache-2.0
