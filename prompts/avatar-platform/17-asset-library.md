# Task: VRM asset library and manifest pipeline

## Context

Repo: `/workspaces/3D`. Task 16 needs a manifest of traits (hair, clothes, body, accessories) to render its editor. This task builds the manifest + asset hosting pipeline.

Sources:
- **[ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars)** — curated CC0 VRM registry.
- **[ToxSam/open-source-3D-assets](https://github.com/ToxSam/open-source-3D-assets)** — 991+ CC0 GLB models.
- **CharacterStudio**'s loot-assets (if license compatible — **verify before including**).
- Our own commissioned or hand-authored assets (future).

## Goal

1. A `public/character-manifest.json` lists every available trait with metadata, preview thumbnail, and asset URL.
2. Assets are hosted locally (not hotlinked) under `public/assets/character/<traitGroup>/<id>/`.
3. A script generates thumbnails headlessly from each VRM/GLB.
4. The editor (task 16) loads the manifest on init and renders it dynamically.

## Deliverable

1. **Manifest schema** `public/character-manifest.schema.json` (JSON Schema):
   ```
   {
     "version": "1",
     "traitGroups": [
       { "id": "hair", "label": "Hair", "traits": [
         { "id": "hair-short-01", "label": "Short messy", "asset": "assets/character/hair/hair-short-01/model.vrm",
           "thumbnail": "assets/character/hair/hair-short-01/thumb.png", "tags": ["casual"], "license": "CC0", "author": "..." }
       ]}
     ]
   }
   ```
2. **Starter asset set** — curate a minimal but usable set (~8 hair, ~10 tops, ~6 bottoms, ~4 footwear, ~6 accessories). Prioritize variety over quantity. License hygiene: **every asset must be CC0, CC-BY (with attribution), or MIT**. Reject CC-BY-SA, CC-NC, any non-commercial terms unless the project has explicitly approved that tradeoff.
3. **Import script** `scripts/import-asset.mjs`:
   - `node scripts/import-asset.mjs <source-url-or-path> --group hair --id hair-short-01 --label "Short messy" --license CC0 --author "..."`
   - Downloads/copies the asset, validates it parses as GLB/VRM, writes to `public/assets/character/<group>/<id>/model.{vrm|glb}`.
   - Appends to `public/character-manifest.json`.
   - Fails loudly on license mismatch or parse errors.
4. **Thumbnail script** `scripts/generate-thumbnails.mjs`:
   - Headless three.js + `node-canvas` or puppeteer rendering.
   - Renders each asset at a standardized camera angle, writes `thumb.png` (256×256).
   - Idempotent: skips assets whose thumb is newer than the model file.
5. **License audit** `scripts/audit-licenses.mjs` — scans the manifest, flags any asset with missing or incompatible license fields. Runs in CI (add a GitHub Action or document the intent).
6. **NOTICES.md** — auto-generated from the manifest, listing every author and license. Committed to the repo.

## Audit checklist

- [ ] Manifest validates against its schema.
- [ ] Every asset in the manifest has a thumbnail on disk.
- [ ] `scripts/audit-licenses.mjs` returns 0 warnings.
- [ ] All assets load in the viewer without errors.
- [ ] Total asset size is noted; document the uncompressed/compressed totals.
- [ ] No non-commercial or share-alike licenses snuck in.
- [ ] Editor (task 16) renders the manifest cleanly with all thumbnails loaded.
- [ ] `npx vite build` completes; assets are included in the dist output.

## Constraints

- Self-host every asset. No hotlinking to github.com raw files or third-party CDNs in production.
- Do not include assets larger than 5 MB individually. Decimate or re-export if needed.
- Use Draco or Meshopt compression where the upstream format allows; document the compression pipeline.
- Attribution text must be human-readable in the editor UI (small credit line per trait).
- Do not mix licenses within a single trait (e.g., CC0 model + CC-BY texture); the composed asset takes the most-restrictive license.

## Verification

1. `node scripts/import-asset.mjs` on a sample CC0 VRM → imported, thumbnail generated, manifest updated.
2. `node scripts/audit-licenses.mjs` → 0 warnings.
3. Load editor (task 16) → every trait category populated, thumbnails render.
4. Strip the manifest to a single entry per category → editor still works with minimal content.

## Scope boundaries — do NOT do these

- No user-uploaded assets (future task).
- No asset marketplace / payments.
- No NFT-gated assets.
- No procedural asset generation.
- No texture-atlasing or LOD pipeline (performance task is 19).

## Reporting

- Count of assets shipped per category.
- Total asset bytes on disk + in the built bundle.
- License breakdown (CC0 vs CC-BY vs MIT).
- Attribution text block.
- Thumbnail generation time (total + per-asset).
- Any assets you considered and rejected, with reasons.
