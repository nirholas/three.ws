// @vitest-environment jsdom
// GLTFLoader clones a glTF material once per morph/skin variant, so one named
// glTF material (a skin shared by a skinned body and a morphing head) arrives as
// two Three.js materials with the same name. dat.gui refuses duplicate folder
// names, and the material editor used to throw on them, failing the model load.
import { describe, it, expect } from 'vitest';
import { GUI } from 'dat.gui';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { MaterialEditor } from '../src/editor/material-editor.js';

function viewerWith(materials) {
	const content = new Group();
	for (const mat of materials) content.add(new Mesh(new BoxGeometry(), mat));
	return { content, gui: new GUI({ autoPlace: false }) };
}

describe('MaterialEditor', () => {
	it('builds a folder for every material when two share a name', () => {
		const skinA = new MeshStandardMaterial({ name: 'Skin' });
		const skinB = skinA.clone();
		const eyes = new MeshStandardMaterial({ name: 'Eyes' });
		const unnamed = new MeshStandardMaterial();
		const viewer = viewerWith([skinA, skinB, eyes, unnamed]);
		const editor = new MaterialEditor(viewer, { recordMaterialEdit() {} });

		expect(() => editor.rebuild()).not.toThrow();
		expect(editor.subfolders).toHaveLength(4);
		const labels = Object.keys(editor.folder.__folders);
		expect(new Set(labels).size).toBe(4);
		expect(labels).toContain('Skin');
		expect(labels).toContain('Eyes');
	});

	it('rebuilds cleanly for the next model', () => {
		const skin = new MeshStandardMaterial({ name: 'Skin' });
		const viewer = viewerWith([skin, skin.clone()]);
		const editor = new MaterialEditor(viewer, { recordMaterialEdit() {} });
		editor.rebuild();
		expect(() => editor.rebuild()).not.toThrow();
		expect(editor.subfolders).toHaveLength(2);
	});
});
