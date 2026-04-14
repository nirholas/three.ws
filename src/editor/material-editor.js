/**
 * MaterialEditor — live PBR editing via dat.gui subfolders.
 *
 * Collects unique MeshStandardMaterial / MeshPhysicalMaterial instances from
 * the loaded content and builds one subfolder per material with controls that
 * mutate the Three.js material directly (for viewport preview) and record
 * the change on the EditorSession (for GLB export).
 */
import { FrontSide, BackSide, DoubleSide } from 'three';
import { traverseMaterials } from '../viewer/internal.js';

const SIDES = { Front: FrontSide, Back: BackSide, Double: DoubleSide };

export class MaterialEditor {
	constructor(viewer, session) {
		this.viewer = viewer;
		this.session = session;
		this.gui = viewer.gui;
		this.folder = null;
		this.subfolders = [];
		this.snapshots = new Map();
	}

	rebuild() {
		this._clear();
		if (!this.viewer.content || !this.gui) return;

		const mats = [];
		traverseMaterials(this.viewer.content, (mat) => {
			if (mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial)) {
				mats.push(mat);
			}
		});

		if (mats.length === 0) return;

		this.folder = this.gui.addFolder('Materials');

		mats.forEach((mat, i) => {
			const label = mat.name || `Material ${i + 1}`;
			const sub = this.folder.addFolder(label);
			this._addControls(sub, mat);
			this.subfolders.push(sub);
		});
	}

	_addControls(folder, mat) {
		const snap = {
			color: mat.color.getHex(),
			metalness: mat.metalness,
			roughness: mat.roughness,
			emissive: mat.emissive.getHex(),
			emissiveIntensity: mat.emissiveIntensity ?? 1,
			opacity: mat.opacity,
			transparent: mat.transparent,
			alphaTest: mat.alphaTest,
			wireframe: mat.wireframe,
			flatShading: mat.flatShading,
			envMapIntensity: mat.envMapIntensity ?? 1,
			side: mat.side,
		};
		this.snapshots.set(mat.uuid, snap);

		const proxy = {
			color: '#' + mat.color.getHexString(),
			emissive: '#' + mat.emissive.getHexString(),
			side: Object.keys(SIDES).find((k) => SIDES[k] === mat.side) || 'Front',
		};

		const record = () => {
			this.session.recordMaterialEdit(mat, {
				name: mat.name,
				baseColor: [mat.color.r, mat.color.g, mat.color.b],
				metalness: mat.metalness,
				roughness: mat.roughness,
				emissive: [mat.emissive.r, mat.emissive.g, mat.emissive.b],
				opacity: mat.opacity,
				alphaMode: mat.transparent
					? 'BLEND'
					: mat.alphaTest > 0
						? 'MASK'
						: 'OPAQUE',
				alphaCutoff: mat.alphaTest,
				doubleSided: mat.side === DoubleSide,
			});
			mat.needsUpdate = true;
			this.viewer.invalidate();
		};

		folder.addColor(proxy, 'color').name('base color').onChange((v) => {
			mat.color.set(v);
			record();
		});
		folder.add(mat, 'metalness', 0, 1, 0.01).onChange(record);
		folder.add(mat, 'roughness', 0, 1, 0.01).onChange(record);
		folder.addColor(proxy, 'emissive').onChange((v) => {
			mat.emissive.set(v);
			record();
		});
		folder.add(mat, 'emissiveIntensity', 0, 4, 0.01).name('emissive int').onChange(() => {
			mat.needsUpdate = true;
			this.viewer.invalidate();
		});
		folder.add(mat, 'opacity', 0, 1, 0.01).onChange(() => {
			mat.transparent = mat.opacity < 1;
			record();
		});
		folder.add(mat, 'transparent').onChange(record);
		folder.add(mat, 'alphaTest', 0, 1, 0.01).name('alpha test').onChange(record);
		folder.add(mat, 'wireframe').onChange(() => {
			mat.needsUpdate = true;
			this.viewer.invalidate();
		});
		folder.add(mat, 'flatShading').name('flat shading').onChange(() => {
			mat.needsUpdate = true;
			this.viewer.invalidate();
		});
		if (mat.envMapIntensity !== undefined) {
			folder.add(mat, 'envMapIntensity', 0, 4, 0.01).name('env map int').onChange(() => {
				this.viewer.invalidate();
			});
		}
		folder.add(proxy, 'side', Object.keys(SIDES)).onChange((v) => {
			mat.side = SIDES[v];
			record();
		});

		folder
			.add(
				{
					reset: () => this._reset(folder, mat, proxy),
				},
				'reset',
			)
			.name('↺ reset');
	}

	_reset(folder, mat, proxy) {
		const snap = this.snapshots.get(mat.uuid);
		if (!snap) return;
		mat.color.setHex(snap.color);
		mat.emissive.setHex(snap.emissive);
		mat.metalness = snap.metalness;
		mat.roughness = snap.roughness;
		mat.emissiveIntensity = snap.emissiveIntensity;
		mat.opacity = snap.opacity;
		mat.transparent = snap.transparent;
		mat.alphaTest = snap.alphaTest;
		mat.wireframe = snap.wireframe;
		mat.flatShading = snap.flatShading;
		if (mat.envMapIntensity !== undefined) mat.envMapIntensity = snap.envMapIntensity;
		mat.side = snap.side;
		proxy.color = '#' + mat.color.getHexString();
		proxy.emissive = '#' + mat.emissive.getHexString();
		proxy.side = Object.keys(SIDES).find((k) => SIDES[k] === mat.side) || 'Front';

		this.session.clearMaterialEdit(mat);
		mat.needsUpdate = true;
		this.viewer.invalidate();

		for (const ctrl of folder.__controllers) {
			if (ctrl.updateDisplay) ctrl.updateDisplay();
		}
	}

	_clear() {
		if (this.folder && this.gui) {
			try {
				this.gui.removeFolder(this.folder);
			} catch (e) {}
		}
		this.folder = null;
		this.subfolders = [];
		this.snapshots.clear();
	}

	dispose() {
		this._clear();
	}
}
