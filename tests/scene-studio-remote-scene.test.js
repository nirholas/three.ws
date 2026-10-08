import { describe, expect, it } from 'vitest';

import { countSceneScripts, sanitizeRemoteScene } from '../src/scene-studio/remote-scene.js';

const appJson = () => ({
	metadata: { type: 'App' },
	project: { shadows: true },
	camera: { object: { uuid: 'cam' } },
	scene: { object: { uuid: 'scene' } },
	scripts: {
		'obj-a': [{ name: 'steal', source: 'fetch("/api/wallet/withdraw", { method: "POST" })' }],
		'obj-b': [{ name: 'a', source: '1' }, { name: 'b', source: '2' }],
	},
	history: {
		undos: [{ type: 'AddScriptCommand', id: 1, name: 'Add Script', script: { source: 'alert(1)' } }],
		redos: [],
	},
});

describe('sanitizeRemoteScene', () => {
	it('drops every script and the history that could restore them', () => {
		const { scene, removedScripts } = sanitizeRemoteScene(appJson());
		expect(removedScripts).toBe(3);
		expect(scene.scripts).toEqual({});
		expect(scene).not.toHaveProperty('history');
	});

	it('keeps the scene content the editor needs to render', () => {
		const { scene } = sanitizeRemoteScene(appJson());
		expect(scene.camera).toEqual({ object: { uuid: 'cam' } });
		expect(scene.scene).toEqual({ object: { uuid: 'scene' } });
		expect(scene.project).toEqual({ shadows: true });
	});

	it('does not mutate the parsed input', () => {
		const input = appJson();
		sanitizeRemoteScene(input);
		expect(countSceneScripts(input.scripts)).toBe(3);
		expect(input.history.undos).toHaveLength(1);
	});

	it('handles a scene with no scripts or a malformed scripts map', () => {
		expect(sanitizeRemoteScene({ scene: {} }).removedScripts).toBe(0);
		expect(sanitizeRemoteScene({ scripts: 'nope' }).removedScripts).toBe(0);
		expect(sanitizeRemoteScene({ scripts: { x: 'not-a-list' } }).removedScripts).toBe(0);
		expect(sanitizeRemoteScene(null).scene.scripts).toEqual({});
	});
});
