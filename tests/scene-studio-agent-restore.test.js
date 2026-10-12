/**
 * Scene Studio Agent tab: SceneAgent.restoreVersion regression test.
 *
 * restoreVersion used to execute a plain SetSceneCommand to step back to an
 * earlier version. SetSceneCommand's constructor only ever pushes
 * AddObjectCommands for the loaded scene's children; it never removes the
 * current scene's children, because its one vendor call site
 * (vendor/js/Loader.js, "import as scene") always runs right after
 * editor.clear(). Reusing it here left the version's objects stacked on top
 * of whatever was already in the scene instead of replacing it, so
 * "restore an earlier version" silently duplicated objects and never
 * actually went back. The fix composes explicit Remove + Add commands under
 * one MultiCmdsCommand instead.
 *
 * These tests build a real vendored Editor (the same class main.js
 * constructs), stubbing only the two browser globals the vendor code reads
 * at construction time: `window` (Storage falls back to a no-op stub when
 * `window.indexedDB` is undefined) and `navigator.language` (Config's
 * startup default), plus the `signals` pub/sub library main.js normally
 * gets from the classic `<script>` tag in pages/scene.html.
 */
import { describe, expect, it } from 'vitest';

class StubSignal {
	constructor() {
		this._listeners = [];
		this.active = true;
	}
	add(fn) {
		this._listeners.push(fn);
	}
	dispatch(...args) {
		if (!this.active) return;
		for (const fn of this._listeners) fn(...args);
	}
}

globalThis.window ??= {};
// Config.js reads/writes window.localStorage[name] as a plain property, not
// through getItem/setItem, so a bare object stands in for it.
globalThis.window.localStorage ??= {};
globalThis.navigator ??= { language: 'en-US' };
globalThis.signals = { Signal: StubSignal };
// Editor.js's module-level `save()` helper (File > Export, unused by these
// tests) creates an <a> at import time; give it an inert stand-in.
globalThis.document ??= { createElement: () => ({ style: {}, setAttribute() {}, click() {} }) };

const { Editor } = await import('../src/scene-studio/vendor/js/Editor.js');
const { AddObjectCommand } = await import('../src/scene-studio/vendor/js/commands/AddObjectCommand.js');
const { SetMaterialColorCommand } = await import('../src/scene-studio/vendor/js/commands/SetMaterialColorCommand.js');
const { SceneAgent } = await import('../src/scene-studio/agent-tab.js');
const THREE = await import('three');

function addBox(editor, name, colorHex) {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ color: colorHex }),
	);
	mesh.name = name;
	editor.execute(new AddObjectCommand(editor, mesh));
	return mesh;
}

describe('SceneAgent.restoreVersion', () => {
	it('replaces the scene with the snapshot instead of appending to it', () => {
		const editor = new Editor();
		const agent = new SceneAgent(editor);

		const redBox = addBox(editor, 'RedBox', 0xff0000);
		const v1 = agent.pushVersion('add red box');

		editor.execute(new SetMaterialColorCommand(editor, redBox, 'color', 0x00ff00));
		agent.pushVersion('recolor to green');
		expect(editor.scene.children).toHaveLength(1);
		expect(redBox.material.color.getHex()).toBe(0x00ff00);

		const restored = agent.restoreVersion(v1.id);

		expect(restored).toBe(true);
		expect(editor.scene.children).toHaveLength(1);
		expect(editor.scene.children[0].material.color.getHex()).toBe(0xff0000);
	});

	it('restoring a version is itself one more undoable edit', () => {
		const editor = new Editor();
		const agent = new SceneAgent(editor);

		addBox(editor, 'RedBox', 0xff0000);
		const v1 = agent.pushVersion('add red box');

		addBox(editor, 'BlueBox', 0x0000ff);
		agent.pushVersion('add blue box');
		expect(editor.scene.children).toHaveLength(2);

		agent.restoreVersion(v1.id);
		expect(editor.scene.children).toHaveLength(1);

		editor.undo();
		expect(editor.scene.children).toHaveLength(2);
	});

	it('returns false for an unknown version id and leaves the scene untouched', () => {
		const editor = new Editor();
		const agent = new SceneAgent(editor);
		addBox(editor, 'RedBox', 0xff0000);
		agent.pushVersion('add red box');

		expect(agent.restoreVersion('not-a-real-id')).toBe(false);
		expect(editor.scene.children).toHaveLength(1);
	});
});
