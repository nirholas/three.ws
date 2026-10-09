// CAD Forge persistence: designs, their rebuilt variants, and their files.
//
// One row per design in `cad_designs`. A design is the build123d program, the
// parameters parsed from it, the kernel's measurements, and the public URLs of
// its exported files (STEP, STL, GLB, thumbnail and drawing SVGs) in object
// storage under cad/<id>/. Refinements are designs too, linked by parent_id, so
// a part's history is a chain of real, buildable programs.
//
// Moving a slider rebuilds the same program with new values. Each distinct set
// of values is cached in `cad_variants` (keyed by paramsKey) with its files
// under cad/<id>/v/<key>/, so a shared configuration link never rebuilds twice.
//
// Tables are created lazily, the same contract as diorama-store: without
// DATABASE_URL every read returns null/empty and every write returns null.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { databaseConfigured } from '../env.js';
import { objectStorageConfigured, putObject, publicUrl } from '../r2.js';
import { recordDailyActivity, maybeAwardFirstCreation } from '../streaks.js';

export function cadStoreEnabled() {
	return databaseConfigured() && objectStorageConfigured();
}

let _ensured = null;
async function ensureTables() {
	if (!cadStoreEnabled()) return false;
	if (_ensured) return _ensured;
	_ensured = (async () => {
		await sql`
			create table if not exists cad_designs (
				id           uuid primary key,
				parent_id    uuid,
				title        text not null,
				summary      text,
				prompt       text not null,
				code         text not null,
				params       jsonb not null default '[]'::jsonb,
				metrics      jsonb not null,
				files        jsonb not null,
				adjustments  jsonb not null default '[]'::jsonb,
				model        text,
				user_id      uuid,
				views        bigint not null default 0,
				created_at   timestamptz not null default now()
			)
		`;
		await sql`create index if not exists cad_designs_created_idx on cad_designs (created_at desc)`;
		await sql`create index if not exists cad_designs_user_idx on cad_designs (user_id, created_at desc)`;
		await sql`create index if not exists cad_designs_parent_idx on cad_designs (parent_id)`;
		await sql`
			create table if not exists cad_variants (
				design_id    uuid not null,
				key          text not null,
				values       jsonb not null,
				metrics      jsonb not null,
				files        jsonb not null,
				adjustments  jsonb not null default '[]'::jsonb,
				created_at   timestamptz not null default now(),
				primary key (design_id, key)
			)
		`;
		return true;
	})().catch((err) => {
		console.error('[cad-store] ensureTables failed:', err?.message);
		_ensured = null;
		return false;
	});
	return _ensured;
}

const ARTIFACTS = Object.freeze({
	glb: { file: 'part.glb', type: 'model/gltf-binary' },
	step: { file: 'part.step', type: 'model/step' },
	stl: { file: 'part.stl', type: 'model/stl' },
	thumb_svg: { file: 'thumb.svg', type: 'image/svg+xml' },
	drawing_svg: { file: 'drawing.svg', type: 'image/svg+xml' },
});

/**
 * Upload a build's base64 artifacts under `prefix`. Returns public URLs keyed
 * like the worker's artifact map: { glb, step, stl, thumb_svg?, drawing_svg? }.
 */
export async function uploadArtifacts(prefix, artifacts) {
	const entries = Object.entries(ARTIFACTS).filter(([key]) => typeof artifacts?.[key] === 'string');
	const urls = {};
	await Promise.all(
		entries.map(async ([key, { file, type }]) => {
			const objectKey = `${prefix}/${file}`;
			await putObject({
				key: objectKey,
				body: Buffer.from(artifacts[key], 'base64'),
				contentType: type,
				metadata: { source: 'cad-forge' },
			});
			urls[key] = publicUrl(objectKey);
		}),
	);
	return urls;
}

export function newDesignId() {
	return randomUUID();
}

function toDesign(row) {
	if (!row) return null;
	return {
		id: row.id,
		parentId: row.parent_id || null,
		title: row.title,
		summary: row.summary || null,
		prompt: row.prompt,
		code: row.code,
		params: Array.isArray(row.params) ? row.params : [],
		metrics: row.metrics,
		files: row.files,
		adjustments: Array.isArray(row.adjustments) ? row.adjustments : [],
		model: row.model || null,
		views: Number(row.views) || 0,
		creatorUsername: row.creator_username || null,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
	};
}

/** Persist a built design. Returns the stored design, or null when storage is off. */
export async function saveDesign(design) {
	if (!(await ensureTables())) return null;
	const createdAt = new Date().toISOString();
	try {
		await sql`
			insert into cad_designs (id, parent_id, title, summary, prompt, code, params, metrics, files, adjustments, model, user_id, created_at)
			values (
				${design.id}, ${design.parentId || null}, ${design.title}, ${design.summary || null}, ${design.prompt},
				${design.code}, ${JSON.stringify(design.params || [])}::jsonb, ${JSON.stringify(design.metrics)}::jsonb,
				${JSON.stringify(design.files)}::jsonb, ${JSON.stringify(design.adjustments || [])}::jsonb,
				${design.model || null}, ${design.userId || null}, ${createdAt}
			)
		`;
	} catch (err) {
		console.error('[cad-store] saveDesign failed:', err?.message);
		return null;
	}
	if (design.userId) {
		recordDailyActivity(design.userId).catch(() => {});
		maybeAwardFirstCreation(design.userId).catch(() => {});
	}
	return { ...design, views: 0, createdAt };
}

export async function getDesign(id) {
	if (!id || !(await ensureTables())) return null;
	try {
		const rows = await sql`
			select d.*, u.username as creator_username
			from cad_designs d
			left join users u on u.id = d.user_id and u.deleted_at is null
			where d.id = ${id}
			limit 1
		`;
		return toDesign(rows[0]);
	} catch (err) {
		console.error('[cad-store] getDesign failed:', err?.message);
		return null;
	}
}

/** A design's lineage: its parent (if any) and its direct refinements. */
export async function getLineage(id) {
	if (!id || !(await ensureTables())) return { parent: null, children: [] };
	try {
		const rows = await sql`
			select id, title, prompt, files->>'thumb_svg' as thumb, created_at, 'child' as rel
			from cad_designs where parent_id = ${id}
			union all
			select p.id, p.title, p.prompt, p.files->>'thumb_svg', p.created_at, 'parent'
			from cad_designs c join cad_designs p on p.id = c.parent_id
			where c.id = ${id}
			order by created_at asc
			limit 40
		`;
		const card = (r) => ({ id: r.id, title: r.title, prompt: r.prompt, thumb: r.thumb || null });
		return {
			parent: rows.filter((r) => r.rel === 'parent').map(card)[0] || null,
			children: rows.filter((r) => r.rel === 'child').map(card),
		};
	} catch (err) {
		console.error('[cad-store] getLineage failed:', err?.message);
		return { parent: null, children: [] };
	}
}

export async function bumpViews(id) {
	if (!id || !(await ensureTables())) return;
	try {
		await sql`update cad_designs set views = views + 1 where id = ${id}`;
	} catch {
		/* a missed view count is not worth surfacing */
	}
}

/** Gallery cards, newest first: index columns and the thumbnail only, never the program. */
export async function listDesigns({ limit = 24, q } = {}) {
	if (!(await ensureTables())) return [];
	const lim = Math.min(60, Math.max(1, Number(limit) || 24));
	const search = typeof q === 'string' && q.trim() ? `%${q.trim().slice(0, 120)}%` : null;
	try {
		const rows = search
			? await sql`
					select id, title, summary, prompt, files->>'thumb_svg' as thumb, metrics->'size_mm' as size_mm, views, created_at
					from cad_designs where title ilike ${search} or prompt ilike ${search}
					order by created_at desc limit ${lim}`
			: await sql`
					select id, title, summary, prompt, files->>'thumb_svg' as thumb, metrics->'size_mm' as size_mm, views, created_at
					from cad_designs
					order by created_at desc limit ${lim}`;
		return rows.map((r) => ({
			id: r.id,
			title: r.title,
			summary: r.summary || null,
			prompt: r.prompt,
			thumb: r.thumb || null,
			sizeMm: Array.isArray(r.size_mm) ? r.size_mm : null,
			views: Number(r.views) || 0,
			createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
		}));
	} catch (err) {
		console.error('[cad-store] listDesigns failed:', err?.message);
		return [];
	}
}

export async function getVariant(designId, key) {
	if (!designId || !key || !(await ensureTables())) return null;
	try {
		const rows = await sql`select * from cad_variants where design_id = ${designId} and key = ${key} limit 1`;
		const row = rows[0];
		return row ? { key: row.key, values: row.values, metrics: row.metrics, files: row.files, adjustments: row.adjustments || [] } : null;
	} catch (err) {
		console.error('[cad-store] getVariant failed:', err?.message);
		return null;
	}
}

export async function saveVariant({ designId, key, values, metrics, files, adjustments }) {
	if (!(await ensureTables())) return null;
	try {
		await sql`
			insert into cad_variants (design_id, key, values, metrics, files, adjustments)
			values (${designId}, ${key}, ${JSON.stringify(values)}::jsonb, ${JSON.stringify(metrics)}::jsonb,
				${JSON.stringify(files)}::jsonb, ${JSON.stringify(adjustments || [])}::jsonb)
			on conflict (design_id, key) do nothing
		`;
		return { key, values, metrics, files, adjustments: adjustments || [] };
	} catch (err) {
		console.error('[cad-store] saveVariant failed:', err?.message);
		return null;
	}
}
