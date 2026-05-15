-- Avatar appearance: outfit + bone-attached accessories + arbitrary morph weights.
--
-- `appearance` is the authoritative state set by the customizer UI / PATCH /api/avatars/:id.
--
-- `baked_storage_key` is a derived GLB on R2 where the appearance has been baked
-- into the geometry (morphs applied, accessory meshes parented to the right bones,
-- exported as a single GLB). Every viewer that loads the avatar — model-viewer on
-- /avatars/:id, embed iframes, third-party 3D renderers — gets the dressed avatar
-- without needing custom client code. This is the same architecture Ready Player Me
-- uses (the avatar URL you get from their API is already baked).
--
-- `appearance_hash` is the sha256 of the canonical appearance JSON the baked GLB
-- was produced from. When `appearance_hash` doesn't match the current appearance's
-- hash, the baked GLB is stale and a re-bake is queued. This lets the API decide
-- which storage key to serve without re-reading R2.

ALTER TABLE avatars
  ADD COLUMN IF NOT EXISTS appearance         jsonb,
  ADD COLUMN IF NOT EXISTS appearance_hash    text,
  ADD COLUMN IF NOT EXISTS baked_storage_key  text,
  ADD COLUMN IF NOT EXISTS baked_at           timestamptz;

-- Quick lookup for the bake worker / lazy-bake path: which avatars have an
-- appearance set but no matching baked GLB?
CREATE INDEX IF NOT EXISTS idx_avatars_pending_bake
  ON avatars (id)
  WHERE deleted_at IS NULL
    AND appearance IS NOT NULL
    AND (baked_storage_key IS NULL OR appearance_hash IS NULL);
