#!/usr/bin/env node
// Re-bake served avatars with the identity-morph fold (api/_lib/bake-morph-fold.js).
//
// Bakes written before the fold carry every identity slider as a dense morph
// layer (about 68 MB of VRAM per viewer on the Parametric base). This script
// finds avatars with a saved appearance whose baked GLB predates the current
// fold version, re-bakes them from the base GLB, uploads the folded GLB under
// its own `-f<version>` key and repoints `baked_storage_key`. The old baked
// object is left in storage, so a rollback is one UPDATE of the pointer.
//
// Usage:
//   node --env-file=.env.local scripts/rebake-avatars.mjs              # report only
//   node --env-file=.env.local scripts/rebake-avatars.mjs --apply
//   node --env-file=.env.local scripts/rebake-avatars.mjs --apply --limit 50
//
// Reads DATABASE_URL and the R2 credentials, so run it with --env-file.
// Re-running is safe: an avatar already on the current fold key is skipped.

import { sql } from '../api/_lib/db.js';
import { bakeAndUploadAppearance, isBakeable } from '../api/_lib/bake.js';
import { FOLD_VERSION } from '../api/_lib/bake-morph-fold.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 0) : 500;
const suffix = `-f${FOLD_VERSION}.glb`;

const rows = await sql`
	select id, storage_key, baked_storage_key, appearance
	from avatars
	where deleted_at is null
	  and appearance is not null
	  and storage_key is not null
	  and (baked_storage_key is null or baked_storage_key not like ${'%' + suffix})
	order by updated_at desc
	limit ${limit}
`;

console.log(`${rows.length} avatar(s) on a pre-fold bake${apply ? '' : ' (dry run, pass --apply to rebake)'}`);

let done = 0;
let failed = 0;
for (const row of rows) {
	if (!isBakeable(row.appearance)) continue;
	if (!apply) {
		console.log(`  would rebake ${row.id} (${row.baked_storage_key || 'no bake yet'})`);
		continue;
	}
	try {
		const result = await bakeAndUploadAppearance({
			baseStorageKey: row.storage_key,
			appearance: row.appearance,
			fold: true,
		});
		if (!result) continue;
		await sql`
			update avatars
			set baked_storage_key = ${result.baked_storage_key}, appearance_hash = ${result.appearance_hash}
			where id = ${row.id}
		`;
		done++;
		console.log(`  rebaked ${row.id} -> ${result.baked_storage_key} (${result.size_bytes} bytes)`);
	} catch (err) {
		failed++;
		console.warn(`  failed ${row.id}: ${err?.message}`);
	}
}
if (apply) console.log(`rebaked ${done}, failed ${failed}`);
process.exit(failed ? 1 : 0);
