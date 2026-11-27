// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { buildIntakeImageSet } from '../scripts/forge-intake-fixtures.mjs';
import { installForgeDropzone } from '../src/shared/forge-dropzone.js';

// The page-level capture paths on /forge and Forge Studio (paste anywhere, drop
// anywhere, paste or drop an image link) share one module. What this pins:
// a file is judged by its bytes, not its name or the type the OS guessed, so a
// HEIC with no type is added and a PDF renamed .jpg is refused with a message
// naming the formats that work; a pasted or dragged link is fetched through
// /api/forge-upload { source_url } and added like any dropped photo; and both
// pages get the same behavior, differing only in how many views they take.

let set;
const fileOf = (id) => {
	const item = set.find((x) => x.id === id);
	return new File([item.bytes], item.name, { type: item.type });
};

function dataTransfer({ files = [], text = '', uriList = '' } = {}) {
	const types = [];
	if (files.length) types.push('Files');
	if (uriList) types.push('text/uri-list');
	if (text) types.push('text/plain');
	return {
		files,
		types,
		getData: (t) => (t === 'text/uri-list' ? uriList : t === 'text/plain' || t === 'text' ? text : ''),
	};
}

function paste(target, data) {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', { value: dataTransfer(data) });
	target.dispatchEvent(e);
	return e;
}

function drop(target, data) {
	const e = new Event('drop', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'dataTransfer', { value: dataTransfer(data) });
	target.dispatchEvent(e);
	return e;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
	for (let i = 0; i < 20; i++) await flush();
}

const added = [];
const onAdd = (e) => added.push(e.detail.files);
const toastText = () => document.querySelector('.forge-toast')?.textContent || '';

let fetchImpl;

beforeAll(async () => {
	set = await buildIntakeImageSet();
	document.body.innerHTML = '<div id="mode-switch"><button data-mode="image" aria-selected="true"></button></div><input id="prompt"><div class="view-slot"></div>';
	fetchImpl = vi.fn();
	installForgeDropzone({ maxViews: 6, fetchImpl: (...a) => fetchImpl(...a) });
	// A second install (the module is imported by both pages' installers and
	// may be evaluated twice in dev) must not double every event.
	installForgeDropzone({ maxViews: 6, fetchImpl: (...a) => fetchImpl(...a) });
}, 60_000);

beforeEach(() => {
	added.length = 0;
	fetchImpl = vi.fn();
	document.addEventListener('forge:add-images', onAdd);
});
afterEach(() => document.removeEventListener('forge:add-images', onAdd));

describe('forge dropzone: files are judged by their bytes', () => {
	it('a pasted JPEG is added once, as the same File', async () => {
		const file = fileOf('jpeg');
		const e = paste(document.body, { files: [file] });
		expect(e.defaultPrevented).toBe(true);
		await settle();
		expect(added).toEqual([[file]]);
	});

	it.each(['heic-untyped', 'avif', 'gif-animated', 'exif-rotated', 'huge-bytes', 'wide'])(
		'a dropped %s is passed on for the page to convert, not dropped',
		async (id) => {
			drop(document.body, { files: [fileOf(id)] });
			await settle();
			expect(added).toHaveLength(1);
			expect(added[0]).toHaveLength(1);
		},
	);

	it.each(['pdf-as-jpg', 'html-as-jpg', 'empty'])('a dropped %s is refused with a message, never passed on', async (id) => {
		drop(document.body, { files: [fileOf(id)] });
		await settle();
		expect(added).toHaveLength(0);
		expect(toastText()).toMatch(/\S/);
	});

	it('the refusal for a renamed PDF names it and the formats that work', async () => {
		drop(document.body, { files: [fileOf('pdf-as-jpg')] });
		await settle();
		expect(toastText()).toMatch(/PDF/);
		expect(toastText()).toMatch(/JPG/);
		expect(toastText()).toMatch(/HEIC/);
	});

	it('a mixed drop adds the photos and says which file was left out', async () => {
		drop(document.body, { files: [fileOf('jpeg'), fileOf('pdf-as-jpg'), fileOf('webp')] });
		await settle();
		expect(added).toHaveLength(1);
		expect(added[0].map((f) => f.name)).toEqual(['mug.jpg', 'shoe.webp']);
		expect(toastText()).toMatch(/scan\.jpg/);
	});

	it('a drop on a view slot is left to the slot (no double add)', async () => {
		drop(document.querySelector('.view-slot'), { files: [fileOf('jpeg')] });
		await settle();
		expect(added).toHaveLength(0);
	});
});

describe('forge dropzone: image links', () => {
	const okImage = (bytes, format) =>
		new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-image-format': format } });

	it('a pasted image link outside a text field is fetched through the server and added', async () => {
		const jpeg = set.find((x) => x.id === 'jpeg').bytes;
		fetchImpl.mockResolvedValue(okImage(jpeg, 'jpeg'));
		const e = paste(document.body, { text: 'https://images.example/photos/mug.jpg' });
		expect(e.defaultPrevented).toBe(true);
		await settle();
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('/api/forge-upload');
		expect(JSON.parse(init.body)).toEqual({ source_url: 'https://images.example/photos/mug.jpg' });
		expect(added).toHaveLength(1);
		expect(added[0][0].type).toBe('image/jpeg');
		expect(added[0][0].name).toBe('mug.jpg');
	});

	it('a link pasted into a text field is left alone', async () => {
		const e = paste(document.getElementById('prompt'), { text: 'https://images.example/mug.jpg' });
		expect(e.defaultPrevented).toBe(false);
		await settle();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('ordinary pasted text is left alone', async () => {
		const e = paste(document.body, { text: 'a red ceramic mug' });
		expect(e.defaultPrevented).toBe(false);
		await settle();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('an image dragged in from another tab (a link, no file) is fetched too, even onto a slot', async () => {
		const png = set.find((x) => x.id === 'png-alpha').bytes;
		fetchImpl.mockResolvedValue(okImage(png, 'png'));
		drop(document.querySelector('.view-slot'), { uriList: '# comment\nhttps://cdn.example/a/cup.png\n' });
		await settle();
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body).source_url).toBe('https://cdn.example/a/cup.png');
		expect(added).toHaveLength(1);
	});

	it('a link that cannot be fetched shows the server\'s own reason', async () => {
		const message = 'Forge could not reach that link: the site did not answer in time or closed the connection. Save the image to your device and add it from there.';
		fetchImpl.mockResolvedValue(
			new Response(JSON.stringify({ error: 'url_unreachable', message }), { status: 502, headers: { 'content-type': 'application/json' } }),
		);
		paste(document.body, { text: 'https://slow.example/a.jpg' });
		await settle();
		expect(added).toHaveLength(0);
		expect(toastText()).toBe(message);
	});
});

describe('forge dropzone: one module, two pages', () => {
	it('the drop overlay says how many views this page takes', () => {
		drop(document.body, {});
		expect(document.querySelector('.forge-drop-card').textContent).toMatch(/1-6 views/);
	});
});
