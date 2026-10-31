# Haunted Graveyard

`/haunted` is a walk-around 3D graveyard built entirely from Kenney's Graveyard Kit (CC0). It is the showcase for the kit that now lives in the [object library](object-library.md).

## What is on the page

- A fenced yard with a gate, a road, a crypt, an altar, nine graves with headstones, lampposts, fire baskets, a pumpkin patch, hay bales and a ring of pine trees. The layout is deterministic (a seeded generator in [src/haunted/page.js](../src/haunted/page.js)), so everyone sees the same yard.
- Five animated characters (the keeper, zombie, skeleton, vampire and ghost). Each plays the kit's own clips; pick one in the panel, choose any of its clips, or let them wander.
- Moonlight, fog, bloom and flickering lamp and basket light. Sliders for fog and moonlight, a lights toggle, wandering toggle, and PNG capture.
- Keyboard: `1` to `5` fly to a character, `L` lights, `W` wandering. Click a character and it reacts.

## Where the models come from

`scripts/ingest-kenney-graveyard.mjs` downloads the kit, checks that its license is CC0, inlines the shared colormap texture so every GLB is a single self-contained file, and writes `public/objects/kenney-graveyard/glb/*.glb` plus `catalog.json`. `scripts/build-object-library.mjs` reads that catalog like the Poly Haven and SimReady ones, so the 91 models appear in `/objects` and `/api/objects/library`.

The page loads the committed files from `/objects/kenney-graveyard/glb/`, so it works without R2. To also serve them from the CDN (owner step):

```
node scripts/ingest-kenney-graveyard.mjs --upload
node scripts/build-object-library.mjs
```

## Failure behaviour

The loading bar counts real fetches. If WebGL is missing or a model fails to load, the stage shows what went wrong and a Try again button.

## Tests

[tests/haunted-graveyard.test.js](../tests/haunted-graveyard.test.js) checks the catalog is CC0 and attributed, every GLB is self-contained, every model the layout places exists, the characters have clips, every element id the script uses is in the HTML, and the page is routed and built.
