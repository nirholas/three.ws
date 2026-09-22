// Per-run workspace storage.
//
// Every run owns one workspace: the files its executions read and write, plus
// the terminal session under `.three_ws/`. The canonical copy lives in GCS at
// gs://$SANDBOX_BUCKET/runs/<runId>/<path>, so files survive the execution that
// made them, any backend can pick the run up, and the run page can offer every
// file for download. Self-hosters without GCP credentials set SANDBOX_STORE=fs
// and the same interface is served from $SANDBOX_DATA_DIR/runs/<runId>/.
//
// Interface (both stores):
//   list(runId)                  → [{ path, size, updated, contentType }]
//   read(runId, path)            → Buffer | null
//   write(runId, path, buf, ct)  → { path, size }
//   remove(runId, path)          → void
//   removeAll(runId)             → void

import fs from 'node:fs/promises';
import path from 'node:path';

import { getGcpAccessToken } from '../gcp-auth.js';
import { sandboxConfig } from './config.js';
import { contentTypeFor, normalizeWorkspacePath } from './paths.js';

const GCS_API = 'https://storage.googleapis.com/storage/v1';
const GCS_UPLOAD = 'https://storage.googleapis.com/upload/storage/v1';

function runPrefix(runId) {
	const id = String(runId || '');
	if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw Object.assign(new Error('invalid run id'), { status: 400, code: 'bad_run', expose: true });
	return `runs/${id}/`;
}

async function gcsFetch(url, init = {}) {
	const token = await getGcpAccessToken();
	const res = await fetch(url, {
		...init,
		headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
		signal: init.signal || AbortSignal.timeout(60_000),
	});
	return res;
}

async function gcsError(res, what) {
	const body = await res.text().catch(() => '');
	return Object.assign(new Error(`GCS ${what} failed (${res.status}): ${body.slice(0, 200)}`), { status: 502, code: 'workspace_unavailable' });
}

function createGcsStore() {
	const bucket = () => sandboxConfig.bucket;
	const objectUrl = (name) => `${GCS_API}/b/${encodeURIComponent(bucket())}/o/${encodeURIComponent(name)}`;

	return {
		kind: 'gcs',
		async list(runId) {
			const prefix = runPrefix(runId);
			const out = [];
			let pageToken = null;
			do {
				const q = new URLSearchParams({ prefix, fields: 'items(name,size,updated,contentType),nextPageToken', maxResults: '1000' });
				if (pageToken) q.set('pageToken', pageToken);
				const res = await gcsFetch(`${GCS_API}/b/${encodeURIComponent(bucket())}/o?${q}`);
				if (!res.ok) throw await gcsError(res, 'list');
				const body = await res.json();
				for (const it of body.items || []) {
					out.push({
						path: it.name.slice(prefix.length),
						size: Number(it.size) || 0,
						updated: it.updated,
						contentType: it.contentType || contentTypeFor(it.name),
					});
				}
				pageToken = body.nextPageToken || null;
			} while (pageToken);
			return out.sort((a, b) => a.path.localeCompare(b.path));
		},
		async read(runId, p) {
			const name = runPrefix(runId) + normalizeWorkspacePath(p);
			const res = await gcsFetch(`${objectUrl(name)}?alt=media`);
			if (res.status === 404) return null;
			if (!res.ok) throw await gcsError(res, 'read');
			return Buffer.from(await res.arrayBuffer());
		},
		async write(runId, p, buf, contentType) {
			const rel = normalizeWorkspacePath(p);
			const name = runPrefix(runId) + rel;
			const q = new URLSearchParams({ uploadType: 'media', name });
			const res = await gcsFetch(`${GCS_UPLOAD}/b/${encodeURIComponent(bucket())}/o?${q}`, {
				method: 'POST',
				headers: { 'content-type': contentType || contentTypeFor(rel) },
				body: buf,
			});
			if (!res.ok) throw await gcsError(res, 'write');
			return { path: rel, size: buf.length };
		},
		async remove(runId, p) {
			const name = runPrefix(runId) + normalizeWorkspacePath(p);
			const res = await gcsFetch(objectUrl(name), { method: 'DELETE' });
			if (!res.ok && res.status !== 404) throw await gcsError(res, 'delete');
		},
		async removeAll(runId) {
			for (const f of await this.list(runId)) await this.remove(runId, f.path);
		},
	};
}

function createFsStore() {
	const root = (runId) => path.join(sandboxConfig.dataDir, runPrefix(runId));
	async function walk(dir, base, out) {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (err) {
			if (err.code === 'ENOENT') return out;
			throw err;
		}
		for (const ent of entries) {
			const abs = path.join(dir, ent.name);
			const rel = base ? `${base}/${ent.name}` : ent.name;
			if (ent.isDirectory()) await walk(abs, rel, out);
			else if (ent.isFile()) {
				const st = await fs.stat(abs);
				out.push({ path: rel, size: st.size, updated: st.mtime.toISOString(), contentType: contentTypeFor(rel) });
			}
		}
		return out;
	}
	return {
		kind: 'fs',
		async list(runId) {
			return (await walk(root(runId), '', [])).sort((a, b) => a.path.localeCompare(b.path));
		},
		async read(runId, p) {
			try {
				return await fs.readFile(path.join(root(runId), normalizeWorkspacePath(p)));
			} catch (err) {
				if (err.code === 'ENOENT') return null;
				throw err;
			}
		},
		async write(runId, p, buf) {
			const rel = normalizeWorkspacePath(p);
			const abs = path.join(root(runId), rel);
			await fs.mkdir(path.dirname(abs), { recursive: true });
			await fs.writeFile(abs, buf);
			return { path: rel, size: buf.length };
		},
		async remove(runId, p) {
			await fs.rm(path.join(root(runId), normalizeWorkspacePath(p)), { force: true });
		},
		async removeAll(runId) {
			await fs.rm(root(runId), { recursive: true, force: true });
		},
	};
}

let _store = null;
let _storeKind = null;

/** The configured workspace store. */
export function workspaceStore() {
	const kind = sandboxConfig.store;
	if (!_store || _storeKind !== kind) {
		_store = kind === 'fs' ? createFsStore() : createGcsStore();
		_storeKind = kind;
	}
	return _store;
}

/** Test hook: swap the store. */
export function _setWorkspaceStore(store) {
	_store = store;
	_storeKind = store ? sandboxConfig.store : null;
}

/** Total bytes a listing holds. */
export function workspaceBytes(listing) {
	return listing.reduce((n, f) => n + (Number(f.size) || 0), 0);
}
