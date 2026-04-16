/**
 * Editor — orchestrator that wires Material Editor, Texture Inspector,
 * Scene Explorer, and GLB export into the Viewer.
 *
 * Usage:
 *   const editor = new Editor(viewer);
 *   editor.attach();                          // once, after viewer constructed
 *   editor.onContentChanged({ url, file });   // every time a new model loads
 */
import { EditorSession } from './session.js';
import { MaterialEditor } from './material-editor.js';
import { SceneExplorer } from './scene-explorer.js';
import { TextureInspector } from './texture-inspector.js';
import { exportEditedGLB, downloadGLB } from './glb-export.js';

export class Editor {
	constructor(viewer) {
		this.viewer = viewer;
		this.session = new EditorSession(viewer);
		this.materialEditor = new MaterialEditor(viewer, this.session);
		this.textureInspector = new TextureInspector(viewer, this.session);
		this.sceneExplorer = new SceneExplorer(viewer, this.session);
		this.exportFolder = null;
		this._exportCtrl = null;
		this._attached = false;
	}

	attach() {
		if (this._attached) return;
		this._attached = true;
		this.sceneExplorer.attach();
		this._addExportFolder();
		this.session.onChange(() => {
			this._updateExportLabel();
			this._updateExportEnabled();
		});
		this._updateExportEnabled();
	}

	onContentChanged({ url = null, file = null, name = null } = {}) {
		this.session.reset({ url, file, name });
		this.materialEditor.rebuild();
		this.textureInspector.rebuild();
		this.sceneExplorer.rebuild();
		this._updateExportLabel();
	}

	_addExportFolder() {
		if (!this.viewer.gui) return;
		const folder = this.viewer.gui.addFolder('Editor');
		this._exportCtrl = folder
			.add(
				{
					download: () => this._exportGLB(),
				},
				'download',
			)
			.name('💾 download GLB');
		folder
			.add(
				{
					explorer: () => this.sceneExplorer.toggle(),
				},
				'explorer',
			)
			.name('🗂 scene panel [T]');
		folder
			.add(
				{
					reset: () => this._resetAll(),
				},
				'reset',
			)
			.name('↺ revert all edits');
		this.exportFolder = folder;
	}

	_updateExportLabel() {
		if (!this._exportCtrl) return;
		const count =
			Object.keys(this.session.materialEdits).length +
			Object.keys(this.session.transformEdits).length +
			Object.keys(this.session.visibilityEdits).length;
		const base = '💾 download GLB';
		this._exportCtrl.name(count > 0 ? `${base} (${count})` : base);
	}

	_updateExportEnabled() {
		if (!this._exportCtrl) return;
		const ready = this.session.isExportReady();
		const row = this._exportCtrl.__li || this._exportCtrl.domElement;
		if (row) {
			row.style.pointerEvents = ready ? '' : 'none';
			row.style.opacity = ready ? '' : '0.4';
		}
	}

	async _exportGLB() {
		try {
			const bytes = await exportEditedGLB(this.session);
			const base = (this.session.sourceName || 'model')
				.replace(/\?.*$/, '')
				.replace(/\.(glb|gltf)$/i, '');
			downloadGLB(bytes, `${base}.edited.glb`);
		} catch (err) {
			console.error('[editor] GLB export failed', err);
			window.alert('GLB export failed: ' + (err.message || err));
		}
	}

	_resetAll() {
		if (!this.session.isDirty()) return;
		if (!window.confirm('Discard all edits and reload the model?')) return;
		window.location.reload();
	}

	dispose() {
		this.materialEditor.dispose();
		this.textureInspector.dispose();
		this.sceneExplorer.detach();
		if (this.exportFolder && this.viewer.gui) {
			try {
				this.viewer.gui.removeFolder(this.exportFolder);
			} catch (e) {}
		}
		this.exportFolder = null;
		this._exportCtrl = null;
		this._attached = false;
	}
}
