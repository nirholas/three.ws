'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const { mount } = require('../src/panel');
const { resultFolder } = require('../src/core/results');
const { MESSAGES } = require('../src/core/errors');
const { startC4Server, memoryStore, bufferFile, instantSleep, KEY } = require('./c4-server');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const box = (type, payload) => {
	const b = Buffer.alloc(8 + payload.length);
	b.writeUInt32BE(b.length, 0);
	b.write(type, 4, 'ascii');
	payload.copy(b, 8);
	return b;
};
function mp4(width, height, seconds) {
	const mvhd = Buffer.alloc(100);
	mvhd.writeUInt32BE(1000, 12);
	mvhd.writeUInt32BE(seconds * 1000, 16);
	const tkhd = Buffer.alloc(84);
	tkhd.writeUInt32BE(width * 65536, 76);
	tkhd.writeUInt32BE(height * 65536, 80);
	return Buffer.concat([box('ftyp', Buffer.from('isom0000isomiso2')), box('mdat', crypto.randomBytes(4000)), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]))]);
}

const nodeSink = {
	open: (p) => fsp.open(p, 'w'),
	write: (h, chunk) => h.write(chunk),
	close: (h) => h.close(),
	remove: (p) => fsp.rm(p, { force: true }),
};

async function rig({ key = KEY, clip = null, files = {}, serverOptions = {} } = {}) {
	const server = await startC4Server({ partSize: 2048, ...serverOptions });
	const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'uxp-panel-'));
	const dom = new JSDOM(html.replace(/<script[^>]*src="src\/panel.js"[^>]*><\/script>/, ''), { pretendToBeVisual: true });
	const calls = { inserted: [], opened: [], imported: [] };
	let storedKey = key;
	const deps = {
		origin: server.origin,
		fetchImpl: fetch,
		sleep: instantSleep,
		win: dom.window,
		openExternal: (u) => calls.opened.push(u),
		storage: { getApiKey: async () => storedKey, setApiKey: async (k) => (storedKey = k), clearApiKey: async () => (storedKey = '') },
		resumeStore: memoryStore(),
		premiere: {
			projectInfo: async () => ({ path: path.join(tmp, 'Trip.prproj'), name: 'Trip' }),
			selectedClip: async () => clip,
			importIntoBin: async (paths) => calls.imported.push(...paths),
			hasActiveSequence: async () => true,
			insertAtPlayhead: async (p) => calls.inserted.push(p),
		},
		files: {
			openLocalFile: async (p, ct) => bufferFile(path.basename(p), files[p], ct),
			expandSplitPair: async (p) => [p],
			pickFile: async () => Object.keys(files)[0],
			ensureFolder: async (dir, levels, sep) => {
				const d = path.join(dir, ...levels);
				await fsp.mkdir(d, { recursive: true });
				return d;
			},
			fileSink: nodeSink,
			fetchStream: (u) => fetch(u),
			dataFolderTarget: async (id) => ({ folder: tmp, sep: path.sep }),
		},
	};
	deps.host = { openFile: deps.files.openLocalFile, expandSplitPair: deps.files.expandSplitPair };
	const panel = mount(dom.window.document, deps);
	const $ = (id) => dom.window.document.getElementById(id);
	const close = async () => {
		dom.window.close();
		await server.close();
		await fsp.rm(tmp, { recursive: true, force: true });
	};
	return { panel, $, calls, server, tmp, dom, close, setKey: (k) => (storedKey = k) };
}

test('every element id the controller needs exists in index.html', async () => {
	const r = await rig();
	try {
		for (const [name, node] of Object.entries(r.panel.el)) assert.ok(node, `#${name} is missing from index.html`);
	} finally {
		await r.close();
	}
});

test('first run: asks for a key, shows the Get an API key link, and the empty states explain what to do', async () => {
	const r = await rig({ key: '' });
	try {
		await r.panel.refresh();
		assert.equal(r.$('key-form').hidden, false);
		assert.equal(r.$('key-saved').hidden, true);
		assert.equal(r.$('empty').hidden, false);
		assert.equal(r.$('chosen').hidden, true);
		assert.equal(r.$('mine-empty').hidden, false);
		assert.ok(r.$('send').hasAttribute('disabled'));
		r.$('key-get').dispatchEvent(new r.dom.window.Event('click', { cancelable: true }));
		assert.deepEqual(r.calls.opened, ['https://three.ws/dashboard/api']);
		r.$('key-save').dispatchEvent(new r.dom.window.Event('click'));
		await new Promise((x) => setTimeout(x, 10));
		assert.equal(r.$('banner').hidden, false);
		assert.equal(r.$('banner-text').textContent, MESSAGES.missing_key);
	} finally {
		await r.close();
	}
});

test('saving a key stores it, hides the form and loads Your captures', async () => {
	const r = await rig({ key: '' });
	try {
		await r.panel.refresh();
		r.$('key-input').value = ` ${KEY} `;
		r.$('key-save').dispatchEvent(new r.dom.window.Event('click'));
		for (let i = 0; i < 100 && (r.$('key-saved').hidden || !r.$('mine-loading').hidden); i++) await new Promise((x) => setTimeout(x, 20));
		assert.equal(r.$('key-form').hidden, true);
		assert.equal(r.$('key-saved').hidden, false);
		assert.equal(r.$('mine-empty').hidden, false, 'a valid key with no captures shows the empty state');
		assert.equal(r.$('mine-error').hidden, true);
	} finally {
		await r.close();
	}
});

test('a rejected key shows the visitor message in the captures list, not a stack trace', async () => {
	const r = await rig({ key: 'wrong' });
	try {
		await r.panel.refresh();
		assert.equal(r.$('mine-error').hidden, false);
		assert.equal(r.$('mine-error-text').textContent, MESSAGES.sign_in_required);
	} finally {
		await r.close();
	}
});

test('selected clip with in/out points: trim, quality, send, progress and result card', async () => {
	const video = mp4(5760, 2880, 40);
	const clipPath = '/media/walk.mp4';
	const r = await rig({ clip: { path: clipPath, inSeconds: 3, outSeconds: 15, durationSeconds: 40 }, files: { [clipPath]: video } });
	try {
		await r.panel.refresh();
		assert.equal(r.$('chosen').hidden, false);
		assert.equal(r.$('chosen-name').textContent, 'walk.mp4');
		assert.equal(r.$('confirm-360').hidden, true, '2:1 proves 360, no confirmation needed');
		assert.equal(r.$('trim-row').hidden, false);
		assert.match(r.$('trim-detail').textContent, /3s to 15s/);
		assert.ok(!r.$('send').hasAttribute('disabled'));

		await r.panel.send();
		const job = [...r.server.jobs.values()][0];
		assert.deepEqual(job.body.trim, { start_s: 3, end_s: 15 });
		assert.equal(job.body.quality, 'standard');
		assert.equal(r.$('result-card').hidden, false);
		assert.equal(r.$('progress-card').hidden, true);
		assert.equal(r.$('viewer-url').textContent, `${r.server.origin}/splat?job=${job.id}`);
		assert.match(r.$('result-folder').textContent, /Trip_three\.ws/);
		assert.equal(r.calls.imported.length, 4);
		assert.equal(r.$('insert-preview').hidden, false);

		r.$('insert-preview').dispatchEvent(new r.dom.window.Event('click'));
		await new Promise((x) => setTimeout(x, 10));
		assert.equal(r.calls.inserted.length, 1);
		assert.match(r.calls.inserted[0], /preview\.mp4$/);

		r.$('open-viewer').dispatchEvent(new r.dom.window.Event('click'));
		assert.equal(r.calls.opened.at(-1), `${r.server.origin}/splat?job=${job.id}`);

		await r.panel.loadMine();
		assert.equal(r.$('mine-list').children.length, 1, 'the finished job is listed with an Import button');
	} finally {
		await r.close();
	}
});

test('a non-2:1 file asks for confirmation and the failure message is shown if the server refuses', async () => {
	const p = '/media/flat.mp4';
	const r = await rig({ files: { [p]: mp4(1920, 1080, 5) } });
	try {
		await r.panel.refresh();
		await r.panel.chooseInput(p, null);
		assert.equal(r.$('confirm-360').hidden, false);
		await r.panel.send();
		assert.equal(r.$('banner').hidden, false);
		assert.equal(r.$('banner-text').textContent, MESSAGES.not_360);
		assert.equal(r.server.uploads.size, 0);
	} finally {
		await r.close();
	}
});

test('a job failure is shown with its visitor message and the buttons recover', async () => {
	const p = '/media/a.mp4';
	const r = await rig({ files: { [p]: mp4(4096, 2048, 5) }, serverOptions: { failJob: { code: 'reconstruction_failed', message: 'x', hint: 'op' } } });
	try {
		await r.panel.refresh();
		await r.panel.chooseInput(p, null);
		await r.panel.send();
		assert.equal(r.$('banner-text').textContent, MESSAGES.reconstruction_failed);
		assert.equal(r.$('cancel').hidden, true);
		assert.equal(r.$('send').hidden, false);
		assert.ok(!r.$('send').hasAttribute('disabled'));
	} finally {
		await r.close();
	}
});

test('no selected clip gives a helpful message, and going offline raises the offline banner', async () => {
	const r = await rig({ clip: null });
	try {
		await r.panel.refresh();
		await r.panel.useSelected();
		assert.equal(r.$('banner-text').textContent, MESSAGES.no_selection);
		r.dom.window.dispatchEvent(new r.dom.window.Event('offline'));
		assert.equal(r.$('banner-text').textContent, MESSAGES.offline);
		r.dom.window.dispatchEvent(new r.dom.window.Event('online'));
		assert.equal(r.$('banner').hidden, true);
	} finally {
		await r.close();
	}
});
