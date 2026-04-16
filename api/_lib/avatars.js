// Avatar service — CRUD + quota enforcement + URL resolution.
// Keep handler code small by routing through this.

import { sql } from './db.js';
import { publicUrl, presignGet, deleteObject } from './r2.js';

export async function listAvatars({ userId, limit = 50, cursor, visibility, includePublic = false }) {
	limit = Math.min(Math.max(limit, 1), 200);
	const params = [userId];
	const conds = ['deleted_at is null'];
	conds.push(includePublic ? `(owner_id = $1 or visibility = 'public')` : `owner_id = $1`);
	if (visibility) { params.push(visibility); conds.push(`visibility = $${params.length}`); }
	if (cursor)     { params.push(new Date(cursor)); conds.push(`created_at < $${params.length}`); }
	params.push(limit + 1);
	const rows = await sql(
		`select id, owner_id, slug, name, description, storage_key, thumbnail_key, size_bytes,
		        content_type, source, visibility, tags, version, created_at, updated_at
		 from avatars where ${conds.join(' and ')}
		 order by created_at desc limit $${params.length}`,
		params,
	);
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	return {
		avatars: page.map(decorate),
		next_cursor: hasMore ? new Date(page[page.length - 1].created_at).toISOString() : null,
	};
}

export async function getAvatar({ id, requesterId = null }) {
	const rows = await sql`
		select * from avatars where id = ${id} and deleted_at is null limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	if (row.visibility === 'private' && row.owner_id !== requesterId) return null;
	return decorate(row);
}

export async function getAvatarBySlug({ ownerId, slug, requesterId = null }) {
	const rows = await sql`
		select * from avatars where owner_id = ${ownerId} and slug = ${slug} and deleted_at is null limit 1
	`;
	const row = rows[0];
	if (!row) return null;
	if (row.visibility === 'private' && row.owner_id !== requesterId) return null;
	return decorate(row);
}

export async function createAvatar({ userId, input, storageKey }) {
	await enforceQuotas(userId, input.size_bytes);
	const finalSlug = input.slug || (await generateSlug(userId, input.name));
	const [row] = await sql`
		insert into avatars (
			owner_id, slug, name, description, storage_key, size_bytes, content_type,
			source, source_meta, visibility, tags, checksum_sha256
		) values (
			${userId}, ${finalSlug}, ${input.name}, ${input.description ?? null},
			${storageKey}, ${input.size_bytes}, ${input.content_type},
			${input.source}, ${JSON.stringify(input.source_meta)}::jsonb,
			${input.visibility}, ${input.tags}, ${input.checksum_sha256 ?? null}
		) returning *
	`;
	return decorate(row);
}

export async function updateAvatar({ id, userId, patch }) {
	if (
		patch.name === undefined &&
		patch.description === undefined &&
		patch.visibility === undefined &&
		patch.tags === undefined
	) {
		return getAvatar({ id, requesterId: userId });
	}
	// Coalesce-style update keeps the statement static and safe against dynamic composition.
	const [row] = await sql`
		update avatars set
			name        = coalesce(${patch.name ?? null}, name),
			description = coalesce(${patch.description ?? null}, description),
			visibility  = coalesce(${patch.visibility ?? null}, visibility),
			tags        = coalesce(${patch.tags ?? null}::text[], tags)
		where id = ${id} and owner_id = ${userId} and deleted_at is null
		returning *
	`;
	return row ? decorate(row) : null;
}

export async function deleteAvatar({ id, userId }) {
	const rows = await sql`
		update avatars set deleted_at = now()
		where id = ${id} and owner_id = ${userId} and deleted_at is null
		returning storage_key, thumbnail_key
	`;
	const row = rows[0];
	if (!row) return false;
	// Fire-and-forget object delete — DB row is source of truth.
	queueMicrotask(async () => {
		try { await deleteObject(row.storage_key); } catch (e) { console.warn('r2 delete failed', e?.message); }
		if (row.thumbnail_key) try { await deleteObject(row.thumbnail_key); } catch {}
	});
	return true;
}

export async function searchPublicAvatars({ q, tag, limit = 24, cursor }) {
	limit = Math.min(Math.max(limit, 1), 100);
	const params = [];
	const conds = [`deleted_at is null`, `visibility = 'public'`];
	if (q) {
		params.push('%' + q + '%');
		conds.push(`(name ilike $${params.length} or description ilike $${params.length})`);
	}
	if (tag)    { params.push(tag); conds.push(`$${params.length} = any(tags)`); }
	if (cursor) { params.push(new Date(cursor)); conds.push(`created_at < $${params.length}`); }
	params.push(limit + 1);
	const rows = await sql(
		`select id, owner_id, slug, name, description, storage_key, thumbnail_key, size_bytes,
		        content_type, source, visibility, tags, created_at
		 from avatars where ${conds.join(' and ')}
		 order by created_at desc limit $${params.length}`,
		params,
	);
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	return {
		avatars: page.map(decorate),
		next_cursor: hasMore ? new Date(page[page.length - 1].created_at).toISOString() : null,
	};
}

export async function resolveAvatarUrl(row, { expiresIn = 600 } = {}) {
	if (row.visibility === 'public' || row.visibility === 'unlisted') {
		return { url: publicUrl(row.storage_key), cdn: true };
	}
	return { url: await presignGet({ key: row.storage_key, expiresIn }), cdn: false, expires_in: expiresIn };
}

// ── quotas ───────────────────────────────────────────────────────────────────
async function enforceQuotas(userId, incomingBytes) {
	const rows = await sql`
		select u.plan, q.max_avatars, q.max_bytes_per_avatar, q.max_total_bytes,
		       (select count(*) from avatars a where a.owner_id = u.id and a.deleted_at is null) as avatar_count,
		       (select coalesce(sum(size_bytes),0) from avatars a where a.owner_id = u.id and a.deleted_at is null) as total_bytes
		from users u join plan_quotas q on q.plan = u.plan
		where u.id = ${userId}
		limit 1
	`;
	const q = rows[0];
	if (!q) throw Object.assign(new Error('user not found'), { status: 404 });
	if (incomingBytes > q.max_bytes_per_avatar) {
		throw Object.assign(new Error(`file too large for plan ${q.plan}`), { status: 413, code: 'plan_limit_size' });
	}
	if (q.avatar_count >= q.max_avatars) {
		throw Object.assign(new Error(`avatar count limit reached on plan ${q.plan}`), { status: 402, code: 'plan_limit_count' });
	}
	if (Number(q.total_bytes) + incomingBytes > Number(q.max_total_bytes)) {
		throw Object.assign(new Error(`storage limit reached on plan ${q.plan}`), { status: 402, code: 'plan_limit_storage' });
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────
function decorate(row) {
	return {
		id: row.id,
		owner_id: row.owner_id,
		slug: row.slug,
		name: row.name,
		description: row.description,
		storage_key: row.storage_key,
		size_bytes: Number(row.size_bytes),
		content_type: row.content_type,
		source: row.source,
		source_meta: row.source_meta || {},
		visibility: row.visibility,
		tags: row.tags || [],
		version: row.version,
		created_at: row.created_at,
		updated_at: row.updated_at,
		model_url: row.visibility === 'public' || row.visibility === 'unlisted'
			? publicUrl(row.storage_key)
			: null,
		thumbnail_url: row.thumbnail_key ? publicUrl(row.thumbnail_key) : null,
	};
}

// Hide owner_id and storage_key from callers who don't own the row. The raw
// user UUID is the primary segment of R2 storage keys, so leaking either helps
// an attacker guess object paths in other users' namespaces.
export function stripOwnerFor(avatar, requesterId) {
	if (!avatar) return avatar;
	if (requesterId && avatar.owner_id === requesterId) return avatar;
	const { owner_id: _o, storage_key: _sk, ...rest } = avatar;
	return rest;
}

async function generateSlug(userId, name) {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'avatar';
	for (let i = 0; i < 5; i++) {
		const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
		const rows = await sql`select 1 from avatars where owner_id = ${userId} and slug = ${candidate} limit 1`;
		if (!rows[0]) return candidate;
	}
	return `${base}-${Date.now().toString(36)}`;
}

export function storageKeyFor({ userId, slug }) {
	const ts = Date.now().toString(36);
	return `u/${userId}/${slug}/${ts}.glb`;
}
