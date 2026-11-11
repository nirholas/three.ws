import { describe, expect, it, vi } from 'vitest';
import {
	filesFromLaunchParams,
	installLaunchConsumer,
	isFileLaunch,
} from '../src/pwa/launch-files.js';

const handle = (name, body = 'x') => ({
	kind: 'file',
	name,
	getFile: async () => new File([body], name),
});

describe('isFileLaunch', () => {
	it('matches only the file_handlers action source', () => {
		expect(isFileLaunch({ search: '?source=file-handler' })).toBe(true);
		expect(isFileLaunch({ search: '?source=pwa' })).toBe(false);
		expect(isFileLaunch({ search: '' })).toBe(false);
	});
});

describe('filesFromLaunchParams', () => {
	it('reads every handle into a name map and flags a model', async () => {
		const res = await filesFromLaunchParams({ files: [handle('scene.gltf'), handle('scene.bin')] });
		expect([...res.files.keys()]).toEqual(['scene.gltf', 'scene.bin']);
		expect(res.hasModel).toBe(true);
	});

	it('treats .vrm as a model and ignores directory handles', async () => {
		const res = await filesFromLaunchParams({
			files: [{ kind: 'directory', name: 'dir', getFile: async () => null }, handle('Avatar.VRM')],
		});
		expect([...res.files.keys()]).toEqual(['Avatar.VRM']);
		expect(res.hasModel).toBe(true);
	});

	it('reports handles that cannot be read', async () => {
		const res = await filesFromLaunchParams({
			files: [{ kind: 'file', name: 'gone.glb', getFile: async () => Promise.reject(new Error('NotFoundError')) }],
		});
		expect(res.hasModel).toBe(false);
		expect(res.skipped).toEqual(['gone.glb']);
	});
});

describe('installLaunchConsumer', () => {
	it('returns false where the browser has no launch queue', () => {
		expect(installLaunchConsumer(() => {}, () => {}, {})).toBe(false);
	});

	it('hands model files to the viewer and explains non-model launches', async () => {
		let consumer;
		const win = { launchQueue: { setConsumer: (fn) => (consumer = fn) } };
		const onFiles = vi.fn();
		const onError = vi.fn();
		expect(installLaunchConsumer(onFiles, onError, win)).toBe(true);

		await consumer({ files: [] });
		expect(onFiles).not.toHaveBeenCalled();

		await consumer({ files: [handle('robot.glb')] });
		expect(onFiles).toHaveBeenCalledTimes(1);
		expect(onFiles.mock.calls[0][0].get('robot.glb')).toBeInstanceOf(File);

		await consumer({ files: [handle('notes.txt')] });
		expect(onError).toHaveBeenCalledWith(expect.stringContaining('.glb, .gltf or .vrm'));
	});
});
