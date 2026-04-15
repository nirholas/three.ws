/**
 * TextureInspector — catalogs every texture referenced by the loaded model,
 * shows a grid of thumbnails with metadata, and opens a lightbox with
 * per-channel extraction (R/G/B/A grayscale), zoom/pan, and UV overlay
 * for any texture.
 */
import {
	RepeatWrapping,
	ClampToEdgeWrapping,
	MirroredRepeatWrapping,
	NearestFilter,
	LinearFilter,
	NearestMipmapNearestFilter,
	LinearMipmapNearestFilter,
	NearestMipmapLinearFilter,
	LinearMipmapLinearFilter,
} from 'three';
import { traverseMaterials } from '../viewer/internal.js';

const SLOT_LABELS = {
	map: 'Base Color',
	normalMap: 'Normal',
	metalnessMap: 'Metallic',
	roughnessMap: 'Roughness',
	aoMap: 'Occlusion',
	emissiveMap: 'Emissive',
	bumpMap: 'Bump',
	alphaMap: 'Alpha',
	displacementMap: 'Displacement',
	clearcoatMap: 'Clearcoat',
	clearcoatNormalMap: 'Clearcoat Normal',
	clearcoatRoughnessMap: 'Clearcoat Roughness',
	sheenColorMap: 'Sheen Color',
	sheenRoughnessMap: 'Sheen Roughness',
	specularColorMap: 'Specular Color',
	specularIntensityMap: 'Specular Intensity',
	transmissionMap: 'Transmission',
	thicknessMap: 'Thickness',
	lightMap: 'Light',
};

const WRAP_LABELS = {
	[RepeatWrapping]: 'repeat',
	[ClampToEdgeWrapping]: 'clamp',
	[MirroredRepeatWrapping]: 'mirror',
};

const FILTER_LABELS = {
	[NearestFilter]: 'nearest',
	[LinearFilter]: 'linear',
	[NearestMipmapNearestFilter]: 'nearest-mip-nearest',
	[LinearMipmapNearestFilter]: 'linear-mip-nearest',
	[NearestMipmapLinearFilter]: 'nearest-mip-linear',
	[LinearMipmapLinearFilter]: 'linear-mip-linear',
};

function detectFormat(tex) {
	if (tex.isCompressedTexture) return 'KTX2/Basis';
	const src = tex.image && tex.image.src;
	if (typeof src === 'string') {
		if (/\.ktx2(\?|$)/i.test(src)) return 'KTX2';
		if (/\.(jpe?g)(\?|$)/i.test(src)) return 'JPEG';
		if (/\.png(\?|$)/i.test(src)) return 'PNG';
		if (/\.webp(\?|$)/i.test(src)) return 'WebP';
		if (src.startsWith('data:image/png')) return 'PNG';
		if (src.startsWith('data:image/jpeg')) return 'JPEG';
		if (src.startsWith('data:image/webp')) return 'WebP';
	}
	if (tex.image && tex.image.tagName === 'VIDEO') return 'video';
	return 'image';
}

function estimateMemoryMB(w, h, mipmap) {
	const base = w * h * 4;
	const total = mipmap ? base * 1.333 : base;
	return (total / 1024 / 1024).toFixed(2);
}

function drawSourceToCanvas(canvas, src) {
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	try {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
		return true;
	} catch (e) {
		ctx.fillStyle = '#222';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#888';
		ctx.font = '10px sans-serif';
		ctx.fillText('preview unavailable', 8, canvas.height / 2);
		return false;
	}
}

export class TextureInspector {
	constructor(viewer, session) {
		this.viewer = viewer;
		this.session = session;
		this.gui = viewer.gui;
		this.folder = null;
		this.panel = null;
		this._lastTextures = null;
		this._keyHandler = (e) => this._onKey(e);
		window.addEventListener('keydown', this._keyHandler);
	}

	rebuild() {
		this._clear();
		if (!this.viewer.content || !this.gui) return;
		const textures = this._collectTextures();
		this._lastTextures = textures;
		if (textures.length === 0) return;

		this.folder = this.gui.addFolder('Textures');
		this.folder
			.add(
				{
					open: () => this._openPanel(textures),
				},
				'open',
			)
			.name(`inspect (${textures.length}) [X]`);
	}

	_onKey(e) {
		if (e.key !== 'x' && e.key !== 'X') return;
		const t = e.target;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		if (this.panel) {
			this.panel.remove();
			this.panel = null;
			return;
		}
		if (this._lastTextures && this._lastTextures.length) {
			this._openPanel(this._lastTextures);
		}
	}

	_collectTextures() {
		const byUuid = new Map();
		traverseMaterials(this.viewer.content, (mat) => {
			for (const slot in SLOT_LABELS) {
				const tex = mat[slot];
				if (!tex || !tex.image) continue;
				const key = tex.uuid;
				if (!byUuid.has(key)) {
					byUuid.set(key, { tex, slots: new Set(), materials: new Set(), meshes: [] });
				}
				const entry = byUuid.get(key);
				entry.slots.add(SLOT_LABELS[slot]);
				entry.materials.add(mat.name || mat.type);
			}
		});

		// Second pass: gather meshes per texture for UV overlay
		this.viewer.content.traverse((node) => {
			if (!node.geometry || !node.material) return;
			const mats = Array.isArray(node.material) ? node.material : [node.material];
			mats.forEach((mat) => {
				for (const slot in SLOT_LABELS) {
					const tex = mat[slot];
					if (!tex || !byUuid.has(tex.uuid)) continue;
					const entry = byUuid.get(tex.uuid);
					if (!entry.meshes.includes(node)) entry.meshes.push(node);
				}
			});
		});

		return [...byUuid.values()];
	}

	_openPanel(textures) {
		if (this.panel) this.panel.remove();

		const panel = document.createElement('div');
		panel.className = 'texture-inspector';
		panel.innerHTML = `
			<div class="texture-inspector__header">
				<span class="texture-inspector__title">Texture Inspector · ${textures.length}</span>
				<button class="texture-inspector__close" title="Close [X]">×</button>
			</div>
			<div class="texture-inspector__grid"></div>
		`;
		document.body.appendChild(panel);
		this.panel = panel;

		panel.querySelector('.texture-inspector__close').addEventListener('click', () => {
			panel.remove();
			this.panel = null;
		});

		const grid = panel.querySelector('.texture-inspector__grid');
		textures.forEach((entry) => grid.appendChild(this._buildCard(entry)));
	}

	_buildCard(entry) {
		const { tex, slots, materials } = entry;
		const img = tex.image;
		const w = img.width || img.videoWidth || 0;
		const h = img.height || img.videoHeight || 0;
		const memMB = estimateMemoryMB(w, h, tex.generateMipmaps !== false);
		const format = detectFormat(tex);
		const wrap = `${WRAP_LABELS[tex.wrapS] || '?'}/${WRAP_LABELS[tex.wrapT] || '?'}`;
		const uvChannel = tex.channel ?? 0;

		const card = document.createElement('div');
		card.className = 'texture-card';
		const thumb = document.createElement('canvas');
		thumb.className = 'texture-card__thumb';
		thumb.width = 128;
		thumb.height = 128;
		drawSourceToCanvas(thumb, img);
		card.appendChild(thumb);

		const info = document.createElement('div');
		info.className = 'texture-card__info';
		info.innerHTML = `
			<div class="texture-card__name">${[...slots].join(' · ')}</div>
			<div class="texture-card__meta">${w}×${h} · ${format} · ~${memMB} MB</div>
			<div class="texture-card__meta">UV${uvChannel} · ${wrap}</div>
			<div class="texture-card__mats">${[...materials].slice(0, 3).join(', ')}${
				materials.size > 3 ? '…' : ''
			}</div>
		`;
		card.appendChild(info);

		const open = () => this._openLightbox(entry);
		thumb.addEventListener('click', open);
		card.addEventListener('click', (e) => {
			if (e.target === thumb) return;
			open();
		});
		return card;
	}

	_openLightbox(entry) {
		const { tex, slots, materials, meshes } = entry;
		const img = tex.image;
		const w = img.width || 256;
		const h = img.height || 256;
		const format = detectFormat(tex);
		const memMB = estimateMemoryMB(w, h, tex.generateMipmaps !== false);
		const wrap = `${WRAP_LABELS[tex.wrapS] || '?'}/${WRAP_LABELS[tex.wrapT] || '?'}`;
		const magFilter = FILTER_LABELS[tex.magFilter] || '?';
		const minFilter = FILTER_LABELS[tex.minFilter] || '?';
		const uvChannel = tex.channel ?? 0;

		const lb = document.createElement('div');
		lb.className = 'texture-lightbox';
		lb.innerHTML = `
			<div class="texture-lightbox__bar">
				<div class="texture-lightbox__meta">
					<span class="texture-lightbox__title">${[...slots].join(' · ')}</span>
					<span class="texture-lightbox__dim">${w}×${h} · ${format} · ~${memMB} MB · UV${uvChannel} · wrap ${wrap} · mag ${magFilter} · min ${minFilter}</span>
				</div>
				<div class="texture-lightbox__channels">
					<button data-ch="rgb" class="active">RGB</button>
					<button data-ch="r">R</button>
					<button data-ch="g">G</button>
					<button data-ch="b">B</button>
					<button data-ch="a">A</button>
					<button data-ch="checker" title="Alpha over checkerboard">⌗</button>
					<button data-act="uv" title="Toggle UV wireframe">UV</button>
					<button data-act="fit" title="Reset zoom">⤢</button>
				</div>
				<button class="texture-lightbox__close" title="Close">×</button>
			</div>
			<div class="texture-lightbox__stage">
				<div class="texture-lightbox__viewport">
					<canvas class="texture-lightbox__canvas" width="${w}" height="${h}"></canvas>
					<canvas class="texture-lightbox__uv" width="${w}" height="${h}"></canvas>
				</div>
			</div>
			<div class="texture-lightbox__footer">Used by: ${[...materials].join(', ')} · ${meshes.length} mesh${meshes.length === 1 ? '' : 'es'}</div>
		`;
		document.body.appendChild(lb);

		const canvas = lb.querySelector('.texture-lightbox__canvas');
		const uvCanvas = lb.querySelector('.texture-lightbox__uv');
		const viewport = lb.querySelector('.texture-lightbox__viewport');
		const ctx = canvas.getContext('2d');
		drawSourceToCanvas(canvas, img);

		let imgData = null;
		try {
			imgData = ctx.getImageData(0, 0, w, h);
		} catch (e) {
			imgData = null;
		}

		let currentChannel = 'rgb';
		let uvVisible = false;

		const drawChecker = () => {
			const tile = 16;
			ctx.fillStyle = '#ccc';
			ctx.fillRect(0, 0, w, h);
			ctx.fillStyle = '#777';
			for (let y = 0; y < h; y += tile) {
				for (let x = (y / tile) % 2 === 0 ? 0 : tile; x < w; x += tile * 2) {
					ctx.fillRect(x, y, tile, tile);
				}
			}
		};

		const drawChannel = (ch) => {
			currentChannel = ch;
			ctx.clearRect(0, 0, w, h);
			if (ch === 'rgb') {
				drawSourceToCanvas(canvas, img);
				return;
			}
			if (ch === 'checker') {
				drawChecker();
				try {
					ctx.drawImage(img, 0, 0, w, h);
				} catch (e) {}
				return;
			}
			if (!imgData) {
				ctx.fillStyle = '#222';
				ctx.fillRect(0, 0, w, h);
				ctx.fillStyle = '#aaa';
				ctx.font = '14px sans-serif';
				ctx.fillText('channel extraction blocked (CORS)', 16, h / 2);
				return;
			}
			const out = ctx.createImageData(w, h);
			const idx = { r: 0, g: 1, b: 2, a: 3 }[ch];
			for (let i = 0; i < imgData.data.length; i += 4) {
				const v = imgData.data[i + idx];
				out.data[i] = v;
				out.data[i + 1] = v;
				out.data[i + 2] = v;
				out.data[i + 3] = 255;
			}
			ctx.putImageData(out, 0, 0);
		};

		const drawUV = () => {
			const uctx = uvCanvas.getContext('2d');
			uctx.clearRect(0, 0, w, h);
			if (!uvVisible) return;
			uctx.strokeStyle = 'rgba(0, 255, 180, 0.75)';
			uctx.lineWidth = Math.max(1, w / 800);
			const attrName = uvChannel === 1 ? 'uv1' : 'uv';
			meshes.forEach((mesh) => {
				const geo = mesh.geometry;
				const uvAttr = geo.attributes[attrName] || geo.attributes.uv;
				if (!uvAttr) return;
				const index = geo.index;
				uctx.beginPath();
				const drawTri = (a, b, c) => {
					const ax = uvAttr.getX(a) * w;
					const ay = (1 - uvAttr.getY(a)) * h;
					const bx = uvAttr.getX(b) * w;
					const by = (1 - uvAttr.getY(b)) * h;
					const cx = uvAttr.getX(c) * w;
					const cy = (1 - uvAttr.getY(c)) * h;
					uctx.moveTo(ax, ay); uctx.lineTo(bx, by);
					uctx.moveTo(bx, by); uctx.lineTo(cx, cy);
					uctx.moveTo(cx, cy); uctx.lineTo(ax, ay);
				};
				if (index) {
					const arr = index.array;
					for (let i = 0; i < arr.length; i += 3) drawTri(arr[i], arr[i + 1], arr[i + 2]);
				} else {
					for (let i = 0; i < uvAttr.count; i += 3) drawTri(i, i + 1, i + 2);
				}
				uctx.stroke();
			});
		};

		// Zoom / pan
		let zoom = 1;
		let tx = 0;
		let ty = 0;
		let dragging = false;
		let lastX = 0;
		let lastY = 0;

		const applyTransform = () => {
			const t = `translate(${tx}px, ${ty}px) scale(${zoom})`;
			canvas.style.transform = t;
			uvCanvas.style.transform = t;
		};
		applyTransform();

		viewport.addEventListener('wheel', (e) => {
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			const next = Math.max(0.1, Math.min(12, zoom * factor));
			// zoom toward cursor
			const rect = viewport.getBoundingClientRect();
			const cx = e.clientX - rect.left - rect.width / 2;
			const cy = e.clientY - rect.top - rect.height / 2;
			tx = cx - (cx - tx) * (next / zoom);
			ty = cy - (cy - ty) * (next / zoom);
			zoom = next;
			applyTransform();
		}, { passive: false });

		viewport.addEventListener('mousedown', (e) => {
			dragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
			viewport.style.cursor = 'grabbing';
		});
		window.addEventListener('mousemove', (e) => {
			if (!dragging) return;
			tx += e.clientX - lastX;
			ty += e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			applyTransform();
		});
		window.addEventListener('mouseup', () => {
			dragging = false;
			viewport.style.cursor = '';
		});

		const fit = () => {
			zoom = 1; tx = 0; ty = 0;
			applyTransform();
		};

		lb.querySelectorAll('.texture-lightbox__channels button').forEach((btn) => {
			btn.addEventListener('click', () => {
				const act = btn.dataset.act;
				if (act === 'uv') {
					uvVisible = !uvVisible;
					btn.classList.toggle('active', uvVisible);
					drawUV();
					return;
				}
				if (act === 'fit') {
					fit();
					return;
				}
				lb.querySelectorAll('.texture-lightbox__channels button[data-ch]').forEach((b) =>
					b.classList.remove('active'),
				);
				btn.classList.add('active');
				drawChannel(btn.dataset.ch);
			});
		});

		lb.querySelector('.texture-lightbox__close').addEventListener('click', () => lb.remove());
		lb.addEventListener('click', (e) => {
			if (e.target === lb) lb.remove();
		});
	}

	_clear() {
		if (this.folder && this.gui) {
			try {
				this.gui.removeFolder(this.folder);
			} catch (e) {}
		}
		this.folder = null;
		if (this.panel) {
			this.panel.remove();
			this.panel = null;
		}
	}

	dispose() {
		this._clear();
		window.removeEventListener('keydown', this._keyHandler);
	}
}
