-- VRoid Hub import (work order 092-partners-09): a new avatars.source value
-- so an avatar pulled in through /import/vroid carries clear provenance,
-- same pattern as 'readyplayer', 'forge' and 'fork' before it. The license
-- fields and creator credit live in source_meta (jsonb), not new columns:
-- the shape already varies by provider (see api/_lib/vroid/license.js) and
-- jsonb is where every other provider's import metadata already lives.

ALTER TABLE avatars
DROP CONSTRAINT avatars_source_check,
ADD CONSTRAINT avatars_source_check
    CHECK (source = ANY (ARRAY[
        'upload', 'avaturn', 'readyplayer', 'import',
        'direct-upload', 'reconstruct', 'studio', 'forge', 'fork', 'vroid_hub'
    ]));
