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
		this._publishCtrl = null;
		this._saveCtrl = null;
		this._publishInFlight = false;
		this._saveNeedsAuth = false;
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
		this._publishCtrl = folder
			.add(
				{
					publish: () => this._openPublishModal(),
				},
				'publish',
			)
			.name('📤 publish as embed');
		folder
			.add(
				{
					explorer: () => this.sceneExplorer.toggle(),
				},
				'explorer',
			)
			.name('🗂 scene panel [T]');
		this._saveCtrl = folder
			.add({ save: () => this._saveEdits() }, 'save')
			.name('☁️ save edits');
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

	async _saveEdits() {
		if (this._saveNeedsAuth) {
			window.location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
			return;
		}
		const avatarId =
			this.session.avatarId ?? new URLSearchParams(location.search).get('avatarId');
		if (!avatarId) {
			this._saveCtrl?.name('⚠ use Publish instead');
			setTimeout(() => this._saveCtrl?.name('☁️ save edits'), 2500);
			return;
		}
		const LABEL = '☁️ save edits';
		const stepPct = { export: 0, presign: 0.25, upload: 0.4, patch: 0.9 };
		const onStep = ({ step, pct }) => {
			const base = stepPct[step] ?? 0;
			const span = step === 'upload' ? 0.5 : step === 'export' ? 0.25 : step === 'presign' ? 0.15 : 0.1;
			const overall = Math.round((base + pct * span) * 100);
			this._saveCtrl?.name(`saving… ${overall}%`);
		};
		try {
			const { saveEditedAvatar } = await import('./save-back.js');
			await saveEditedAvatar(this.session, { avatarId, onStep });
			this._saveCtrl?.name('saved ✓');
			setTimeout(() => this._saveCtrl?.name(LABEL), 1500);
		} catch (err) {
			if (err?.code === 'auth') {
				this._saveNeedsAuth = true;
				this._saveCtrl?.name('⚠ sign in to save (click)');
			} else {
				console.error('[editor] save failed', err);
				this._saveCtrl?.name('⚠ ' + (err?.message || 'save failed'));
				setTimeout(() => this._saveCtrl?.name(LABEL), 3000);
			}
		}
	}

	_resetAll() {
		if (!this.session.isDirty()) return;
		if (!window.confirm('Discard all edits and reload the model?')) return;
		window.location.reload();
	}

	async _openPublishModal() {
		if (this._publishInFlight) return;
		this._publishInFlight = true;
		this._setPublishEnabled(false);

		let modal = null;
		try {
			const [publishMod, modalMod] = await Promise.all([
				import('./publish.js'),
				import('./publish-modal.js'),
			]);
			const { publishEditedGLB, AuthRequiredError } = publishMod;
			const { PublishModal } = modalMod;

			modal = new PublishModal(document.body, { session: this.session });
			modal.onRetry(() => this._openPublishModal());
			modal.open();

			try {
				const result = await publishEditedGLB(this.session, { onStep: modal.onStep });
				modal.showResult(result.urls);
			} catch (err) {
				if (err instanceof AuthRequiredError || err?.name === 'AuthRequiredError') {
					modal.showAuthRequired();
				} else {
					modal.showError(err);
				}
				console.error('[editor] publish failed', err);
			}
		} catch (err) {
			console.error('[editor] publish modal failed to load', err);
			if (modal) modal.showError(err);
			else window.alert('Publish failed: ' + (err.message || err));
		} finally {
			this._publishInFlight = false;
			this._setPublishEnabled(true);
		}
	}

	_setPublishEnabled(enabled) {
		if (!this._publishCtrl) return;
		const row = this._publishCtrl.__li || this._publishCtrl.domElement;
		if (row) {
			row.style.pointerEvents = enabled ? '' : 'none';
			row.style.opacity = enabled ? '' : '0.4';
		}
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
		this._publishCtrl = null;
		this._saveCtrl = null;
		this._attached = false;
	}
}
