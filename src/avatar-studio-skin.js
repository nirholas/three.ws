// Avatar Studio "Skin" tab: texture layers (complexion, makeup, tattoos, decals)
// over the Parametric base. The preview runs the SAME compositor the server bakes
// with (src/avatar-layers.js), so what the editor shows is what the saved GLB is.
//
// The composite is painted over the current skin colour and installed as the
// skin material's base-colour map; the material colour goes white while layers
// are active so the texture carries the whole colour. With no layers the map is
// removed and the caller's skin colour logic is the only thing in play.

import * as THREE from 'three';
import {
	compositeLayers,
	layerRegionError,
	LAYER_BLENDS,
	LAYER_REGIONS,
	LAYER_SCALE_MAX,
	LAYER_SCALE_MIN,
	MAX_LAYERS,
	parseLayerSource,
} from './avatar-layers.js';

const CATALOG_URL = '/avatars/layers/index.json';
const MASK_URL = '/avatars/parametric-base.regions.png';
const PREVIEW_SIZE = 1024;
const SKIN_MATERIALS = new Set(['Wolf3D_Skin', 'Wolf3D_Body', 'Parametric_Body']);
const KIND_LABEL = { complexion: 'Complexion', makeup: 'Makeup', tattoo: 'Tattoos', decal: 'Decals' };
const REGION_LABEL = {
	all: 'Whole body', scalp: 'Head and face', upperArms: 'Upper arms', forearms: 'Forearms',
	hands: 'Hands', torso: 'Torso', thighs: 'Thighs', calves: 'Calves', feet: 'Feet',
};
const BLEND_LABEL = { normal: 'Normal', multiply: 'Multiply', overlay: 'Overlay' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function decodeImageData(blob) {
	const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	const canvas = document.createElement('canvas');
	canvas.width = bmp.width;
	canvas.height = bmp.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(bmp, 0, 0);
	bmp.close?.();
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	return { width: img.width, height: img.height, data: img.data };
}

async function fetchImageData(url, init) {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return decodeImageData(await res.blob());
}

function hexToRgb(hex) {
	const n = parseInt(String(hex).replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * @param {object} deps
 * @param {() => import('three').Object3D | null} deps.getRoot
 * @param {() => object} deps.getWorking   the working appearance (mutated in place)
 * @param {() => string | null} deps.getSkinHex  the chosen skin colour, or null for the material's authored colour
 * @param {() => void} deps.onChange       called after every user edit (history, dirty, draft)
 * @param {(kind:'ok'|'err'|'spin', msg:string) => void} deps.setStatus
 */
export function createSkinLayers({ getRoot, getWorking, getSkinHex, onChange, setStatus }) {
	let catalog = null;
	let catalogError = null;
	let mask = null;
	const sprites = new Map(); // source -> decoded RGBA
	const failed = new Set();
	let texture = null;
	let raf = 0;
	let loading = null;
	let panelEl = null;

	function skinMaterials() {
		const out = [];
		getRoot()?.traverse((o) => {
			if (!o.isMesh) return;
			for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
				if (m && SKIN_MATERIALS.has(m.name) && !out.includes(m)) out.push(m);
			}
		});
		return out;
	}

	/** Layers paint the Parametric body's UVs only; other bases have no region mask. */
	function supported() {
		return skinMaterials().some((m) => m.name === 'Parametric_Body');
	}

	async function loadSource(source) {
		if (sprites.has(source) || failed.has(source)) return;
		const parsed = parseLayerSource(source);
		if (!parsed) { failed.add(source); return; }
		try {
			if (parsed.type === 'catalog') {
				const entry = catalog?.layers.find((l) => l.id === parsed.id);
				if (!entry) throw new Error('retired');
				sprites.set(source, await fetchImageData(`/avatars/layers/${entry.file}`));
			} else {
				sprites.set(source, await fetchImageData(`/api/avatars/layer-upload?id=${encodeURIComponent(parsed.id)}`, { credentials: 'include' }));
			}
		} catch {
			failed.add(source);
		}
	}

	/** Load the catalog, the region mask and every sprite the working stack needs. */
	function ensureLoaded() {
		loading ||= (async () => {
			try {
				const res = await fetch(CATALOG_URL);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				catalog = await res.json();
				mask = await fetchImageData(MASK_URL).then((img) => {
					const bytes = new Uint8Array(img.width * img.height);
					for (let i = 0; i < bytes.length; i++) bytes[i] = img.data[i * 4];
					return { width: img.width, height: img.height, data: bytes };
				});
			} catch (err) {
				catalogError = err.message || 'network error';
			}
		})();
		return loading.then(async () => {
			await Promise.all((getWorking().layers || []).map((l) => loadSource(l.source)));
		});
	}

	function clearTexture(mats, skinOverride) {
		for (const m of mats) {
			if (!m.userData.layerTexture) continue;
			m.map = null;
			m.color.set(skinOverride || getSkinHex() || m.userData.origColor || '#ffffff');
			delete m.userData.layerTexture;
			m.needsUpdate = true;
		}
	}

	/** Re-run the compositor and install (or remove) the skin texture. Cheap enough per frame of a drag. */
	function apply(skinOverride) {
		const mats = skinMaterials();
		const layers = (getWorking().layers || []).filter((l) => sprites.has(l.source));
		if (!mats.length || !layers.length || !mask || !supported()) {
			clearTexture(mats, skinOverride);
			return;
		}
		const hex = getSkinHex();
		const orig = mats[0].userData.origColor ?? `#${mats[0].color.getHexString()}`;
		const base = hexToRgb(skinOverride || hex || orig);
		const rgba = compositeLayers({ size: PREVIEW_SIZE, base, layers, sources: sprites, mask });
		let canvas = texture?.image;
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.width = canvas.height = PREVIEW_SIZE;
		}
		canvas.getContext('2d').putImageData(new ImageData(rgba, PREVIEW_SIZE, PREVIEW_SIZE), 0, 0);
		if (!texture) {
			texture = new THREE.CanvasTexture(canvas);
			texture.flipY = false;
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.anisotropy = 4;
		}
		texture.needsUpdate = true;
		for (const m of mats) {
			if (m.userData.origColor === undefined) m.userData.origColor = `#${m.color.getHexString()}`;
			m.map = texture;
			m.color.set('#ffffff');
			m.userData.layerTexture = true;
			m.needsUpdate = true;
		}
	}

	function scheduleApply() {
		if (raf) return;
		raf = requestAnimationFrame(() => { raf = 0; apply(); });
	}

	async function restore() {
		await ensureLoaded();
		apply();
		if (panelEl?.isConnected) render(panelEl);
	}

	// ── Editing ─────────────────────────────────────────────────────────
	const layersOf = () => (getWorking().layers ||= []);
	const find = (id) => layersOf().find((l) => l.id === id);

	function nextId(base) {
		const used = new Set(layersOf().map((l) => l.id));
		const stem = base.slice(0, 26);
		for (let n = 1; n < 100; n++) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
		return `${stem}-${Date.now() % 100000}`;
	}

	async function addCatalog(entry) {
		if (layersOf().length >= MAX_LAYERS) return setStatus('err', `A skin can carry ${MAX_LAYERS} layers. Remove one first.`);
		const source = `catalog:${entry.id}`;
		await loadSource(source);
		if (failed.has(source)) return setStatus('err', `Could not load ${entry.label}. Check your connection and try again.`);
		const d = entry.defaults;
		layersOf().push({
			id: nextId(entry.id), kind: entry.kind, source, region: d.region, blend: d.blend,
			opacity: d.opacity, uv: { offset: [...d.uv.offset], scale: d.uv.scale, rotation: d.uv.rotation },
			...(d.tint ? { tint: d.tint } : {}),
		});
		commit();
	}

	async function addUpload(file) {
		if (layersOf().length >= MAX_LAYERS) return setStatus('err', `A skin can carry ${MAX_LAYERS} layers. Remove one first.`);
		if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setStatus('err', 'Pick a PNG, JPEG or WebP image.');
		if (file.size > 2_000_000) return setStatus('err', 'That image is over 2 MB. Pick a smaller one.');
		setStatus('spin', 'Uploading your image…');
		try {
			const b64 = await new Promise((resolve, reject) => {
				const fr = new FileReader();
				fr.onload = () => resolve(String(fr.result));
				fr.onerror = () => reject(fr.error);
				fr.readAsDataURL(file);
			});
			const res = await fetch('/api/avatars/layer-upload', {
				method: 'POST', credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ png_base64: b64 }),
			});
			const body = await res.json().catch(() => ({}));
			if (res.status === 401) return setStatus('err', 'Sign in to add your own image.');
			if (!res.ok) return setStatus('err', body?.error_description || 'The upload failed. Try another image.');
			const source = body.data.source;
			failed.delete(source);
			await loadSource(source);
			if (failed.has(source)) return setStatus('err', 'The image uploaded but could not be read back. Try again.');
			layersOf().push({
				id: nextId('mine'), kind: 'decal', source, region: 'torso', blend: 'normal', opacity: 1,
				uv: { offset: [0.45, 0.17], scale: 0.12, rotation: 0 },
			});
			commit();
			setStatus('ok', 'Added your image as a decal. Move it with the sliders.');
		} catch {
			setStatus('err', 'The upload could not reach the server. Check your connection and try again.');
		}
	}

	function commit() {
		apply();
		onChange();
		if (panelEl?.isConnected) render(panelEl);
	}

	function patch(id, fn, { rerender = false } = {}) {
		const l = find(id);
		if (!l) return;
		fn(l);
		const err = layerRegionError(l);
		if (err) { setStatus('err', err); return; }
		if (rerender) return commit();
		scheduleApply();
		onChange();
	}

	// ── Panel ───────────────────────────────────────────────────────────
	function slider(id, field, label, min, max, step, value, fmt) {
		return `<label class="ask-row"><span>${label}</span>
			<input type="range" data-id="${esc(id)}" data-field="${field}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}">
			<output>${fmt(value)}</output></label>`;
	}

	function layerCard(l, i, n) {
		const entry = catalog?.layers.find((c) => `catalog:${c.id}` === l.source);
		const name = entry?.label || 'Your image';
		const missing = failed.has(l.source);
		const regions = LAYER_REGIONS.filter((r) => !layerRegionError({ ...l, region: r }));
		return `<div class="ask-card" data-card="${esc(l.id)}">
			<div class="ask-card-head">
				<strong>${esc(name)}</strong><span class="ask-kind">${esc(KIND_LABEL[l.kind] || l.kind)}</span>
				${missing ? '<span class="ask-warn">Image missing: it will be skipped</span>' : ''}
				<span class="ask-actions">
					<button type="button" data-act="up" data-id="${esc(l.id)}" aria-label="Move ${esc(name)} down the stack" ${i === 0 ? 'disabled' : ''}>↓</button>
					<button type="button" data-act="down" data-id="${esc(l.id)}" aria-label="Move ${esc(name)} up the stack" ${i === n - 1 ? 'disabled' : ''}>↑</button>
					<button type="button" data-act="remove" data-id="${esc(l.id)}" aria-label="Remove ${esc(name)}">×</button>
				</span>
			</div>
			${slider(l.id, 'opacity', 'Strength', 0, 1, 0.01, l.opacity, (v) => `${Math.round(v * 100)}%`)}
			${slider(l.id, 'x', 'Across', 0, 1, 0.001, l.uv.offset[0], (v) => Number(v).toFixed(2))}
			${slider(l.id, 'y', 'Up and down', 0, 1, 0.001, l.uv.offset[1], (v) => Number(v).toFixed(2))}
			${slider(l.id, 'scale', 'Size', LAYER_SCALE_MIN, LAYER_SCALE_MAX, 0.005, l.uv.scale, (v) => `${Math.round(v * 100)}%`)}
			${slider(l.id, 'rotation', 'Rotate', -180, 180, 1, l.uv.rotation, (v) => `${Math.round(v)}°`)}
			<div class="ask-selects">
				<label>Where <select data-id="${esc(l.id)}" data-field="region">${regions.map((r) => `<option value="${r}"${r === l.region ? ' selected' : ''}>${REGION_LABEL[r]}</option>`).join('')}</select></label>
				<label>Blend <select data-id="${esc(l.id)}" data-field="blend">${LAYER_BLENDS.map((b) => `<option value="${b}"${b === l.blend ? ' selected' : ''}>${BLEND_LABEL[b]}</option>`).join('')}</select></label>
				<label>Tint <input type="color" data-id="${esc(l.id)}" data-field="tint" value="${esc(l.tint || '#ffffff')}" aria-label="Tint"></label>
			</div>
		</div>`;
	}

	function ensureCss() {
		if (document.getElementById('as-skin-css')) return;
		const s = document.createElement('style');
		s.id = 'as-skin-css';
		s.textContent = `
			.ask-note { font-size: 12px; color: var(--text-3, #71717a); margin: 0 0 12px; }
			.ask-error { border: 1px solid #7a1f2b; border-radius: 10px; padding: 12px; font-size: 13px; }
			.ask-error button, .ask-add, .ask-upload { font-family: inherit; }
			.ask-group { margin: 0 0 16px; }
			.ask-group h3 { font-size: 12px; margin: 0 0 8px; color: var(--text-2, #a1a1aa); font-weight: 600; letter-spacing: .02em; }
			.ask-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
			.ask-add { display: flex; flex-direction: column; align-items: center; gap: 4px; background: var(--panel, #111); border: 1px solid var(--border, #1f1f1f); border-radius: 10px; padding: 6px; cursor: pointer; color: var(--text-2, #a1a1aa); font-size: 11px; transition: border-color .15s, transform .12s; }
			.ask-add img { width: 100%; aspect-ratio: 1/1; object-fit: contain; border-radius: 6px; background: #8a6a55; }
			.ask-add:hover { border-color: var(--text-3, #71717a); transform: translateY(-1px); }
			.ask-add:active { transform: none; }
			.ask-add:focus-visible, .ask-upload:focus-within, .ask-card button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--accent, #fff); }
			.ask-add:disabled { opacity: .4; cursor: not-allowed; transform: none; }
			.ask-upload { display: inline-flex; gap: 8px; align-items: center; border: 1px dashed var(--border, #1f1f1f); border-radius: 10px; padding: 10px 12px; cursor: pointer; font-size: 12px; color: var(--text-2, #a1a1aa); }
			.ask-upload:hover { border-color: var(--text-3, #71717a); }
			.ask-upload input { position: absolute; width: 1px; height: 1px; opacity: 0; }
			.ask-card { border: 1px solid var(--border, #1f1f1f); border-radius: 12px; padding: 10px 12px; margin: 0 0 10px; background: var(--panel, #111); }
			.ask-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; }
			.ask-kind { font-size: 11px; color: var(--text-3, #71717a); }
			.ask-warn { font-size: 11px; color: #e2604a; }
			.ask-actions { margin-left: auto; display: flex; gap: 4px; }
			.ask-actions button { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border, #1f1f1f); background: transparent; color: inherit; cursor: pointer; }
			.ask-actions button:hover:not(:disabled) { border-color: var(--text-3, #71717a); }
			.ask-actions button:disabled { opacity: .35; cursor: not-allowed; }
			.ask-row { display: grid; grid-template-columns: 78px 1fr 44px; gap: 8px; align-items: center; font-size: 12px; color: var(--text-2, #a1a1aa); margin: 4px 0; }
			.ask-row output { text-align: right; font-variant-numeric: tabular-nums; }
			.ask-selects { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 12px; color: var(--text-2, #a1a1aa); }
			.ask-selects select { font: inherit; background: transparent; color: inherit; border: 1px solid var(--border, #1f1f1f); border-radius: 6px; padding: 3px 4px; }
			.ask-empty { border: 1px dashed var(--border, #1f1f1f); border-radius: 12px; padding: 16px; text-align: center; font-size: 13px; color: var(--text-3, #71717a); margin-bottom: 14px; }
		`;
		document.head.appendChild(s);
	}

	function render(panel) {
		panelEl = panel;
		ensureCss();
		if (!getRoot()) {
			panel.innerHTML = '<div class="as-empty">Waiting for avatar to load…</div>';
			return;
		}
		if (!supported()) {
			panel.innerHTML = '<p class="ask-note">Skin layers paint the Parametric body. Switch the base to Parametric to add makeup, tattoos and decals.</p>';
			return;
		}
		if (!catalog && !catalogError) {
			panel.innerHTML = '<div class="as-empty">Loading the skin catalog…</div>';
			ensureLoaded().then(() => { apply(); if (panelEl?.isConnected) render(panelEl); });
			return;
		}
		if (catalogError) {
			panel.innerHTML = `<div class="ask-error" role="alert">The skin catalog could not load (${esc(catalogError)}). <button type="button" data-act="retry">Retry</button></div>`;
			panel.querySelector('[data-act="retry"]').addEventListener('click', () => {
				catalogError = null; loading = null; render(panel); });
			return;
		}
		const layers = layersOf();
		const full = layers.length >= MAX_LAYERS;
		const groups = Object.keys(KIND_LABEL).map((kind) => {
			const items = catalog.layers.filter((c) => c.kind === kind);
			if (!items.length) return '';
			return `<section class="ask-group"><h3>${KIND_LABEL[kind]}</h3><div class="ask-grid">${items.map((c) => `
				<button type="button" class="ask-add" data-add="${esc(c.id)}" ${full ? 'disabled' : ''} aria-label="Add ${esc(c.label)}">
					<img src="/avatars/layers/${esc(c.file)}" alt="" loading="lazy" width="64" height="64"><span>${esc(c.label)}</span>
				</button>`).join('')}</div></section>`;
		}).join('');
		panel.innerHTML = `
			<p class="ask-note">Layer makeup, tattoos and decals over the skin. Up to ${MAX_LAYERS}; they bake into your saved avatar.</p>
			${layers.length ? '<section class="ask-group"><h3>On your avatar (top layer first)</h3>' + [...layers].reverse().map((l) => layerCard(l, layers.indexOf(l), layers.length)).join('') + '</section>' : '<div class="ask-empty">No layers yet. Pick something below to put it on your avatar.</div>'}
			${groups}
			<section class="ask-group"><h3>Your own image</h3>
				<label class="ask-upload">Upload a PNG, JPEG or WebP (up to 2 MB)<input type="file" accept="image/png,image/jpeg,image/webp" data-upload></label>
			</section>`;
		bind(panel);
	}

	function bind(panel) {
		panel.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
			const entry = catalog.layers.find((c) => c.id === b.dataset.add);
			if (entry) addCatalog(entry);
		}));
		panel.querySelector('[data-upload]')?.addEventListener('change', (e) => {
			const f = e.target.files?.[0];
			e.target.value = '';
			if (f) addUpload(f);
		});
		panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
			const layers = layersOf();
			const i = layers.findIndex((l) => l.id === b.dataset.id);
			if (i < 0) return;
			if (b.dataset.act === 'remove') layers.splice(i, 1);
			else {
				const j = b.dataset.act === 'up' ? i - 1 : i + 1;
				if (j < 0 || j >= layers.length) return;
				[layers[i], layers[j]] = [layers[j], layers[i]];
			}
			commit();
		}));
		panel.querySelectorAll('input[data-field], select[data-field]').forEach((el) => {
			const field = el.dataset.field;
			const update = () => {
				const v = el.value;
				patch(el.dataset.id, (l) => {
					if (field === 'opacity') l.opacity = Number(v);
					else if (field === 'x') l.uv.offset[0] = Number(v);
					else if (field === 'y') l.uv.offset[1] = Number(v);
					else if (field === 'scale') l.uv.scale = Number(v);
					else if (field === 'rotation') l.uv.rotation = Number(v);
					else if (field === 'region') l.region = v;
					else if (field === 'blend') l.blend = v;
					else if (field === 'tint') { if (v.toLowerCase() === '#ffffff') delete l.tint; else l.tint = v; }
				});
				const out = el.parentElement?.querySelector('output');
				if (out) out.textContent = field === 'opacity' || field === 'scale' ? `${Math.round(v * 100)}%` : field === 'rotation' ? `${Math.round(v)}°` : Number(v).toFixed(2);
			};
			el.addEventListener('input', update);
		});
	}

	return { render, apply, restore, ensureLoaded };
}
