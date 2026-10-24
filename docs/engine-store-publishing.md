# Publishing the engine bridges to the stores

The Unity, Godot and Unreal bridges ([overview](./engine-bridges.md)) are packaged and validated by one script. The owner submits the output to each store.

```sh
npm run package:engine-stores            # build everything into dist/engine-stores
npm run package:engine-stores -- --check # validate only, write nothing
npm run package:engine-stores -- --only godot
```

The script exits 1 if any validation fails. Zips are deterministic: sorted entries, fixed timestamps, so the same source tree always gives the same SHA-256. Output:

| Path | Content |
|---|---|
| `dist/engine-stores/manifest.json` | Per bridge: version, zip name, bytes, SHA-256, file count, every check that passed or failed |
| `dist/engine-stores/<engine>/<zip>` | The upload artifact |
| `dist/engine-stores/<engine>/listing.json` | Store listing text, copied from `docs/engine-store-listings/<engine>.json` |
| `dist/engine-stores/<engine>/artwork/icon-{128,512}.png` | Base icons rendered from `public/favicon.svg` |

## What is validated

Per bridge: required files exist; version is `x.y.z` and the listing version and minimum engine version equal the engine's own manifest (`package.json`, `plugin.cfg` plus `project.godot`, `.uplugin`); the LICENSE is Apache-2.0; no en or em dash and no unfinished-work marker in any packaged text file; the listing has every required field, a tagline of at most 80 characters, a description of at least 200 characters, https links, and a data disclosure. Unity also requires `documentationUrl`, `changelogUrl`, `licensesUrl`, valid asmdefs and existing sample paths. Godot requires a complete `plugin.cfg` whose script exists. Unreal requires an integer `Version`, `DocsURL`, and a `Build.cs` for each module. Tests: `tests/package-engine-bridges.test.js`.

## Listing metadata

Edit `docs/engine-store-listings/{unity,godot,unreal}.json`. They carry name, tagline, description, category, tags, price (Free), license, links, the data disclosure and the store-specific upload steps. When a bridge version changes, bump the engine manifest and the listing together; the validator rejects a mismatch.

## Submission checklist

All three: be signed in to the owner's publisher account; run `npm run package:engine-stores`; confirm every line says PASS; take 3 to 5 real screenshots of the editor window generating a model.

- [ ] **Unity Asset Store.** Create a Publisher Portal product (Package). In a Unity 2021.3 project containing `packages/unity-bridge`, run Asset Store Tools > Package Upload, validate, upload. Fill the page from `unity/listing.json`. Media: icon 160x100, card 420x280, cover 1950x1300.
- [ ] **Godot Asset Library.** Create a GitHub release attaching `godot/three-ws-forge-bridge-godot-<version>.zip`. Asset Library > Submit Asset: provider Custom, download URL the release asset, Godot version 4.3, icon URL from `godot/artwork/icon-128.png` hosted anywhere stable, text from `godot/listing.json`.
- [ ] **Fab (Unreal).** Install Unreal 5.3 or later, run `RunUAT BuildPlugin -Plugin=<path>/packages/unreal-bridge/ThreeWsBridge.uplugin -Package=<out> -TargetPlatforms=Win64+Linux` once per supported engine version, create a Code Plugin listing in the Fab Publisher Portal, upload each build, fill the page from `unreal/listing.json`. After approval, set `MarketplaceURL` in the `.uplugin`.

## Honest limits

Unreal binaries need an Unreal install, so Fab's per-version build runs on the owner's machine. Unity and Godot submissions need no engine to be installed on a publisher's side beyond the Unity Editor for Asset Store Tools. Review times and approval are the stores' decision.
