// Everything a Forge takedown has to reach beyond the creation row and its own
// bucket files (that part is forgeStore.deleteCreation, with forge-derived-keys):
//
//   findDerivedItems    what was made FROM the model: avatar copies saved through
//                       /api/avatars/from-forge, the Sketchfab showcase listing,
//                       and remixes that point back at it. Read BEFORE the row is
//                       deleted, because the Sketchfab ledger cascades with it.
//   removeDerivedItems  takes the avatar copies and the Sketchfab listing down and
//                       reports every item it could not remove. Remixes are other
//                       people's creations, so they are listed for an operator to
//                       judge, never deleted automatically.
//   takedownCdnPaths    every edge-cached URL path that can still serve the model.
//
// Used by scripts/forge-takedown.mjs.

import { sql } from './db.js';
import { meshUrlForms } from './forge-derived-keys.js';
import { removeAvatarForTakedown } from './avatars.js';
import { deleteModel, sketchfabConfigured } from './sketchfab.js';
import { VARIANT_WIDTHS } from '../../src/shared/cdn-variant.js';

const RASTER = /\.(png|jpe?g|webp)$/i;

function cdnPath(key) {
	return `/cdn/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// Cache-invalidation paths. Cloud CDN matches a path with an optional trailing
// `*`, ignoring the query string, so the id-scoped reads (/api/forge-creation,
// the feeds) are invalidated by path: they hold entries for this model for up to
// their s-maxage plus stale-while-revalidate window. /api/render/glb holds the
// share card render for a day; invalidating it re-renders other models on their
// next view, a cost a takedown is allowed to cause.
export function takedownCdnPaths({ id, keys }) {
	const stored = [...new Set(keys)].filter((k) => k && !k.endsWith('.') && !k.endsWith('/'));
	const variants = stored
		.filter((k) => RASTER.test(k) && !k.startsWith('variants/'))
		.flatMap((k) => VARIANT_WIDTHS.map((w) => `/cdn/_v/${w}/${k.split('/').map(encodeURIComponent).join('/')}`));
	const paths = [
		`/m/${id}`,
		`/m/${id}/*`,
		`/forge/share/${id}`,
		`/api/forge/${id}/og`,
		'/api/forge-creation',
		'/api/forge-gallery',
		'/api/creations',
		'/api/explore',
		// The share page's social image is a render of the mesh URL, cached a day.
		'/api/render/glb',
		...stored.map(cdnPath),
		...variants,
	];
	return [...new Set(paths)];
}

/**
 * @param {{ id: string, glb_url?: string|null, glb_key?: string|null, web_glb_url?: string|null, web_glb_key?: string|null, lod_glb_url?: string|null, lod_glb_key?: string|null }} row
 */
export async function findDerivedItems(row) {
	const urls = meshUrlForms(row);
	const avatars = urls.length
		? await sql`
			select id, owner_id, name, visibility, deleted_at
			from avatars
			where source_meta->>'source_glb_url' = any(${urls}::text[])
			order by created_at
		`
		: [];
	const sketchfab = await sql`
		select creation_id, status, sketchfab_uid, sketchfab_url
		from sketchfab_uploads
		where creation_id = ${row.id} and sketchfab_uid is not null
	`;
	const remixes = await sql`
		select id, visibility, user_id
		from forge_creations
		where parent_creation_id = ${row.id}
		order by created_at
	`;
	return { avatars, sketchfab, remixes };
}

/**
 * @param {{ avatars: Array<{id: string}>, sketchfab: Array<{sketchfab_uid: string}> }} items
 * @returns {Promise<{ removed: Array<{kind: string, ref: string}>, failed: Array<{kind: string, ref: string, error: string}> }>}
 */
export async function removeDerivedItems(items) {
	const removed = [];
	const failed = [];
	for (const a of items.avatars || []) {
		try {
			const out = await removeAvatarForTakedown(a.id);
			if (!out) continue;
			removed.push({ kind: 'avatar', ref: a.id });
			for (const f of out.failed) failed.push({ kind: 'avatar_object', ref: f.key, error: f.error });
		} catch (err) {
			failed.push({ kind: 'avatar', ref: a.id, error: err?.message || String(err) });
		}
	}
	for (const u of items.sketchfab || []) {
		try {
			if (!sketchfabConfigured()) throw new Error('SKETCHFAB_API_TOKEN unset: delete the model by hand on sketchfab.com');
			await deleteModel(u.sketchfab_uid);
			removed.push({ kind: 'sketchfab', ref: u.sketchfab_uid });
		} catch (err) {
			failed.push({ kind: 'sketchfab', ref: u.sketchfab_uid, error: err?.message || String(err) });
		}
	}
	return { removed, failed };
}
