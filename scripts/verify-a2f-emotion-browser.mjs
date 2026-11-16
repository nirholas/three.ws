#!/usr/bin/env node
// Browser check for Audio2Face-3D facial emotion on /audio2face.
//
// For each rig (a URL the page loads, or a local .glb/.vrm fed through the
// page's "use your own avatar" picker) and each emotion setting, it loads the
// page, has the digital human say one line through the real /api/a2f stream,
// samples the applied-emotion meters and the rig badge while it speaks, takes
// a mid-line screenshot, records a video and fails on any console error.
//
//   node scripts/verify-a2f-emotion-browser.mjs --base http://localhost:3269 \
//     --rig arkit=/avatars/default.glb --rig vrm=file:/path/avatar.vrm \
//     --out docs/nvidia-media/a2f-emotion
//
// Emotion settings default to "joy" (strength 1) and "off". The run writes
// <out>/<rig>-<setting>.png, .webm and a summary.json.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : dflt;
};
const base = arg('base', 'http://localhost:3269');
const out = resolve(arg('out', 'a2f-emotion-check'));
const line = arg('line', 'Oh wow, that is wonderful news! I am so happy for you, really!');
const rigs = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] !== '--rig') continue;
	const [name, ...rest] = argv[i + 1].split('=');
	rigs.push({ name, src: rest.join('=') });
}
if (!rigs.length) rigs.push({ name: 'arkit', src: '/avatars/default.glb' });
const settings = (arg('settings', 'joy,off')).split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const summary = [];
let failed = false;

for (const rig of rigs) {
	for (const setting of settings) {
		const tag = `${rig.name}-${setting}`;
		const context = await browser.newContext({
			viewport: { width: 1280, height: 800 },
			recordVideo: { dir: out, size: { width: 1280, height: 800 } },
		});
		const page = await context.newPage();
		const errors = [];
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
		page.on('pageerror', (e) => errors.push(String(e)));
		page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
		const q = new URLSearchParams(setting === 'off' ? { emotion: 'off' } : { emotion: setting, emotionStrength: '1' });
		if (!rig.src.startsWith('file:')) q.set('avatar', rig.src);
		await page.goto(`${base}/audio2face?${q}`, { waitUntil: 'domcontentloaded' });
		if (rig.src.startsWith('file:')) {
			await page.waitForFunction(() => window.__digitalHuman?.state().avatarReady, null, { timeout: 90_000 });
			await page.setInputFiles('#own-avatar', rig.src.slice(5));
			await page.waitForFunction(() => document.querySelector('#avatar').value.startsWith('blob:'));
			await page.waitForTimeout(300);
		}
		await page.waitForFunction(() => window.__digitalHuman?.state().avatarReady, null, { timeout: 90_000 });
		const badge = await page.textContent('#viewer-badge');
		await page.evaluate((l) => {
			window.__digitalHuman.say(l);
		}, line);
		await page.waitForFunction(() => window.__digitalHuman.state().speaking, null, { timeout: 60_000 });

		const samples = [];
		let shot = false;
		const t0 = Date.now();
		while (Date.now() - t0 < 30_000) {
			const s = await page.evaluate(() => {
				const st = window.__digitalHuman.state();
				const emo = {};
				for (const row of document.querySelectorAll('.emo-row')) {
					emo[row.firstChild.textContent] = parseFloat(row.querySelector('.emo-bar > span').style.width) / 100 || 0;
				}
				return { speaking: st.speaking, mouth: st.mouth, emo, note: document.querySelector('.emo-note')?.textContent };
			});
			if (!s.speaking && samples.length > 3) break;
			samples.push(s);
			if (!shot && Date.now() - t0 > 1600) {
				await page.screenshot({ path: join(out, `${tag}.png`) });
				shot = true;
			}
			await page.waitForTimeout(100);
		}
		const note = samples.at(-1)?.note || '';
		const peak = {};
		for (const s of samples) for (const [k, v] of Object.entries(s.emo)) peak[k] = Math.max(peak[k] || 0, v);
		const a2fFrames = samples.filter((s) => s.mouth === 'a2f').length;
		const video = page.video();
		await context.close();
		const videoPath = join(out, `${tag}.webm`);
		renameSync(await video.path(), videoPath);
		const row = { rig: rig.name, setting, badge, note, a2fFrames, peak, errors };
		const ok =
			!errors.length &&
			a2fFrames > 0 &&
			(setting === 'off' ? Object.values(peak).every((v) => v === 0) : Object.values(peak).some((v) => v > 0.1));
		row.ok = ok;
		failed ||= !ok;
		summary.push(row);
		console.log(`${ok ? 'PASS' : 'FAIL'} ${tag}: ${badge} | ${note} | peak ${JSON.stringify(peak)} | a2f samples ${a2fFrames} | errors ${errors.length}`);
		for (const e of errors) console.log('   console:', e.slice(0, 300));
	}
}
await browser.close();
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
process.exit(failed ? 1 : 0);
