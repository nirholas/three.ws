-- Record every reference-view URL a generation was fed, not just the first.
--
-- The multi-view lanes (Pixal3D fuses up to four photos, the turnaround lanes
-- add generated side views) previously left only preview_image_url (the first
-- view, later overwritten by materializeCreation with the durable copy) and
-- source_image_keys (bucket keys of the user's own uploads only; externally
-- hosted views are deliberately dropped there because they are not ours to
-- delete). A three-view request from hosted URLs therefore kept no trace of two
-- of its three inputs, so the run could not be audited, reproduced, or
-- explained to the customer who paid for it.
--
-- source_image_urls is a jsonb array of the http(s) URLs in the order the
-- reconstructor received them, capped at 12, written by createCreation
-- (api/_lib/forge-store.js). The row delete in deleteCreation removes it with
-- the rest of the creation.
alter table forge_creations
	add column if not exists source_image_urls jsonb;
