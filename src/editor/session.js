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
