// Anatomy persistence: one row per machine in `anatomy_designs`.
//
// A design is a normalized spec (src/anatomy/spec.js) plus where it came from:
// written by Claude on /anatomy (`generated`), written by an agent through the
// skill or MCP (`published`). The spec is the whole artifact, there are no
// files, so a design renders from a single row.
//
// The table is created lazily, the same contract as the CAD Forge store:
// without DATABASE_URL every read returns null/empty and every write null.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { databaseConfigured } from '../env.js';
import { recordDailyActivity, maybeAwardFirstCreation } from '../streaks.js';

export function anatomyStoreEnabled() {
	return databaseConfigured();
}

let _ensured = null;
async function ensureTables() {
	if (!anatomyStoreEnabled()) return false;
	if (_ensured) return _ensured;
	_ensured = (async () => {
		await sql`
			create table if not exists anatomy_designs (
				id          uuid primary key,
				title       text not null,
				subtitle    text,
				prompt      text,
				spec        jsonb not null,
				stats       jsonb not null,
				source      text not null default 'generated',
				model       text,
				user_id     uuid,
				views       bigint not null default 0,
				created_at  timestamptz not null default now()
			)
		`;
		await sql`create index if not exists anatomy_designs_created_idx on anatomy_designs (created_at desc)`;
		await sql`create index if not exists anatomy_designs_user_idx on anatomy_designs (user_id, created_at desc)`;
		return true;
	})().catch((err) => {
		console.error('[anatomy-store] ensureTables failed:', err?.message);
		_ensured = null;
		return false;
	});
	return _ensured;
}

export function newDesignId() {
	return randomUUID();
}

function toDesign(row, { withSpec = true } = {}) {
	return {
		id: row.id,
		title: row.title,
		subtitle: row.subtitle || '',
		prompt: row.prompt || null,
		...(withSpec ? { spec: row.spec } : {}),
		stats: row.stats,
		source: row.source,
		model: row.model || null,
		views: Number(row.views) || 0,
		creatorUsername: row.creator_username || null,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
	};
}

/** Persist a design. Returns the stored design, or null when storage is off or the write failed. */
export async function saveDesign(design) {
	if (!(await ensureTables())) return null;
	const createdAt = new Date().toISOString();
	try {
		await sql`
			insert into anatomy_designs (id, title, subtitle, prompt, spec, stats, source, model, user_id, created_at)
			values (
				${design.id}, ${design.title}, ${design.subtitle || null}, ${design.prompt || null},
				${JSON.stringify(design.spec)}::jsonb, ${JSON.stringify(design.stats)}::jsonb,
				${design.source}, ${design.model || null}, ${design.userId || null}, ${createdAt}
			)
		`;
	} catch (err) {
		console.error('[anatomy-store] saveDesign failed:', err?.message);
		return null;
	}
	if (design.userId) {
		recordDailyActivity(design.userId).catch(() => {});
		maybeAwardFirstCreation(design.userId).catch(() => {});
	}
	const { userId: _omit, ...rest } = design;
	return { ...rest, views: 0, creatorUsername: null, createdAt };
}

export async function getDesign(id) {
	if (!id || !(await ensureTables())) return null;
	try {
		const rows = await sql`
			select d.*, u.username as creator_username
			from anatomy_designs d
			left join users u on u.id = d.user_id and u.deleted_at is null
			where d.id = ${id}
			limit 1
		`;
		return rows[0] ? toDesign(rows[0]) : null;
	} catch (err) {
		console.error('[anatomy-store] getDesign failed:', err?.message);
		return null;
	}
}

export async function bumpViews(id) {
	if (!(await ensureTables())) return;
	sql`update anatomy_designs set views = views + 1 where id = ${id}`.catch(() => {});
}

/** Newest designs without their specs (gallery cards). */
export async function listDesigns({ limit = 24, q } = {}) {
	if (!(await ensureTables())) return [];
	const lim = Math.min(60, Math.max(1, Number(limit) || 24));
	const search = q ? `%${String(q).slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
	try {
		const rows = search
			? await sql`select id, title, subtitle, prompt, stats, source, model, views, created_at
					from anatomy_designs where title ilike ${search} or prompt ilike ${search} or subtitle ilike ${search}
					order by created_at desc limit ${lim}`
			: await sql`select id, title, subtitle, prompt, stats, source, model, views, created_at
					from anatomy_designs order by created_at desc limit ${lim}`;
		return rows.map((r) => toDesign(r, { withSpec: false }));
	} catch (err) {
		console.error('[anatomy-store] listDesigns failed:', err?.message);
		return [];
	}
}
