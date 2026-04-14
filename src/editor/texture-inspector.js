/**
 * TextureInspector — catalogs every texture referenced by the loaded model,
 * shows a grid of thumbnails with metadata, and opens a lightbox with
 * per-channel extraction (R/G/B/A grayscale) for any texture.
 */
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

function drawSourceToCanvas(canvas, src) {
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	try {
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
	}

	rebuild() {
		this._clear();
		if (!this.viewer.content || !this.gui) return;
		const textures = this._collectTextures();
		if (textures.length === 0) return;

		this.folder = this.gui.addFolder('Textures');
		this.folder
			.add(
				{
					open: () => this._openPanel(textures),
				},
				'open',
			)
			.name(`inspect (${textures.length})`);
	}

	_collectTextures() {
		const byUuid = new Map();
		traverseMaterials(this.viewer.content, (mat) => {
			for (const slot in SLOT_LABELS) {
				const tex = mat[slot];
				if (!tex || !tex.image) continue;
				const key = tex.uuid;
				if (!byUuid.has(key)) {
					byUuid.set(key, { tex, slots: new Set(), materials: new Set() });
				}
				const entry = byUuid.get(key);
				entry.slots.add(SLOT_LABELS[slot]);
				entry.materials.add(mat.name || mat.type);
			}
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
				<button class="texture-inspector__close" title="Close">×</button>
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

	_buildCard({ tex, slots, materials }) {
		const img = tex.image;
		const w = img.width || img.videoWidth || 0;
		const h = img.height || img.videoHeight || 0;
		const memMB = ((w * h * 4 * 1.33) / 1024 / 1024).toFixed(2);

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
			<div class="texture-card__meta">${w}×${h} · ~${memMB} MB</div>
			<div class="texture-card__mats">${[...materials].slice(0, 3).join(', ')}${
				materials.size > 3 ? '…' : ''
			}</div>
		`;
		card.appendChild(info);

		thumb.addEventListener('click', () => this._openLightbox(tex, slots, materials));
		card.addEventListener('click', (e) => {
			if (e.target === thumb) return;
			this._openLightbox(tex, slots, materials);
		});
		return card;
	}

	_openLightbox(tex, slots, materials) {
		const img = tex.image;
		const w = img.width || 256;
		const h = img.height || 256;

		const lb = document.createElement('div');
		lb.className = 'texture-lightbox';
		lb.innerHTML = `
			<div class="texture-lightbox__bar">
				<div class="texture-lightbox__meta">
					<span class="texture-lightbox__title">${[...slots].join(' · ')}</span>
					<span class="texture-lightbox__dim">${w}×${h}</span>
				</div>
				<div class="texture-lightbox__channels">
					<button data-ch="rgb" class="active">RGB</button>
					<button data-ch="r">R</button>
					<button data-ch="g">G</button>
					<button data-ch="b">B</button>
					<button data-ch="a">A</button>
					<button data-ch="checker" title="Alpha over checkerboard">⌗</button>
				</div>
				<button class="texture-lightbox__close" title="Close">×</button>
			</div>
			<div class="texture-lightbox__stage">
				<canvas class="texture-lightbox__canvas" width="${w}" height="${h}"></canvas>
			</div>
			<div class="texture-lightbox__footer">Used by: ${[...materials].join(', ')}</div>
		`;
		document.body.appendChild(lb);

		const canvas = lb.querySelector('.texture-lightbox__canvas');
		const ctx = canvas.getContext('2d');
		drawSourceToCanvas(canvas, img);

		let imgData = null;
		try {
			imgData = ctx.getImageData(0, 0, w, h);
		} catch (e) {
			imgData = null;
		}

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

		lb.querySelectorAll('.texture-lightbox__channels button').forEach((btn) => {
			btn.addEventListener('click', () => {
				lb.querySelectorAll('.texture-lightbox__channels button').forEach((b) =>
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
	}
}
