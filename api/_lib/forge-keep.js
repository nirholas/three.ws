// Pay-to-keep ledger reads for Forge (api/forge-keep.js). A generation is "kept"
// when a settled $THREE payment for forge.keep.<tier> was redeemed against its
// creation id in forge_consumption_redemptions (the single-use ledger Game-Ready
// already uses), so no new table is needed and one payment still funds exactly one
// keep. Holders keep for free and leave no row: their entitlement is re-derived
// from the holding on every read.

import { sql } from './db.js';

/** The creation a keep applies to: a finished row with a durable file, or null. */
export async function loadKeepableCreation(creationId) {
	const [row] = await sql`
		select id, tier, glb_url, status
		from forge_creations
		where id = ${creationId} and status = 'done' and glb_url is not null
		limit 1
	`;
	return row || null;
}

/** True when a keep payment was already redeemed for this creation. */
export async function isCreationKept(creationId) {
	const [row] = await sql`
		select payment_id
		from forge_consumption_redemptions
		where job_id = ${creationId} and action like 'forge.keep.%'
		limit 1
	`;
	return Boolean(row);
}
