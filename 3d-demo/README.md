# 3d-demo

A standalone React + Three.js interactive demo showing pointer-driven 3D cube displacement using `@react-three/fiber`.

## What it is

An isolated Create React App project. It renders a 4×4×4 grid of rounded cubes that push away from the cursor in 3D space, with bloom and ambient occlusion post-processing effects. Source: https://discourse.threejs.org/t/meshes-push-away-from-mouse-hover/68397

## Status

**Unlinked / standalone.** This project is not part of the main three.ws platform:

- Not referenced in `vercel.json` — it does not deploy as part of the site.
- Not linked from any nav or page in `public/` or `index.html`.
- Has its own `package.json` and must be run separately with `npm start`.

It is a local prototype/experiment. To run it:

```sh
cd 3d-demo
npm install
npm start
```

## Not to be confused with

- The main `src/` directory — the three.ws viewer/editor built with Vite.
- `sims-demo/` — a separate demo project also unlinked from main nav.
