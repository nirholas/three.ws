# __TITLE__

An augmented-reality studio built with [3D AR Studio](https://github.com/nirholas/3D-AR-Studio)
and bundled with Vite, so `three` is shared with the rest of your app instead of
being downloaded twice.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

Camera and WebXR need a secure context. `localhost` counts as one; to test on a
phone over your LAN, run `npm run dev -- --host` behind an https tunnel.

## Point it at your own models

```js
createArStudio('#stage', { assets: 'https://your.cdn/models.json' })
```

See <https://github.com/nirholas/3D-AR-Studio#your-own-models> for every accepted
catalogue shape, and for writing a source of your own.
