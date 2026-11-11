// "Minecraft: Bedrock" export for Forge models.
//
// A row in the Forge export menu opens a panel that voxelizes the current
// model on the server (/api/minecraft-export), draws the result as instanced
// cubes in a small three.js preview, and downloads the same build as a
// .mcpack behavior pack. Every control change re-requests the preview; the
// server caches the parsed mesh, so only the voxelize step repeats.
//
// Not an official Minecraft product. Not approved by or associated with Mojang
// or Microsoft. "Minecraft" is used only to say which game the file is for.

const API = '/api/minecraft-export';
const DEBOUNCE_MS = 320;
const MIN_HEIGHT = 16;
const MAX_HEIGHT = 128;
const NOTICE = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';

const COLOR_SOURCE_COPY = {
	texture: 'Colors sampled from the model texture at each block.',
	vertex: 'Colors taken from the model vertex colors.',
	material: 'This model has no texture, so blocks use its flat material colors.',
};

function esc(s) {
	return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const fmtInt = (n) => Number(n || 0).toLocaleString();
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

function injectStyles() {
	if (document.getElementById('mcx-styles')) return;
	const style = document.createElement('style');
	style.id = 'mcx-styles';
	style.textContent = `
		.mcx-overlay {
			position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
			padding: 1rem; background: rgba(0,0,0,0.62); animation: mcx-fade 0.16s ease;
		}
		@keyframes mcx-fade { from { opacity: 0; } to { opacity: 1; } }
		.mcx-modal {
			position: relative; width: 100%; max-width: 980px; max-height: 92vh; overflow: auto;
			background: var(--surface-0, #0e0e14); color: var(--ink, #eee);
			border: 1px solid var(--stroke, rgba(255,255,255,0.14)); border-radius: var(--radius-lg, 12px);
			padding: 1.1rem; animation: mcx-rise 0.18s ease;
		}
		@keyframes mcx-rise { from { transform: translateY(6px); opacity: 0.6; } to { transform: none; opacity: 1; } }
		.mcx-modal h2 { margin: 0 2rem 0.2rem 0; font-size: var(--text-md, 1rem); }
		.mcx-sub { margin: 0 0 0.9rem; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim, #999); }
		.mcx-close {
			position: absolute; top: 0.7rem; right: 0.7rem; padding: 0.3rem 0.45rem; line-height: 1; cursor: pointer;
			background: none; border: 1px solid transparent; border-radius: var(--radius-sm, 6px); color: var(--ink-dim, #999); font-size: 1.05rem;
			transition: color 0.15s ease, background 0.15s ease;
		}
		.mcx-close:hover { color: var(--ink, #eee); background: var(--surface-2, rgba(255,255,255,0.06)); }
		.mcx-close:active { transform: translateY(1px); }
		.mcx-close:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mcx-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 1rem; }
		@media (max-width: 760px) { .mcx-grid { grid-template-columns: 1fr; } }
		.mcx-stage {
			position: relative; aspect-ratio: 4 / 3; border-radius: var(--radius-md, 8px); overflow: hidden;
			background: radial-gradient(ellipse at 50% 30%, #1d2230 0%, #0b0d13 75%);
			border: 1px solid var(--stroke, rgba(255,255,255,0.12));
		}
		.mcx-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
		.mcx-stage canvas:active { cursor: grabbing; }
		.mcx-stage-msg {
			position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
			gap: 0.5rem; padding: 1.2rem; text-align: center; font-size: var(--text-sm, 0.85rem); color: var(--ink-dim, #aaa);
		}
		.mcx-stage-msg[hidden] { display: none; }
		.mcx-skel {
			position: absolute; inset: 0; pointer-events: none;
			background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%);
			background-size: 220% 100%; animation: mcx-shimmer 1.2s linear infinite;
		}
		.mcx-skel[hidden] { display: none; }
		@keyframes mcx-shimmer { from { background-position: 120% 0; } to { background-position: -120% 0; } }
		.mcx-badge {
			position: absolute; left: 0.6rem; bottom: 0.6rem; padding: 0.25rem 0.5rem; border-radius: 999px;
			background: rgba(0,0,0,0.55); font-size: var(--text-xs, 0.72rem); color: #ddd; pointer-events: none;
		}
		.mcx-badge[hidden] { display: none; }
		.mcx-side { display: flex; flex-direction: column; gap: 0.8rem; min-width: 0; }
		.mcx-field { display: flex; flex-direction: column; gap: 0.35rem; }
		.mcx-label { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim, #aaa); }
		.mcx-label output { color: var(--ink, #eee); font-weight: 600; font-variant-numeric: tabular-nums; }
		.mcx-range { width: 100%; accent-color: var(--accent, #7c6cff); cursor: pointer; }
		.mcx-range:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 3px; border-radius: 4px; }
		.mcx-select {
			width: 100%; padding: 0.45rem 0.55rem; font: inherit; font-size: var(--text-sm, 0.85rem); cursor: pointer;
			background: var(--surface-1, #16161d); color: var(--ink, #eee);
			border: 1px solid var(--stroke, rgba(255,255,255,0.16)); border-radius: var(--radius-md, 8px);
			transition: border-color 0.15s ease;
		}
		.mcx-select:hover { border-color: var(--ink-dim, #888); }
		.mcx-select:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mcx-seg { display: inline-flex; border: 1px solid var(--stroke, rgba(255,255,255,0.16)); border-radius: var(--radius-md, 8px); overflow: hidden; }
		.mcx-seg button {
			flex: 1; padding: 0.4rem 0.8rem; font: inherit; font-size: var(--text-sm, 0.82rem); cursor: pointer;
			background: transparent; color: var(--ink-dim, #aaa); border: none; transition: background 0.15s ease, color 0.15s ease;
		}
		.mcx-seg button + button { border-left: 1px solid var(--stroke, rgba(255,255,255,0.16)); }
		.mcx-seg button:hover { color: var(--ink, #eee); background: var(--surface-2, rgba(255,255,255,0.05)); }
		.mcx-seg button:active { background: var(--surface-2, rgba(255,255,255,0.1)); }
		.mcx-seg button[aria-pressed="true"] { background: var(--accent, #7c6cff); color: var(--bg-0, #0a0a0a); font-weight: 600; }
		.mcx-seg button:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: -2px; }
		.mcx-checks { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; }
		.mcx-check { display: inline-flex; align-items: center; gap: 0.4rem; font-size: var(--text-sm, 0.82rem); cursor: pointer; color: var(--ink, #ddd); }
		.mcx-check:hover { color: var(--ink, #fff); }
		.mcx-check input { accent-color: var(--accent, #7c6cff); cursor: pointer; }
		.mcx-check input:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mcx-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; }
		.mcx-stat { padding: 0.5rem 0.55rem; border-radius: var(--radius-md, 8px); background: var(--surface-1, #16161d); border: 1px solid var(--stroke, rgba(255,255,255,0.1)); }
		.mcx-stat b { display: block; font-size: var(--text-md, 0.98rem); font-variant-numeric: tabular-nums; }
		.mcx-stat span { font-size: var(--text-xs, 0.7rem); color: var(--ink-dim, #999); }
		.mcx-stat.is-loading b { color: transparent; background: rgba(255,255,255,0.08); border-radius: 4px; }
		.mcx-note { margin: 0; font-size: var(--text-xs, 0.76rem); color: var(--ink-dim, #999); line-height: 1.5; }
		.mcx-blocks { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.3rem; }
		.mcx-blocks li {
			display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0.45rem; border-radius: 999px;
			background: var(--surface-1, #16161d); font-size: var(--text-xs, 0.72rem); border: 1px solid var(--stroke, rgba(255,255,255,0.08));
		}
		.mcx-swatch { width: 0.8rem; height: 0.8rem; border-radius: 3px; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35); }
		.mcx-btn {
			display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; cursor: pointer;
			background: var(--accent, #7c6cff); color: var(--bg-0, #0a0a0a); border: 1px solid var(--accent, #7c6cff);
			border-radius: var(--radius-md, 8px); padding: 0.55rem 0.95rem; font: inherit; font-size: var(--text-sm, 0.86rem); font-weight: 600;
			transition: opacity 0.15s ease, transform 0.15s ease;
		}
		.mcx-btn:hover { opacity: 0.9; }
		.mcx-btn:active { transform: translateY(1px); }
		.mcx-btn:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mcx-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
		.mcx-btn.is-ghost { background: transparent; color: var(--ink, #eee); border-color: var(--stroke, rgba(255,255,255,0.2)); }
		.mcx-btn.is-ghost:hover { background: var(--surface-2, rgba(255,255,255,0.06)); opacity: 1; }
		.mcx-spinner {
			display: inline-block; width: 0.85em; height: 0.85em; border: 2px solid currentColor; border-right-color: transparent;
			border-radius: 50%; animation: mcx-spin 0.7s linear infinite; flex: none;
		}
		@keyframes mcx-spin { to { transform: rotate(360deg); } }
		.mcx-error {
			margin: 0; padding: 0.6rem 0.75rem; border-radius: var(--radius-md, 8px); border: 1px solid var(--danger, #ff6b6b);
			color: var(--danger, #ff6b6b); font-size: var(--text-xs, 0.78rem); line-height: 1.5;
		}
		.mcx-error[hidden] { display: none; }
		.mcx-how {
			margin: 0; padding: 0.7rem 0.85rem; border-radius: var(--radius-md, 8px); background: var(--surface-1, #16161d);
			border: 1px solid var(--stroke, rgba(255,255,255,0.1)); font-size: var(--text-xs, 0.76rem); line-height: 1.6;
		}
		.mcx-how ol { margin: 0.3rem 0 0; padding-left: 1.1rem; }
		.mcx-how code { font-size: 0.95em; padding: 0.05rem 0.3rem; border-radius: 4px; background: rgba(255,255,255,0.08); user-select: all; }
		.mcx-how a { color: var(--accent, #7c6cff); }
		.mcx-how a:hover { text-decoration: underline; }
		.mcx-how a:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mcx-legal { margin: 0.9rem 0 0; font-size: 0.66rem; letter-spacing: 0.03em; color: var(--ink-dim, #888); }
		@media (prefers-reduced-motion: reduce) {
			.mcx-overlay, .mcx-modal { animation: none; }
			.mcx-skel { animation: none; }
			.mcx-spinner { animation-duration: 1.6s; }
		}
	`;
	document.head.appendChild(style);
}

/** Decode the API's 4-bytes-per-voxel base64 payload. */
function decodeVoxels(b64) {
	const bin = atob(b64 || '');
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * The three.js preview: one InstancedMesh of unit cubes, recolored per block.
 * three.js is imported on first use so the export menu costs nothing until the
 * panel opens.
 */
async function createPreview(canvas) {
	const THREE = await import('three');
	const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 2000);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
	const sun = new THREE.DirectionalLight(0xffffff, 1.9);
	sun.position.set(0.6, 1, 0.45);
	scene.add(sun);
	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = false;
	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const material = new THREE.MeshLambertMaterial();
	let mesh = null;
	let framedFor = '';

	const render = () => renderer.render(scene, camera);
	controls.addEventListener('change', render);

	const resize = () => {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		render();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	return {
		show({ voxels, palette, dims }) {
			const data = decodeVoxels(voxels);
			const count = data.length / 4;
			if (mesh) {
				scene.remove(mesh);
				mesh.dispose();
			}
			mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
			mesh.count = count;
			const colors = palette.map((p) => new THREE.Color().setRGB(p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255, THREE.SRGBColorSpace));
			const m = new THREE.Matrix4();
			const [nx, , nz] = dims;
			for (let i = 0; i < count; i += 1) {
				const o = i * 4;
				m.makeTranslation(data[o] - nx / 2 + 0.5, data[o + 1] + 0.5, data[o + 2] - nz / 2 + 0.5);
				mesh.setMatrixAt(i, m);
				mesh.setColorAt(i, colors[data[o + 3]] || colors[0]);
			}
			mesh.instanceMatrix.needsUpdate = true;
			if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
			scene.add(mesh);

			// Re-frame only when the footprint changes, so a palette or dither
			// change keeps the angle the user orbited to.
			const key = dims.join('x');
			if (key !== framedFor) {
				framedFor = key;
				const [, ny] = dims;
				const r = Math.hypot(nx, ny, nz) / 2;
				const dist = r / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
				controls.target.set(0, ny / 2, 0);
				camera.position.set(dist * 0.62, ny / 2 + dist * 0.38, dist * 0.68);
				camera.near = Math.max(0.1, dist / 100);
				camera.far = dist * 10;
				camera.updateProjectionMatrix();
				controls.update();
			}
			resize();
		},
		dispose() {
			ro.disconnect();
			controls.dispose();
			if (mesh) mesh.dispose();
			geometry.dispose();
			material.dispose();
			renderer.dispose();
		},
	};
}

function filenameFrom(res, fallback) {
	const cd = res.headers.get('content-disposition') || '';
	const m = /filename="([^"]+)"/.exec(cd);
	return m ? m[1] : fallback;
}

/**
 * Open the Bedrock export panel for one model.
 * @param {{creationId?: string|null, glbUrl?: string|null, returnFocus?: HTMLElement}} source
 */
export function openMinecraftPanel(source) {
	injectStyles();
	const overlay = document.createElement('div');
	overlay.className = 'mcx-overlay';
	overlay.innerHTML = `
		<div class="mcx-modal" role="dialog" aria-modal="true" aria-labelledby="mcx-title">
			<button class="mcx-close" type="button" aria-label="Close">✕</button>
			<h2 id="mcx-title">Export for Minecraft: Bedrock Edition</h2>
			<p class="mcx-sub">Turns this model into blocks and packs it as a structure you can load in any Bedrock world.</p>
			<div class="mcx-grid">
				<div>
					<div class="mcx-stage">
						<canvas aria-label="Block preview. Drag to orbit, scroll to zoom."></canvas>
						<div class="mcx-skel" hidden></div>
						<div class="mcx-stage-msg" hidden></div>
						<span class="mcx-badge" hidden></span>
					</div>
					<p class="mcx-error" role="alert" hidden></p>
				</div>
				<div class="mcx-side">
					<div class="mcx-field">
						<label class="mcx-label" for="mcx-height">Height in blocks <output id="mcx-height-out">64</output></label>
						<input class="mcx-range" id="mcx-height" type="range" min="${MIN_HEIGHT}" max="${MAX_HEIGHT}" step="1" value="64">
					</div>
					<div class="mcx-field">
						<label class="mcx-label" for="mcx-palette">Blocks to use</label>
						<select class="mcx-select" id="mcx-palette">
							<option value="all">All solid blocks</option>
						</select>
					</div>
					<div class="mcx-field">
						<span class="mcx-label" id="mcx-fill-label">Inside</span>
						<div class="mcx-seg" role="group" aria-labelledby="mcx-fill-label">
							<button type="button" data-fill="solid" aria-pressed="true">Solid</button>
							<button type="button" data-fill="shell" aria-pressed="false">Hollow shell</button>
						</div>
					</div>
					<div class="mcx-checks">
						<label class="mcx-check"><input type="checkbox" id="mcx-dither"> Dither colors</label>
						<label class="mcx-check"><input type="checkbox" id="mcx-levels" checked> Auto brightness</label>
					</div>
					<div class="mcx-stats" aria-live="polite">
						<div class="mcx-stat is-loading"><b data-stat="blocks">-</b><span>blocks</span></div>
						<div class="mcx-stat is-loading"><b data-stat="dims">-</b><span>size (x, y, z)</span></div>
						<div class="mcx-stat is-loading"><b data-stat="kinds">-</b><span>block types</span></div>
					</div>
					<ul class="mcx-blocks" aria-label="Most used blocks"></ul>
					<p class="mcx-note" data-note></p>
					<button class="mcx-btn" type="button" data-download disabled>Download .mcpack</button>
					<div class="mcx-how" data-how hidden></div>
				</div>
			</div>
			<p class="mcx-legal">${NOTICE} Minecraft is a trademark of Mojang Synergies AB.</p>
		</div>`;
	document.body.appendChild(overlay);

	const $ = (sel) => overlay.querySelector(sel);
	const canvas = $('canvas');
	const skel = $('.mcx-skel');
	const stageMsg = $('.mcx-stage-msg');
	const badge = $('.mcx-badge');
	const errorBox = $('.mcx-error');
	const height = $('#mcx-height');
	const heightOut = $('#mcx-height-out');
	const paletteSel = $('#mcx-palette');
	const dither = $('#mcx-dither');
	const levels = $('#mcx-levels');
	const downloadBtn = $('[data-download]');
	const note = $('[data-note]');
	const how = $('[data-how]');
	const blocksList = $('.mcx-blocks');
	const statEls = overlay.querySelectorAll('.mcx-stat');
	let fill = 'solid';
	let preview = null;
	let previewFailed = false;
	let current = null;
	let inflight = null;
	let seq = 0;
	let debounce = 0;
	let palettesLoaded = false;

	const requestBody = (format) => ({
		...(source.creationId ? { creationId: source.creationId } : {}),
		...(isHttpUrl(source.glbUrl) ? { glbUrl: source.glbUrl } : {}),
		height: Number(height.value),
		palette: paletteSel.value,
		fill,
		dither: dither.checked,
		levels: levels.checked ? 'auto' : 'none',
		format,
	});

	function setStageMessage(html) {
		stageMsg.innerHTML = html || '';
		stageMsg.hidden = !html;
	}

	function setLoading(on) {
		skel.hidden = !on;
		for (const el of statEls) el.classList.toggle('is-loading', on && !current);
		if (on) downloadBtn.disabled = true;
	}

	// Plain-language copy per API error code; the server's own message is the
	// fallback for anything not listed.
	const ERROR_COPY = {
		fetch_failed: 'The model file could not be downloaded. It may have been removed, or the file host is unreachable right now.',
		too_large: 'This model file is too large to turn into blocks. Try a lighter version of it.',
		too_complex: 'This model has too many triangles to voxelize in one go. Try a smaller height or a simplified model.',
		timeout: 'Building the blocks took too long. Try a smaller height.',
		invalid_model: 'This file is not a model the block export can read.',
		no_geometry: 'This model has no surfaces to turn into blocks.',
		creation_not_found: 'This model is not saved publicly, so it cannot be exported yet.',
	};

	function resetStats() {
		for (const el of overlay.querySelectorAll('[data-stat]')) el.textContent = '-';
		for (const el of statEls) el.classList.remove('is-loading');
	}

	function showError(message, { retry = true } = {}) {
		errorBox.innerHTML = `${esc(message)}${retry ? ' <button class="mcx-btn is-ghost" type="button" data-retry style="margin-top:0.5rem">Try again</button>' : ''}`;
		errorBox.hidden = false;
		errorBox.querySelector('[data-retry]')?.addEventListener('click', () => refresh(0));
	}

	function renderHow(data) {
		const id = data.structureId;
		const fn = `/function ${data.functionName}`;
		how.innerHTML = `
			<strong>Load it in Bedrock</strong>
			<ol>
				<li>Open the downloaded <code>${esc(data.name)}.mcpack</code>. Bedrock imports it.</li>
				<li>In a world's settings, turn on cheats and add the pack under Behavior Packs.</li>
				${id
					? `<li>Place a structure block (<code>/give @s structure_block</code>), switch it to Load, enter <code>${esc(id)}</code>, and press Load.</li>
				<li>Or stand where the build should go and run <code>${esc(fn)}</code>.</li>`
					: `<li>This build is wider than one structure block (64 by 64), so it ships as ${data.stats.tiles} tiles. Stand where it should go and run <code>${esc(fn)}</code> to place them all.</li>`}
			</ol>
			<a href="/docs/minecraft-export" target="_blank" rel="noopener">Limits and tips</a>`;
		how.hidden = false;
	}

	function renderStats(data) {
		const s = data.stats;
		$('[data-stat="blocks"]').textContent = fmtInt(s.blockCount);
		$('[data-stat="dims"]').textContent = s.dims.join(' x ');
		$('[data-stat="kinds"]').textContent = fmtInt(data.preview.palette.length);
		for (const el of statEls) el.classList.remove('is-loading');
		blocksList.innerHTML = data.preview.palette
			.slice(0, 8)
			.map((p) => `<li title="${esc(p.name)}"><span class="mcx-swatch" style="background:rgb(${p.rgb.join(',')})"></span>${esc(p.label)} <span style="opacity:0.6">${fmtInt(p.count)}</span></li>`)
			.join('');
		const parts = [COLOR_SOURCE_COPY[s.colorSource] || ''];
		if (s.brightness > 1) parts.push(`Brightened ${s.brightness}x because the texture is darker than any block would look in game.`);
		if (s.clamped) parts.push(`Height reduced to ${s.height} so the width stays within ${fmtInt(192)} blocks.`);
		if (s.fill === 'solid') parts.push(`${fmtInt(s.interiorBlocks)} of the blocks fill the inside.`);
		note.textContent = parts.filter(Boolean).join(' ');
		badge.textContent = `${fmtInt(data.preview.visibleCount)} visible blocks`;
		badge.hidden = false;
	}

	function populatePalettes(palettes) {
		if (palettesLoaded || !palettes) return;
		palettesLoaded = true;
		const keep = paletteSel.value;
		paletteSel.innerHTML = Object.entries(palettes)
			.map(([k, label]) => `<option value="${esc(k)}"${k === keep ? ' selected' : ''}>${esc(label)}</option>`)
			.join('');
	}

	async function loadPreview() {
		const mine = (seq += 1);
		inflight?.abort();
		inflight = new AbortController();
		errorBox.hidden = true;
		setLoading(true);
		if (!current) setStageMessage('<span class="mcx-spinner" aria-hidden="true"></span><span>Turning the model into blocks. The first preview downloads the model, so it can take a few seconds.</span>');
		try {
			const res = await fetch(API, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(requestBody('preview')),
				signal: inflight.signal,
			});
			const body = await res.json().catch(() => null);
			if (mine !== seq) return;
			if (res.status === 422 && body?.error === 'empty_build') {
				current = null;
				setStageMessage(`<strong>No blocks at ${esc(height.value)} high.</strong><span>This model is too thin to fill a block at this size. Drag the height slider up and try again.</span>`);
				resetStats();
				note.textContent = '';
				blocksList.innerHTML = '';
				how.hidden = true;
				badge.hidden = true;
				return;
			}
			if (!res.ok || !body?.ok) {
				const msg = res.status === 429
					? 'Too many export requests. Wait a minute and try again.'
					: ERROR_COPY[body?.error] || body?.error_description || `The export failed (${res.status}).`;
				showError(msg);
				if (!current) {
					resetStats();
					setStageMessage('<span>No preview yet.</span>');
				}
				return;
			}
			current = body;
			populatePalettes(body.palettes);
			renderStats(body);
			renderHow(body);
			if (!preview && !previewFailed) {
				try {
					preview = await createPreview(canvas);
				} catch (err) {
					previewFailed = true;
					console.warn('[forge-minecraft] 3D preview unavailable', err);
				}
			}
			if (mine !== seq) return;
			if (preview) {
				preview.show({ voxels: body.preview.voxels, palette: body.preview.palette, dims: body.stats.dims });
				setStageMessage('');
			} else {
				setStageMessage('<span>This browser cannot draw the 3D preview (WebGL is off), but the counts and download below are ready.</span>');
			}
			downloadBtn.disabled = false;
		} catch (err) {
			if (err?.name === 'AbortError' || mine !== seq) return;
			showError('Could not reach the export service. Check your connection and try again.');
			if (!current) {
				resetStats();
				setStageMessage('<span>No preview yet.</span>');
			}
		} finally {
			if (mine === seq) setLoading(false);
		}
	}

	function refresh(delay = DEBOUNCE_MS) {
		clearTimeout(debounce);
		if (delay) {
			setLoading(true);
			debounce = setTimeout(loadPreview, delay);
		} else {
			loadPreview();
		}
	}

	async function download() {
		if (!current) return;
		const label = downloadBtn.textContent;
		downloadBtn.disabled = true;
		downloadBtn.innerHTML = '<span class="mcx-spinner" aria-hidden="true"></span> Building pack';
		try {
			const res = await fetch(API, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(requestBody('mcpack')),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.error_description || body?.message || `The pack could not be built (${res.status}).`);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filenameFrom(res, `${current.name}.mcpack`);
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 30_000);
		} catch (err) {
			showError(err.message || 'The pack could not be built.');
		} finally {
			downloadBtn.textContent = label;
			downloadBtn.disabled = !current;
		}
	}

	height.addEventListener('input', () => {
		heightOut.textContent = height.value;
		refresh();
	});
	paletteSel.addEventListener('change', () => refresh(0));
	dither.addEventListener('change', () => refresh(0));
	levels.addEventListener('change', () => refresh(0));
	for (const b of overlay.querySelectorAll('[data-fill]')) {
		b.addEventListener('click', () => {
			if (fill === b.dataset.fill) return;
			fill = b.dataset.fill;
			for (const o of overlay.querySelectorAll('[data-fill]')) o.setAttribute('aria-pressed', String(o === b));
			refresh(0);
		});
	}
	downloadBtn.addEventListener('click', download);

	const close = () => {
		clearTimeout(debounce);
		inflight?.abort();
		seq += 1;
		preview?.dispose();
		overlay.remove();
		document.removeEventListener('keydown', onKey);
		source.returnFocus?.focus?.();
	};
	const onKey = (e) => {
		if (e.key === 'Escape') close();
	};
	$('.mcx-close').addEventListener('click', close);
	overlay.addEventListener('click', (e) => {
		if (e.target === overlay) close();
	});
	document.addEventListener('keydown', onKey);
	height.focus();

	if (!source.creationId && !isHttpUrl(source.glbUrl)) {
		setStageMessage('<strong>Save this model first.</strong><span>The block export runs on the server, so it needs a stored model. Unsaved edits in this tab cannot be exported yet.</span>');
		resetStats();
		for (const el of overlay.querySelectorAll('input, select, .mcx-seg button')) el.disabled = true;
		return { close };
	}
	loadPreview();
	return { close };
}

/**
 * Add the "Minecraft: Bedrock" row to a Forge export menu. Hidden until a
 * stored model (creation id or http(s) GLB URL) is known, like the print rows.
 *
 * @param {HTMLElement} menu
 * @param {{ isLocalEdit?: () => boolean }} [opts]
 */
export function mountMinecraftMenuItem(menu, { isLocalEdit = () => false } = {}) {
	let source = { creationId: null, glbUrl: null };
	const item = document.createElement('button');
	item.type = 'button';
	item.className = 'export-item';
	item.setAttribute('role', 'menuitem');
	item.dataset.minecraft = 'bedrock';
	item.hidden = true;
	item.innerHTML = `
		<span class="fmt">.mcpack</span>
		<span class="blurb">Minecraft: Bedrock. Turn this model into blocks, preview it, and download a structure pack.</span>
		<span class="status" aria-live="polite"></span>`;
	item.addEventListener('click', () => {
		const local = isLocalEdit();
		openMinecraftPanel({
			creationId: local ? null : source.creationId,
			glbUrl: local ? null : source.glbUrl,
			returnFocus: item,
		});
	});
	menu.appendChild(item);
	return {
		setCreation(creationId, glbUrl = null) {
			source = { creationId: creationId || null, glbUrl: isHttpUrl(glbUrl) ? glbUrl : null };
			item.hidden = !source.creationId && !source.glbUrl;
		},
	};
}
