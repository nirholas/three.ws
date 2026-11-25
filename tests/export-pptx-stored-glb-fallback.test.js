// /api/forge/export-pptx?src=<our GLB URL> reads the model by its storage key.
// loadStoredGlb used to fetch `<S3_PUBLIC_DOMAIN>/<key>`, the bucket's raw
// *.r2.dev domain, which only serves objects that live in R2. Every model made
// while R2 refused our credential (since 2026-11-14) lives in the GCS fallback
// bucket instead, so exporting any of them answered "no stored model" even
// though /cdn/ served it. The loader now reads through the storage helpers,
// which look in R2 and then the fallback.

import { describe, it, expect, vi } from 'vitest';

const stored = new Map();
const headCalls = [];
vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		headObject: async (key) => {
			headCalls.push(key);
			return stored.has(key) ? { ContentLength: stored.get(key).length } : null;
		},
		getObjectBuffer: async (key) => stored.get(key),
	};
});

const realFetch = globalThis.fetch;
const { loadStoredGlb } = await import('../api/forge/export-pptx.js');

describe('loadStoredGlb', () => {
	it('returns the bytes of an object only the storage helpers can reach', async () => {
		globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 }));
		try {
			stored.set('u/42/robot.glb', Buffer.from('glTF-bytes'));
			const bytes = await loadStoredGlb('u/42/robot.glb');
			expect(Buffer.from(bytes).toString()).toBe('glTF-bytes');
			expect(globalThis.fetch).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('answers null when no store has the key', async () => {
		expect(await loadStoredGlb('u/42/missing.glb')).toBeNull();
		expect(headCalls).toContain('u/42/missing.glb');
	});

	it('refuses an object over the export limit without downloading it', async () => {
		stored.set('u/42/huge.glb', { length: 101 * 1024 * 1024 });
		await expect(loadStoredGlb('u/42/huge.glb')).rejects.toThrow(/too large/);
	});
});
