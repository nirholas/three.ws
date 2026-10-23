# __TITLE__

An augmented-reality studio, built with [3D AR Studio](https://github.com/nirholas/3D-AR-Studio).
Open `index.html` on a phone, tap **Camera**, and the models stand on your actual floor.

## Run it locally

```bash
npx 3d-ar-studio dev
```

Then open the printed URL. Camera and WebXR need a secure context, so use `https://`
or `localhost` (both count as secure); a bare LAN IP over `http://` will not get camera access.

## Publish it

Any static host works, because this is one HTML file with no build step.

**GitHub Pages, in one command:**

```bash
npx 3d-ar-studio deploy
```

That creates the repository if it does not exist, pushes, and turns Pages on.

**By hand:** commit this folder, then in your repository go to
*Settings → Pages* and serve from the branch root.

## Point it at your own models

Add an `assets` option in `index.html`:

```js
createArStudio('#stage', { assets: 'https://your.cdn/models.json' })
```

The catalogue can be a bare array or an object wrapping one, and each entry needs
only a model URL (`src`, `url`, `glb`, or `glb_url`); a `title` and `poster` make
the tray look better. Full details:
<https://github.com/nirholas/3D-AR-Studio#your-own-models>
