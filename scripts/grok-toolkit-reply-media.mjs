#!/usr/bin/env node
// Media for the reply in docs/x-posts/2026-11-27-grok-toolkit-reply.md: a short
// reel and a still that put the 14 open Grok repositories next to the three.ws
// surface each one uses (docs/grok-toolkit.md).
//
//   node scripts/grok-toolkit-reply-media.mjs [--frames 96] [--turns 2] [--fps 20]
//
// Nothing on it is drawn by hand. The chair is Wooden Chair 01 from the free
// catalog, the model Grok returned in the recorded runs of
// examples/grok-sentence-to-3d and examples/litellm-grok-gateway, and every
// frame of the turntable is a render from the public production endpoint
// (GET https://three.ws/api/render/glb). That endpoint allows 60 renders per 10
// minutes per address and caches each one for a day, so a first run waits out
// one rate window and a second run is quick. Frames are kept in the system
// temp directory between runs.
//
// Output: public/x-media/grok-toolkit/reel.mp4 (1920x1080, H.264, yuv420p,
// faststart) and card.png (the same layout as a still).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BASE, dataUrl, esc, launchBrowser } from './lib/x-card-kit.mjs';

const { values } = parseArgs({
	options: {
		frames: { type: 'string', default: '96' },
		turns: { type: 'string', default: '2' },
		fps: { type: 'string', default: '20' },
		origin: { type: 'string', default: 'https://three.ws' },
	},
});
const FRAMES = Number(values.frames);
const TURNS = Number(values.turns);
const FPS = Number(values.fps);
if (![FRAMES, TURNS, FPS].every((n) => Number.isInteger(n) && n > 0)) throw new Error('--frames, --turns and --fps take whole numbers above zero');

const GLB = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/WoodenChair_01.glb';
const STILL_AZIMUTH = 30;
const outDir = resolve('public/x-media/grok-toolkit');
const cacheDir = join(tmpdir(), 'three-ws-grok-toolkit-reel');

// The 14 repositories of the post, each with the three.ws surface that works
// with it. Same order and wording as the table in docs/grok-toolkit.md.
export const ROWS = [
	['xai-org/grok-prompts', 'shared pages the @grok bot can read'],
	['xai-org/grok-build', 'a plugin with skills, commands and an art director'],
	['xai-org/plugin-marketplace', "a catalog entry that passes xAI's checks"],
	['xai-org/xai-sdk-python', 'a runnable example'],
	['xai-org/xai-sdk-ts', 'a runnable example that streams tool calls'],
	['xai-org/xai-cookbook', "the same example in the cookbook's layout"],
	['xai-org/grok-build-plugin-cc', 'registered for Claude Code sessions'],
	['stablyai/orca', 'a declarative plugin'],
	['slopus/happy', 'an mcp.toml it reads on open'],
	['milind-soni/OpenMausBot', 'a paste-ready server entry'],
	['Anil-matcha/suparagent', 'a community listing'],
	['FoundationAgents/MetaGPT', 'a three-role 3D studio team'],
	['OpenHands/OpenHands', 'skills and AGENTS.md, loaded as they are'],
	['BerriAI/litellm', 'a proxy config with the 3D tools in its gateway'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One production render of the chair at `azimuth` degrees, cached on disk. */
async function renderFrame(azimuth) {
	const file = join(cacheDir, `az-${azimuth.toFixed(2)}.png`);
	if (existsSync(file)) return file;
	const url = new URL('/api/render/glb', values.origin);
	url.search = new URLSearchParams({ glbUrl: GLB, width: '720', height: '720', background: 'transparent', azimuth: String(azimuth), elevation: '12' });
	for (let attempt = 1; attempt <= 8; attempt++) {
		const res = await fetch(url);
		if (res.ok && res.headers.get('content-type')?.startsWith('image/png')) {
			writeFileSync(file, Buffer.from(await res.arrayBuffer()));
			return file;
		}
		const detail = (await res.text()).slice(0, 200);
		// 429 is the endpoint's rate budget and 5xx a cold renderer: both pass with time.
		if (res.status !== 429 && res.status < 500) throw new Error(`render at azimuth ${azimuth} answered HTTP ${res.status}: ${detail}`);
		const wait = Math.min(Number(res.headers.get('retry-after')) || 30 * attempt, 600);
		console.log(`render at azimuth ${azimuth}: HTTP ${res.status}, waiting ${wait}s (attempt ${attempt} of 8)`);
		await sleep(wait * 1000);
	}
	throw new Error(`render at azimuth ${azimuth} did not succeed in 8 attempts`);
}

const CSS = `
	.stage { position: absolute; left: 72px; top: 64px; width: 392px; height: 470px; border-radius: 18px; overflow: hidden; background: radial-gradient(120% 90% at 50% 30%, #f4f4f7 0%, #d5d5dc 70%, #b9b9c2 100%); }
	.stage img { position: absolute; left: 50%; top: 50%; width: 470px; height: 470px; transform: translate(-50%, -50%); }
	.stagecap { position: absolute; left: 72px; top: 548px; width: 392px; }
	.col { position: absolute; left: 512px; top: 60px; right: 64px; }
	.col h1 { font-size: 38px; }
	.col .url { margin-top: 12px; font: 500 15px/1 'JBMono', monospace; color: #b9b9c4; }
	.rows { margin-top: 22px; }
	.row { display: flex; align-items: baseline; height: 27.5px; border-top: 1px solid rgba(255,255,255,0.07); padding-top: 6px; }
	.row .n { width: 34px; font: 500 12px/1 'JBMono', monospace; color: #5d5d66; }
	.row .repo { width: 254px; font: 500 13.5px/1 'JBMono', monospace; color: #b9b9c4; white-space: nowrap; }
	.row .what { flex: 1; font-size: 14px; line-height: 1; color: #6f6f79; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.row.on .n, .row.on .repo, .row.on .what { color: #fff; }
	.ours { position: absolute; left: 72px; bottom: 30px; height: 30px; }
	.link { position: absolute; right: 64px; bottom: 38px; font: 500 14px/1 'JBMono', monospace; color: #9a9aa4; }
`;

const page = () => `<!doctype html><meta charset="utf-8"><style>${BASE}${CSS}</style>
<div class="stage"><img id="turn" alt=""></div>
<div class="stagecap cap">Wooden Chair 01, CC0. Grok found it through xAI's TypeScript SDK and through a LiteLLM proxy. Rendered by three.ws.</div>
<div class="col">
	<h1>14 open Grok repos.<br>One 3D server.</h1>
	<div class="url">https://three.ws/api/mcp-studio</div>
	<div class="rows">${ROWS.map(([repo, what], i) => `<div class="row" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="repo">${esc(repo)}</span><span class="what">${esc(what)}</span></div>`).join('')}</div>
</div>
<img class="ours" src="${dataUrl('public/brand/three-ws-lockup-on-dark.png', 'image/png')}" alt="three.ws">
<div class="link">three.ws/docs/grok-toolkit</div>`;

async function main() {
	if (spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg is not on PATH');
	mkdirSync(cacheDir, { recursive: true });
	mkdirSync(outDir, { recursive: true });

	const azimuths = Array.from({ length: FRAMES }, (_, i) => (i * 360) / FRAMES);
	const sources = [];
	for (const [i, azimuth] of azimuths.entries()) {
		sources.push(await renderFrame(azimuth));
		if ((i + 1) % 12 === 0 || i + 1 === FRAMES) console.log(`renders: ${i + 1} of ${FRAMES}`);
	}
	const still = await renderFrame(STILL_AZIMUTH);

	const shots = join(cacheDir, 'shots');
	rmSync(shots, { recursive: true, force: true });
	mkdirSync(shots, { recursive: true });

	const browser = await launchBrowser();
	try {
		// 1200x675 at 1.6x is 1920x1080.
		const tab = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 1.6 });
		await tab.setContent(page(), { waitUntil: 'load' });
		await tab.evaluate(async () => {
			await document.fonts.ready;
			if (!document.fonts.check("600 54px 'Inter'")) throw new Error('Inter did not load');
		});
		const show = (file, active) =>
			tab.evaluate(
				async ({ src, active }) => {
					const img = document.getElementById('turn');
					img.src = src;
					await img.decode();
					for (const row of document.querySelectorAll('.row')) row.classList.toggle('on', Number(row.dataset.i) === active);
				},
				{ src: `data:image/png;base64,${readFileSync(file).toString('base64')}`, active },
			);

		const total = FRAMES * TURNS;
		for (let f = 0; f < total; f++) {
			await show(sources[f % FRAMES], Math.min(ROWS.length - 1, Math.floor((f * ROWS.length) / total)));
			await tab.screenshot({ path: join(shots, `f${String(f).padStart(4, '0')}.png`) });
		}
		await show(still, -1);
		await tab.screenshot({ path: join(outDir, 'card.png') });
		console.log(`card: ${join(outDir, 'card.png')}`);
	} finally {
		await browser.close();
	}

	const reel = join(outDir, 'reel.mp4');
	const enc = spawnSync(
		'ffmpeg',
		['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(shots, 'f%04d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', reel],
		{ stdio: 'inherit' },
	);
	if (enc.status !== 0) throw new Error(`ffmpeg exited ${enc.status}`);
	rmSync(shots, { recursive: true, force: true });
	console.log(`reel: ${reel}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
