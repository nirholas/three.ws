#!/usr/bin/env node
// Push every image in the Forge intake set through the real /forge (or Studio)
// page in a real browser and record what the person would see, stopping before
// generation. Nothing is generated: the run ends at the uploaded photo tile.
//
// Usage:
//   npx vite --port 4109 --strictPort        (in another terminal)
//   node scripts/forge-intake-verify.mjs --base http://localhost:4109 --page /forge \
//        --out <dir> [--heic <real.heic>] [--label after] [--paths picker,paste,drop,link]
//
// Signed in as the QA account from .auth/audit-state.json (refresh it with
// `npm run audit:web:login`). The dev server proxies /api to production, so the
// presign and the PUT to storage are real. One exception, stated in the output:
// production does not have the link import yet until the next deploy, so when
// the page asks /api/forge-upload for { source_url } this script answers it
// with the real import code (api/_lib/forge-image-import.js, SSRF guard and all)
// run in this process, and records that it did. Every other request is real.
//
// For each image it records the tile's final state and message, any toast, and
// for an upload the exact bytes that went to storage (type, size, pixel size,
// EXIF orientation), read from the PUT itself.

import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildIntakeImageSet } from './forge-intake-fixtures.mjs';

function arg(name, fallback = null) {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:4109');
const PAGE = arg('page', '/forge');
const OUT = resolve(arg('out', 'forge-intake-verify'));
const LABEL = arg('label', 'run');
const HEIC = arg('heic');
const PATHS = new Set((arg('paths', 'picker,paste,drop,link') || '').split(',').filter(Boolean));
const AUTH_STATE = resolve('.auth/audit-state.json');
const SETTLE_MS = 120_000;

const LINKS = [
	{ id: 'link-image', url: 'https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG' },
	{ id: 'link-private', url: 'http://169.254.169.254/latest/meta-data/' },
	{ id: 'link-404', url: 'https://upload.wikimedia.org/wikipedia/commons/0/00/three-ws-forge-intake-missing.jpg' },
];

async function signedInContext(browser) {
	const state = JSON.parse(await readFile(AUTH_STATE, 'utf8'));
	const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
	// The QA session cookie is scoped to three.ws; the dev server proxies /api
	// there, so the same session is presented from localhost.
	const sid = state.cookies.find((c) => c.name === '__Host-sid');
	if (!sid) throw new Error('no __Host-sid in .auth/audit-state.json: run npm run audit:web:login');
	await context.addCookies([{ name: sid.name, value: sid.value, domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
	return context;
}

async function describeBytes(buf) {
	try {
		const m = await sharp(buf).metadata();
		return { format: m.format, width: m.width, height: m.height, orientation: m.orientation ?? 1, pages: m.pages ?? 1 };
	} catch (err) {
		return { error: String(err.message || err) };
	}
}

async function slotState(page) {
	return page.evaluate(() => {
		const el = document.querySelector('#views-grid .view-slot, .views-grid .view-slot');
		if (!el) return { state: 'missing' };
		return {
			state: el.dataset.state,
			message: el.querySelector('.vs-error-msg')?.textContent || '',
			preparing: el.querySelector('.vs-preparing-text')?.textContent || '',
			retryLabel: el.querySelector('.vs-retry')?.textContent || '',
		};
	});
}

async function clearSlots(page) {
	await page.evaluate(() => {
		for (const btn of document.querySelectorAll('.view-slot .vs-remove')) {
			const slot = btn.closest('.view-slot');
			if (slot && slot.dataset.state !== 'empty') btn.click();
		}
	});
}

async function waitForOutcome(page, puts, toasts) {
	const started = Date.now();
	let sawChange = false;
	const timeline = [];
	let last = '';
	while (Date.now() - started < SETTLE_MS) {
		const use = page.locator('dialog[open] button[value="use"]');
		if (await use.count()) {
			timeline.push({ t: Date.now() - started, event: 'review shown' });
			await use.first().click();
		}
		const s = await slotState(page);
		const key = `${s.state}|${s.message}|${s.preparing}`;
		if (key !== last) {
			timeline.push({ t: Date.now() - started, state: s.state, ...(s.state === 'preparing' ? { text: s.preparing } : {}) });
			last = key;
		}
		if (s.state !== 'empty') sawChange = true;
		if (s.state === 'uploaded' || s.state === 'error') return { ...s, ms: Date.now() - started, timeline };
		if (!sawChange && Date.now() - started > 6000) {
			return { state: 'ignored', message: '', ms: Date.now() - started, timeline, toast: toasts.at(-1) || '' };
		}
		await page.waitForTimeout(250);
	}
	return { state: 'timeout', ms: SETTLE_MS, timeline, puts: puts.length };
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const realHeic = HEIC ? await readFile(HEIC) : null;
	const set = await buildIntakeImageSet({ realHeic });

	const browser = await chromium.launch();
	const context = await signedInContext(browser);
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
	});

	const puts = [];
	await context.route(
		(url) => !url.href.startsWith(BASE),
		async (route) => {
			const req = route.request();
			if (req.method() === 'PUT') {
				const body = req.postDataBuffer();
				puts.push({ type: req.headers()['content-type'], size: body?.length ?? null, bytes: body });
			}
			await route.continue();
		},
	);

	let linkImportsAnsweredLocally = 0;
	const { importImageFromUrl, ImageImportError } = await import('../api/_lib/forge-image-import.js');
	await context.route(`${BASE}/api/forge-upload`, async (route) => {
		const req = route.request();
		let body = {};
		try {
			body = JSON.parse(req.postData() || '{}');
		} catch {
			body = {};
		}
		if (!body.source_url) return route.continue();
		linkImportsAnsweredLocally++;
		try {
			const got = await importImageFromUrl(body.source_url);
			return route.fulfill({
				status: 200,
				headers: { 'content-type': 'application/octet-stream', 'x-image-format': got.format, 'x-content-type-options': 'nosniff' },
				body: Buffer.from(got.bytes),
			});
		} catch (err) {
			if (err instanceof ImageImportError) {
				return route.fulfill({ status: err.status, contentType: 'application/json', body: JSON.stringify({ error: err.code, message: err.message }) });
			}
			throw err;
		}
	});

	await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#mode-switch [data-mode="image"]', { timeout: 60_000 });
	await page.click('#mode-switch [data-mode="image"]');
	await page.waitForSelector('.view-slot', { timeout: 30_000 });

	const toasts = [];
	await page.exposeFunction('__intakeToast', (t) => toasts.push(t));
	await page.evaluate(() => {
		new MutationObserver(() => {
			const t = document.querySelector('.forge-toast');
			if (t && t.dataset.show === 'true' && t.textContent) window.__intakeToast(t.textContent);
		}).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
	});

	const results = [];
	async function record(path, item, run) {
		await clearSlots(page);
		const putsBefore = puts.length;
		const toastsBefore = toasts.length;
		const errorsBefore = errors.length;
		await run();
		const outcome = await waitForOutcome(page, puts, toasts);
		const put = puts.length > putsBefore ? puts.at(-1) : null;
		const row = {
			path,
			id: item.id,
			name: item.name,
			inputType: item.type,
			inputBytes: item.bytes?.length ?? null,
			state: outcome.state,
			message: outcome.message || '',
			toasts: [...new Set(toasts.slice(toastsBefore))],
			ms: outcome.ms,
			timeline: outcome.timeline,
			uploaded: put ? { type: put.type, size: put.size, ...(put.bytes ? await describeBytes(put.bytes) : {}) } : null,
			errors: errors.slice(errorsBefore),
		};
		results.push(row);
		const up = row.uploaded ? ` -> ${row.uploaded.type} ${row.uploaded.width}x${row.uploaded.height} ${Math.round(row.uploaded.size / 1024)} KB orient=${row.uploaded.orientation}` : '';
		console.log(`[${LABEL}] ${path.padEnd(6)} ${item.id.padEnd(15)} ${row.state}${row.message ? ` "${row.message}"` : ''}${row.toasts.length ? ` toast="${row.toasts.at(-1)}"` : ''}${up}${row.errors.length ? ` ERRORS: ${row.errors.join(' | ').slice(0, 300)}` : ''}`);
	}

	// Files go through the picker from disk, as a person's would (CDP caps an
	// in-memory payload well below the 30 MB photo).
	const filesDir = resolve(OUT, 'files');
	await mkdir(filesDir, { recursive: true });
	async function onDisk(item) {
		const dir = resolve(filesDir, item.id);
		await mkdir(dir, { recursive: true });
		const file = resolve(dir, item.name);
		await writeFile(file, item.bytes);
		return file;
	}

	if (PATHS.has('picker')) {
		for (const item of set) {
			const file = await onDisk(item);
			await record('picker', item, () => page.setInputFiles('#view-file-input', file));
		}
	}

	const browserEvent = (kind, item) =>
		page.evaluate(
			({ kind, name, type, b64 }) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const dt = new DataTransfer();
				dt.items.add(new File([bytes], name, { type }));
				if (kind === 'paste') document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
				else document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
			},
			{ kind, name: item.name, type: item.type, b64: Buffer.from(item.bytes).toString('base64') },
		);

	const sample = ['jpeg', 'heic-untyped', 'heic-real', 'exif-rotated', 'pdf-as-jpg'];
	for (const kind of ['paste', 'drop']) {
		if (!PATHS.has(kind)) continue;
		for (const id of sample) {
			const item = set.find((x) => x.id === id);
			if (item) await record(kind, item, () => browserEvent(kind, item));
		}
	}

	if (PATHS.has('link')) {
		for (const link of LINKS) {
			await record('link', { id: link.id, name: link.url, type: 'text/uri-list', bytes: null }, () =>
				page.evaluate((url) => {
					const dt = new DataTransfer();
					dt.setData('text/plain', url);
					document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
				}, link.url),
			);
		}
	}

	await clearSlots(page);
	await browser.close();
	const file = resolve(OUT, `results-${LABEL}.json`);
	await writeFile(
		file,
		JSON.stringify({ label: LABEL, base: BASE, page: PAGE, at: new Date().toISOString(), linkImportsAnsweredLocally, results }, null, 2),
	);
	console.log(`\nwrote ${file} (${results.length} rows; link imports answered by the local import code: ${linkImportsAnsweredLocally})`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
