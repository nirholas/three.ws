/**
 * EditorSession — central state for live-editable properties on a loaded model.
 *
 * Four kinds of edits are tracked and replayed at export time:
 *   - materialEdits   keyed by Three.js material.uuid
 *   - transformEdits  keyed by Three.js Object3D.uuid
 *   - visibilityEdits keyed by Three.js Object3D.uuid
 *   - textureEdits    keyed by "<material.uuid>:<slot>", carrying the new image bytes
 *
 * Each material/node edit also records the glTF array index the loader parsed it
 * from (`materialIndex` / `nodeIndex`), so the export can tell apart entities
 * that share a name.
 *
 * We also keep the raw source bytes so we can re-serialize a modified GLB
 * via glTF-Transform without refetching. Bytes are captured lazily either
 * from a URL or from a File.
 */
import { log } from '../shared/log.js';
import { previewTexture } from './texture-replace.js';
export class EditorSession {
	constructor(viewer) {
		this.viewer = viewer;
		this.sourceURL = null;
		this.sourceFile = null;
		this.sourceBuffer = null;
		this.sourceName = 'model';
		this.materialEdits = {};
		this.transformEdits = {};
		this.visibilityEdits = {};
		this.textureEdits = {};
		this._listeners = new Set();
	}

	reset({ url = null, file = null, name = null } = {}) {
		this.sourceURL = url;
		this.sourceFile = file;
		this.sourceBuffer = null;
		this.sourceName =
			name || (file && file.name) || (url ? url.split('/').pop().split('?')[0] : 'model');
		this.materialEdits = {};
		this.transformEdits = {};
		this.visibilityEdits = {};
		this.textureEdits = {};
		if (!url && !file) {
			log.warn('[editor] no source — export disabled');
		}
		this._emit();
	}

	isExportReady() {
		return !!(this.sourceURL || this.sourceFile || this.sourceBuffer);
	}

	onChange(fn) {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}

	_emit(kind = 'reset') {
		for (const fn of this._listeners) {
			try {
				fn(this, kind);
			} catch (e) {
				log.warn('[editor.session] listener error', e);
			}
		}
	}

	/** The glTF array index the loader parsed `object` from, or undefined when unknown. */
	_gltfIndex(object, kind) {
		const idx = this.viewer?.gltfParser?.associations?.get(object)?.[kind];
		return Number.isInteger(idx) ? idx : undefined;
	}

	recordMaterialEdit(material, patch) {
		const key = material.uuid;
		const existing = this.materialEdits[key] || { name: material.name, uuid: key };
		const materialIndex = this._gltfIndex(material, 'materials');
		this.materialEdits[key] = {
			...existing,
			...patch,
			...(materialIndex !== undefined ? { materialIndex } : {}),
		};
		this._emit('material');
	}

	clearMaterialEdit(material) {
		delete this.materialEdits[material.uuid];
		for (const key of Object.keys(this.textureEdits)) {
			if (this.textureEdits[key].materialUuid === material.uuid) delete this.textureEdits[key];
		}
		this._emit('reset');
	}

	/**
	 * @param {THREE.Material} material
	 * @param {string} slot one of the TEXTURE_SLOT_IDS in glb-export.js
	 * @param {Uint8Array} bytes the replacement image file
	 * @param {string} mime image/png | image/jpeg | image/webp
	 */
	recordTextureEdit(material, slot, bytes, mime) {
		const materialIndex = this._gltfIndex(material, 'materials');
		this.textureEdits[`${material.uuid}:${slot}`] = {
			name: material.name,
			materialUuid: material.uuid,
			...(materialIndex !== undefined ? { materialIndex } : {}),
			slot,
			bytes,
			mime,
		};
		this._emit('material');
	}

	recordTransformEdit(node) {
		const nodeIndex = this._gltfIndex(node, 'nodes');
		this.transformEdits[node.uuid] = {
			name: node.name,
			uuid: node.uuid,
			...(nodeIndex !== undefined ? { nodeIndex } : {}),
			position: node.position.toArray(),
			rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
			scale: node.scale.toArray(),
		};
		this._emit('transform');
	}

	recordVisibilityEdit(node, visible) {
		const nodeIndex = this._gltfIndex(node, 'nodes');
		this.visibilityEdits[node.uuid] = {
			name: node.name,
			visible,
			...(nodeIndex !== undefined ? { nodeIndex } : {}),
		};
		this._emit('visibility');
	}

	isDirty() {
		return (
			Object.keys(this.materialEdits).length > 0 ||
			Object.keys(this.transformEdits).length > 0 ||
			Object.keys(this.visibilityEdits).length > 0 ||
			Object.keys(this.textureEdits).length > 0
		);
	}

	/** Total number of recorded edits across every kind. */
	editCount() {
		return (
			Object.keys(this.materialEdits).length +
			Object.keys(this.transformEdits).length +
			Object.keys(this.visibilityEdits).length +
			Object.keys(this.textureEdits).length
		);
	}

	/**
	 * Replay previously-stashed edits onto the freshly loaded viewport.
	 * UUIDs don't cross the reload boundary, so matching is by name — the
	 * same strategy glb-export.js uses. After viewport mutation the three
	 * maps are re-keyed by the new uuid so further edits update in place.
	 *
	 * @param {{materialEdits?: object, transformEdits?: object, visibilityEdits?: object}} edits
	 */
	restoreEdits({ materialEdits, transformEdits, visibilityEdits, textureEdits } = {}) {
		this.materialEdits = { ...(materialEdits || {}) };
		this.transformEdits = { ...(transformEdits || {}) };
		this.visibilityEdits = { ...(visibilityEdits || {}) };
		this.textureEdits = { ...(textureEdits || {}) };
		this._applyRestoredToViewport();
		this._emit('reset');
	}

	_applyRestoredToViewport() {
		const content = this.viewer && this.viewer.content;
		if (!content) return;

		const matByName = new Map();
		const nodeByName = new Map();
		content.traverse((node) => {
			if (node.name && !nodeByName.has(node.name)) nodeByName.set(node.name, node);
			if (!node.geometry) return;
			const mats = Array.isArray(node.material) ? node.material : [node.material];
			for (const mat of mats) {
				if (mat && mat.name && !matByName.has(mat.name)) matByName.set(mat.name, mat);
			}
		});

		const rekey = (map, lookup, apply) => {
			const rekeyed = {};
			for (const k in map) {
				const edit = map[k];
				const target = lookup.get(edit.name);
				if (!target) {
					rekeyed[k] = edit;
					continue;
				}
				apply(target, edit);
				rekeyed[target.uuid] = { ...edit, uuid: target.uuid };
			}
			return rekeyed;
		};

		this.materialEdits = rekey(this.materialEdits, matByName, (mat, edit) => {
			if (edit.baseColor && mat.color) mat.color.setRGB(...edit.baseColor);
			if (edit.emissive && mat.emissive) mat.emissive.setRGB(...edit.emissive);
			if (edit.emissiveIntensity !== undefined) mat.emissiveIntensity = edit.emissiveIntensity;
			if (edit.metalness !== undefined) mat.metalness = edit.metalness;
			if (edit.roughness !== undefined) mat.roughness = edit.roughness;
			if (edit.opacity !== undefined) mat.opacity = edit.opacity;
			if (edit.alphaMode !== undefined) {
				mat.transparent = edit.alphaMode === 'BLEND';
			}
			if (edit.alphaCutoff !== undefined) mat.alphaTest = edit.alphaCutoff;
			mat.needsUpdate = true;
		});

		this.transformEdits = rekey(this.transformEdits, nodeByName, (node, edit) => {
			if (edit.position) node.position.fromArray(edit.position);
			if (edit.rotation) {
				node.rotation.set(edit.rotation[0], edit.rotation[1], edit.rotation[2]);
			}
			if (edit.scale) node.scale.fromArray(edit.scale);
		});

		this.visibilityEdits = rekey(this.visibilityEdits, nodeByName, (node, edit) => {
			node.visible = edit.visible !== false;
		});

		for (const key in this.textureEdits) {
			const edit = this.textureEdits[key];
			const mat = matByName.get(edit.name);
			if (!mat) continue;
			edit.materialUuid = mat.uuid;
			previewTexture(mat, edit.slot, edit.bytes, edit.mime)
				.then(() => this.viewer?.invalidate?.())
				.catch((e) => log.warn('[editor.session] could not preview restored texture', e));
		}

		if (this.viewer && this.viewer.invalidate) this.viewer.invalidate();
	}

	async getSourceBuffer() {
		if (this.sourceBuffer) return this.sourceBuffer;

		if (this.sourceFile) {
			this.sourceBuffer = await this.sourceFile.arrayBuffer();
			return this.sourceBuffer;
		}

		if (this.sourceURL) {
			const res = await fetch(this.sourceURL);
			if (!res.ok) throw new Error(`Failed to fetch source: ${res.status}`);
			this.sourceBuffer = await res.arrayBuffer();
			return this.sourceBuffer;
		}

		throw new Error('No source URL or File set on EditorSession');
	}
}
