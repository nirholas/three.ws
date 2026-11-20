#!/usr/bin/env node
// Builds the static assets /grok ships: the showcase posters and the share card.
//
//   node scripts/build-grok-assets.mjs            (npm run grok:assets)
//   node scripts/build-grok-assets.mjs --og-only  (redraw the card from the posters on disk)
//
// Showcase posters: each id below is a real public model on three.ws. The
// script reads its GLB from /api/forge-creation, renders it through
// /api/render/glb (the same renderer the gallery uses) and writes a 480px WebP
// to public/grok/showcase/<id>.webp. pages/grok.html links each one to /m/<id>,
// and tests/grok-hub.test.js checks every linked poster exists.
//
// Share card: a 1200x630 PNG at public/og/grok.png, drawn with the repo's OG
// renderer (api/_lib/og-image.js) from the hero copy and four of the posters.
// No third-party logos: text and our own renders only.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ImageResponse } from '../api/_lib/og-image.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGIN = process.env.THREE_WS_ORIGIN || 'https://three.ws';
const POSTER_DIR = path.join(ROOT, 'public/grok/showcase');
const OG_PATH = path.join(ROOT, 'public/og/grok.png');

export const SHOWCASE = [
	'84bacb12-ddc0-42a2-8264-d7fc0f1a1404', // a friendly orange fox character
	'48ad85f1-6130-45df-9876-add9dda38d1e', // a friendly cartoon robot helper
	'c714cfc4-cdd5-492f-a91f-9929afa2618b', // a vintage film camera
	'fb550385-e59e-4943-bb4d-b99f60866437', // a red chair
	'518ea3c1-f31f-43ea-aa43-ef21e36b2d39', // a mid-engine hypercar body
	'ff8b50b3-d172-404e-a95d-abf32cda041d', // a red sports coupe
];

// The four posters the share card shows, in reading order.
const OG_POSTERS = [SHOWCASE[0], SHOWCASE[2], SHOWCASE[1], SHOWCASE[3]];

const posterPath = (id) => path.join(POSTER_DIR, `${id}.webp`);

async function fetchOk(url, what, timeoutMs) {
	const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) throw new Error(`${what} answered ${res.status} for ${url}`);
	return res;
}

async function renderPoster(id) {
	const res = await fetchOk(`${ORIGIN}/api/forge-creation?id=${encodeURIComponent(id)}`, 'forge-creation', 30_000);
	const { creation } = await res.json();
	const glb = creation?.web_glb_url || creation?.glb_url;
	if (!glb) throw new Error(`model ${id} has no GLB`);
	const png = await fetchOk(`${ORIGIN}/api/render/glb?glbUrl=${encodeURIComponent(glb)}`, 'render/glb', 180_000);
	const buf = Buffer.from(await png.arrayBuffer());
	const webp = await sharp(buf).resize(480, 480, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
	await writeFile(posterPath(id), webp);
	return { id, prompt: creation.prompt, bytes: webp.length };
}

async function posterDataUri(id) {
	const png = await sharp(await readFile(posterPath(id))).resize(216, 216).png().toBuffer();
	return `data:image/png;base64,${png.toString('base64')}`;
}

const el = (type, style, children) => ({ type, props: { style, children } });

async function buildCard() {
	const posters = await Promise.all(OG_POSTERS.map(posterDataUri));
	const tile = (src) => ({
		type: 'img',
		props: { src, width: 216, height: 216, style: { borderRadius: 18, border: '1px solid #2a2a33' } },
	});
	const node = el(
		'div',
		{ width: 1200, height: 630, display: 'flex', background: '#0b0b0f', color: '#f4f4f7', padding: 64, fontFamily: 'geist' },
		[
			el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 584, height: 502, marginRight: 40 }, [
				el('div', { display: 'flex', flexDirection: 'column' }, [
					el('div', { fontSize: 24, color: '#a78bfa', letterSpacing: 2, marginBottom: 24 }, 'THREE.WS FOR GROK'),
					el('div', { fontSize: 62, lineHeight: 1.05, letterSpacing: -2, marginBottom: 26 }, 'Give Grok a 3D studio and a body.'),
					el('div', { fontSize: 27, lineHeight: 1.4, color: '#b4b4c0' }, 'One connector for Grok Bot, grok.com, Grok Build, Cursor and the xAI API. Text and photos become 3D models and rigged avatars.'),
				]),
				el('div', { display: 'flex', alignItems: 'center', fontSize: 26, color: '#f4f4f7' }, [
					el('div', { width: 12, height: 12, borderRadius: 12, background: '#a78bfa', marginRight: 14 }, ''),
					'three.ws/grok',
				]),
			]),
			el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 448, height: 502 }, [0, 2].map((row) =>
				el('div', { display: 'flex', justifyContent: 'space-between', marginBottom: row === 0 ? 16 : 0 }, [tile(posters[row]), tile(posters[row + 1])]),
			)),
		],
	);
	const res = new ImageResponse(node, { width: 1200, height: 630 });
	const png = Buffer.from(await res.arrayBuffer());
	await mkdir(path.dirname(OG_PATH), { recursive: true });
	await writeFile(OG_PATH, png);
	const meta = await sharp(png).metadata();
	return { path: path.relative(ROOT, OG_PATH), width: meta.width, height: meta.height, bytes: png.length };
}

async function main() {
	await mkdir(POSTER_DIR, { recursive: true });
	if (!process.argv.includes('--og-only')) {
		const results = await Promise.allSettled(SHOWCASE.map(renderPoster));
		const failed = results.filter((r) => r.status === 'rejected');
		for (const r of results) {
			if (r.status === 'fulfilled') console.log(`poster ${r.value.id} ${r.value.bytes}B  ${String(r.value.prompt).slice(0, 60)}`);
			else console.error(`poster failed: ${r.reason?.message || r.reason}`);
		}
		if (failed.length) process.exit(1);
	}
	console.log('card', JSON.stringify(await buildCard()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err?.stack || err);
		process.exit(1);
	});
}
