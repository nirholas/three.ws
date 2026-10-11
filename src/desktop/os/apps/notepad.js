// Notepad: tabbed plain-text editor backed by the virtual file system (../fs.js).
import './notepad.css';
import * as fs from '../fs.js';

/* ---------- pure helpers (unit tested) ---------- */

/** Start offsets of every match of `query` in `text`. */
export function findMatches(text, query, caseSensitive = false) {
	if (!query) return [];
	const hay = caseSensitive ? text : text.toLowerCase();
	const needle = caseSensitive ? query : query.toLowerCase();
	const out = [];
	for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
	return out;
}

/** Replace every match. Returns { text, count }. */
export function replaceAll(text, query, replacement, caseSensitive = false) {
	const hits = findMatches(text, query, caseSensitive);
	if (!hits.length) return { text, count: 0 };
	let out = '';
	let last = 0;
	for (const i of hits) {
		out += text.slice(last, i) + replacement;
		last = i + query.length;
	}
	return { text: out + text.slice(last), count: hits.length };
}

/** Index in `matches` of the first match at or after `pos`, wrapping to 0. -1 when there are none. */
export function nextMatchIndex(matches, pos, backwards = false) {
	if (!matches.length) return -1;
	if (backwards) {
		for (let i = matches.length - 1; i >= 0; i--) if (matches[i] < pos) return i;
		return matches.length - 1;
	}
	const i = matches.findIndex((m) => m >= pos);
	return i < 0 ? 0 : i;
}

/** 1-based line and column of a caret offset. */
export function lineCol(text, pos) {
	const head = text.slice(0, Math.max(0, pos));
	const line = head.split('\n').length;
	return { line, col: pos - (head.lastIndexOf('\n') + 1) + 1 };
}

/** Offset of the start of 1-based `line`, clamped to the last line. */
export function offsetOfLine(text, line) {
	let off = 0;
	for (let n = 1; n < line; n++) {
		const i = text.indexOf('\n', off);
		if (i < 0) return off;
		off = i + 1;
	}
	return off;
}

export const countLines = (text) => text.split('\n').length;

export const MIN_SIZE = 8;
export const MAX_SIZE = 48;
export const DEFAULT_SIZE = 14;
export const clampSize = (n) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
export const zoomPercent = (size) => Math.round((size / DEFAULT_SIZE) * 100);

/** Window title for a document. */
export const titleFor = (name, dirty) => `${dirty ? '*' : ''}${name} - Notepad`;

/** A usable file name from what the user typed: trims, adds .txt when there is no extension. */
export function fileNameFrom(input) {
	const n = String(input || '').trim();
	if (!n) return '';
	return fs.extOf(n) ? n : `${n}.txt`;
}

/** Validate drafts read back from storage. Anything malformed is dropped. */
export function parseDrafts(raw) {
	try {
		const list = JSON.parse(raw || '[]');
		if (!Array.isArray(list)) return [];
		return list
			.filter((d) => d && typeof d.id === 'string' && typeof d.text === 'string' && typeof d.name === 'string')
			.map((d) => ({ id: d.id, name: d.name, text: d.text, path: typeof d.path === 'string' ? d.path : null }));
	} catch {
		return [];
	}
}

/* ---------- the app ---------- */

const GLYPHS = {
	'np-new': '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>',
	'np-open': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 8z"/><path d="M3 18l4-8h16l-3 8z"/>',
	'np-save': '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
	'np-find': '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/>',
	'np-wrap': '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5"/><path d="m13 15-3 3 3 3"/>',
	'np-plus': '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M11 8v6M8 11h6"/>',
	'np-minus': '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M8 11h6"/>',
	'np-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
	'np-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
	'np-x': '<path d="M6 6l12 12M18 6 6 18"/>',
};

const DRAFTS_KEY = 'notepad:drafts';
const PREFS_KEY = 'notepad:prefs';
let uid = 0;

export function mount(host, ctx) {
	for (const [k, v] of Object.entries(GLYPHS)) ctx.registerGlyph(k, v);
	const { h, esc, icon } = ctx;

	let prefs = { wrap: true, size: DEFAULT_SIZE };
	try {
		prefs = { ...prefs, ...JSON.parse(ctx.store.get(PREFS_KEY) || '{}') };
		prefs.size = clampSize(prefs.size);
	} catch {
		/* defaults */
	}
	const savePrefs = () => ctx.store.set(PREFS_KEY, JSON.stringify(prefs));

	const root = h('div', 'np');
	root.innerHTML = `
		<div class="np-bar" role="toolbar" aria-label="Notepad commands">
			<button class="np-b" data-act="new" title="New tab (Ctrl+N)">${icon('np-new', 16)}<span>New</span></button>
			<button class="np-b" data-act="open" title="Open from your files (Ctrl+O)">${icon('np-open', 16)}<span>Open</span></button>
			<button class="np-b" data-act="computer" title="Open a file from this computer">${icon('upload', 16)}<span>From computer</span></button>
			<button class="np-b" data-act="save" title="Save (Ctrl+S)">${icon('np-save', 16)}<span>Save</span></button>
			<button class="np-b" data-act="saveas" title="Save as (Ctrl+Shift+S)"><span>Save as</span></button>
			<i class="np-sep"></i>
			<button class="np-b" data-act="find" title="Find and replace (Ctrl+F, Ctrl+H)">${icon('np-find', 16)}<span>Find</span></button>
			<button class="np-b" data-act="goto" title="Go to line (Ctrl+G)"><span>Go to line</span></button>
			<span class="np-grow"></span>
			<button class="np-b" data-act="wrap" aria-pressed="false" title="Word wrap">${icon('np-wrap', 16)}<span>Wrap</span></button>
			<button class="np-b ic" data-act="zout" title="Zoom out (Ctrl+-)" aria-label="Zoom out">${icon('np-minus', 16)}</button>
			<button class="np-b ic" data-act="zin" title="Zoom in (Ctrl++)" aria-label="Zoom in">${icon('np-plus', 16)}</button>
		</div>
		<div class="np-tabs" role="tablist" aria-label="Open documents"></div>
		<div class="np-find" hidden>
			<div class="np-row">
				<input class="np-fi" placeholder="Find" aria-label="Find" spellcheck="false" />
				<span class="np-count" aria-live="polite"></span>
				<button class="np-b ic" data-act="prev" title="Previous (Shift+F3)" aria-label="Previous match">${icon('np-up', 14)}</button>
				<button class="np-b ic" data-act="next" title="Next (F3)" aria-label="Next match">${icon('np-down', 14)}</button>
				<button class="np-b case" data-act="case" aria-pressed="false" title="Match case">Aa</button>
				<button class="np-b ic" data-act="closefind" title="Close (Esc)" aria-label="Close find">${icon('np-x', 14)}</button>
			</div>
			<div class="np-row np-rep">
				<input class="np-ri" placeholder="Replace with" aria-label="Replace with" spellcheck="false" />
				<button class="np-b" data-act="replace">Replace</button>
				<button class="np-b" data-act="replaceall">Replace all</button>
			</div>
		</div>
		<div class="np-edit"></div>
		<div class="np-status" role="status">
			<span data-s="pos"></span><span data-s="chars"></span><span class="np-grow"></span><span data-s="zoom"></span><span>UTF-8</span>
		</div>
		<input type="file" hidden accept="text/*,.txt,.md,.json,.js,.css,.html,.csv,.xml,.log" multiple />`;
	host.append(root);
	const q = (s) => root.querySelector(s);
	const tabsEl = q('.np-tabs');
	const editEl = q('.np-edit');
	const findBar = q('.np-find');
	const findIn = q('.np-fi');
	const repIn = q('.np-ri');
	const countEl = q('.np-count');
	const fileInput = q('input[type=file]');
	let caseSens = false;
	let dead = false;

	/** @type {{id:string,path:string|null,name:string,saved:string,ta:HTMLTextAreaElement}[]} */
	const docs = [];
	let cur = null;

	const isDirty = (d) => d.ta.value !== d.saved;
	const err = (e) => ctx.toast(e?.message || 'Something went wrong');

	/* --- drafts --- */
	function flushDrafts() {
		const list = docs.filter(isDirty).map((d) => ({ id: d.id, path: d.path, name: d.name, text: d.ta.value }));
		if (list.length) ctx.store.set(DRAFTS_KEY, JSON.stringify(list));
		else ctx.store.del(DRAFTS_KEY);
	}
	let draftTimer = 0;
	const scheduleDrafts = () => {
		clearTimeout(draftTimer);
		draftTimer = setTimeout(flushDrafts, 350);
	};
	const onHide = () => flushDrafts();
	window.addEventListener('pagehide', onHide);

	/* --- documents --- */
	function addDoc({ path = null, name = 'Untitled.txt', text = '', saved = text, activate = true } = {}) {
		const ta = h('textarea', 'np-ta');
		ta.value = text;
		ta.spellcheck = false;
		ta.setAttribute('aria-label', name);
		ta.hidden = true;
		const d = { id: `d${Date.now().toString(36)}${uid++}`, path, name, saved, ta };
		applyView(ta);
		ta.addEventListener('input', () => {
			updateTab(d);
			updateStatus();
			scheduleDrafts();
			if (!findBar.hidden) updateCount();
		});
		for (const ev of ['keyup', 'click', 'select', 'focus']) ta.addEventListener(ev, updateStatus);
		ta.addEventListener('keydown', (e) => {
			if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
				e.preventDefault();
				if (!document.execCommand('insertText', false, '\t')) {
					ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end');
					ta.dispatchEvent(new Event('input'));
				}
			}
		});
		ta.addEventListener('wheel', (e) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			setSize(prefs.size + (e.deltaY < 0 ? 1 : -1));
		}, { passive: false });
		editEl.append(ta);
		docs.push(d);
		if (activate) activateDoc(d);
		else renderTabs();
		return d;
	}

	function applyView(ta) {
		ta.style.fontSize = `${prefs.size}px`;
		ta.wrap = prefs.wrap ? 'soft' : 'off';
		ta.classList.toggle('nowrap', !prefs.wrap);
	}
	function applyViewAll() {
		docs.forEach((d) => applyView(d.ta));
		q('[data-act="wrap"]').setAttribute('aria-pressed', prefs.wrap);
		updateStatus();
	}
	function setSize(n) {
		prefs.size = clampSize(n);
		savePrefs();
		applyViewAll();
	}

	function activateDoc(d) {
		cur = d;
		for (const x of docs) x.ta.hidden = x !== d;
		renderTabs();
		updateStatus();
		updateTitle();
		d.ta.focus();
		if (!findBar.hidden) updateCount();
	}

	function renderTabs() {
		tabsEl.innerHTML = '';
		for (const d of docs) {
			const dirty = isDirty(d);
			const t = h('div', `np-tab${d === cur ? ' on' : ''}`);
			t.dataset.id = d.id;
			t.setAttribute('role', 'tab');
			t.setAttribute('aria-selected', d === cur);
			t.tabIndex = d === cur ? 0 : -1;
			t.title = d.path || d.name;
			t.innerHTML = `<span class="np-tn">${esc(d.name)}</span><span class="np-dot" ${dirty ? '' : 'hidden'} title="Unsaved changes"></span><button class="np-x" aria-label="Close ${esc(d.name)}" tabindex="-1">${icon('np-x', 12)}</button>`;
			tabsEl.append(t);
		}
		const add = h('button', 'np-add');
		add.dataset.act = 'new';
		add.setAttribute('aria-label', 'New tab');
		add.title = 'New tab';
		add.innerHTML = icon('plus', 14);
		tabsEl.append(add);
	}
	function updateTab(d) {
		const t = tabsEl.querySelector(`[data-id="${d.id}"]`);
		if (!t) return;
		t.querySelector('.np-tn').textContent = d.name;
		t.querySelector('.np-dot').hidden = !isDirty(d);
		t.title = d.path || d.name;
		if (d === cur) updateTitle();
	}
	function updateTitle() {
		if (cur) ctx.setTitle(titleFor(cur.name, isDirty(cur)));
	}
	function updateStatus() {
		if (!cur) return;
		const ta = cur.ta;
		const { line, col } = lineCol(ta.value, ta.selectionStart);
		const sel = ta.selectionEnd - ta.selectionStart;
		q('[data-s="pos"]').textContent = `Ln ${line}, Col ${col}${sel ? ` (${sel} selected)` : ''}`;
		q('[data-s="chars"]').textContent = `${ta.value.length.toLocaleString()} ${ta.value.length === 1 ? 'character' : 'characters'}`;
		q('[data-s="zoom"]').textContent = `${zoomPercent(prefs.size)}%`;
	}

	/* --- open / save --- */
	const openCommon = async (path) => {
		const existing = docs.find((d) => d.path === path);
		if (existing) return activateDoc(existing);
		const node = await fs.stat(path);
		if (!node || node.type !== 'file') throw new Error(`"${path}" could not be opened.`);
		const text = await fs.readText(path);
		const only = docs.length === 1 && !docs[0].path && !isDirty(docs[0]) && !docs[0].ta.value;
		const d = addDoc({ path, name: node.name, text: text ?? '' });
		if (only) closeDoc(docs[0], true);
		return d;
	};
	async function openPath(path) {
		try {
			await openCommon(path);
		} catch (e) {
			err(e);
		}
	}

	async function saveDoc(d, as = false) {
		let path = d.path;
		if (!path || as) {
			const chosen = await fileDialog({ mode: 'save', name: d.name, dir: d.path ? fs.parentOf(d.path) : '/Documents' });
			if (!chosen) return false;
			path = chosen;
		}
		try {
			const text = d.ta.value;
			const node = await fs.write(path, text, { mime: fs.mimeOf(path) === 'application/octet-stream' ? 'text/plain' : fs.mimeOf(path) });
			d.path = path;
			d.name = node.name;
			d.saved = text;
			d.ta.setAttribute('aria-label', d.name);
			updateTab(d);
			updateTitle();
			flushDrafts();
			ctx.toast(`Saved ${d.name}`);
			return true;
		} catch (e) {
			err(e);
			return false;
		}
	}

	async function closeDoc(d, force = false) {
		if (!force && isDirty(d)) {
			activateDoc(d);
			const r = await choose({
				title: `Save changes to ${d.name}?`,
				message: 'Your changes will be lost if you do not save them.',
				buttons: [
					['save', 'Save', 'primary'],
					['discard', "Don't save", 'danger'],
					['cancel', 'Cancel', ''],
				],
			});
			if (r === 'cancel' || r == null) return false;
			if (r === 'save' && !(await saveDoc(d))) return false;
		}
		const i = docs.indexOf(d);
		docs.splice(i, 1);
		d.ta.remove();
		if (!docs.length) addDoc();
		else if (cur === d) activateDoc(docs[Math.min(i, docs.length - 1)]);
		else renderTabs();
		flushDrafts();
		return true;
	}

	/* --- dialogs --- */
	function choose({ title, message = '', buttons }) {
		return new Promise((resolve) => {
			const wrap = h('div', 'np-modal');
			wrap.innerHTML = `<div class="np-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}<div class="np-dlg-act">${buttons.map(([id, label, cls]) => `<button class="np-pill ${cls}" data-id="${id}">${esc(label)}</button>`).join('')}</div></div>`;
			root.append(wrap);
			const done = (v) => {
				wrap.remove();
				cur?.ta.focus();
				resolve(v);
			};
			wrap.addEventListener('click', (e) => {
				const b = e.target.closest('[data-id]');
				if (b) done(b.dataset.id);
				else if (e.target === wrap) done(null);
			});
			wrap.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Escape') done(null);
			});
			wrap.querySelector('.primary, .danger, button').focus();
		});
	}

	function promptLine() {
		return new Promise((resolve) => {
			const wrap = h('div', 'np-modal');
			const lines = countLines(cur.ta.value);
			wrap.innerHTML = `<form class="np-dlg" role="dialog" aria-modal="true" aria-label="Go to line"><h3>Go to line</h3><input class="np-in" type="number" min="1" max="${lines}" placeholder="Line number (1 to ${lines})" aria-label="Line number" /><div class="np-dlg-act"><button type="button" class="np-pill" data-x>Cancel</button><button class="np-pill primary">Go</button></div></form>`;
			root.append(wrap);
			const inp = wrap.querySelector('input');
			inp.focus();
			const done = (v) => {
				wrap.remove();
				cur.ta.focus();
				resolve(v);
			};
			wrap.addEventListener('submit', (e) => {
				e.preventDefault();
				const n = parseInt(inp.value, 10);
				done(Number.isFinite(n) ? n : null);
			});
			wrap.querySelector('[data-x]').addEventListener('click', () => done(null));
			wrap.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Escape') done(null);
			});
		});
	}

	/** In-app open/save dialog over the virtual file system. Resolves to a path or null. */
	function fileDialog({ mode, name = 'Untitled.txt', dir = '/Documents' }) {
		return new Promise((resolve) => {
			let loc = dir;
			const wrap = h('div', 'np-modal');
			wrap.innerHTML = `<div class="np-dlg np-fd" role="dialog" aria-modal="true" aria-label="${mode === 'save' ? 'Save as' : 'Open'}">
				<h3>${mode === 'save' ? 'Save as' : 'Open a file'}</h3>
				<div class="np-fd-bar"><button class="np-b ic" data-up aria-label="Up one level" title="Up">${icon('np-up', 14)}</button><div class="np-fd-path"></div><button class="np-b" data-newdir title="New folder">${icon('plus', 14)}<span>Folder</span></button></div>
				<div class="np-fd-list" role="listbox" tabindex="0"></div>
				${mode === 'save' ? '<input class="np-in" aria-label="File name" spellcheck="false" />' : ''}
				<div class="np-dlg-act"><button class="np-pill" data-x>Cancel</button><button class="np-pill primary" data-ok>${mode === 'save' ? 'Save' : 'Open'}</button></div></div>`;
			root.append(wrap);
			const list = wrap.querySelector('.np-fd-list');
			const pathEl = wrap.querySelector('.np-fd-path');
			const nameIn = wrap.querySelector('input');
			const okBtn = wrap.querySelector('[data-ok]');
			let picked = null;
			const done = (v) => {
				wrap.remove();
				cur?.ta.focus();
				resolve(v);
			};
			const crumbs = () => {
				let acc = '';
				const segs = loc === '/' ? [] : loc.split('/').filter(Boolean);
				pathEl.innerHTML = `<button data-go="/">This PC</button>${segs.map((s) => `<span>/</span><button data-go="${esc((acc += `/${s}`))}">${esc(s)}</button>`).join('')}`;
			};
			const show = async (to) => {
				try {
					const nodes = to === '/' ? (await fs.list('/')).filter((n) => n.path !== fs.TRASH) : await fs.list(to);
					loc = to;
					picked = null;
					crumbs();
					const rows = nodes.filter((n) => n.type === 'dir' || mode === 'save' || fs.kindOf(n.name) === 'text' || fs.kindOf(n.name) === 'other');
					list.innerHTML = rows.length
						? rows.map((n) => `<div class="np-fd-row" role="option" tabindex="-1" data-path="${esc(n.path)}" data-type="${n.type}">${icon(n.type === 'dir' ? 'folder' : 'note', 16)}<span>${esc(n.name)}</span></div>`).join('')
						: `<div class="np-fd-empty">${loc === '/' ? 'No folders.' : 'This folder is empty.'}${mode === 'save' ? ' Type a name below to save here.' : ''}</div>`;
					updateOk();
				} catch (e) {
					err(e);
				}
			};
			const updateOk = () => {
				okBtn.disabled = mode === 'save' ? !fileNameFrom(nameIn.value) || loc === '/' : !picked;
			};
			const confirm = async () => {
				if (mode === 'open') return picked && done(picked);
				const n = fileNameFrom(nameIn.value);
				if (!n || loc === '/') return;
				const p = fs.join(loc, n);
				const ex = await fs.stat(p);
				if (ex?.type === 'dir') return err(new Error('A folder with that name already exists.'));
				if (ex) {
					const r = await choose({ title: 'Replace file?', message: `${n} already exists in this folder. Do you want to replace it?`, buttons: [['yes', 'Replace', 'danger'], ['no', 'Cancel', '']] });
					if (r !== 'yes') return;
				}
				done(p);
			};
			wrap.addEventListener('click', async (e) => {
				const go = e.target.closest('[data-go]');
				if (go) return show(go.dataset.go);
				if (e.target.closest('[data-up]')) return loc !== '/' && show(fs.parentOf(loc));
				if (e.target.closest('[data-x]') || e.target === wrap) return done(null);
				if (e.target.closest('[data-ok]')) return confirm();
				if (e.target.closest('[data-newdir]')) {
					if (loc === '/') return;
					try {
						const nm = await fs.uniqueName(loc, 'New folder');
						await fs.mkdir(fs.join(loc, nm));
						await show(loc);
					} catch (x) {
						err(x);
					}
					return;
				}
				const row = e.target.closest('.np-fd-row');
				if (!row) return;
				list.querySelectorAll('.sel').forEach((r) => r.classList.remove('sel'));
				row.classList.add('sel');
				if (row.dataset.type === 'dir') {
					picked = null;
				} else {
					picked = row.dataset.path;
					if (nameIn) nameIn.value = fs.nameOf(picked);
				}
				updateOk();
			});
			wrap.addEventListener('dblclick', (e) => {
				const row = e.target.closest('.np-fd-row');
				if (!row) return;
				if (row.dataset.type === 'dir') show(row.dataset.path);
				else {
					picked = row.dataset.path;
					confirm();
				}
			});
			wrap.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Escape') return done(null);
				if (e.key === 'Enter' && e.target !== wrap.querySelector('[data-x]')) {
					e.preventDefault();
					const focused = document.activeElement?.closest?.('.np-fd-row');
					if (focused?.dataset.type === 'dir') return show(focused.dataset.path);
					if (focused && mode === 'open') picked = focused.dataset.path;
					confirm();
				}
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
					const rows = [...list.querySelectorAll('.np-fd-row')];
					if (!rows.length) return;
					e.preventDefault();
					const i = rows.indexOf(document.activeElement);
					const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
					next.focus();
					next.click();
				}
			});
			if (nameIn) {
				nameIn.value = name;
				nameIn.addEventListener('input', updateOk);
			}
			show(loc).then(() => {
				if (nameIn) {
					nameIn.focus();
					const dot = name.lastIndexOf('.');
					nameIn.setSelectionRange(0, dot > 0 ? dot : name.length);
				} else list.focus();
			});
		});
	}

	/* --- find / replace --- */
	function matches() {
		return cur ? findMatches(cur.ta.value, findIn.value, caseSens) : [];
	}
	function updateCount() {
		const m = matches();
		if (!findIn.value) countEl.textContent = '';
		else if (!m.length) countEl.textContent = 'No results';
		else {
			const pos = cur.ta.selectionStart;
			const i = m.findIndex((x) => x === pos && cur.ta.selectionEnd - pos === findIn.value.length);
			countEl.textContent = i >= 0 ? `${i + 1} of ${m.length}` : `${m.length} ${m.length === 1 ? 'match' : 'matches'}`;
		}
		countEl.classList.toggle('none', !!findIn.value && !m.length);
	}
	function selectMatch(backwards = false) {
		const m = matches();
		if (!m.length) return updateCount();
		const ta = cur.ta;
		const pos = backwards ? ta.selectionStart : ta.selectionEnd > ta.selectionStart ? ta.selectionStart + 1 : ta.selectionStart;
		const at = m[nextMatchIndex(m, pos, backwards)];
		ta.focus();
		ta.setSelectionRange(at, at + findIn.value.length);
		updateStatus();
		updateCount();
	}
	function openFind(replace = false) {
		findBar.hidden = false;
		findBar.classList.toggle('with-rep', replace);
		const sel = cur.ta.value.slice(cur.ta.selectionStart, cur.ta.selectionEnd);
		if (sel && !sel.includes('\n')) findIn.value = sel;
		(replace && findIn.value ? repIn : findIn).focus();
		findIn.select?.();
		updateCount();
	}
	function closeFind() {
		findBar.hidden = true;
		cur?.ta.focus();
	}
	function replaceCurrent() {
		const ta = cur.ta;
		const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
		const hit = caseSens ? sel === findIn.value : sel.toLowerCase() === findIn.value.toLowerCase();
		if (hit && findIn.value) {
			ta.focus();
			if (!document.execCommand('insertText', false, repIn.value)) {
				ta.setRangeText(repIn.value, ta.selectionStart, ta.selectionEnd, 'end');
				ta.dispatchEvent(new Event('input'));
			}
		}
		selectMatch();
	}
	function replaceEverything() {
		if (!findIn.value) return;
		const ta = cur.ta;
		const r = replaceAll(ta.value, findIn.value, repIn.value, caseSens);
		if (!r.count) return updateCount();
		ta.focus();
		ta.select();
		if (!document.execCommand('insertText', false, r.text)) {
			ta.value = r.text;
			ta.dispatchEvent(new Event('input'));
		}
		ctx.toast(`Replaced ${r.count} ${r.count === 1 ? 'match' : 'matches'}`);
		findIn.focus();
		updateCount();
	}
	findIn.addEventListener('input', () => {
		if (findIn.value) {
			const ta = cur.ta;
			const m = matches();
			if (m.length) {
				const at = m[nextMatchIndex(m, ta.selectionStart)];
				ta.focus();
				ta.setSelectionRange(at, at + findIn.value.length);
				findIn.focus({ preventScroll: true });
			}
		}
		updateCount();
	});
	findIn.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			selectMatch(e.shiftKey);
		}
	});
	repIn.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			replaceCurrent();
		}
	});
	findBar.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			closeFind();
		}
	});

	async function gotoLine() {
		const n = await promptLine();
		if (n == null) return;
		const ta = cur.ta;
		const off = offsetOfLine(ta.value, n);
		ta.focus();
		ta.setSelectionRange(off, off);
		const lh = parseFloat(getComputedStyle(ta).lineHeight) || prefs.size * 1.5;
		ta.scrollTop = Math.max(0, (Math.min(n, countLines(ta.value)) - 3) * lh);
		updateStatus();
	}

	function openFromComputer() {
		fileInput.click();
	}
	fileInput.addEventListener('change', async () => {
		const files = [...fileInput.files];
		fileInput.value = '';
		for (const f of files) {
			try {
				const text = await f.text();
				const only = docs.length === 1 && !docs[0].path && !isDirty(docs[0]) && !docs[0].ta.value;
				addDoc({ name: f.name, text, saved: '' });
				if (only) closeDoc(docs[0], true);
			} catch (e) {
				err(e);
			}
		}
	});

	/* --- commands and keys --- */
	const act = {
		new: () => addDoc(),
		open: async () => {
			const p = await fileDialog({ mode: 'open', dir: cur?.path ? fs.parentOf(cur.path) : '/Documents' });
			if (p) openPath(p);
		},
		computer: openFromComputer,
		save: () => saveDoc(cur),
		saveas: () => saveDoc(cur, true),
		find: () => openFind(false),
		goto: gotoLine,
		wrap: () => {
			prefs.wrap = !prefs.wrap;
			savePrefs();
			applyViewAll();
		},
		zin: () => setSize(prefs.size + 2),
		zout: () => setSize(prefs.size - 2),
		next: () => selectMatch(false),
		prev: () => selectMatch(true),
		case: () => {
			caseSens = !caseSens;
			q('[data-act="case"]').setAttribute('aria-pressed', caseSens);
			updateCount();
		},
		closefind: closeFind,
		replace: replaceCurrent,
		replaceall: replaceEverything,
	};
	root.addEventListener('click', (e) => {
		const b = e.target.closest('[data-act]');
		if (b) return act[b.dataset.act]?.();
		const t = e.target.closest('.np-tab');
		if (!t) return;
		const d = docs.find((x) => x.id === t.dataset.id);
		if (!d) return;
		if (e.target.closest('.np-x')) closeDoc(d);
		else activateDoc(d);
	});
	tabsEl.addEventListener('auxclick', (e) => {
		const t = e.target.closest('.np-tab');
		if (e.button === 1 && t) closeDoc(docs.find((x) => x.id === t.dataset.id));
	});
	tabsEl.addEventListener('keydown', (e) => {
		const i = docs.indexOf(cur);
		if (e.key === 'ArrowRight') activateDoc(docs[(i + 1) % docs.length]);
		else if (e.key === 'ArrowLeft') activateDoc(docs[(i - 1 + docs.length) % docs.length]);
		else return;
		tabsEl.querySelector('.np-tab.on')?.focus();
	});
	root.addEventListener('keydown', (e) => {
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (mod && k === 's') return e.preventDefault(), saveDoc(cur, e.shiftKey);
		if (mod && k === 'n') return e.preventDefault(), addDoc();
		if (mod && k === 'o') return e.preventDefault(), act.open();
		if (mod && k === 'w') return e.preventDefault(), closeDoc(cur);
		if (mod && k === 'f') return e.preventDefault(), openFind(false);
		if (mod && k === 'h') return e.preventDefault(), openFind(true);
		if (mod && k === 'g') return e.preventDefault(), gotoLine();
		if (mod && (k === '=' || k === '+')) return e.preventDefault(), act.zin();
		if (mod && k === '-') return e.preventDefault(), act.zout();
		if (mod && k === '0') return e.preventDefault(), setSize(DEFAULT_SIZE);
		if (mod && e.key === 'Tab') {
			e.preventDefault();
			return activateDoc(docs[(docs.indexOf(cur) + (e.shiftKey ? -1 : 1) + docs.length) % docs.length]);
		}
		if (e.key === 'F3') return e.preventDefault(), findIn.value ? selectMatch(e.shiftKey) : openFind(false);
	});

	// Dropped text files from the real OS open as tabs.
	root.addEventListener('dragover', (e) => {
		if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
	});
	root.addEventListener('drop', async (e) => {
		const files = [...(e.dataTransfer?.files || [])];
		if (!files.length) return;
		e.preventDefault();
		for (const f of files) {
			try {
				addDoc({ name: f.name, text: await f.text(), saved: '' });
			} catch (x) {
				err(x);
			}
		}
	});

	/* --- startup: restore drafts, then honour the launch argument --- */
	async function restore() {
		for (const dr of parseDrafts(ctx.store.get(DRAFTS_KEY))) {
			let saved = '';
			if (dr.path) saved = (await fs.readText(dr.path).catch(() => null)) ?? '';
			addDoc({ id: dr.id, path: dr.path, name: dr.name, text: dr.text, saved, activate: false });
		}
		if (docs.length) ctx.toast('Restored your unsaved notes');
	}
	async function applyArg(arg) {
		if (typeof arg !== 'string' || !arg) return;
		await openPath(fs.normalize(arg));
	}
	ctx.onArg(applyArg);

	q('[data-act="wrap"]').setAttribute('aria-pressed', prefs.wrap);
	renderTabs();
	restore()
		.then(() => applyArg(ctx.arg))
		.then(() => {
			if (dead) return;
			if (!docs.length) addDoc();
			else if (!cur) activateDoc(docs[docs.length - 1]);
		});

	return () => {
		dead = true;
		clearTimeout(draftTimer);
		flushDrafts();
		window.removeEventListener('pagehide', onHide);
	};
}
