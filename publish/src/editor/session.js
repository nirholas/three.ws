/**
 * EditorSession — central state for live-editable properties on a loaded model.
 *
 * Three kinds of edits are tracked and replayed at export time:
 *   - materialEdits   keyed by Three.js material.uuid
 *   - transformEdits  keyed by Three.js Object3D.uuid
 *   - visibilityEdits keyed by Three.js Object3D.uuid
 *
 * We also keep the raw source bytes so we can re-serialize a modified GLB
 * via glTF-Transform without refetching. Bytes are captured lazily either
 * from a URL or from a File.
 */
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
		if (!url && !file) {
			console.warn('[editor] no source — export disabled');
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

	_emit() {
		for (const fn of this._listeners) {
			try {
				fn(this);
			} catch (e) {
				console.warn('[editor.session] listener error', e);
			}
		}
	}

	recordMaterialEdit(material, patch) {
		const key = material.uuid;
		const existing = this.materialEdits[key] || { name: material.name, uuid: key };
		this.materialEdits[key] = { ...existing, ...patch };
		this._emit();
	}

	clearMaterialEdit(material) {
		delete this.materialEdits[material.uuid];
		this._emit();
	}

	recordTransformEdit(node) {
		this.transformEdits[node.uuid] = {
			name: node.name,
			uuid: node.uuid,
			position: node.position.toArray(),
			rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
			scale: node.scale.toArray(),
		};
		this._emit();
	}

	recordVisibilityEdit(node, visible) {
		this.visibilityEdits[node.uuid] = { name: node.name, visible };
		this._emit();
	}

	isDirty() {
		return (
			Object.keys(this.materialEdits).length > 0 ||
			Object.keys(this.transformEdits).length > 0 ||
			Object.keys(this.visibilityEdits).length > 0
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
	restoreEdits({ materialEdits, transformEdits, visibilityEdits } = {}) {
		this.materialEdits = { ...(materialEdits || {}) };
		this.transformEdits = { ...(transformEdits || {}) };
		this.visibilityEdits = { ...(visibilityEdits || {}) };
		this._applyRestoredToViewport();
		this._emit();
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
