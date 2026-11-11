// Opening a model from Windows Explorer. The manifest's file_handlers member
// launches /app?source=file-handler and Chromium hands the file to the page
// through window.launchQueue. Headless Chromium has no OS to double-click in, so
// the one stub here is the launchQueue itself (browser plumbing, not our code):
// it captures the consumer src/pwa/launch-files.js installs and then delivers a
// file handle backed by the real bytes of a .glb from public/. Everything after
// that, reading the handle, building the file map and rendering it in the
// viewer, is the shipped client code. The file must never leave the machine.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GLB_NAME = 'glasses-round.glb';
const GLB_BYTES = readFileSync(join(process.cwd(), 'public', 'accessories', GLB_NAME));

test('a .glb launched from the OS renders in /app without being uploaded', async ({ page }) => {
	test.setTimeout(240_000);

	const writes = [];
	const consoleErrors = [];
	page.on('request', (req) => {
		if (req.method() === 'GET' || req.method() === 'HEAD' || req.method() === 'OPTIONS') return;
		const body = req.postDataBuffer();
		writes.push({
			url: req.url(),
			method: req.method(),
			carriesGlb: !!body && body.includes(Buffer.from('glTF')) && body.length >= GLB_BYTES.length,
		});
	});
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});

	await page.addInitScript(() => {
		const queue = {
			consumer: null,
			setConsumer(fn) {
				this.consumer = fn;
			},
		};
		Object.defineProperty(window, 'launchQueue', { value: queue, configurable: true });
	});

	await page.goto('/app?source=file-handler', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.launchQueue?.consumer === 'function', null, { timeout: 180_000 });

	// A file launch must not pull the default stage rig: the viewer waits for the file.
	expect(await page.evaluate(() => window.VIEWER?.app?._currentModelUrl || null)).toBeNull();

	await page.evaluate(
		async ({ name, b64 }) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			const file = new File([bytes], name, { type: 'model/gltf-binary' });
			await window.launchQueue.consumer({ files: [{ kind: 'file', name, getFile: async () => file }] });
		},
		{ name: GLB_NAME, b64: GLB_BYTES.toString('base64') },
	);

	await page.waitForFunction(
		(name) => window.VIEWER?.app?._currentLocalFile?.name === name && !!window.VIEWER.app.viewer?.content,
		GLB_NAME,
		{ timeout: 120_000 },
	);

	const loaded = await page.evaluate(() => {
		const app = window.VIEWER.app;
		let meshes = 0;
		app.viewer.content.traverse((o) => {
			if (o.isMesh) meshes++;
		});
		return { size: app._currentLocalFile.size, remoteUrl: app._currentModelUrl, meshes };
	});
	expect(loaded.size).toBe(GLB_BYTES.length);
	expect(loaded.remoteUrl).toBeNull();
	expect(loaded.meshes).toBeGreaterThan(0);

	// Nothing carrying the model, and nothing to an upload or storage endpoint.
	expect(writes.filter((w) => w.carriesGlb)).toEqual([]);
	expect(writes.filter((w) => /\/api\/(avatars|upload|presign|r2|storage|forge)/i.test(w.url))).toEqual([]);
	expect(consoleErrors.filter((t) => /launch|file-handler|launched file/i.test(t))).toEqual([]);
});

test('a launch with no model explains what to do instead of failing silently', async ({ page }) => {
	test.setTimeout(240_000);
	await page.addInitScript(() => {
		const queue = {
			consumer: null,
			setConsumer(fn) {
				this.consumer = fn;
			},
		};
		Object.defineProperty(window, 'launchQueue', { value: queue, configurable: true });
	});
	await page.goto('/app?source=file-handler', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => typeof window.launchQueue?.consumer === 'function', null, { timeout: 180_000 });
	await page.evaluate(async () => {
		const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
		await window.launchQueue.consumer({ files: [{ kind: 'file', name: 'notes.txt', getFile: async () => file }] });
	});
	await expect(page.getByText('None of the opened files is a .glb, .gltf or .vrm model')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'Choose a file' })).toBeVisible();
});
