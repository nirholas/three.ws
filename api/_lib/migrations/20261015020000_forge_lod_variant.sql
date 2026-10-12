-- LOD chain variant of a finished forge mesh, opt-in via { lods: true } on the
-- generation request (api/_lib/forge-options.js).
--
-- Building a real MSFT_lod chain (packages/glb-tools's buildLodChain,
-- meshoptimizer decimation under the hood) costs real CPU, so it only runs when
-- a caller asks for it, exactly like the web-delivery variant it sits beside
-- (see 20260904120000_forge_web_glb.sql). Stored as a THIRD object: glb_url
-- stays the caller's requested output_format untouched, web_glb_url stays the
-- phone-sized delivery variant, and lod_glb_url is the combined, single-file
-- MSFT_lod GLB a real-time engine can switch levels from at runtime.
--
-- lod_levels carries the per-level triangle/vertex counts (name, ratio,
-- triangleCount, vertexCount) so a reader can show the chain's shape without
-- fetching and parsing the GLB itself (the same shape the Engine QA report's
-- triangleBudget check already renders in public/engine-qa-panel.js).
--
-- Null on every existing row and on any row whose caller did not opt in, or
-- whose build failed; readers must treat null as "no LOD chain available."
alter table forge_creations
	add column if not exists lod_glb_key text,
	add column if not exists lod_glb_url text,
	add column if not exists lod_levels  jsonb;
