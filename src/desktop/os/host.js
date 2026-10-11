// Mounts a native OS app into a window body and hands it its `ctx`.
import * as fs from './fs.js';
import { icon, registerGlyph } from '../icons.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (tag, cls, html) => {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (html != null) el.innerHTML = html;
	return el;
};

/** Which app opens a path: folders in Files, text in Notepad, pictures in Photos, media in the player. */
export function appForPath(path, type) {
	if (type === 'dir') return 'files';
	const kind = fs.kindOf(fs.nameOf(path));
	if (kind === 'text') return 'notepad';
	if (kind === 'image') return 'photos';
	if (kind === 'audio' || kind === 'video') return 'media';
	return 'files';
}

export async function mountOsApp(app, body, win, sh) {
	const host = h('div', `napp-host napp-${app.id}`);
	host.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;overflow:hidden';
	body.append(host);
	const ctx = {
		h, esc, icon, registerGlyph, fs,
		tile: sh.tile,
		toast: sh.toast,
		notify: sh.notify,
		arg: win?.arg,
		onArg: (fn) => {
			if (win) win.onArg = fn;
		},
		setTitle: (t) => sh.wm.setTitle(app.id, t),
		onClose: (fn) => win?.cleanups.push(fn),
		launchId: sh.launchId,
		openPath: async (path) => {
			const node = await fs.stat(path);
			sh.launchId(appForPath(path, node?.type), { arg: path });
		},
		get prefs() {
			return sh.prefs();
		},
		setPrefs: (patch) => sh.setPrefs(patch),
		onPrefs: (fn) => {
			const off = sh.onPrefs(fn);
			win?.cleanups.push(off);
			return off;
		},
		store: sh.store,
		windows: () => sh.wm.list(),
		closeWindow: (id) => sh.wm.close(id),
		focusWindow: (id) => sh.wm.focus(id),
		async fetchJson(url, init) {
			const r = await fetch(url, { credentials: 'include', ...init });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json();
		},
	};
	try {
		await fs.init();
		const mod = await app.load();
		const cleanup = await mod.mount(host, ctx);
		if (typeof cleanup === 'function') win?.cleanups.push(cleanup);
	} catch (err) {
		console.error(`[desktop] ${app.id} failed to start`, err);
		host.replaceChildren(h('div', 'napp-error', `<b>${esc(app.title)} could not start.</b><p>${esc(err?.message || 'Unknown error')}</p>`));
	}
}
