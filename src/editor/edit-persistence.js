/**
 * edit-persistence — round-trip the editor's in-progress state across a
 * navigation (the "sign in to publish" redirect being the driving case).
 *
 * Edits are small JSON → `sessionStorage` under `edt:<id>`.
 * Source bytes (for dropped files) go to IndexedDB under `3dagent/edt-bytes`,
 * keyed by the same id. URL-loaded models store only the url and re-fetch.
 */

import { log } from '../shared/log.js';
const DB_NAME = '3dagent';
const STORE_NAME = 'edt-bytes';
const SS_PREFIX = 'edt:';
// v2 added textureEdits (image bytes live in IndexedDB under `<id>:tex`).
// v1 blobs carry no texture edits and restore as-is.
const BLOB_VERSION = 2;

function base64url(bytes) {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newToken() {
	const rand = crypto.getRandomValues(new Uint8Array(6));
	return 'edt_' + base64url(rand);
}

function openDB() {
	return new Promise((resolve, reject) => {
		let req;
		try {
			req = indexedDB.open(DB_NAME, 1);
		} catch (err) {
			reject(err);
			return;
		}
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error('indexedDB blocked'));
	});
}

async function idbPut(key, value) {
	const db = await openDB();
	try {
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).put(value, key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

async function idbGet(key) {
	const db = await openDB();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const req = tx.objectStore(STORE_NAME).get(key);
			req.onsuccess = () => resolve(req.result ?? null);
			req.onerror = () => reject(req.error);
		});
	} finally {
		db.close();
	}
}

async function idbDelete(key) {
	const db = await openDB();
	try {
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).delete(key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

function snapshotEdits(session) {
	return {
		materialEdits: { ...(session.materialEdits || {}) },
		transformEdits: { ...(session.transformEdits || {}) },
		visibilityEdits: { ...(session.visibilityEdits || {}) },
		textureEdits: Object.fromEntries(
			Object.entries(session.textureEdits || {}).map(([k, e]) => {
				const { bytes: _bytes, ...meta } = e;
				return [k, meta];
			}),
		),
	};
}

const EMPTY_EDITS = {
	materialEdits: {},
	transformEdits: {},
	visibilityEdits: {},
	textureEdits: {},
};

/**
 * Stash current editor state so the user can continue after a round-trip (login).
 * Returns a short token to be placed in the URL (e.g. ?resume=abc123).
 *
 * @param {import('./session.js').EditorSession} session
 * @returns {Promise<string>}
 */
export async function stashSession(session) {
	const id = newToken();
	const edits = snapshotEdits(session);
	const blob = { v: BLOB_VERSION, edits, ts: Date.now() };

	const texEntries = Object.entries(session.textureEdits || {}).map(([key, e]) => ({ key, bytes: e.bytes }));
	if (texEntries.length) {
		try {
			await idbPut(id + ':tex', texEntries);
		} catch (err) {
			log.warn('[edit-persistence] failed to stash texture bytes', err);
			blob.edits.textureEdits = {};
		}
	}

	if (session.sourceURL) {
		blob.source = { url: session.sourceURL };
	} else if (session.sourceFile) {
		const file = session.sourceFile;
		blob.source = { file: { name: file.name, type: file.type } };
		try {
			const bytes = await file.arrayBuffer();
			await idbPut(id, { name: file.name, type: file.type, bytes });
		} catch (err) {
			log.warn('[edit-persistence] failed to stash file bytes', err);
			// fall through — restore returns null if bytes are missing
		}
	} else {
		blob.source = null;
	}

	try {
		sessionStorage.setItem(SS_PREFIX + id, JSON.stringify(blob));
	} catch (err) {
		log.warn('[edit-persistence] sessionStorage write failed', err);
	}

	return id;
}

/**
 * Restore previously stashed state.
 *
 * @param {string} token
 * @returns {Promise<null | {
 *   source: { url: string } | { file: File },
 *   edits: { materialEdits: object, transformEdits: object, visibilityEdits: object }
 * }>}
 */
export async function restoreSession(token) {
	if (!token || typeof token !== 'string') return null;

	let raw = null;
	try {
		raw = sessionStorage.getItem(SS_PREFIX + token);
	} catch {
		return null;
	}
	if (!raw) return null;

	let blob;
	try {
		blob = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!blob || !blob.source) return null;

	const edits = { ...EMPTY_EDITS, ...(blob.edits || {}) };
	if (blob.v >= 2 && Object.keys(edits.textureEdits || {}).length) {
		let stored = null;
		try {
			stored = await idbGet(token + ':tex');
		} catch (err) {
			log.warn('[edit-persistence] idb texture read failed', err);
		}
		const bytesByKey = new Map((stored || []).map((t) => [t.key, t.bytes]));
		const restored = {};
		for (const [key, meta] of Object.entries(edits.textureEdits)) {
			const bytes = bytesByKey.get(key);
			if (bytes) restored[key] = { ...meta, bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) };
		}
		edits.textureEdits = restored;
	} else {
		edits.textureEdits = {};
	}

	if (blob.source.url) {
		return { source: { url: blob.source.url }, edits };
	}

	if (blob.source.file) {
		let rec = null;
		try {
			rec = await idbGet(token);
		} catch (err) {
			log.warn('[edit-persistence] idb read failed', err);
			return null;
		}
		if (!rec || !rec.bytes) return null;
		const file = new File([rec.bytes], rec.name || 'model.glb', {
			type: rec.type || 'model/gltf-binary',
		});
		return { source: { file }, edits };
	}

	return null;
}

/** Delete the stash (after successful resume). */
export async function clearStash(token) {
	if (!token) return;
	try {
		sessionStorage.removeItem(SS_PREFIX + token);
	} catch {
		/* ignore */
	}
	try {
		await idbDelete(token);
		await idbDelete(token + ':tex');
	} catch {
		/* ignore */
	}
}
