// Multi-format export layered onto the forge result viewer.
//
// The download button always offers the source GLB instantly. This module adds
// a format menu beside it that converts the live model in the browser with
// three.js exporters — no worker, no queue, no upload:
//   • OBJ  — universal geometry for DCC tools (geometry + UVs, no materials)
//   • STL  — solid geometry for 3D printing (binary)
//   • PLY  — vertex data for scanning/point-cloud tools (binary)
//   • USDZ — textured AR asset for iPhone / Vision Pro
//
// three.js and the exporters load lazily on first use; the parsed scene is
// cached per model URL so switching formats doesn't re-download the GLB.
// Like the stylize/optimize panels, this module injects its own markup and
// styles and only needs the result panel's download anchor to exist.

import { createLogger } from '../shared/log.js';
import { creationIdFromGlbUrl, mountSlicerMenuItems } from '../slicer-handoff.js';

const log = createLogger('forge-export');

const download = document.getElementById('download');
const resultPanel = document.getElementById('state-result');

if (download && resultPanel) {
	const FORMATS = [
		{
			id: 'glb',
			label: 'GLB',
			blurb: 'Source format — textures embedded. Works everywhere glTF does.',
			ext: 'glb',
		},
		{
			id: 'obj',
			label: 'OBJ',
			blurb: 'Universal geometry + UVs for Blender, Maya, C4D. Materials not included.',
			ext: 'obj',
			mime: 'text/plain',
		},
		{
			id: 'stl',
			label: 'STL',
			blurb: 'Solid geometry for 3D printing and CAD. Binary, compact.',
			ext: 'stl',
			mime: 'model/stl',
		},
		{
			id: 'ply',
			label: 'PLY',
			blurb: 'Vertex-level data for scanning and point-cloud tools. Binary.',
			ext: 'ply',
			mime: 'application/octet-stream',
		},
		{
			id: 'usdz',
			label: 'USDZ',
			blurb: 'Textured AR asset — opens directly on iPhone and Vision Pro.',
			ext: 'usdz',
			mime: 'model/vnd.usdz+zip',
		},
	];

	// ---- markup ------------------------------------------------------------

	const style = document.createElement('style');
	style.textContent = `
		.export-split { position: relative; display: inline-flex; align-items: stretch; }
		.export-caret {
			display: inline-flex; align-items: center; justify-content: center;
			margin-left: 1px; padding: 0 0.55rem;
			border: 1px solid var(--border, rgba(255,255,255,0.14));
			border-radius: 0 8px 8px 0; background: var(--surface-2, rgba(255,255,255,0.05));
			color: inherit; cursor: pointer;
			transition: background 0.15s ease, border-color 0.15s ease;
		}
		.export-caret:hover, .export-caret:focus-visible { background: var(--surface-3, rgba(255,255,255,0.1)); }
		.export-caret:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.export-caret svg { width: 12px; height: 12px; transition: transform 0.18s ease; }
		.export-caret[aria-expanded="true"] svg { transform: rotate(180deg); }
		.export-split > a { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; }
		.export-menu {
			position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 40;
			min-width: 290px; padding: 0.35rem;
			border: 1px solid var(--border, rgba(255,255,255,0.14));
			border-radius: 12px;
			background: var(--surface-1, #16161d);
			box-shadow: 0 16px 40px rgba(0,0,0,0.45);
			opacity: 0; transform: translateY(6px); pointer-events: none;
			transition: opacity 0.16s ease, transform 0.16s ease;
		}
		.export-menu.is-open { opacity: 1; transform: translateY(0); pointer-events: auto; }
		.export-item {
			display: flex; align-items: baseline; gap: 0.65rem; width: 100%;
			padding: 0.55rem 0.7rem; border: 0; border-radius: 8px;
			background: transparent; color: inherit; text-align: left; cursor: pointer;
			transition: background 0.12s ease;
		}
		.export-item:hover, .export-item:focus-visible { background: var(--surface-3, rgba(255,255,255,0.08)); }
		.export-item:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: -2px; }
		.export-item[aria-disabled="true"] { opacity: 0.55; cursor: progress; }
		.export-item .fmt { font-weight: 600; font-size: 0.86rem; min-width: 3.2em; letter-spacing: 0.02em; }
		.export-item .blurb { flex: 1; font-size: 0.78rem; opacity: 0.72; line-height: 1.35; }
		.export-item .status { font-size: 0.74rem; min-width: 5.5em; text-align: right; opacity: 0.85; }
		.export-item .status.is-error { color: var(--danger, #ff6b6b); }
		.export-spinner {
			display: inline-block; width: 0.85em; height: 0.85em; vertical-align: -0.1em;
			border: 2px solid currentColor; border-right-color: transparent;
			border-radius: 50%; animation: export-spin 0.7s linear infinite;
		}
		@keyframes export-spin { to { transform: rotate(360deg); } }
		@media (prefers-reduced-motion: reduce) {
			.export-menu { transition: none; }
			.export-caret svg { transition: none; }
			.export-spinner { animation-duration: 1.5s; }
		}
	`;
	document.head.appendChild(style);

	const split = document.createElement('div');
	split.className = 'export-split';
	download.parentNode.insertBefore(split, download);
	split.appendChild(download);

	const caret = document.createElement('button');
	caret.type = 'button';
	caret.className = 'export-caret';
	caret.setAttribute('aria-haspopup', 'menu');
	caret.setAttribute('aria-expanded', 'false');
	caret.setAttribute('aria-label', 'More download formats');
	caret.title = 'More formats, or open in a 3D-printing slicer';
	caret.innerHTML =
		'<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	split.appendChild(caret);

	const menu = document.createElement('div');
	menu.className = 'export-menu';
	menu.setAttribute('role', 'menu');
	menu.setAttribute('aria-label', 'Download format');
	split.appendChild(menu);

	const itemStatus = new Map();
	for (const f of FORMATS) {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'export-item';
		item.setAttribute('role', 'menuitem');
		item.dataset.format = f.id;
		item.innerHTML = `
			<span class="fmt">.${f.ext}</span>
			<span class="blurb">${f.blurb}</span>
			<span class="status" aria-live="polite"></span>
		`;
		item.addEventListener('click', () => onPick(f, item));
		menu.appendChild(item);
		itemStatus.set(f.id, item.querySelector('.status'));
	}

	// Slicer handoff rows (OrcaSlicer, Bambu Studio). They download the stored
	// creation from /api/slicer/<id>/model.stl, so they appear only for a model
	// that has a creation id, and say so when the viewer shows an unsaved edit.
	const slicerItems = mountSlicerMenuItems(menu, {
		isLocalEdit: () => (download.getAttribute('href') || '').startsWith('blob:'),
	});

	// ---- menu behavior -------------------------------------------------------

	function setOpen(open) {
		menu.classList.toggle('is-open', open);
		caret.setAttribute('aria-expanded', String(open));
		if (open) menu.querySelector('.export-item')?.focus();
	}
	const isOpen = () => menu.classList.contains('is-open');

	caret.addEventListener('click', () => setOpen(!isOpen()));
	document.addEventListener('click', (e) => {
		if (isOpen() && !split.contains(e.target)) setOpen(false);
	});
	split.addEventListener('keydown', (e) => {
		if (!isOpen()) return;
		const items = [...menu.querySelectorAll('.export-item:not([hidden])')];
		const idx = items.indexOf(document.activeElement);
		if (e.key === 'Escape') {
			setOpen(false);
			caret.focus();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			items[(idx + 1) % items.length]?.focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			items[(idx - 1 + items.length) % items.length]?.focus();
		}
	});

	// ---- conversion ----------------------------------------------------------

	let three = null; // { THREE, GLTFLoader, exporters... } cached after first load
	async function loadThree() {
		if (three) return three;
		const [THREE, gltf, draco, obj, stl, ply, usdz] = await Promise.all([
			import('three'),
			import('three/addons/loaders/GLTFLoader.js'),
			import('three/addons/loaders/DRACOLoader.js'),
			import('three/addons/exporters/OBJExporter.js'),
			import('three/addons/exporters/STLExporter.js'),
			import('three/addons/exporters/PLYExporter.js'),
			import('three/addons/exporters/USDZExporter.js'),
		]);
		three = {
			THREE,
			GLTFLoader: gltf.GLTFLoader,
			DRACOLoader: draco.DRACOLoader,
			OBJExporter: obj.OBJExporter,
			STLExporter: stl.STLExporter,
			PLYExporter: ply.PLYExporter,
			USDZExporter: usdz.USDZExporter,
		};
		return three;
	}

	// Parsed-scene cache: one fetch+parse per model URL no matter how many
	// formats the user exports.
	let sceneCache = { url: null, scene: null };
	async function loadScene(url) {
		if (sceneCache.url === url && sceneCache.scene) return sceneCache.scene;
		const t = await loadThree();
		const loader = new t.GLTFLoader();
		const dracoLoader = new t.DRACOLoader();
		dracoLoader.setDecoderPath('/three/draco/gltf/');
		loader.setDRACOLoader(dracoLoader);
		const gltf = await loader.loadAsync(url);
		sceneCache = { url, scene: gltf.scene };
		return gltf.scene;
	}

	function baseName() {
		const attr = download.getAttribute('download') || 'forge.glb';
		return attr.replace(/\.glb$/i, '') || 'forge';
	}

	function saveBlob(data, mime, filename) {
		const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
	}

	async function convert(format, scene) {
		const t = await loadThree();
		switch (format.id) {
			case 'obj':
				return new t.OBJExporter().parse(scene);
			case 'stl':
				return new t.STLExporter().parse(scene, { binary: true });
			case 'ply':
				return await new Promise((resolve, reject) => {
					try {
						new t.PLYExporter().parse(scene, resolve, { binary: true });
					} catch (err) {
						reject(err);
					}
				});
			case 'usdz':
				return await new t.USDZExporter().parseAsync(scene);
			default:
				throw new Error(`unknown export format: ${format.id}`);
		}
	}

	const busy = new Set();
	async function onPick(format, item) {
		if (format.id === 'glb') {
			// The source GLB needs no conversion — hand off to the primary anchor.
			setOpen(false);
			download.click();
			return;
		}
		if (busy.has(format.id)) return;
		const url = download.getAttribute('href');
		if (!url) return;
		const status = itemStatus.get(format.id);
		busy.add(format.id);
		item.setAttribute('aria-disabled', 'true');
		status.classList.remove('is-error');
		status.innerHTML = '<span class="export-spinner" aria-hidden="true"></span> converting';
		try {
			const scene = await loadScene(url);
			const data = await convert(format, scene);
			saveBlob(data, format.mime, `${baseName()}.${format.ext}`);
			status.textContent = 'saved ✓';
			setTimeout(() => {
				if (status.textContent === 'saved ✓') status.textContent = '';
			}, 4000);
		} catch (err) {
			log.error(format.id, err);
			status.textContent = 'failed — retry';
			status.classList.add('is-error');
		} finally {
			busy.delete(format.id);
			item.removeAttribute('aria-disabled');
		}
	}

	// A new generation invalidates the parsed-scene cache (the href changes, but
	// clearing eagerly also frees the old scene graph for GC).
	document.addEventListener('forge:model-ready', (e) => {
		sceneCache = { url: null, scene: null };
		slicerItems.setCreation(e.detail?.creationId || creationIdFromGlbUrl(e.detail?.glbUrl));
		for (const status of itemStatus.values()) {
			status.textContent = '';
			status.classList.remove('is-error');
		}
	});
}
