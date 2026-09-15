# Build an animated agent in 10 minutes

This guide begins with the working character already visible in the starter. Each step changes
one thing and keeps the page runnable.

## 1. Understand the two tags

Open `index.html`. The module script registers the `agent-3d` web component. The element below
it supplies a model URL and a display name. No framework or bundler is involved.

## 2. Change the agent's identity

Change the element's `name` to a role that belongs on your site. Update the introduction in
`app.js` to match. Refresh the page and press **Introduce yourself**.

## 3. Create a model

From the terminal, describe one full-body character in a neutral pose:

```bash
npm create @three-ws/agent "a friendly museum guide in a navy uniform"
```

Generation and rigging normally take one to three minutes. The command reports real elapsed
time, downloads the finished GLB, and prints its hosted URL.

## 4. Put the model on the page

Replace the `body` value in `index.html` with that hosted URL. To serve the downloaded model
from the starter instead, copy `agent.glb` beside `index.html` and use:

```html
<agent-3d body="./agent.glb" name="Museum Guide"></agent-3d>
```

## 5. Add behavior

The starter waits for the component to load before enabling controls. Add another button and
call one documented method, such as:

```js
await agent.playClip('idle', { userInitiated: true });
agent.speak('What would you like to explore?');
```

Use `userInitiated: true` only in response to a real user gesture. Ambient animation should
respect reduced-motion preferences.

## 6. Ship it

The starter is static. Any host that serves `index.html`, `app.js`, `styles.css`, and the model
can run it. Before publishing, run:

```bash
npm test
```

Share the finished URL in the
[three.ws Show and tell discussion](https://github.com/nirholas/three.ws/discussions/categories/show-and-tell).
