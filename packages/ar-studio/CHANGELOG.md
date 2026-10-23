# Changelog

## 0.3.2

- **A model placed through Quick Look now rests on your floor instead of hanging in the air.**
  0.3.1 got an iPhone into ARKit; once there, the model hung at roughly the height it had been
  authored at and drifted with the phone rather than settling on a surface, which reads as
  broken tracking and is not. AR Quick Look anchors the scene's ORIGIN to the plane it detects
  and never looks at the geometry, so a GLB authored around its bounding-box centre arrives
  half-buried and one authored around a distant scene origin arrives floating across the room.
  No anchoring flag fixes that; the content has to be moved. Every export is now stood on y=0
  with its footprint centred over the origin before it is written. On the Poly Haven wrench in
  the demo catalogue that is a 14 cm correction.
- **The pinch size reaches the AR viewer.** `USDZExporter` walks `scene.children` and writes
  each node's LOCAL matrix, so the transform on the object handed to it is never written at
  all: the scale the studio set on the exported root was silently dropped, and every model
  arrived at its authored size no matter what anyone had resized it to. Placement now rides on
  a `Model` stage node inside the root, which does get written.
- **A model authored in centimetres is brought back to room scale** on the convert-from-URL
  path. USDZ is metres, so a 75 cm prop authored as 75 units arrived 75 m tall, far too large
  for any plane ARKit found indoors, and swam around the viewer: the same symptom as a broken
  anchor from a completely different cause.
- **The page hands the camera over before the AR viewer opens.** The camera is a single-client
  resource on a phone. Leaving the studio's `getUserMedia` stream running while Quick Look
  started ARKit against the same camera left world tracking and plane detection unable to
  converge. The passthrough is now released on the way into native AR and restarted when you
  come back, exactly as the immersive WebXR path has always done.
- **The camera passthrough says what it is.** It is a gyroscope over a video feed: it turns with
  you, but it has no plane detection and no positional tracking, so walking around was never
  going to hold a model to a spot on the real floor. On a device with a real AR viewer the
  status line now says so and offers the one-tap route to it.
- **A model too big for any plane in the room is brought back to one that fits.** Quick Look
  does not place a model until ARKit has found a horizontal plane large enough to hold it;
  until then the model hangs aligned to the camera and travels with the phone, which reads as
  broken tracking rather than as "still looking". Exports are now capped at a 2.5 m footprint
  and a 2.5 m height. This is a ceiling, not a normalizer: furniture, people and props pass
  through untouched. It matters because the pinch size is honoured again, and the studio lets
  that reach 4x, which on a standing figure is seven metres of nothing a floor will ever fit.
- The render loop stops while the native AR viewer has the screen, instead of drawing 60 frames
  a second of a hidden page while ARKit is doing plane detection on the same GPU.
- New API: `usdzExportRoot()`, `groundOnFloor()`, `fitToRoomScale()`, `clampToPlaceableSize()`,
  `MAX_AR_FOOTPRINT_M`, `MAX_AR_HEIGHT_M`, and a `fit` option on `sceneToUsdzBlob()`.

## 0.3.1

- **Quick Look now opens in AR, not Object mode.** 0.3.0 got an iPhone all the way into Apple's
  viewer and then landed on the turntable, with the AR tab inert: everything looked right and
  the one thing anybody wanted did not happen. Safari decides whether a URL is an AR asset from
  its file extension, and a `blob:` URL has no path and therefore no extension, so the generated
  USDZ was opened as a generic 3D file. The anchor now carries
  `download="<model-name>.usdz"`, which is the name Safari sniffs. Exported as
  `usdzFilename()`, and pinned by a test, because nothing about the symptom points at the cause.
- The Quick Look checkout banner is all-or-nothing now, matching how Quick Look renders it:
  `withQuickLookBanner()` returns the URL untouched unless a `callToAction` is present, instead
  of producing a banner with a title and a dead button.

## 0.3.0

- **"Place in your space" now actually opens the AR viewer on an iPhone.** 0.2.0 routed iOS to
  AR Quick Look but converted the model to USDZ *inside* the tap handler, and iOS opens
  `rel="ar"` only while the page still holds the user gesture that asked for it. The conversion
  outlived the gesture, Safari silently declined, and the button did nothing. Preparing and
  opening are now separate steps: the studio converts ahead of the tap, and the tap itself is
  synchronous straight through to the anchor.
- **A designed hand-off sheet** between the AR button and the device viewer: a preview of the
  model that is going, a picker when the scene holds more than one, honest progress while the
  USDZ is built, an error state with a retry, and one primary button. Full dialog semantics
  (focus capture and return, Escape, backdrop dismiss) and a designed empty state.
- **The USDZ is exported from the copy already standing in your scene**, not refetched. No
  second download, no second CORS round trip, and the model reaches Quick Look at the size it
  was pinched to and in the pose it was in.
- **Conversions are cached** (four at a time, least-recently-used, object URLs revoked on
  eviction) and warmed in the background for whichever model the button would send, so opening
  AR a second time is instant.
- Exports are tuned for their only reader: `quickLookCompatible` corrects Apple's inverted
  texture repeat handling, and horizontal plane anchoring is declared in the file.
- A meshopt-compressed GLB no longer fails a one-shot conversion that starts before the decoder
  has finished loading.
- New API: `prepareNativeAr()`, `objectToUsdzBlob()`, `cachedUsdzUrl()`, `isQuickLookReady()`,
  `releaseQuickLook()`, `clearQuickLookCache()`, `studio.openArSheet()`,
  `studio.closeArSheet()`, and the `ar-sheet` event.

## 0.2.0

- **Real ARKit and ARCore placement, not a camera-passthrough approximation.** An iPhone has no
  WebXR, and until now it fell back to compositing the scene over the camera feed, which floats
  rather than sticks. It now opens Apple's AR Quick Look: real plane detection, real scale, real
  occlusion. The GLB is converted to USDZ on the device (a real conversion via three.js's
  `USDZExporter`, about a second for a typical prop), so no server and no pre-baked USDZ is
  needed. Android without WebXR opens Scene Viewer.
- The **AR** button now resolves the device's best path at boot, labels itself for what it will
  actually do, and acts on the selected model.
- New API: `studio.enterAR()`, `studio.placeInYourSpace()`, `studio.arMode`, the `native-ar` and
  `native-ar-error` events, and the exported `arCapability()`, `placeInYourSpace()`,
  `glbUrlToUsdzBlob()` and `withQuickLookBanner()` helpers.

## 0.1.0

First release.

- **The studio.** A live multi-model AR scene for any web page: place, drag, pinch-resize,
  twist-rotate and duplicate any number of models through the device camera, with a designed
  path on every device (WebXR on Android and headsets, camera passthrough with gyro world-lock
  on iOS, grid preview with a QR hand-off on desktop).
- **Text to 3D, in the camera.** A prompt box in the dock generates a model on a free, keyless
  lane and drops the result into the room. Progress narration reports only what the pipeline
  actually reported.
- **Pluggable model sources.** Ships wired to a few hundred CC0 props. `assets` takes a
  manifest URL, an inline list, a custom source object, or an ordered array of them; five
  common catalogue shapes are read without reshaping.
- **Scenes are links.** Models and transforms round-trip through the URL and a QR code, and
  persist to localStorage between visits.
- **Shared rooms.** A six-character code puts two or more people in one arrangement, with live
  presence and per-owner edit gating.
- **Universal idle animation.** Humanoid models with no baked clip get one retargeted onto
  their own skeleton, with no rig allow-list.
- **MCP server.** Six tools so an agent can generate, search, arrange, export and scaffold AR
  experiences: `generate_3d_model`, `check_generation`, `search_models`, `compose_ar_scene`,
  `export_ar`, `create_ar_page`.
- **CLI.** `create`, `dev`, `deploy` and `page`, so adding AR to a project is two commands.
