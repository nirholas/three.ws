// In-memory world-store backend that honours the production contract: the
// compare-and-set upsert (an INSERT only when no row exists, an UPDATE only when
// ifMatch is '*' or equals the stored etag), a visibility that an omitted value
// PRESERVES, and the atomic invitee updateAccess.
export function makeWorldBackend() {
	const rows = new Map();
	const blobs = new Map();
	let clock = 0;
	return {
		rows,
		blobs,
		async readRow(worldId) {
			return rows.has(worldId) ? { ...rows.get(worldId), invitees: [...rows.get(worldId).invitees] } : null;
		},
		async readBlob(key) {
			if (!blobs.has(key)) throw new Error(`no such blob: ${key}`);
			return blobs.get(key);
		},
		async writeBlob(key, bytes) {
			blobs.set(key, Buffer.from(bytes));
		},
		async deleteBlob(key) {
			blobs.delete(key);
		},
		async upsert({ worldId, schemaVersion, etag, size, inlineDoc, r2Key, owner, writer, ifMatch, visibility }) {
			const existing = rows.get(worldId);
			if (existing) {
				const ok = ifMatch === '*' || existing.etag === ifMatch;
				if (!ok) return { committed: false };
				const row = {
					...existing,
					schema_version: schemaVersion,
					doc_version: existing.doc_version + 1,
					etag,
					size_bytes: size,
					inline_doc: inlineDoc,
					r2_key: r2Key,
					updated_by: writer,
					visibility: visibility ?? existing.visibility,
					updated_at: ++clock,
				};
				rows.set(worldId, row);
				return { committed: true, version: row.doc_version, etag, ownerId: row.owner_id ?? null, visibility: row.visibility, updatedAt: row.updated_at };
			}
			const row = {
				world_id: worldId,
				schema_version: schemaVersion,
				doc_version: 1,
				etag,
				size_bytes: size,
				inline_doc: inlineDoc,
				r2_key: r2Key,
				owner_id: owner ?? null,
				updated_by: writer,
				visibility: visibility ?? 'public',
				invitees: [],
				updated_at: ++clock,
			};
			rows.set(worldId, row);
			return { committed: true, version: 1, etag, ownerId: row.owner_id, visibility: row.visibility, updatedAt: row.updated_at };
		},
		async updateAccess({ worldId, visibility, invite, uninvite, maxInvitees }) {
			const row = rows.get(worldId);
			if (!row) return null;
			const next = [...new Set([...row.invitees.filter((id) => !uninvite.includes(id)), ...invite])];
			if (next.length > maxInvitees) return { limited: true };
			row.invitees = next;
			row.visibility = visibility ?? row.visibility;
			return { visibility: row.visibility, invitees: [...row.invitees] };
		},
		async remove(worldId) {
			if (!rows.has(worldId)) return false;
			const r2 = rows.get(worldId).r2_key;
			rows.delete(worldId);
			return r2;
		},
	};
}
