import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sweepAnonUploads } from '../api/_lib/anon-upload-sweep.js';
import { ANON_UPLOAD_LIMITS } from '../api/_lib/anon-upload-limits.js';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const MB = 1024 * 1024;

// In-memory bucket implementing the same surface as api/_lib/r2.js.
function bucket(objects, pageSize = 2) {
	const store = new Map(objects.map((o) => [o.key, { lastModified: new Date(NOW - 60_000), ...o }]));
	const deleted = [];
	const heads = [];
	return {
		deleted,
		heads,
		store,
		async listObjectsPage({ prefix, continuationToken }) {
			const all = [...store.values()]
				.filter((o) => o.key.startsWith(prefix) && (!continuationToken || o.key > continuationToken))
				.sort((x, y) => (x.key < y.key ? -1 : 1));
			const slice = all.slice(0, pageSize);
			const next = all.length > pageSize ? slice[slice.length - 1].key : null;
			return { objects: slice, nextToken: next };
		},
		async headObject(key) {
			heads.push(key);
			const o = store.get(key);
			return o ? { ContentLength: o.headSize ?? o.size } : null;
		},
		async deleteObject(key) {
			deleted.push(key);
			store.delete(key);
		},
	};
}

describe('sweepAnonUploads', () => {
	it('deletes only objects above their prefix ceiling, across pages', async () => {
		const b = bucket([
			{ key: 'forge/uploads/a/ok.png', size: 8 * MB },
			{ key: 'forge/uploads/a/big1.png', size: 8 * MB + 1 },
			{ key: 'forge/uploads/a/big2.png', size: 90 * MB },
			{ key: 'scene/shares/ok.glb', size: 150 * MB },
			{ key: 'scene/shares/big.glb', size: 201 * MB },
			{ key: 'other/prefix/huge.bin', size: 900 * MB },
		]);
		const out = await sweepAnonUploads(b, { now: NOW });
		expect(b.deleted.sort()).toEqual([
			'forge/uploads/a/big1.png',
			'forge/uploads/a/big2.png',
			'scene/shares/big.glb',
		]);
		expect(out.deleted).toBe(3);
		expect(out.errors).toBe(0);
	});

	it('confirms with HEAD and keeps an object whose real size is within the ceiling', async () => {
		const b = bucket([{ key: 'motion-swap/uploads/x.mp4', size: 300 * MB, headSize: 10 * MB }]);
		await sweepAnonUploads(b, { now: NOW });
		expect(b.heads).toEqual(['motion-swap/uploads/x.mp4']);
		expect(b.deleted).toEqual([]);
	});

	it('does not HEAD or delete objects within the ceiling', async () => {
		const b = bucket([{ key: 'print/uploads/a/m.glb', size: 100 * MB }]);
		await sweepAnonUploads(b, { now: NOW });
		expect(b.heads).toEqual([]);
	});

	it('skips objects older than the lookback window', async () => {
		const b = bucket([
			{ key: 'forge/uploads/a/old.png', size: 50 * MB, lastModified: new Date(NOW - 48 * 3600_000) },
		]);
		await sweepAnonUploads(b, { now: NOW });
		expect(b.deleted).toEqual([]);
	});

	it('survives a failing delete and keeps sweeping', async () => {
		const b = bucket([
			{ key: 'forge/uploads/a/1.png', size: 20 * MB },
			{ key: 'forge/uploads/a/2.png', size: 20 * MB },
		]);
		const real = b.deleteObject;
		b.deleteObject = async (k) => {
			if (k.endsWith('1.png')) throw new Error('boom');
			return real(k);
		};
		const out = await sweepAnonUploads(b, { now: NOW });
		expect(out.errors).toBe(1);
		expect(b.deleted).toEqual(['forge/uploads/a/2.png']);
	});

	it('reports a prefix it stopped early on', async () => {
		const b = bucket(
			Array.from({ length: 6 }, (_, i) => ({ key: `forge/uploads/a/${i}.png`, size: 1 })),
			1,
		);
		const out = await sweepAnonUploads(b, { now: NOW, maxPages: 2 });
		expect(out.truncated).toEqual(['forge/uploads/']);
	});
});

describe('anonymous upload ceilings', () => {
	it('print ceiling matches the analyzer input cap', () => {
		const src = readFileSync(new URL('../api/_lib/print/mesh-io.js', import.meta.url), 'utf8');
		const m = src.match(/MAX_INPUT_BYTES = (\d+) \* 1024 \* 1024/);
		expect(Number(m[1]) * 1024 * 1024).toBe(ANON_UPLOAD_LIMITS['print/uploads/']);
	});

	it('every prefix the presign handlers write is covered', () => {
		const files = {
			'api/scene-upload.js': 'capture/uploads/',
			'api/scene-glb-upload.js': 'scene/shares/',
			'api/motion-swap.js': 'motion-swap/uploads/',
			'api/forge-upload.js': 'forge/uploads/',
			'api/print/upload.js': 'print/uploads/',
		};
		for (const [f, prefix] of Object.entries(files)) {
			expect(readFileSync(new URL('../' + f, import.meta.url), 'utf8')).toContain('`' + prefix);
			expect(ANON_UPLOAD_LIMITS[prefix]).toBeGreaterThan(0);
		}
	});

	it('the sweep cron is declared in vercel.json', () => {
		const { crons } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
		expect(crons.some((c) => c.path === '/api/cron/anon-upload-sweep')).toBe(true);
	});
});
