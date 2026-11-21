# Adobe Exchange listing: three.ws 360 Capture

Submission is an owner step (nothing here has been sent to Adobe). Plugin id `ws.three.capture`, Premiere Pro 25.6 or later, free.

## Name

three.ws 360 Capture

## Short description (under 100 characters)

Turn 360 footage into a 3D scene without leaving Premiere Pro.

## Full description

Send a 360 clip from your project to three.ws and get a 3D Gaussian splat scene back, imported into your bin and ready to cut.

- Works with stitched 360 video and photos from any 360 camera, and with raw .insv and .insp files from Insta360 cameras.
- Select a clip or pick a file. In and Out points become the range that is sent.
- Choose Preview, Standard or High quality.
- Large files upload in parallel parts and resume if the connection drops.
- Live progress with plain stage names, and a Cancel button.
- Results land in a bin named "three.ws captures": a preview video, a poster frame, and the scene as .ply and .spz. One button puts the preview on your timeline at the playhead.
- A single 360 photo comes back as a 3D shell you can step inside.
- Every result also has a shareable three.ws link.
- Your recent captures are listed in the panel with Import and Open buttons.

Requires a free three.ws account and an API key (the panel links to the page where you create one). Files are sent to three.ws only when you press Send.

Insta360 is a trademark of Arashi Vision Inc. three.ws is not affiliated with, endorsed by or sponsored by Arashi Vision. Adobe and Premiere Pro are trademarks of Adobe Inc.

## Keywords

360, VR, Gaussian splat, 3D scene, equirectangular, photogrammetry, Insta360, three.ws

## Permissions to explain on the listing

- Network: three.ws and its storage hosts only.
- Local files, full access: to read the clip you send by path and to save results next to your project file.
- Open links: https only, to open the viewer and the API key page.

## Links

- Support and docs: https://three.ws/insta360 (the 360 to 3D landing page and shooting guide)
- API keys: https://three.ws/dashboard/api
- Privacy: https://three.ws/legal/privacy

## Screenshots the owner must capture in Premiere Pro

Capture at 2x on the dark theme (and one on light), 1600 px wide minimum, from Premiere Pro 25.6 or later with a real 360 clip:

1. The panel on first run: key field, "Get an API key" link, empty state.
2. A 360 clip selected in the Project panel with In and Out points set, and the panel showing the clip name, size, trim and quality picker.
3. Upload in progress: the progress bar with the "bytes of bytes" detail.
4. Processing in progress with a stage label such as "Training the scene".
5. The result card: viewer link, saved-folder path, and "Insert preview at playhead".
6. The Project panel showing the "three.ws captures" bin with preview.mp4, poster.jpg, scene.ply and scene.spz.
7. The timeline with the preview inserted at the playhead.
8. The scene open in the three.ws viewer in a browser, next to the panel.
9. "Your captures" with at least two rows.
10. An error state (for example the "does not look like a 360 clip" banner).

Icon: `icons/plugin-icon@2x.png` (96 x 96). The listing also needs a 512 x 512 icon: export `public/pwa-512x512.png`.
