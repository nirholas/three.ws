// File Explorer: the desktop's window onto the virtual file system (../fs.js).
import './files.css';
import * as fs from '../fs.js';

const HOME = '@home';

/* ---------- pure helpers (unit tested) ---------- */

/** "0 B", "812 B", "12 KB", "1.5 MB". */
export function formatSize(bytes) {
	const n = Number(bytes);
	if (!Number.isFinite(n) || n <= 0) return '0 B';
	if (n < 1024) return `${Math.round(n)} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	const s = v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
	return `${s} ${units[i]}`;
}

/** Human type label for a node: "File folder", "PNG file", "File". */
export function typeLabel(node) {
	if (node.type === 'dir') return 'File folder';
	const e = fs.extOf(node.name);
	return e ? `${e.toUpperCase()} file` : 'File';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sort nodes without mutating the input. Folders always come first.
 * key: 'name' | 'date' | 'size' | 'type'; dir: 'asc' | 'desc'.
 */
export function sortNodes(nodes, { key = 'name', dir = 'asc' } = {}) {
	const sign = dir === 'desc' ? -1 : 1;
	const cmp = {
		name: (a, b) => collator.compare(a.name, b.name),
		date: (a, b) => (a.mtime || 0) - (b.mtime || 0) || collator.compare(a.name, b.name),
		size: (a, b) => (a.size || 0) - (b.size || 0) || collator.compare(a.name, b.name),
		type: (a, b) => collator.compare(typeLabel(a), typeLabel(b)) || collator.compare(a.name, b.name),
	}[key] || ((a, b) => collator.compare(a.name, b.name));
	return [...nodes].sort((a, b) => {
		if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
		return sign * cmp(a, b);
	});
}

/** Display name for a location: Home, Computer, Trash or the folder name. */
export function locationName(loc) {
	if (loc === HOME) return 'Home';
	if (loc === '/') return 'Computer';
	if (loc === fs.TRASH) return 'Trash';
	return fs.nameOf(loc) || 'Computer';
}

/** Breadcrumb trail for the address bar: [{ name, path }]. */
export function buildCrumbs(loc) {
	if (loc === HOME) return [{ name: 'Home', path: HOME }];
	const out = [{ name: 'Computer', path: '/' }];
	const p = fs.normalize(loc);
	if (p === '/') return out;
	let acc = '';
	for (const seg of p.split('/').filter(Boolean)) {
		acc += `/${seg}`;
		out.push({ name: acc === fs.TRASH ? 'Trash' : seg, path: acc });
	}
	return out;
}

/** Turn text typed in the address bar into a location ("home", "Computer\\Documents", "/Pictures/a"). */
export function parseAddress(input) {
	let s = String(input ?? '').trim().replace(/\\/g, '/');
	if (!s || /^(computer|this pc)\/?$/i.test(s)) return '/';
	if (/^home\/?$/i.test(s)) return HOME;
	if (/^(trash|recycle bin)\/?$/i.test(s)) return fs.TRASH;
	s = s.replace(/^(computer|this pc)\//i, '/').replace(/^(trash|recycle bin)(?=\/|$)/i, fs.TRASH);
	return fs.normalize(s);
}

/** Case-insensitive name filter. An empty query returns everything. */
export function filterByName(nodes, query) {
	const q = String(query || '').trim().toLowerCase();
	return q ? nodes.filter((n) => n.name.toLowerCase().includes(q)) : nodes;
}

/** Paths between `anchor` and `target` (inclusive) in display order, for shift-click. */
export function rangeSelect(order, anchor, target) {
	const a = order.indexOf(anchor);
	const b = order.indexOf(target);
	if (b < 0) return [];
	if (a < 0) return [target];
	return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Next cursor index for an arrow/Home/End key. `cols` is 1 for list views. */
export function moveIndex(i, key, count, cols = 1) {
	if (!count) return -1;
	if (i < 0) return key === 'ArrowUp' || key === 'End' || key === 'ArrowLeft' ? count - 1 : 0;
	const step = { ArrowUp: -cols, ArrowDown: cols, ArrowLeft: cols > 1 ? -1 : 0, ArrowRight: cols > 1 ? 1 : 0 }[key];
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	if (step == null) return i;
	return Math.max(0, Math.min(count - 1, i + step));
}

/** Of `paths`, those that can legally be moved into `dest` (not already there, not into themselves). */
export function movablePaths(paths, dest) {
	const d = fs.normalize(dest);
	return paths.map(fs.normalize).filter((p) => fs.parentOf(p) !== d && d !== p && !d.startsWith(`${p}/`));
}

/** Total size of the selected files, and how many folders were among them. */
export function selectionSummary(nodes) {
	let bytes = 0;
	let dirs = 0;
	for (const n of nodes) n.type === 'dir' ? dirs++ : (bytes += n.size || 0);
	return { count: nodes.length, bytes, dirs };
}

/** Status-bar text for a listing. */
export function statusText(total, selected) {
	const items = `${total} ${total === 1 ? 'item' : 'items'}`;
	if (!selected.count) return items;
	const sel = `${selected.count} selected`;
	return selected.bytes ? `${items}   ${sel}   ${formatSize(selected.bytes)}` : `${items}   ${sel}`;
}

/* ---------- module state shared by every Explorer window ---------- */

let clip = null; // { mode: 'copy' | 'cut', paths }

const GLYPHS = {
	'fx-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
	'fx-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
	'fx-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
	'fx-cut': '<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M7.5 16 17 3M16.5 16 7 3"/>',
	'fx-copy': '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
	'fx-paste': '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
	'fx-sort': '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
	'fx-file': '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
	'fx-newfolder': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
	'fx-newfile': '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>',
	'fx-restore': '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4.5h4.5"/>',
	'fx-drive': '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2-8h10l2 8M7.5 16.5h.01M11 16.5h6"/>',
	'fx-detail': '<path d="M4 6h16M4 12h16M4 18h16"/>',
	'fx-tiles': '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
};

const DIR_ICON = { Desktop: 'desktop', Pictures: 'image', Music: 'music', Videos: 'video', Downloads: 'download', Documents: 'note' };
const KIND_ICON = { text: 'note', image: 'image', audio: 'music', video: 'video', model: 'cube', other: 'fx-file' };

export function iconName(node) {
	if (node.type === 'dir') {
		if (node.path === fs.TRASH) return 'trash';
		return node.parent === '/' ? DIR_ICON[node.name] || 'folder' : 'folder';
	}
	return KIND_ICON[fs.kindOf(node.name)] || 'fx-file';
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const fmtDate = (ms) => (ms ? dateFmt.format(ms) : '');

/* ---------- the app ---------- */

export function mount(host, ctx) {
	for (const [k, v] of Object.entries(GLYPHS)) ctx.registerGlyph(k, v);
	const { h, esc, icon } = ctx;

	const readJson = (k, d) => {
		try {
			return { ...d, ...JSON.parse(ctx.store.get(k) || '{}') };
		} catch {
			return d;
		}
	};
	const view0 = ctx.store.get('files:view');
	const st = {
		loc: HOME,
		hist: [],
		hi: -1,
		nodes: [],
		shown: [],
		sel: new Set(),
		cursor: null,
		anchor: null,
		view: ['list', 'details', 'grid'].includes(view0) ? view0 : 'details',
		sort: readJson('files:sort', { key: 'name', dir: 'asc' }),
		query: '',
		searching: false,
		loading: true,
		error: null,
		renaming: null,
		dirty: false,
		trashCount: 0,
	};
	let token = 0;
	let dead = false;
	const thumbs = new Map(); // path -> { mtime, url }
	const els = new Map(); // path -> element in the current listing

	const root = h('div', 'fx');
	root.innerHTML = `
		<div class="fx-top">
			<div class="fx-nav">
				<button class="fx-btn" data-act="back" title="Back (Alt+Left)" aria-label="Back">${icon('fx-left', 16)}</button>
				<button class="fx-btn" data-act="fwd" title="Forward (Alt+Right)" aria-label="Forward">${icon('fx-right', 16)}</button>
				<button class="fx-btn" data-act="up" title="Up (Backspace)" aria-label="Up one level">${icon('fx-up', 16)}</button>
				<button class="fx-btn" data-act="refresh" title="Refresh (F5)" aria-label="Refresh">${icon('reload', 16)}</button>
			</div>
			<div class="fx-addr" data-role="addr" title="Click to edit the address (Ctrl+L)"></div>
			<label class="fx-search">${icon('search', 14)}<input type="search" placeholder="Search" aria-label="Search this folder" spellcheck="false" autocomplete="off" /></label>
		</div>
		<div class="fx-cmd" role="toolbar" aria-label="File commands" data-role="cmd"></div>
		<div class="fx-body">
			<nav class="fx-side" aria-label="Navigation" data-role="side"></nav>
			<main class="fx-main">
				<div class="fx-scroll" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="Files" data-role="scroll"></div>
				<div class="fx-drop" data-role="dropmsg" hidden></div>
			</main>
		</div>
		<div class="fx-status" role="status" data-role="status"></div>
		<input type="file" multiple hidden data-role="file" />`;
	host.append(root);
	const $ = (r) => root.querySelector(`[data-role="${r}"]`);
	const addr = $('addr');
	const cmd = $('cmd');
	const side = $('side');
	const hdr = h('div', 'fx-hdr');
	const scroll = $('scroll');
	const statusEl = $('status');
	const fileInput = $('file');
	const searchInput = root.querySelector('.fx-search input');
	const dropMsg = $('dropmsg');

	/* --- derived --- */
	const isDirLoc = (l) => l !== HOME && l !== '/';
	const inTrash = () => st.loc === fs.TRASH || st.loc.startsWith(`${fs.TRASH}/`);
	const trashRoot = () => st.loc === fs.TRASH;
	const canWrite = () => isDirLoc(st.loc) && !inTrash() && !st.searching;
	const uploadDir = () => (canWrite() ? st.loc : '/Downloads');
	const selNodes = () => st.shown.filter((n) => st.sel.has(n.path));
	const nodeAt = (p) => st.shown.find((n) => n.path === p);
	const err = (e) => ctx.toast(e?.message || 'Something went wrong');

	/* --- loading --- */
	async function fetchNodes(loc, query) {
		if (query) {
			const base = loc === HOME || loc === '/' ? '/' : loc;
			const all = await fs.walk(base);
			const keepTrash = inTrash();
			return filterByName(all.filter((n) => keepTrash || !n.path.startsWith(`${fs.TRASH}/`)), query);
		}
		if (loc === HOME) {
			const dirs = (await Promise.all(fs.DIRS.map((d) => fs.stat(`/${d}`)))).filter(Boolean);
			return [...dirs, ...(await fs.recentFiles(24))];
		}
		if (loc === '/') return (await fs.list('/')).filter((n) => n.path !== fs.TRASH);
		const node = await fs.stat(loc);
		if (!node) throw new Error(`"${loc}" does not exist.`);
		if (node.type !== 'dir') throw new Error(`"${loc}" is not a folder.`);
		return fs.list(loc);
	}

	async function load({ keepSel = false } = {}) {
		const my = ++token;
		st.dirty = false;
		const timer = setTimeout(() => {
			if (my === token && !dead) {
				st.loading = true;
				renderList();
			}
		}, 90);
		try {
			const nodes = await fetchNodes(st.loc, st.query.trim());
			if (my !== token || dead) return;
			st.nodes = nodes;
			st.error = null;
			st.searching = !!st.query.trim();
			const keep = new Set(nodes.map((n) => n.path));
			st.sel = keepSel ? new Set([...st.sel].filter((p) => keep.has(p))) : st.sel;
			applySort();
		} catch (e) {
			if (my !== token || dead) return;
			st.nodes = [];
			st.shown = [];
			st.error = e?.message || 'This location could not be read.';
			st.sel.clear();
		} finally {
			clearTimeout(timer);
		}
		if (my === token && !dead) {
			st.loading = false;
			renderAll();
		}
	}

	function applySort() {
		st.shown = sortNodes(st.nodes, st.sort);
		if (st.cursor && !nodeAt(st.cursor)) st.cursor = null;
	}

	async function go(loc, { push = true, select = null } = {}) {
		if (push) {
			st.hist = st.hist.slice(0, st.hi + 1);
			if (st.hist[st.hist.length - 1] !== loc) st.hist.push(loc);
			st.hi = st.hist.length - 1;
		}
		st.loc = loc;
		st.query = '';
		st.searching = false;
		searchInput.value = '';
		st.sel = new Set(select ? [select] : []);
		st.cursor = select;
		st.anchor = select;
		ctx.setTitle(locationName(loc));
		await load({ keepSel: !!select });
		if (select) els.get(select)?.scrollIntoView({ block: 'center' });
	}
	const goBack = () => st.hi > 0 && go(st.hist[--st.hi], { push: false });
	const goFwd = () => st.hi < st.hist.length - 1 && go(st.hist[++st.hi], { push: false });
	const goUp = () => {
		if (st.loc === HOME || st.loc === '/') return;
		go(fs.parentOf(st.loc));
	};

	/* --- rendering --- */
	function skeleton() {
		return `<div class="fx-skel" aria-busy="true" aria-label="Loading">${'<div class="fx-skel-row"><i></i><b></b></div>'.repeat(9)}</div>`;
	}

	const detailCols = () => (st.searching ? 'Location' : trashRoot() ? 'Original location' : '');

	function renderHeader() {
		if (st.view !== 'details' || st.error) {
			hdr.hidden = true;
			return;
		}
		hdr.hidden = false;
		const extra = detailCols();
		hdr.style.setProperty('--cols', extra ? 'minmax(160px,1fr) 150px 110px 80px minmax(120px,0.8fr)' : 'minmax(160px,1fr) 150px 110px 80px');
		const col = (key, label, cls = '') => {
			const on = st.sort.key === key;
			return `<button class="fx-th ${cls}" data-sort="${key}" aria-sort="${on ? (st.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}${on ? `<span class="fx-caret">${st.sort.dir === 'asc' ? '&#9650;' : '&#9660;'}</span>` : ''}</button>`;
		};
		hdr.innerHTML = `<span class="fx-th-pad"></span>${col('name', 'Name')}${col('date', 'Date modified')}${col('type', 'Type')}${col('size', 'Size', 'r')}${extra ? `<span class="fx-th">${extra}</span>` : ''}`;
	}

	function storageHtml(big) {
		const u = st.usage;
		if (!u) return '';
		const pct = u.quota ? Math.max(1, Math.min(100, (u.used / u.quota) * 100)) : 0;
		const label = u.quota ? `${formatSize(u.used)} of ${formatSize(u.quota)} used` : `${formatSize(u.bytes)} in ${u.files} ${u.files === 1 ? 'file' : 'files'}`;
		return `<div class="fx-meter ${big ? 'big' : ''}"><div class="fx-meter-bar"${u.quota ? '' : ' hidden'}><i style="width:${pct.toFixed(1)}%"></i></div><span>${esc(label)}</span>${big && u.quota ? `<span class="fx-meter-sub">${esc(`${u.files} ${u.files === 1 ? 'file' : 'files'}, ${formatSize(u.bytes)} stored by this desktop`)}</span>` : ''}</div>`;
	}

	function itemHtml(n) {
		const loc = n.path;
		const extra = st.searching ? esc(fs.parentOf(loc)) : trashRoot() ? esc(n.trashedFrom ? fs.parentOf(n.trashedFrom) : '') : '';
		const kind = n.type === 'dir' ? 'dir' : fs.kindOf(n.name);
		const thumb = st.view === 'grid' && kind === 'image' ? ' data-thumb="1"' : '';
		const meta = st.view === 'details' ? `<span class="fx-c">${fmtDate(n.mtime)}</span><span class="fx-c">${esc(typeLabel(n))}</span><span class="fx-c r">${n.type === 'dir' ? '' : formatSize(n.size)}</span>${detailCols() ? `<span class="fx-c" title="${extra}">${extra}</span>` : ''}` : '';
		const tip = `${n.name}\n${typeLabel(n)}${n.type === 'dir' ? '' : `\nSize: ${formatSize(n.size)}`}\nModified: ${fmtDate(n.mtime)}`;
		return `<div class="fx-item k-${kind}${st.sel.has(loc) ? ' sel' : ''}${clip?.mode === 'cut' && clip.paths.includes(loc) ? ' cut' : ''}${st.cursor === loc ? ' cur' : ''}" role="option" aria-selected="${st.sel.has(loc)}" draggable="true" data-path="${esc(loc)}" data-type="${n.type}" title="${esc(tip)}"><span class="fx-ic"${thumb}>${icon(iconName(n), st.view === 'grid' ? 40 : 18)}</span><span class="fx-name">${esc(n.name)}</span>${meta}</div>`;
	}

	function emptyHtml() {
		if (st.searching) return `<div class="fx-empty">${icon('search', 40)}<h3>No results for &ldquo;${esc(st.query.trim())}&rdquo;</h3><p>Nothing in ${esc(locationName(st.loc))} matches that name. Check the spelling or try a shorter word.</p></div>`;
		if (trashRoot()) return `<div class="fx-empty">${icon('trash', 40)}<h3>The Trash is empty</h3><p>Files and folders you delete show up here until you empty it.</p></div>`;
		if (canWrite()) return `<div class="fx-empty">${icon('folder', 40)}<h3>This folder is empty</h3><p>Drop files here or use New.</p><div class="fx-empty-act"><button class="fx-pill" data-act="newfolder">New folder</button><button class="fx-pill" data-act="upload">Upload files</button></div></div>`;
		return `<div class="fx-empty">${icon('folder', 40)}<h3>Nothing here yet</h3><p>Open a folder such as Documents, then drop files here or use New.</p></div>`;
	}

	function renderList() {
		els.clear();
		scroll.className = `fx-scroll v-${st.view}`;
		scroll.removeAttribute('aria-busy');
		if (st.loading && !st.shown.length && !st.error) {
			scroll.innerHTML = skeleton();
			return;
		}
		if (st.error) {
			scroll.innerHTML = `<div class="fx-empty err">${icon('close', 40)}<h3>This location can&rsquo;t be opened</h3><p>${esc(st.error)}</p><div class="fx-empty-act"><button class="fx-pill" data-act="refresh">Try again</button><button class="fx-pill" data-act="gohome">Go to Home</button></div></div>`;
			return;
		}
		const extra = detailCols();
		scroll.style.setProperty('--cols', extra ? 'minmax(160px,1fr) 150px 110px 80px minmax(120px,0.8fr)' : 'minmax(160px,1fr) 150px 110px 80px');
		const lead = st.loc === '/' ? `<div class="fx-pc">${icon('fx-drive', 34)}<div><b>Local storage</b>${storageHtml(true)}</div></div>` : '';
		scroll.innerHTML = st.shown.length ? `${lead}<div class="fx-items">${st.shown.map(itemHtml).join('')}</div>` : `${lead}${emptyHtml()}`;
		if (!hdr.hidden) scroll.prepend(hdr);
		for (const el of scroll.querySelectorAll('.fx-item')) els.set(el.dataset.path, el);
		observeThumbs();
	}

	function renderCmd() {
		const sel = selNodes();
		const one = sel.length === 1;
		const files = sel.filter((n) => n.type === 'file');
		const w = canWrite();
		const b = (act, ic, label, { dis = false, title = '', cls = '' } = {}) =>
			`<button class="fx-cb ${cls}" data-act="${act}" ${dis ? 'disabled' : ''} title="${esc(title || label)}" aria-label="${esc(label)}">${icon(ic, 16)}<span>${esc(label)}</span></button>`;
		const sep = '<i class="fx-sep"></i>';
		const viewBtn = (v, ic, label) => `<button class="fx-vb ${st.view === v ? 'on' : ''}" data-view="${v}" title="${label}" aria-label="${label}" aria-pressed="${st.view === v}">${icon(ic, 16)}</button>`;
		let left;
		if (trashRoot()) {
			left = `${b('restore', 'fx-restore', 'Restore', { dis: !sel.length, title: 'Restore the selected items' })}${b('purge', 'trash', 'Delete permanently', { dis: !sel.length })}${b('empty', 'trash', 'Empty Trash', { dis: !st.nodes.length })}`;
		} else {
			left = `${b('newfolder', 'fx-newfolder', 'New folder', { dis: !w, title: w ? 'New folder' : 'Open a folder to create items in it' })}${b('newfile', 'fx-newfile', 'New text document', { dis: !w })}${b('upload', 'upload', 'Upload', { title: `Upload files to ${locationName(uploadDir())}` })}${sep}${b('cut', 'fx-cut', 'Cut', { dis: !sel.length || inTrash(), cls: 'sec' })}${b('copy', 'fx-copy', 'Copy', { dis: !sel.length, cls: 'sec' })}${b('paste', 'fx-paste', 'Paste', { dis: !w || !clip, cls: 'sec' })}${b('rename', 'edit', 'Rename', { dis: !one || inTrash(), cls: 'sec' })}${b('delete', 'trash', 'Delete', { dis: !sel.length, cls: 'sec' })}${b('download', 'download', 'Download', { dis: !files.length, cls: 'sec' })}`;
		}
		cmd.innerHTML = `${left}<span class="fx-grow"></span>${b('sort', 'fx-sort', 'Sort', { title: 'Sort and order', cls: 'sec' })}<span class="fx-views" role="group" aria-label="View">${viewBtn('list', 'list', 'List')}${viewBtn('details', 'fx-detail', 'Details')}${viewBtn('grid', 'fx-tiles', 'Large icons')}</span>`;
		root.querySelector('[data-act="back"]').disabled = st.hi <= 0;
		root.querySelector('[data-act="fwd"]').disabled = st.hi >= st.hist.length - 1;
		root.querySelector('[data-act="up"]').disabled = st.loc === HOME || st.loc === '/';
	}

	function renderStatus() {
		statusEl.textContent = st.error ? '' : statusText(st.shown.length, selectionSummary(selNodes()));
	}

	function renderAddr() {
		if (addr.querySelector('input')) return;
		const crumbs = buildCrumbs(st.loc);
		addr.innerHTML = `<span class="fx-crumbs">${crumbs.map((c, i) => `${i ? `<span class="fx-chev" aria-hidden="true">${icon('chevron', 10)}</span>` : ''}<button class="fx-crumb" data-go="${esc(c.path)}" ${i === crumbs.length - 1 ? 'aria-current="page"' : ''}>${esc(c.name)}</button>`).join('')}</span>`;
		const c = addr.firstElementChild;
		c.scrollLeft = c.scrollWidth;
	}

	function renderSide() {
		const link = (path, ic, label, extra = '') =>
			`<button class="fx-nv${st.loc === path ? ' on' : ''}" data-go="${esc(path)}" ${isDirLoc(path) ? `data-drop="${esc(path)}"` : ''}>${icon(ic, 16)}<span>${esc(label)}</span>${extra}</button>`;
		side.innerHTML = `
			${link(HOME, 'home', 'Home')}
			<div class="fx-nh">Quick access</div>
			${fs.DIRS.map((d) => link(`/${d}`, DIR_ICON[d] || 'folder', d)).join('')}
			<div class="fx-nh">Devices</div>
			${link('/', 'pc', 'Computer')}
			${storageHtml(false)}
			<div class="fx-nh">Bin</div>
			<button class="fx-nv${trashRoot() ? ' on' : ''}" data-go="${fs.TRASH}" data-drop="${fs.TRASH}">${icon('trash', 16)}<span>Trash</span>${st.trashCount ? `<em class="fx-count">${st.trashCount}</em>` : ''}</button>`;
	}

	function renderAll() {
		renderAddr();
		renderHeader();
		renderList();
		renderCmd();
		renderStatus();
		renderSide();
	}

	function paintSelection() {
		for (const [p, el] of els) {
			const on = st.sel.has(p);
			el.classList.toggle('sel', on);
			el.classList.toggle('cur', st.cursor === p);
			el.classList.toggle('cut', clip?.mode === 'cut' && clip.paths.includes(p));
			el.setAttribute('aria-selected', on);
		}
		renderCmd();
		renderStatus();
	}

	/* --- thumbnails --- */
	let io = null;
	function observeThumbs() {
		io?.disconnect();
		const keep = new Set(st.shown.map((n) => n.path));
		for (const [p, t] of thumbs) {
			if (!keep.has(p)) {
				URL.revokeObjectURL(t.url);
				thumbs.delete(p);
			}
		}
		if (st.view !== 'grid') return;
		io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					io.unobserve(e.target);
					setThumb(e.target.closest('.fx-item'));
				}
			},
			{ root: scroll, rootMargin: '200px' },
		);
		for (const t of scroll.querySelectorAll('[data-thumb]')) io.observe(t);
	}
	async function setThumb(item) {
		if (!item) return;
		const p = item.dataset.path;
		const node = nodeAt(p);
		if (!node) return;
		let t = thumbs.get(p);
		if (!t || t.mtime !== node.mtime) {
			if (t) URL.revokeObjectURL(t.url);
			const url = await fs.urlFor(p).catch(() => null);
			if (!url) return;
			t = { mtime: node.mtime, url };
			thumbs.set(p, t);
		}
		if (dead || els.get(p) !== item) return;
		const box = item.querySelector('.fx-ic');
		const img = new Image();
		img.alt = '';
		img.decoding = 'async';
		img.onload = () => box.replaceChildren(img);
		img.src = t.url;
	}

	/* --- selection --- */
	function select(paths, { cursor = paths[paths.length - 1] ?? null, anchor } = {}) {
		st.sel = new Set(paths);
		st.cursor = cursor;
		if (anchor !== undefined) st.anchor = anchor;
		paintSelection();
	}
	function clickItem(p, e) {
		const order = st.shown.map((n) => n.path);
		if (e.shiftKey) select(rangeSelect(order, st.anchor ?? p, p), { cursor: p });
		else if (e.ctrlKey || e.metaKey) {
			const s = new Set(st.sel);
			s.has(p) ? s.delete(p) : s.add(p);
			select([...s], { cursor: p, anchor: p });
		} else select([p], { cursor: p, anchor: p });
	}

	/* --- menus and dialogs --- */
	let menu = null;
	let menuOff = null;
	function closeMenu() {
		menu?.remove();
		menu = null;
		menuOff?.();
		menuOff = null;
	}
	function showMenu(x, y, items, { from = null } = {}) {
		closeMenu();
		const m = h('div', 'fx-menu');
		m.setAttribute('role', 'menu');
		for (const it of items) {
			if (it === '-') {
				m.append(h('hr'));
				continue;
			}
			const b = h('button', it.danger ? 'danger' : '');
			b.setAttribute('role', 'menuitem');
			b.disabled = !!it.disabled;
			b.innerHTML = `<span class="fx-mi">${it.check ? icon('check', 14) : it.icon ? icon(it.icon, 15) : ''}</span><span class="fx-ml">${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}`;
			b.addEventListener('click', () => {
				closeMenu();
				it.run();
			});
			m.append(b);
		}
		root.append(m);
		const r = root.getBoundingClientRect();
		const mw = m.offsetWidth;
		const mh = m.offsetHeight;
		m.style.left = `${Math.max(4, Math.min(x - r.left, r.width - mw - 4))}px`;
		m.style.top = `${Math.max(4, Math.min(y - r.top, r.height - mh - 4))}px`;
		menu = m;
		m.querySelector('button:not(:disabled)')?.focus();
		const onDown = (e) => {
			if (!m.contains(e.target)) closeMenu();
		};
		const onKey = (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closeMenu();
				(from || scroll).focus?.();
			} else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				const bs = [...m.querySelectorAll('button:not(:disabled)')];
				const i = bs.indexOf(document.activeElement);
				bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
			}
		};
		document.addEventListener('pointerdown', onDown, true);
		root.addEventListener('keydown', onKey, true);
		root.addEventListener('wheel', closeMenu, { passive: true });
		menuOff = () => {
			document.removeEventListener('pointerdown', onDown, true);
			root.removeEventListener('keydown', onKey, true);
			root.removeEventListener('wheel', closeMenu);
		};
	}

	/** Small in-window dialog. Resolves to true/false, or the input text (null on cancel) when `input` is set. */
	function ask({ title, message = '', input = null, ok = 'OK', danger = false, cancel = 'Cancel' }) {
		return new Promise((resolve) => {
			const wrap = h('div', 'fx-modal');
			wrap.innerHTML = `<form class="fx-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}${input != null ? '<input class="fx-dlg-in" spellcheck="false" autocomplete="off" />' : ''}<div class="fx-dlg-act"><button type="button" class="fx-pill" data-x="no">${esc(cancel)}</button><button type="submit" class="fx-pill ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`;
			root.append(wrap);
			const inp = wrap.querySelector('input');
			const done = (v) => {
				wrap.remove();
				scroll.focus();
				resolve(v);
			};
			if (inp) {
				inp.value = input;
				inp.focus();
				const dot = input.lastIndexOf('.');
				inp.setSelectionRange(0, dot > 0 ? dot : input.length);
			} else wrap.querySelector('[type=submit]').focus();
			wrap.addEventListener('submit', (e) => {
				e.preventDefault();
				done(inp ? inp.value.trim() : true);
			});
			wrap.querySelector('[data-x]').addEventListener('click', () => done(inp ? null : false));
			wrap.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Escape') done(inp ? null : false);
			});
			wrap.addEventListener('pointerdown', (e) => e.target === wrap && done(inp ? null : false));
		});
	}

	/* --- operations --- */
	async function open(node) {
		if (node.type === 'dir') return go(node.path);
		try {
			await ctx.openPath(node.path);
		} catch (e) {
			err(e);
		}
	}
	function openSelection() {
		const sel = selNodes();
		if (!sel.length) return;
		const dir = sel.find((n) => n.type === 'dir');
		if (dir) open(dir);
		else sel.forEach(open);
	}

	async function makeItem(kind) {
		if (!canWrite()) return;
		try {
			const name = await fs.uniqueName(st.loc, kind === 'dir' ? 'New folder' : 'New Text Document.txt');
			const p = fs.join(st.loc, name);
			if (kind === 'dir') await fs.mkdir(p);
			else await fs.write(p, '', { mime: 'text/plain' });
			await load();
			select([p], { anchor: p });
			els.get(p)?.scrollIntoView({ block: 'nearest' });
			startRename(p);
		} catch (e) {
			err(e);
		}
	}

	function startRename(path) {
		const el = els.get(path);
		const node = nodeAt(path);
		if (!el || !node || inTrash()) return;
		const label = el.querySelector('.fx-name');
		const input = h('input', 'fx-rename');
		input.value = node.name;
		input.spellcheck = false;
		input.setAttribute('aria-label', 'New name');
		label.replaceWith(input);
		st.renaming = path;
		input.focus();
		const dot = node.type === 'file' ? node.name.lastIndexOf('.') : -1;
		input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
		let finished = false;
		const finish = async (commit) => {
			if (finished) return;
			finished = true;
			st.renaming = null;
			const v = input.value.trim();
			if (commit && v && v !== node.name) {
				try {
					const np = await fs.rename(path, v);
					st.sel = new Set([np]);
					st.cursor = np;
					await load({ keepSel: true });
					scroll.focus();
					return;
				} catch (e) {
					err(e);
				}
			}
			if (st.dirty) await load({ keepSel: true });
			else {
				input.replaceWith(label);
				scroll.focus();
			}
		};
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter') finish(true);
			else if (e.key === 'Escape') finish(false);
		});
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('click', (e) => e.stopPropagation());
		input.addEventListener('dblclick', (e) => e.stopPropagation());
	}

	function setClip(mode) {
		const paths = selNodes().map((n) => n.path);
		if (!paths.length) return;
		clip = { mode, paths };
		ctx.toast(`${paths.length} ${paths.length === 1 ? 'item' : 'items'} ${mode === 'cut' ? 'cut' : 'copied'}`);
		paintSelection();
	}
	async function paste() {
		if (!clip || !canWrite()) return;
		const { mode, paths } = clip;
		const made = [];
		let failed = 0;
		for (const src of paths) {
			try {
				if (mode === 'cut' && fs.parentOf(src) === st.loc) continue;
				const dest = fs.join(st.loc, await fs.uniqueName(st.loc, fs.nameOf(src)));
				mode === 'cut' ? await fs.move(src, dest) : await fs.copy(src, dest);
				made.push(dest);
			} catch (e) {
				failed++;
				err(e);
			}
		}
		if (mode === 'cut') clip = null;
		await load();
		if (made.length) select(made, { anchor: made[0] });
		if (made.length && !failed) ctx.toast(`${mode === 'cut' ? 'Moved' : 'Pasted'} ${made.length} ${made.length === 1 ? 'item' : 'items'}`);
	}

	async function remove(permanent = false) {
		const sel = selNodes();
		if (!sel.length) return;
		const perm = permanent || inTrash();
		if (perm) {
			const msg = sel.length === 1 ? `"${sel[0].name}" will be permanently deleted. This can't be undone.` : `These ${sel.length} items will be permanently deleted. This can't be undone.`;
			if (!(await ask({ title: 'Delete permanently?', message: msg, ok: 'Delete', danger: true }))) return;
		}
		const idx = Math.max(0, st.shown.findIndex((n) => n.path === sel[0].path));
		let n = 0;
		for (const node of sel) {
			try {
				await (perm ? fs.purge(node.path) : fs.remove(node.path));
				n++;
			} catch (e) {
				err(e);
			}
		}
		st.sel.clear();
		await load();
		const next = st.shown[Math.min(idx, st.shown.length - 1)];
		if (next) select([next.path], { anchor: next.path });
		if (n) ctx.toast(perm ? `Deleted ${n} ${n === 1 ? 'item' : 'items'} permanently` : `Moved ${n} ${n === 1 ? 'item' : 'items'} to the Trash`);
	}

	async function restoreSel() {
		let n = 0;
		let last = null;
		for (const node of selNodes()) {
			try {
				last = await fs.restore(node.path);
				n++;
			} catch (e) {
				err(e);
			}
		}
		st.sel.clear();
		await load();
		refreshSide();
		if (n) ctx.toast(n === 1 ? `Restored to ${fs.parentOf(last)}` : `Restored ${n} items`);
	}
	async function emptyBin() {
		const count = st.nodes.length;
		if (!count) return;
		if (!(await ask({ title: 'Empty the Trash?', message: `${count} ${count === 1 ? 'item' : 'items'} will be permanently deleted. This can't be undone.`, ok: 'Empty Trash', danger: true }))) return;
		try {
			await fs.emptyTrash();
			ctx.toast('Trash emptied');
		} catch (e) {
			err(e);
		}
		await load();
	}

	async function download() {
		for (const node of selNodes().filter((n) => n.type === 'file')) {
			try {
				const f = await fs.read(node.path);
				if (!f) continue;
				const url = URL.createObjectURL(f.blob);
				const a = h('a');
				a.href = url;
				a.download = node.name;
				root.append(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(url), 4000);
			} catch (e) {
				err(e);
			}
		}
	}

	async function uploadFiles(files, dir = uploadDir()) {
		const list = [...files];
		if (!list.length) return;
		const done = [];
		for (const f of list) {
			try {
				done.push(await fs.importFile(f, dir));
			} catch (e) {
				err(e);
			}
		}
		if (done.length) {
			ctx.toast(`Uploaded ${done.length} ${done.length === 1 ? 'file' : 'files'} to ${locationName(dir)}`);
			if (dir === st.loc) {
				await load();
				select(done, { anchor: done[0] });
			}
		}
	}

	async function moveInto(paths, dest, copy = false) {
		const ok = copy ? paths : movablePaths(paths, dest);
		if (!ok.length) return;
		let n = 0;
		for (const p of ok) {
			try {
				if (dest === fs.TRASH) {
					await fs.remove(p);
				} else {
					const to = fs.join(dest, await fs.uniqueName(dest, fs.nameOf(p)));
					copy ? await fs.copy(p, to) : await fs.move(p, to);
				}
				n++;
			} catch (e) {
				err(e);
			}
		}
		if (n) ctx.toast(`${copy ? 'Copied' : 'Moved'} ${n} ${n === 1 ? 'item' : 'items'} to ${locationName(dest)}`);
		await load();
	}

	/* --- menus --- */
	function sortMenu(x, y, from) {
		const key = (k, label) => ({ label, check: st.sort.key === k, run: () => setSort({ key: k }) });
		showMenu(x, y, [
			key('name', 'Name'),
			key('date', 'Date modified'),
			key('type', 'Type'),
			key('size', 'Size'),
			'-',
			{ label: 'Ascending', check: st.sort.dir === 'asc', run: () => setSort({ dir: 'asc' }) },
			{ label: 'Descending', check: st.sort.dir === 'desc', run: () => setSort({ dir: 'desc' }) },
		], { from });
	}
	function setSort(patch) {
		st.sort = { ...st.sort, ...patch };
		ctx.store.set('files:sort', JSON.stringify(st.sort));
		applySort();
		renderHeader();
		renderList();
		paintSelection();
	}
	function setView(v) {
		if (st.view === v) return;
		st.view = v;
		ctx.store.set('files:view', v);
		renderHeader();
		renderList();
		paintSelection();
		if (st.cursor) els.get(st.cursor)?.scrollIntoView({ block: 'nearest' });
	}

	function itemMenu(x, y) {
		const sel = selNodes();
		const one = sel.length === 1;
		const files = sel.filter((n) => n.type === 'file');
		if (trashRoot()) {
			return showMenu(x, y, [
				{ label: 'Restore', icon: 'fx-restore', run: restoreSel },
				{ label: 'Delete permanently', icon: 'trash', danger: true, kbd: 'Del', run: () => remove(true) },
			]);
		}
		showMenu(x, y, [
			{ label: one && sel[0].type === 'dir' ? 'Open folder' : 'Open', icon: 'external', kbd: 'Enter', run: openSelection },
			...(inTrash() ? [] : [
				'-',
				{ label: 'Cut', icon: 'fx-cut', kbd: 'Ctrl+X', run: () => setClip('cut') },
				{ label: 'Copy', icon: 'fx-copy', kbd: 'Ctrl+C', run: () => setClip('copy') },
				{ label: 'Rename', icon: 'edit', kbd: 'F2', disabled: !one, run: () => startRename(sel[0].path) },
			]),
			{ label: 'Download', icon: 'download', disabled: !files.length, run: download },
			'-',
			{ label: inTrash() || st.searching && sel.some((n) => n.path.startsWith(fs.TRASH)) ? 'Delete permanently' : 'Delete', icon: 'trash', kbd: 'Del', danger: true, run: () => remove(false) },
		]);
	}
	function backgroundMenu(x, y) {
		const w = canWrite();
		if (trashRoot()) {
			return showMenu(x, y, [
				{ label: 'Empty Trash', icon: 'trash', disabled: !st.nodes.length, run: emptyBin },
				'-',
				{ label: 'Refresh', icon: 'reload', kbd: 'F5', run: () => load({ keepSel: true }) },
			]);
		}
		showMenu(x, y, [
			{ label: 'List', check: st.view === 'list', run: () => setView('list') },
			{ label: 'Details', check: st.view === 'details', run: () => setView('details') },
			{ label: 'Large icons', check: st.view === 'grid', run: () => setView('grid') },
			'-',
			{ label: 'Sort by', icon: 'fx-sort', run: () => sortMenu(x, y) },
			{ label: 'Refresh', icon: 'reload', kbd: 'F5', run: () => load({ keepSel: true }) },
			'-',
			{ label: 'New folder', icon: 'fx-newfolder', disabled: !w, run: () => makeItem('dir') },
			{ label: 'New text document', icon: 'fx-newfile', disabled: !w, run: () => makeItem('file') },
			{ label: 'Paste', icon: 'fx-paste', kbd: 'Ctrl+V', disabled: !w || !clip, run: paste },
			{ label: 'Upload files', icon: 'upload', run: () => fileInput.click() },
		]);
	}

	/* --- events --- */
	const actions = {
		back: goBack,
		fwd: goFwd,
		up: goUp,
		refresh: () => load({ keepSel: true }),
		gohome: () => go(HOME),
		newfolder: () => makeItem('dir'),
		newfile: () => makeItem('file'),
		upload: () => fileInput.click(),
		cut: () => setClip('cut'),
		copy: () => setClip('copy'),
		paste,
		rename: () => st.sel.size === 1 && startRename([...st.sel][0]),
		delete: () => remove(false),
		download,
		restore: restoreSel,
		purge: () => remove(true),
		empty: emptyBin,
	};

	root.addEventListener('click', (e) => {
		const t = e.target;
		const act = t.closest('[data-act]');
		if (act && !act.disabled) {
			if (act.dataset.act === 'sort') {
				const r = act.getBoundingClientRect();
				sortMenu(r.left, r.bottom + 4, act);
			} else actions[act.dataset.act]?.();
			return;
		}
		const vb = t.closest('[data-view]');
		if (vb) return setView(vb.dataset.view);
		const th = t.closest('[data-sort]');
		if (th) return setSort({ key: th.dataset.sort, dir: st.sort.key === th.dataset.sort && st.sort.dir === 'asc' ? 'desc' : 'asc' });
		const nav = t.closest('[data-go]');
		if (nav) return go(nav.dataset.go);
		if (t.closest('.fx-addr') && !addr.querySelector('input')) return editAddr();
		const item = t.closest('.fx-item');
		if (item && scroll.contains(item)) {
			scroll.focus({ preventScroll: true });
			return clickItem(item.dataset.path, e);
		}
		if (scroll.contains(t) && !t.closest('button')) {
			scroll.focus({ preventScroll: true });
			if (!e.ctrlKey && !e.shiftKey) select([], { cursor: null });
		}
	});
	scroll.addEventListener('dblclick', (e) => {
		const item = e.target.closest('.fx-item');
		if (!item || e.target.closest('input')) return;
		const node = nodeAt(item.dataset.path);
		if (node) open(node);
	});
	root.addEventListener('contextmenu', (e) => {
		if (e.target.closest('input')) return;
		if (!scroll.contains(e.target) && !e.target.closest('.fx-pc')) return;
		e.preventDefault();
		const item = e.target.closest('.fx-item');
		if (item) {
			if (!st.sel.has(item.dataset.path)) select([item.dataset.path], { anchor: item.dataset.path });
			itemMenu(e.clientX, e.clientY);
		} else {
			if (st.sel.size) select([], { cursor: null });
			backgroundMenu(e.clientX, e.clientY);
		}
	});
	root.addEventListener('auxclick', (e) => {
		if (e.button === 3) {
			e.preventDefault();
			goBack();
		} else if (e.button === 4) {
			e.preventDefault();
			goFwd();
		}
	});
	fileInput.addEventListener('change', async () => {
		const files = [...fileInput.files];
		fileInput.value = '';
		await uploadFiles(files);
	});

	// Search
	let searchTimer = 0;
	const runSearch = () => {
		clearTimeout(searchTimer);
		st.query = searchInput.value;
		st.sel.clear();
		load();
	};
	searchInput.addEventListener('input', () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(runSearch, 220);
	});
	searchInput.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if (e.key === 'Enter') runSearch();
		if (e.key === 'Escape') {
			searchInput.value = '';
			runSearch();
			scroll.focus();
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			scroll.focus();
			if (st.shown[0]) select([st.shown[0].path], { anchor: st.shown[0].path });
		}
	});

	// Address bar editing
	function editAddr() {
		if (addr.querySelector('input')) return;
		const input = h('input', 'fx-addr-in');
		input.value = st.loc === HOME ? 'Home' : st.loc;
		input.spellcheck = false;
		input.setAttribute('aria-label', 'Address');
		addr.replaceChildren(input);
		input.focus();
		input.select();
		let finished = false;
		const finish = async (commit) => {
			if (finished) return;
			if (commit) {
				const target = parseAddress(input.value);
				if (target !== st.loc) {
					const ok = target === HOME || target === '/' || (await fs.stat(target))?.type === 'dir';
					if (!ok) {
						input.classList.add('bad');
						input.title = `"${input.value}" is not a folder on this computer.`;
						ctx.toast(`Can't find a folder at "${input.value}"`);
						return;
					}
					finished = true;
					addr.replaceChildren();
					await go(target);
					return;
				}
			}
			finished = true;
			addr.replaceChildren();
			renderAddr();
			scroll.focus();
		};
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter') finish(true);
			if (e.key === 'Escape') finish(false);
		});
		input.addEventListener('blur', () => finish(false));
	}

	// Keyboard
	root.addEventListener('keydown', (e) => {
		const t = e.target;
		if (t.matches('input, textarea')) return;
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key;
		if (e.altKey && k === 'ArrowLeft') return e.preventDefault(), goBack();
		if (e.altKey && k === 'ArrowRight') return e.preventDefault(), goFwd();
		if (e.altKey && k === 'ArrowUp') return e.preventDefault(), goUp();
		if (mod && k.toLowerCase() === 'l') return e.preventDefault(), editAddr();
		if (mod && k.toLowerCase() === 'f') return e.preventDefault(), searchInput.focus();
		if (k === 'F5') return e.preventDefault(), load({ keepSel: true });
		if (!scroll.contains(t) && t !== scroll) return;
		if (mod && k.toLowerCase() === 'a') return e.preventDefault(), select(st.shown.map((n) => n.path), { cursor: st.cursor, anchor: st.shown[0]?.path });
		if (mod && k.toLowerCase() === 'c') return e.preventDefault(), setClip('copy');
		if (mod && k.toLowerCase() === 'x') return e.preventDefault(), inTrash() || setClip('cut');
		if (mod && k.toLowerCase() === 'v') return e.preventDefault(), paste();
		if (k === 'F2') return e.preventDefault(), actions.rename();
		if (k === 'Delete') return e.preventDefault(), remove(e.shiftKey);
		if (k === 'Backspace') return e.preventDefault(), goUp();
		if (k === 'Enter') return e.preventDefault(), openSelection();
		if (k === 'Escape' && st.sel.size) return select([], { cursor: null });
		if (k === ' ' && mod && st.cursor) {
			e.preventDefault();
			const s = new Set(st.sel);
			s.has(st.cursor) ? s.delete(st.cursor) : s.add(st.cursor);
			return select([...s], { cursor: st.cursor, anchor: st.cursor });
		}
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) {
			e.preventDefault();
			const order = st.shown.map((n) => n.path);
			let cols = 1;
			if (st.view === 'grid' && els.size) {
				const first = els.values().next().value;
				cols = Math.max(1, [...els.values()].filter((el) => el.offsetTop === first.offsetTop).length);
			}
			const i = moveIndex(order.indexOf(st.cursor), k, order.length, cols);
			if (i < 0) return;
			const p = order[i];
			if (e.shiftKey) select(rangeSelect(order, st.anchor ?? p, p), { cursor: p });
			else select([p], { cursor: p, anchor: p });
			els.get(p)?.scrollIntoView({ block: 'nearest' });
			return;
		}
		if (k.length === 1 && !mod && !e.altKey) {
			const q = k.toLowerCase();
			const order = st.shown;
			const start = Math.max(0, order.findIndex((n) => n.path === st.cursor) + 1);
			const hit = [...order.slice(start), ...order.slice(0, start)].find((n) => n.name.toLowerCase().startsWith(q));
			if (hit) {
				select([hit.path], { cursor: hit.path, anchor: hit.path });
				els.get(hit.path)?.scrollIntoView({ block: 'nearest' });
			}
		}
	});

	// Drag and drop: items between folders, and real files from the OS
	root.addEventListener('dragstart', (e) => {
		const item = e.target.closest?.('.fx-item');
		if (!item) return;
		const p = item.dataset.path;
		if (!st.sel.has(p)) select([p], { anchor: p });
		const paths = [...st.sel];
		e.dataTransfer.setData('application/x-tws-paths', JSON.stringify(paths));
		e.dataTransfer.setData('text/plain', paths.map(fs.nameOf).join('\n'));
		e.dataTransfer.effectAllowed = 'copyMove';
	});
	const dropTargetOf = (e) => {
		const side = e.target.closest?.('[data-drop]');
		if (side) return side.dataset.drop;
		const item = e.target.closest?.('.fx-item[data-type="dir"]');
		if (item && !inTrash()) return item.dataset.path;
		return null;
	};
	const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
	const hasInternal = (e) => [...(e.dataTransfer?.types || [])].includes('application/x-tws-paths');
	let hot = null;
	const setHot = (el) => {
		if (hot === el) return;
		hot?.classList.remove('drop-hot');
		hot = el;
		hot?.classList.add('drop-hot');
	};
	root.addEventListener('dragover', (e) => {
		const ext = hasFiles(e);
		if (!ext && !hasInternal(e)) return;
		const target = dropTargetOf(e);
		const zone = e.target.closest?.('[data-drop], .fx-item[data-type="dir"]');
		if (!target && !canWrite() && !ext) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = ext ? 'copy' : e.ctrlKey ? 'copy' : 'move';
		setHot(zone && target ? zone : null);
		if (ext) {
			dropMsg.hidden = false;
			dropMsg.textContent = `Drop to upload to ${locationName(target || uploadDir())}`;
		}
	});
	root.addEventListener('dragleave', (e) => {
		if (!root.contains(e.relatedTarget)) {
			setHot(null);
			dropMsg.hidden = true;
		}
	});
	root.addEventListener('drop', async (e) => {
		const ext = hasFiles(e);
		const internal = hasInternal(e);
		if (!ext && !internal) return;
		e.preventDefault();
		const target = dropTargetOf(e);
		setHot(null);
		dropMsg.hidden = true;
		if (internal) {
			let paths = [];
			try {
				paths = JSON.parse(e.dataTransfer.getData('application/x-tws-paths'));
			} catch {
				return;
			}
			const dest = target || (canWrite() ? st.loc : null);
			if (dest) await moveInto(paths, dest, e.ctrlKey && dest !== fs.TRASH);
			return;
		}
		const files = [];
		let skipped = 0;
		for (const it of e.dataTransfer.items || []) {
			if (it.kind !== 'file') continue;
			if (it.webkitGetAsEntry?.()?.isDirectory) skipped++;
			else if (it.getAsFile()) files.push(it.getAsFile());
		}
		if (skipped) ctx.toast('Folders can\'t be dropped yet. Drop the files inside them instead.');
		const dest = target && target !== fs.TRASH ? target : uploadDir();
		await uploadFiles(files.length || skipped ? files : [...e.dataTransfer.files], dest);
	});

	/* --- live refresh --- */
	let refreshTimer = 0;
	const unsub = fs.subscribe(() => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			if (dead) return;
			refreshSide();
			if (st.renaming) st.dirty = true;
			else load({ keepSel: true });
		}, 80);
	});
	async function refreshSide() {
		try {
			const [u, trash] = await Promise.all([fs.usage(), fs.list(fs.TRASH)]);
			const est = (await navigator.storage?.estimate?.().catch(() => null)) || {};
			if (dead) return;
			st.usage = { ...u, used: est.usage || 0, quota: est.quota || 0 };
			st.trashCount = trash.length;
			renderSide();
			const pc = scroll.querySelector('.fx-pc > div');
			if (pc) pc.innerHTML = `<b>Local storage</b>${storageHtml(true)}`;
		} catch {
			/* the sidebar simply keeps its previous numbers */
		}
	}

	/* --- launch args --- */
	async function applyArg(arg) {
		if (!arg || typeof arg !== 'string') return go(HOME);
		const p = parseAddress(arg);
		if (p === HOME || p === '/') return go(p);
		const node = await fs.stat(p);
		if (!node) {
			ctx.toast(`"${arg}" does not exist`);
			return go(HOME);
		}
		if (node.type === 'dir') return go(p);
		return go(fs.parentOf(p), { select: p });
	}
	ctx.onArg((a) => applyArg(a));

	renderAll();
	refreshSide();
	applyArg(ctx.arg).then(() => scroll.focus({ preventScroll: true }));

	return () => {
		dead = true;
		clearTimeout(searchTimer);
		clearTimeout(refreshTimer);
		unsub();
		closeMenu();
		io?.disconnect();
		for (const t of thumbs.values()) URL.revokeObjectURL(t.url);
		thumbs.clear();
	};
}
