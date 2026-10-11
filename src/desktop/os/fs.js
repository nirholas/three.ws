// The desktop's virtual file system. Real storage: every node lives in
// IndexedDB (`tws-os` / `fs`), keyed by absolute path, so files survive reloads
// and hold Blobs of any size the browser allows. Paths are POSIX-style
// ("/Documents/notes.txt"). Deleting moves to /Trash; purge() is permanent.

export const DIRS = ['Desktop', 'Documents', 'Pictures', 'Downloads', 'Music', 'Videos'];
export const TRASH = '/Trash';
const DB = 'tws-os';
const STORE = 'fs';

const MIME = {
	txt: 'text/plain', md: 'text/markdown', json: 'application/json', js: 'text/javascript', css: 'text/css', html: 'text/html', csv: 'text/csv', xml: 'text/xml', log: 'text/plain',
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
	mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', weba: 'audio/webm',
	mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
	glb: 'model/gltf-binary', gltf: 'model/gltf+json', pdf: 'application/pdf', zip: 'application/zip',
};

export const extOf = (name) => {
	const i = String(name).lastIndexOf('.');
	return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
/** 'text' | 'image' | 'audio' | 'video' | 'model' | 'other', from a file name or mime type. */
export function kindOf(nameOrMime) {
	const m = nameOrMime.includes('/') ? nameOrMime : mimeOf(nameOrMime);
	if (m.startsWith('text/') || m === 'application/json') return 'text';
	if (m.startsWith('image/')) return 'image';
	if (m.startsWith('audio/')) return 'audio';
	if (m.startsWith('video/')) return 'video';
	if (m.startsWith('model/')) return 'model';
	return 'other';
}

export function normalize(path) {
	const out = [];
	for (const seg of String(path).split('/')) {
		if (!seg || seg === '.') continue;
		if (seg === '..') out.pop();
		else out.push(seg);
	}
	return `/${out.join('/')}`;
}
export const parentOf = (p) => normalize(p).split('/').slice(0, -1).join('/') || '/';
export const nameOf = (p) => normalize(p).split('/').pop() || '';
export const join = (...parts) => normalize(parts.join('/'));
const validName = (n) => !!n && n.length <= 120 && !/[\\/]/.test(n) && n !== '.' && n !== '..';

let dbp = null;
const listeners = new Set();
const emit = (paths) => listeners.forEach((fn) => fn(paths));
export function subscribe(fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function db() {
	dbp ||= new Promise((res, rej) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => {
			const s = r.result.createObjectStore(STORE, { keyPath: 'path' });
			s.createIndex('parent', 'parent');
		};
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});
	return dbp;
}
async function tx(mode, fn) {
	const d = await db();
	return new Promise((res, rej) => {
		const t = d.transaction(STORE, mode);
		let out;
		Promise.resolve(fn(t.objectStore(STORE))).then((v) => (out = v), rej);
		t.oncomplete = () => res(out);
		t.onerror = t.onabort = () => rej(t.error || new Error('storage failed'));
	});
}
const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

let ready = null;
/** Create the standard folders once. Safe to call repeatedly. */
export function init() {
	ready ||= tx('readwrite', async (s) => {
		for (const n of [...DIRS, 'Trash']) {
			const path = `/${n}`;
			if (!(await req(s.get(path)))) s.put(dirNode(path));
		}
	});
	return ready;
}
const dirNode = (path) => ({ path, name: nameOf(path), parent: parentOf(path), type: 'dir', size: 0, mtime: Date.now(), ctime: Date.now() });
const meta = ({ data, ...n }) => n;

export async function stat(path) {
	await init();
	const p = normalize(path);
	if (p === '/') return { path: '/', name: '', parent: '', type: 'dir', size: 0, mtime: 0, ctime: 0 };
	const n = await tx('readonly', (s) => req(s.get(p)));
	return n ? meta(n) : null;
}
export const exists = async (path) => !!(await stat(path));

/** Children of a folder (metadata only), folders first then by name. */
export async function list(path) {
	await init();
	const p = normalize(path);
	const rows = await tx('readonly', (s) => req(s.index('parent').getAll(p)));
	return rows
		.map(meta)
		.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1));
}

/** File content: { node, blob } (always a Blob), or null when the path is not a file. */
export async function read(path) {
	await init();
	const n = await tx('readonly', (s) => req(s.get(normalize(path))));
	if (!n || n.type !== 'file') return null;
	const blob = n.data instanceof Blob ? n.data : new Blob([n.data ?? ''], { type: n.mime });
	return { node: meta(n), blob };
}
export async function readText(path) {
	const f = await read(path);
	return f ? f.blob.text() : null;
}

/** Pick a name that does not exist in `dir`: "a.txt" -> "a (2).txt". */
export async function uniqueName(dir, name) {
	const taken = new Set((await list(dir)).map((n) => n.name.toLowerCase()));
	if (!taken.has(name.toLowerCase())) return name;
	const e = extOf(name);
	const base = e ? name.slice(0, -(e.length + 1)) : name;
	for (let i = 2; ; i++) {
		const c = e ? `${base} (${i}).${e}` : `${base} (${i})`;
		if (!taken.has(c.toLowerCase())) return c;
	}
}

async function ensureParent(s, path) {
	const par = parentOf(path);
	if (par === '/') return;
	const row = await req(s.get(par));
	if (!row) throw new Error(`Folder not found: ${par}`);
	if (row.type !== 'dir') throw new Error(`${par} is not a folder`);
}

/** Create or replace a file. `data` is a string or Blob. Returns the node. */
export async function write(path, data, { mime } = {}) {
	await init();
	const p = normalize(path);
	if (!validName(nameOf(p))) throw new Error('That file name is not allowed');
	const blob = data instanceof Blob ? data : null;
	const node = await tx('readwrite', async (s) => {
		await ensureParent(s, p);
		const prev = await req(s.get(p));
		if (prev && prev.type === 'dir') throw new Error('A folder with that name already exists');
		const n = {
			path: p, name: nameOf(p), parent: parentOf(p), type: 'file',
			mime: mime || blob?.type || mimeOf(p), size: blob ? blob.size : new Blob([data]).size,
			mtime: Date.now(), ctime: prev?.ctime || Date.now(), data,
		};
		s.put(n);
		return n;
	});
	emit([parentOf(p)]);
	return meta(node);
}

export async function mkdir(path) {
	await init();
	const p = normalize(path);
	if (!validName(nameOf(p))) throw new Error('That folder name is not allowed');
	await tx('readwrite', async (s) => {
		await ensureParent(s, p);
		if (await req(s.get(p))) throw new Error('Something with that name already exists');
		s.put(dirNode(p));
	});
	emit([parentOf(p)]);
	return p;
}

async function descendants(s, path) {
	const out = [];
	const walk = async (p) => {
		for (const c of await req(s.index('parent').getAll(p))) {
			out.push(c);
			if (c.type === 'dir') await walk(c.path);
		}
	};
	await walk(path);
	return out;
}

/** Move or rename. Folders move with their contents. Throws if the target exists. */
export async function move(from, to) {
	await init();
	const a = normalize(from);
	const b = normalize(to);
	if (a === b) return b;
	if (b.startsWith(`${a}/`)) throw new Error('A folder cannot be moved into itself');
	if (!validName(nameOf(b))) throw new Error('That name is not allowed');
	await tx('readwrite', async (s) => {
		const src = await req(s.get(a));
		if (!src) throw new Error('Source not found');
		if (await req(s.get(b))) throw new Error('Something with that name already exists');
		await ensureParent(s, b);
		const kids = src.type === 'dir' ? await descendants(s, a) : [];
		for (const n of [src, ...kids]) {
			s.delete(n.path);
			const np = b + n.path.slice(a.length);
			s.put({ ...n, path: np, name: nameOf(np), parent: parentOf(np), mtime: n === src ? Date.now() : n.mtime });
		}
	});
	emit([parentOf(a), parentOf(b)]);
	return b;
}
export const rename = (path, newName) => move(path, join(parentOf(path), newName));

export async function copy(from, to) {
	await init();
	const a = normalize(from);
	const b = normalize(to);
	if (b === a || b.startsWith(`${a}/`)) throw new Error('A folder cannot be copied into itself');
	await tx('readwrite', async (s) => {
		const src = await req(s.get(a));
		if (!src) throw new Error('Source not found');
		if (await req(s.get(b))) throw new Error('Something with that name already exists');
		await ensureParent(s, b);
		const kids = src.type === 'dir' ? await descendants(s, a) : [];
		for (const n of [src, ...kids]) {
			const np = b + n.path.slice(a.length);
			s.put({ ...n, path: np, name: nameOf(np), parent: parentOf(np), ctime: Date.now(), mtime: Date.now() });
		}
	});
	emit([parentOf(b)]);
	return b;
}

/** Move to the Trash, remembering where it came from. Items already in the Trash are purged. */
export async function remove(path) {
	const p = normalize(path);
	if (p === '/' || DIRS.includes(p.slice(1)) || p === TRASH) throw new Error('This folder is part of the system and cannot be deleted');
	if (p.startsWith(`${TRASH}/`)) return purge(p);
	const name = await uniqueName(TRASH, nameOf(p));
	const dest = join(TRASH, name);
	await move(p, dest);
	await tx('readwrite', async (s) => {
		const n = await req(s.get(dest));
		if (n) s.put({ ...n, trashedFrom: p, trashedAt: Date.now() });
	});
	return dest;
}
export async function restore(path) {
	const n = await tx('readonly', (s) => req(s.get(normalize(path))));
	if (!n || !n.trashedFrom) throw new Error('Nothing to restore');
	let dest = n.trashedFrom;
	if (!(await exists(parentOf(dest)))) dest = join('/Documents', nameOf(dest));
	if (await exists(dest)) dest = join(parentOf(dest), await uniqueName(parentOf(dest), nameOf(dest)));
	await move(n.path, dest);
	await tx('readwrite', async (s) => {
		const r = await req(s.get(dest));
		if (r) {
			delete r.trashedFrom;
			delete r.trashedAt;
			s.put(r);
		}
	});
	return dest;
}
/** Permanently delete a file or folder (and its contents). */
export async function purge(path) {
	await init();
	const p = normalize(path);
	if (p === '/' || DIRS.includes(p.slice(1)) || p === TRASH) throw new Error('This folder is part of the system and cannot be deleted');
	await tx('readwrite', async (s) => {
		for (const n of await descendants(s, p)) s.delete(n.path);
		s.delete(p);
	});
	emit([parentOf(p)]);
}
export async function emptyTrash() {
	for (const n of await list(TRASH)) await purge(n.path);
}

/** Every file under a folder (recursive), for search and totals. */
export async function walk(path = '/') {
	await init();
	const out = [];
	await tx('readonly', async (s) => {
		for (const n of await descendants(s, normalize(path))) out.push(meta(n));
	});
	return out;
}
export async function usage() {
	const files = (await walk('/')).filter((n) => n.type === 'file');
	return { files: files.length, bytes: files.reduce((t, n) => t + n.size, 0) };
}
/** Newest files first, excluding the Trash. */
export async function recentFiles(limit = 8) {
	return (await walk('/'))
		.filter((n) => n.type === 'file' && !n.path.startsWith(`${TRASH}/`))
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, limit);
}
/** A short-lived object URL for a file, or null. Call URL.revokeObjectURL when done. */
export async function urlFor(path) {
	const f = await read(path);
	return f ? URL.createObjectURL(f.blob) : null;
}
/** Save a download-style File/Blob into a folder with a unique name. Returns the path. */
export async function importFile(file, dir = '/Downloads') {
	const name = await uniqueName(dir, file.name || 'file');
	const p = join(dir, name);
	await write(p, file, { mime: file.type || mimeOf(name) });
	return p;
}
export async function wipe() {
	await tx('readwrite', async (s) => s.clear());
	ready = null;
	emit(['/']);
}
