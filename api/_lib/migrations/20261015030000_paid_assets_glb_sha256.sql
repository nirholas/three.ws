-- Cache the GLB content hash on paid_assets so /api/x402/asset-download can
-- issue (or recall) its free, signed content credential (work order 079,
-- specs/PROVENANCE_3D.md) without re-fetching and re-hashing the full object
-- from R2 on every single paid download. Null until the first download after
-- this migration lands; backfilled lazily, not in bulk, the same way every
-- other best-effort provenance field in this codebase fills in.
alter table paid_assets
	add column if not exists glb_sha256 text;
