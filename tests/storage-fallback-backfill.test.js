/**
 * scripts/storage-fallback-backfill.mjs moves objects diverted to the GCS
 * fallback bucket back into R2 once the R2 credential works again. It must copy
 * what R2 lacks, skip what R2 already holds, and never delete a GCS copy that R2
 * cannot be shown to serve.
 */
import { describe, it, expect } from 'vitest';
import { backfill } from '../scripts/storage-fallback-backfill.mjs';

function stores({ gcs, r2 = {}, putFails = new Set() }) {
	const gcsMap = new Map(Object.entries(gcs).map(([k, v]) => [k, Buffer.from(v)]));
	const r2Map = new Map(Object.entries(r2).map(([k, v]) => [k, Buffer.from(v)]));
	return {
		gcsMap,
		r2Map,
		io: {
			list: async function* () {
				for (const [name, body] of gcsMap) yield { name, size: body.length };
			},
			r2Head: async (key) => (r2Map.has(key) ? { ContentLength: r2Map.get(key).length } : null),
			r2Put: async ({ key, body }) => {
				if (putFails.has(key)) throw new Error('Unauthorized');
				r2Map.set(key, body);
			},
			gcsGet: async (key) => (gcsMap.has(key) ? { body: gcsMap.get(key), contentType: 'model/gltf-binary', metadata: {} } : null),
			gcsDelete: async (key) => {
				gcsMap.delete(key);
			},
		},
	};
}

describe('storage fallback backfill', () => {
	it('copies what R2 lacks and skips what it already holds at the same size', async () => {
		const s = stores({ gcs: { 'forge/a.glb': 'aaaa', 'forge/b.glb': 'bb' }, r2: { 'forge/b.glb': 'bb' } });
		const tally = await backfill(s.io);
		expect(tally).toMatchObject({ seen: 2, copied: 1, skipped: 1, deleted: 0, failed: 0 });
		expect(s.r2Map.get('forge/a.glb').toString()).toBe('aaaa');
		expect(s.gcsMap.size).toBe(2);
	});

	it('re-copies an R2 object whose size differs from the fallback copy', async () => {
		const s = stores({ gcs: { 'k.glb': 'full-bytes' }, r2: { 'k.glb': 'trunc' } });
		const tally = await backfill(s.io);
		expect(tally.copied).toBe(1);
		expect(s.r2Map.get('k.glb').toString()).toBe('full-bytes');
	});

	it('changes nothing on a dry run', async () => {
		const s = stores({ gcs: { 'forge/a.glb': 'aaaa' } });
		const tally = await backfill({ ...s.io, dryRun: true, deleteAfter: true });
		expect(tally.copied).toBe(1);
		expect(s.r2Map.size).toBe(0);
		expect(s.gcsMap.size).toBe(1);
	});

	it('deletes the GCS copy only after R2 verifies it, and keeps it when the copy failed', async () => {
		const s = stores({ gcs: { 'ok.glb': 'aaaa', 'bad.glb': 'bbbb' }, putFails: new Set(['bad.glb']) });
		const tally = await backfill({ ...s.io, deleteAfter: true });
		expect(tally).toMatchObject({ copied: 1, deleted: 1, failed: 1 });
		expect(s.gcsMap.has('ok.glb')).toBe(false);
		expect(s.gcsMap.has('bad.glb')).toBe(true);
	});
});
