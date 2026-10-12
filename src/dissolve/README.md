# src/dissolve

Controller and engine for the `/dissolve` page. See [docs/dissolve.md](../../docs/dissolve.md).

- `page.js`: renderer, bloom, DOM wiring, tools, morph timeline, capture, share links.
- `engine.js`: GPGPU particle simulation (velocity and position ping-pong passes, point renderer).
- `sample-core.js`: pure surface sampling, Morton ordering and stage fitting (no three.js).
- `shape.js`: GLB to coloured point cloud, chunked with progress.
- `audio.js`: opt-in microphone band levels.
- `recorder.js`: canvas capture to webm or mp4.
- `shelf.js`: bundled models, look presets, quality tiers, share-link state.
