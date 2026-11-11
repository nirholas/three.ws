---
name: add-avatar-companion
description: Add the @three-ws/walk animated 3D avatar companion (corner mascot plus full-page stroll and platformer playground) to a website, configure its roster and assets, and deep-link it. Use when the user wants a walking 3D mascot or avatar on their pages.
---

# Add the walking avatar companion

`@three-ws/walk` (version 0.1.2, the package in this repo) is a Three.js library. A character idles in the page corner, follows the cursor and greets each page. Clicking it detaches it into a full-page playground in stroll or platformer mode. Visitors choose their avatar from a built-in roster, or the site supplies its own GLB.

## Install

```bash
npm install @three-ws/walk three
```

`three` (0.150 or newer) is a peer dependency. The site must serve two sets of assets from its own origin or from a CDN set through `assetBase`: the avatar GLBs the roster references (for example `/avatars/*.glb`) and the shared animation manifest at `/animations/manifest.json` with its clips, used to retarget motion onto rigs that ship no locomotion.

## Mount it

```js
import { createWalkCompanion } from '@three-ws/walk';

createWalkCompanion().bootstrap(); // auto-mount, honours ?walk= and ?avatar= links
```

Or control it:

```js
const walk = createWalkCompanion({ defaultAvatarId: 'fox' });
walk.enable();            // mount the corner companion
walk.openPicker();        // let the visitor choose
walk.setAvatar('michelle'); // persist and hot-swap
walk.disable();
```

Import is side-effect free: nothing touches the DOM until `enable()` or `bootstrap()`. The returned control also has `isEnabled()`, `toggle()` and `instance`.

## Options

`avatars` (roster, default `WALK_AVATARS`), `defaultAvatarId` (default `'robot'`), `assetBase`, `apiBase` (prefix for the `/api/avatars/<id>/glb` proxy), `manifestUrl` (default `/animations/manifest.json`), `excludedRoutes` (path prefixes where it never mounts), `enablePicker` (default true), `greeting` (`(path) => string | null`), `docsUrl`, `storagePrefix` (default `walk`).

## Custom avatar

Each roster entry needs `id`, `name`, `category`, `asset`, `source: 'static'`, `rig`, and optionally `accent`. `rig: 'embedded'` plays clips baked into the GLB (robots, animals). `rig: 'shared'` retargets the shared `idle`, `walk`, `run`, `wave`, `jump` clips onto a humanoid.

```js
import { createWalkCompanion, WALK_AVATARS } from '@three-ws/walk';
createWalkCompanion({
  avatars: [...WALK_AVATARS, { id: 'mascot', name: 'Our Mascot', category: 'Brand', asset: '/brand/mascot.glb', source: 'static', rig: 'shared' }],
  defaultAvatarId: 'mascot',
}).bootstrap();
```

## URL controls (with `bootstrap()`)

`?walk=1` forces it on, `?walk=0` off, `?walk=play` opens the playground, `?avatar=<id>` picks an avatar.

## Lower-level exports

`launchPlayground`, `exitPlayground`, `switchPlaygroundMode`, `createAvatarPicker`, `loadWalkAvatar`, `getAvatar`, `listCategories`, `makeApiAvatarEntry`, `resolveAvatarUrl`. See `types/index.d.ts` for signatures.

## Notes

It respects `prefers-reduced-motion`, shares one WebGL context budget with other Three.js viewers on the page, and loads the playground lazily. The repo license is proprietary (all rights reserved), so tell the user to check the LICENSE before shipping it in a product.
