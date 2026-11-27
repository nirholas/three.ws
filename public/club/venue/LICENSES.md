# /club/venue asset provenance

`club-venue.glb` and `club-hdri.hdr` in this directory are synthesised at build time from procedural
geometry / sampled radiance functions:

- [scripts/build-club-venue.mjs](../../../scripts/build-club-venue.mjs) →
  `club-venue.glb` (authored via `@gltf-transform/core`)
- [scripts/build-club-hdri.mjs](../../../scripts/build-club-hdri.mjs) →
  `club-hdri.hdr` (Radiance RGBE, no third-party samples)

Because nothing in either file traces back to a third-party asset, three.ws
holds full copyright and dedicates them to the public domain under
**Creative Commons CC0 1.0 Universal**
(https://creativecommons.org/publicdomain/zero/1.0/). Use, modify, and
redistribute freely; attribution is appreciated but not required.

| File             | Source                                                             | License | Notes                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `club-venue.glb` | Authored — primitive geometry assembled via `@gltf-transform/core` | CC0 1.0 | Floor disc, cylinder wall, ceiling, bar + neon backsplash, truss beams, per-slot backstage doors. All 14 named empties from the `src/club-venue.js` contract are present.                                |
| `club-hdri.hdr`  | Authored — radiance functions sampled into Radiance RGBE           | CC0 1.0 | 128×64 equirectangular. Dark purple wash + four warm/coloured spot bumps + mirrorball ring + bar back-glow. Tuned for PBR reflections (`scene.environment`) only — background stays the dark fog colour. |

## Upgrading to artist-authored assets

The named-empty contract in [src/club-venue.js](../../../src/club-venue.js)
is the only thing the runtime depends on. Drop a richer
`club-venue.glb` / `club-hdri.hdr` into this directory (e.g. a Polyhaven
CC0 nightclub HDR + a hand-modelled GLB) and the page will pick it up on
next load. Update this file with provenance for each replacement asset
before committing:

```markdown
### `club-venue.glb`

- **Source**: https://example.com/asset-page
- **Author**: Studio name
- **License**: CC0 1.0 (or SPDX identifier)
- **Modifications**: named-empty injection, draco compression, ...
```

## Regenerating the procedural baseline

```sh
npm run build:club-venue   # → club-venue.glb
npm run build:club-hdri    # → club-hdri.hdr
npm run build:club-assets  # → both props + venue (in one shot)
```

Output is deterministic — same input code produces byte-identical files —
so committed files only change when a builder script changes.

## Third-party entrance venues (CC BY 4.0)

`alleyway.glb` and `tour.glb` are **not** authored by three.ws. They are the two
walk-in venues of the `/club` entrance (the first two venues in
[src/club-variant.js](../../../src/club-variant.js)). Both are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by their authors, which
permits commercial use and modification with attribution.

| File           | Source                                                                                                                                                | Author                                                  | License   | Modifications                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alleyway.glb` | ["Armentrout Textured Game Environment - Alleyway"](https://sketchfab.com/3d-models/armentrout-textured-game-environment-alleyway-ad32afd3994643a1b68eb2f44d77c60c) | [dcarmentrout](https://sketchfab.com/dcarmentrout)      | CC BY 4.0 | weld + prune + dedup, textures resized to at most 2048 px and re-encoded as WebP q82, position/normal/UV quantization, Meshopt compression via [scripts/build-club-entrance-venue.mjs](../../../scripts/build-club-entrance-venue.mjs) |
| `tour.glb`     | ["Richard's Art Gallery - Audio Tour"](https://sketchfab.com/3d-models/richards-art-gallery-audio-tour-0e3e19faa6474fd5974e6a7ed1b221d8)              | [shinymagic](https://sketchfab.com/shinymagic)          | CC BY 4.0 | same pipeline; the author's `xxx` / "DO NOT RENDER" ground disc is stripped                                                                                                         |

CC BY requires credit wherever the work is shown, so the same title, author,
source and license are rendered on screen for as long as each model is visible
(`setVenueCredit` in [src/club-entrance.js](../../../src/club-entrance.js), fed
by the venue's `credit` block in `src/club-variant.js`). Keep the two in step:
if an asset is replaced, update the `credit` block and this table together.

## Removed assets

Two third-party models were removed on 2026-11-26 after a licence audit and must
not be re-added: a "Space Smugglers Club House" model (Sketchfab, CC BY-NC-ND 4.0:
non-commercial and no derivatives, incompatible with a paid club) and an
unverified copy of it. The walk-in's last step is now the procedural, CC0
`club-venue.glb`. The unused `/stripclub` back-alley variant (never shipped in
the repo) was also retired; that path now resolves to the default entrance.
