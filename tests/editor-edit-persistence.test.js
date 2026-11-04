// The editor stashes its edits across the sign-in redirect. v2 added texture
// edits (image bytes in IndexedDB); v1 blobs must still restore.
import { describe, it, expect, beforeEach } from 'vitest';

function fakeIndexedDB() {
	const stores = new Map();
	const tick = (fn) => queueMicrotask(fn);
	return {
		open() {
			const req = {};
			const db = {
				objectStoreNames: { contains: () => true },
				createObjectStore() {},
				close() {},
				transaction() {
					const tx = {};
					tx.objectStore = () => ({
						put: (v, k) => (stores.set(k, v), tick(() => tx.oncomplete?.())),
						delete: (k) => (stores.delete(k), tick(() => tx.oncomplete?.())),
						get: (k) => {
							const r = {};
							tick(() => {
								r.result = stores.get(k);
								r.onsuccess?.();
							});
							return r;
						},
					});
					return tx;
				},
			};
			tick(() => {
				req.result = db;
				req.onsuccess?.();
			});
			return req;
		},
	};
}

beforeEach(() => {
	const ss = new Map();
	globalThis.sessionStorage = {
		getItem: (k) => ss.get(k) ?? null,
		setItem: (k, v) => ss.set(k, v),
		removeItem: (k) => ss.delete(k),
	};
	globalThis.indexedDB = fakeIndexedDB();
});

describe('edit-persistence', () => {
	it('round-trips texture edit bytes through a stash', async () => {
		const { stashSession, restoreSession } = await import('../src/editor/edit-persistence.js');
		const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
		const session = {
			sourceURL: 'https://example.test/a.glb',
			materialEdits: { m1: { name: 'Skin', emissiveIntensity: 2 } },
			transformEdits: {},
			visibilityEdits: {},
			textureEdits: {
				'm1:baseColor': { name: 'Skin', materialUuid: 'm1', slot: 'baseColor', mime: 'image/png', bytes },
			},
		};
		const token = await stashSession(session);
		const out = await restoreSession(token);
		expect(out.edits.materialEdits.m1.emissiveIntensity).toBe(2);
		const tex = out.edits.textureEdits['m1:baseColor'];
		expect([...tex.bytes]).toEqual([...bytes]);
		expect(tex.slot).toBe('baseColor');
	});

	it('restores a version 1 blob with no texture edits', async () => {
		const { restoreSession } = await import('../src/editor/edit-persistence.js');
		sessionStorage.setItem(
			'edt:old',
			JSON.stringify({
				v: 1,
				source: { url: 'https://example.test/a.glb' },
				edits: { materialEdits: { x: { name: 'M' } }, transformEdits: {}, visibilityEdits: {} },
			}),
		);
		const out = await restoreSession('old');
		expect(out.edits.materialEdits.x.name).toBe('M');
		expect(out.edits.textureEdits).toEqual({});
	});
});
