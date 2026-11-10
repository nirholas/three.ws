---
name: find-3d-assets
description: Search the free three.ws catalog of CC0 3D props, rigged characters and motion clips, then download a GLB into a project with paste-ready render code, using the @three-ws/assets CLI. Use before generating a model from scratch, or whenever a project needs a ready-made 3D asset.
---

# Find and add 3D assets with @three-ws/assets

The catalog is public: no account, no API key, no payment. Node 18+ is required (built-in `fetch`). Run the CLI with `npx @three-ws/assets <command>` or install it with `npm install --save-dev @three-ws/assets` and call `three-ws-assets`.

## Commands

### search

```bash
npx @three-ws/assets search wooden chair --kind object
npx @three-ws/assets search wave --kind animation --limit 5
npx @three-ws/assets search --kind character --json
```

Flags: `--kind object|character|animation`, `--category <c>`, `--tag <t>`, `--limit <1-50>` (default 12), `--offset <n>`, `--json`. Every query word must match a title, name, tag or category; with no full match you get partial matches and a warning on stderr. It exits 1 when nothing matches.

### show

Prints one item's facts and paste-ready source without downloading.

```bash
npx @three-ws/assets show object:painted_wooden_chair_01
npx @three-ws/assets show character:abe --framework three > model.js
```

### add

Downloads the asset and prints a snippet that points at the local copy.

```bash
npx @three-ws/assets add object:painted_wooden_chair_01
npx @three-ws/assets add character:abe --dir src/models --framework agent-3d
npx @three-ws/assets add animation:mx-wave-abc123 --thumb
```

Flags: `--dir <path>` (default `public/three-ws/` when the project has a `public/` directory, else `three-ws-assets/`), `--framework agent-3d|model-viewer|three|react`, `--thumb`, `--force`, `--json`. A re-run that would write identical bytes changes nothing. A file edited after adding is never overwritten without `--force`, and the command exits 1.

Default frameworks: `model-viewer` for props, `agent-3d` for rigged characters, `three` (GLTFLoader, or `AnimationClip.parse` for clips) for clips.

## Programmatic use

The package also exports `./api` (`@three-ws/assets/api`) for use from code. The catalog origin can be overridden with the env var `THREE_WS_API`. The live item count is `total` in `GET https://three.ws/api/catalog?limit=1`.

## Worked example

```bash
npx @three-ws/assets search industrial lamp --kind object --limit 3
npx @three-ws/assets add object:<id from the search> --framework three
```

Item ids have the form `<kind>:<name>`; take them from `search` output, never guess them. Objects are CC0 (public domain). Check an item's license line in `show` output before using characters or clips commercially.
