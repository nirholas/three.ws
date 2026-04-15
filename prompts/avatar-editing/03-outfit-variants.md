# Task 03 — Outfit / accessory variants

## Why this exists

One agent, multiple looks. Users want their agent to appear in a suit on LinkedIn, casual on their personal site, cyberpunk on a Discord. Variants let the same identity render different GLBs per context without forcing the user to create multiple agents.

## Files you own

- Create: migration file adding `avatar_variants` table (follow naming pattern of existing migrations).
- Edit: `api/_lib/schema.sql` — same DDL appended.
- Create: `api/avatars/[id]/variants.js` — `GET`, `POST`, `DELETE`.
- Create: `src/editor/variants-panel.js` — UI for creating / selecting / deleting variants.
- Edit: `public/agent/embed.html` — accept `?variant=<slug>` and fetch that variant's GLB instead of the default.

Do not change `api/avatars/[id].js` beyond minimal additions.

## Deliverable

### Schema

```sql
CREATE TABLE IF NOT EXISTS avatar_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  avatar_id uuid NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  slug text NOT NULL,            -- url-safe, lowercase, e.g. 'formal', 'cyberpunk'
  label text NOT NULL,           -- display name, e.g. 'Formal'
  model_url text NOT NULL,       -- R2 URL of the variant GLB
  storage_key text NOT NULL,
  preview_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (avatar_id, slug)
);

CREATE INDEX IF NOT EXISTS avatar_variants_avatar_idx ON avatar_variants (avatar_id);
```

### API

- `GET /api/avatars/:id/variants` — public if avatar is public/unlisted; owner-only otherwise. Returns `{ variants: [...] }`.
- `POST /api/avatars/:id/variants` (owner-only) — body: `{ slug, label, glb: <multipart> }`. Uploads GLB, inserts row.
- `DELETE /api/avatars/:id/variants/:slug` (owner-only) — soft-delete by removing the row; R2 blob kept for 7 days in case of accident (or hard delete — pick one, document).

### Editor UI

A "Variants" folder in the editor GUI (adjacent to the Editor folder we already added). Controls:
- Dropdown: current variant (defaults to "original")
- "Save current edits as new variant" button
- "Delete selected variant" button
- Rename current variant label

When a variant is selected, the viewer swaps to that variant's GLB (editor snapshots reset to that variant's baseline).

### Embed support

`/agent/:slug/embed?variant=formal` loads the `formal` variant if it exists; falls back to default with a console warning.

### OG / Claude / LobeHub

The public page URL supports `/agent/:slug?variant=cyberpunk` as well. The canonical URL stays `/agent/:slug` (the variant is a query param, not a path segment, to keep SEO and sharing simple).

## Constraints

- Slug is `[a-z0-9][a-z0-9-]{0,31}` — validate on write.
- Max 12 variants per avatar. Return 409 on the 13th.
- Variants do not have their own action history — they are pure visual alternates of the same identity.
- Do not treat variants as a new avatar primary key. The canonical public URL always resolves to the default model when no variant is specified.

## Acceptance test

1. Schema migration applies cleanly.
2. Owner creates two variants; `GET /api/avatars/:id/variants` returns both.
3. `/agent/:slug?variant=formal` shows the formal GLB; omitting the param shows the default.
4. `?variant=doesnotexist` logs a warning, loads default, does not 500.
5. Non-owner tries `POST` → 403.
6. 13th variant create → 409.

## Reporting

- Your rule for "original" — is it a row in the table or a special implicit variant? Document.
- Any SEO / social preview implications of the `?variant=` param.
