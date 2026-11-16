#!/usr/bin/env node
// Build the vision eval image set from data/evals/vision/manifest.json.
//
// Every image is fetched or produced from a licence-clean source and its
// provenance (source URL, author, licence) is written to
// data/evals/vision/provenance.json, so anyone can re-derive the exact set:
//
//   commons     a Wikimedia Commons file whose licence is CC0 or public domain.
//               The licence is read from the file's own extmetadata and the
//               build refuses any file that is not CC0 / PD.
//   render      a CC0 Poly Haven model from the three.ws asset catalog, rendered
//               by the SAME headless renderer the forge quality gate uses
//               (api/_lib/3d-vision.js renderTurntable), on its gray backdrop.
//   screenshot  a three.ws page the platform owns, captured with Playwright.
//   derived     a darkened and blurred copy of another item in the set (the
//               "near black blur" input class the input checkers must reject).
//
// Images are normalized to JPEG with the long side at most 1024 px.
//
//   node scripts/nvidia-vision-eval-build.mjs            # build missing images
//   node scripts/nvidia-vision-eval-build.mjs --force    # rebuild every image
//   node scripts/nvidia-vision-eval-build.mjs --only id1,id2

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SET_DIR = join(ROOT, 'data/evals/vision');
const IMG_DIR = join(SET_DIR, 'images');
const MANIFEST = join(SET_DIR, 'manifest.json');
const PROVENANCE = join(SET_DIR, 'provenance.json');
const CATALOG = 'https://three.ws/api/catalog';
const UA = 'three.ws-vision-eval/1.0 (https://three.ws)';
const LICENCE_OK = /^(cc0|public domain|pd\b|pd-)/i;
const MAX_SIDE = 1024;
const RENDER_BACKGROUND = '#8a8a8a';

const { values } = parseArgs({ options: { force: { type: 'boolean', default: false }, only: { type: 'string' } } });
const only = values.only ? new Set(values.only.split(',')) : null;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const provenance = existsSync(PROVENANCE) ? JSON.parse(readFileSync(PROVENANCE, 'utf8')) : {};
mkdirSync(IMG_DIR, { recursive: true });

function stripHtml(s) {
	return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function normalize(buf) {
	return sharp(buf)
		.rotate()
		.flatten({ background: RENDER_BACKGROUND })
		.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 84, mozjpeg: true })
		.toBuffer();
}

async function fromCommons(title) {
	const u = new URL('https://commons.wikimedia.org/w/api.php');
	const q = { action: 'query', format: 'json', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600' };
	for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
	const j = await (await fetch(u, { headers: { 'user-agent': UA } })).json();
	const page = Object.values(j.query?.pages || {})[0];
	const ii = page?.imageinfo?.[0];
	if (!ii) throw new Error(`commons file not found: ${title}`);
	const meta = ii.extmetadata || {};
	const licence = stripHtml(meta.LicenseShortName?.value);
	if (!LICENCE_OK.test(licence)) throw new Error(`refusing ${title}: licence "${licence}" is not CC0 or public domain`);
	const res = await fetch(ii.thumburl || ii.url, { headers: { 'user-agent': UA } });
	if (!res.ok) throw new Error(`commons download ${res.status} for ${title}`);
	return {
		buf: Buffer.from(await res.arrayBuffer()),
		prov: {
			kind: 'commons',
			title,
			source: ii.descriptionurl,
			licence,
			author: stripHtml(meta.Artist?.value) || null,
		},
	};
}

let renderTurntable = null;
async function fromRender(name, view = 'three-quarter') {
	const res = await fetch(`${CATALOG}?id=object:${encodeURIComponent(name)}`);
	const item = (await res.json())?.item;
	if (!item?.url) throw new Error(`catalog item not found: object:${name}`);
	if (item.license !== 'CC0') throw new Error(`refusing object:${name}: licence ${item.license}`);
	renderTurntable ||= (await import('../api/_lib/3d-vision.js')).renderTurntable;
	const out = await renderTurntable({ glbUrl: item.url, views: [view], size: 768, background: RENDER_BACKGROUND });
	return {
		buf: out.frames[0].png,
		prov: {
			kind: 'render',
			title: item.title,
			source: `https://three.ws/api/catalog?id=object:${name}`,
			model: item.url,
			licence: 'CC0 (Poly Haven model, rendered by three.ws)',
			author: 'Poly Haven contributors',
			view,
		},
	};
}

let browser = null;
async function fromScreenshot(url) {
	if (!browser) {
		const { chromium } = await import('playwright');
		browser = await chromium.launch();
	}
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	try {
		const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
		if (!res || !res.ok()) throw new Error(`screenshot ${url}: HTTP ${res?.status()}`);
		await page.waitForTimeout(1500);
		return {
			buf: await page.screenshot({ type: 'png' }),
			prov: { kind: 'screenshot', title: await page.title(), source: url, licence: 'Owned by three.ws', author: 'three.ws' },
		};
	} finally {
		await page.close();
	}
}

async function fromDerived(baseId) {
	const base = join(IMG_DIR, `${baseId}.jpg`);
	if (!existsSync(base)) throw new Error(`derived item needs ${baseId}.jpg built first`);
	const buf = await sharp(base).blur(18).modulate({ brightness: 0.12 }).toBuffer();
	const baseProv = provenance[baseId] || {};
	return {
		buf,
		prov: {
			kind: 'derived',
			title: `${baseId}, blurred (sigma 18) and darkened to 12% brightness`,
			source: baseProv.source || null,
			licence: baseProv.licence || null,
			author: baseProv.author || null,
			derivedFrom: baseId,
		},
	};
}

async function build(item) {
	const s = item.source;
	if (s.kind === 'commons') return fromCommons(s.title);
	if (s.kind === 'render') return fromRender(s.name, s.view);
	if (s.kind === 'screenshot') return fromScreenshot(s.url);
	if (s.kind === 'derived') return fromDerived(s.from);
	throw new Error(`unknown source kind ${s.kind} on ${item.id}`);
}

// Derived items read their base image, so build them last.
const ordered = [...manifest.items].sort((a, b) => (a.source.kind === 'derived') - (b.source.kind === 'derived'));
let built = 0;
const failures = [];
for (const item of ordered) {
	if (only && !only.has(item.id)) continue;
	const out = join(IMG_DIR, `${item.id}.jpg`);
	if (!values.force && existsSync(out) && provenance[item.id]) continue;
	try {
		const { buf, prov } = await build(item);
		const jpg = await normalize(buf);
		writeFileSync(out, jpg);
		provenance[item.id] = { ...prov, file: `images/${item.id}.jpg`, bytes: jpg.length };
		built++;
		console.log(`built ${item.id} (${prov.kind}, ${Math.round(jpg.length / 1024)} KB)`);
	} catch (e) {
		failures.push(`${item.id}: ${e.message}`);
		console.error(`FAILED ${item.id}: ${e.message}`);
	}
}
if (browser) await browser.close();
const sorted = Object.fromEntries(Object.entries(provenance).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, '\t')}\n`);
console.log(`${built} built, ${failures.length} failed, ${Object.keys(sorted).length} in provenance.json`);
process.exit(failures.length ? 1 : 0);
