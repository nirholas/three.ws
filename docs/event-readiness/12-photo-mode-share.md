# Feature 12: photo mode with branded one-tap share

The event's growth loop is screenshots. Photo mode has shipped as `src/game/photo-mode.js`: the HUD camera button or `P` captures the world, composites it onto a branded share card, and offers it back as a download or a clipboard image, all in the browser. The list below records what exists against the original spec so a rerun builds only the gap (the free orbit camera, the frame toggle and `navigator.share` of the image file were not built; the shipped flow is an offscreen render rather than a live camera mode).

## Where the code lives

- Photo mode: `src/game/photo-mode.js` and `src/game/photo-mode.css`, imported lazily on the first press from `src/game/coincommunities.js`; the offscreen world render is `src/game/scene-capture.js`, shared with the build screenshot. Camera: `src/game/camera-modes.js`
- HUD mount points: `src/game/coincommunities-ui.js`, styles in `src/game/coincommunities.css`
- Share-sheet precedent: the build screenshot flow in `src/game/coincommunities.js` and the invite sheet (`src/game/invite-sheet.js`), which does use `navigator.share`
- OG card for shared links: `api/play-og.js` (verify the /play link preview actually renders the coin image and name; fix it if stale)
- Deep-link contract: `coinWorldUrl()` covered by `tests/fits-lib.test.js`

## What was built, against the spec

1. **Photo mode toggle.** Shipped: a HUD camera button and the `P` key (Ctrl+P still reaches the browser print dialog). It photographs the world where the player stands rather than opening a free orbit camera, so there is no capture bar, frame toggle or pinch/orbit control. Original spec: a mode that hides all HUD chrome, unlocks a free orbit camera with slow smoothed movement, and shows shutter, frame toggle and exit; on mobile, pinch to zoom, drag to orbit, a big shutter.
2. **Branded frame.** Shipped in `composeCard`: a full-bleed world shot with a hairline and a signature bar carrying the three.ws mark, the coin and world labels, and the date, stamped with the event's name from `/event.json` during a live event. It does not draw the deep link.
3. **Share.** Shipped as a preview sheet with Download (PNG) and Copy image (async clipboard, disabled with an explanation where the browser cannot put images on the clipboard). `navigator.share` of the image file and a copy-link action were not built; the invite sheet (`src/game/invite-sheet.js`) is the share-link path, and the canonical link is `/play?coin=...` from `coinWorldUrl()`.
4. **Quality details.** Shipped: the capture is an offscreen render at up to a capped width (`MAX_CAPTURE_WIDTH`), so the HUD, chat and name tags are never in the frame and no camera or HUD state needs restoring. Name tags are always excluded rather than opt-in.
5. **Self-attach.** Shipped: own module and stylesheet, imported on the first press so a session that never takes a photo pays nothing.

## Verify

- Desktop and emulated-mobile passes on `npm run dev`: press `P` or the camera button, check the card, download and copy, dismiss; zero console errors; the HUD is untouched throughout.
- The shared deep link round-trips into the same world, and its OG preview (via `api/play-og.js`) shows the coin identity.
- `npm test` green.

## Report format

Files shipped, a saved sample capture path, what the share flow does per platform (share sheet vs download), and the `data/changelog.json` entry text you added.
