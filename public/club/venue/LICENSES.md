# /club/venue asset provenance

Both files in this directory are synthesised at build time from procedural
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

## Third-party entrance asset

`space-smugglers-clubhouse.glb` is **not** authored by three.ws. It is the
interior rendered live behind the cover-charge door (the backdrop in
[src/club-entrance.js](../../../src/club-entrance.js)), compressed from a
supplied "Space Smugglers Club House (dark version)" GLB export.

| File                            | Source                      | License                        | Modifications                                                                                                                                                              |
| ------------------------------- | --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space-smugglers-clubhouse.glb` | Supplied third-party export | © original author — see source | weld + prune + dedup, textures resized ≤2048 → WebP q82, position/normal/UV quantization, Meshopt compression (~20 MB → ~1.6 MB) via [scripts/build-club-entrance-venue.mjs](../../../scripts/build-club-entrance-venue.mjs) |

This file is **not** CC0 — confirm the original model's license before any
redistribution beyond three.ws. Regenerate from the source export with:

```sh
npm run build:club-entrance-venue   # → space-smugglers-clubhouse.glb
```

## Third-party back alley (the `/stripclub` entrance)

`back-alley.glb` is **not** authored by three.ws. It is the brick back alley the
`/stripclub` entrance opens on (the first venue of the `stripclub` variant in
[src/club-variant.js](../../../src/club-variant.js)).

| File             | Source                                                                                                                                        | Author                                        | License                                                   | Modifications                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `back-alley.glb` | ["environment ally with bar/strip club"](https://sketchfab.com/3d-models/environment-ally-with-barstrip-club-a98c2e9748b24b7fb781d452814304ef) | [anthonydpc](https://sketchfab.com/tonydpc)   | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | weld + prune + dedup, textures resized to at most 2048 px and re-encoded as WebP q82, position/normal/UV quantization, Meshopt compression via [scripts/build-club-entrance-venue.mjs](../../../scripts/build-club-entrance-venue.mjs) |

CC BY requires credit wherever the work is shown, so the same title, author,
source and license are rendered on screen for as long as the model is visible
(`setVenueCredit` in [src/club-entrance.js](../../../src/club-entrance.js), fed
by the venue's `credit` block in `src/club-variant.js`). Keep the two in step:
if this asset is replaced, update the `credit` block and this table together.

Rebuild from the source export: download the GLB from the Sketchfab page above
(a free Sketchfab login is required), save it in the repo root as
`environment_ally_with_barstrip_club.glb`, then:

```sh
npm run build:club-entrance-venue   # → back-alley.glb, and prints its bounds + door meshes
```
