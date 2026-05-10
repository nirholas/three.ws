#!/usr/bin/env node
// Render launch-week.html as a smooth-scroll video.
//
// Output: scroll.mp4 at the repo root.
//
// Prereqs: dev server running at http://localhost:3000 (`npm run dev`)
// Usage:   node scripts/render-launch-video.mjs
//          node scripts/render-launch-video.mjs --duration 120   # 120-second scroll
//          node scripts/render-launch-video.mjs --width 1920 --height 1080

import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const PAGE_URL = args.url || 'http://localhost:3000/launch-week.html';
const SCROLL_SECONDS = parseFloat(args.duration || '90');
const WIDTH = parseInt(args.width || '1280', 10);
const HEIGHT = parseInt(args.height || '800', 10);
const SCROLL_WEBM = path.join(ROOT, 'scroll.webm');
const SCROLL_MP4  = path.join(ROOT, 'scroll.mp4');
const EMBED_WAIT_MS = 12_000;
const HEAD_PAD_MS = 1_500;
const TAIL_PAD_MS = 2_000;

async function main() {
  console.log(`Page:     ${PAGE_URL}`);
  console.log(`Viewport: ${WIDTH}x${HEIGHT} @ 2x DPR`);
  console.log(`Scroll:   ${SCROLL_SECONDS}s (+ ${HEAD_PAD_MS / 1000}s head pad, ${TAIL_PAD_MS / 1000}s tail pad)`);

  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--window-size=${WIDTH},${HEIGHT}`,
      '--font-render-hinting=none',
      '--force-device-scale-factor=2',
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.warn(`  [page error] ${m.text().slice(0, 200)}`);
  });

  console.log(`Loading ${PAGE_URL}...`);
  await page.goto(PAGE_URL, { waitUntil: 'networkidle2', timeout: 60_000 });

  console.log(`Waiting ${EMBED_WAIT_MS / 1000}s for tweet embeds to render...`);
  await new Promise((r) => setTimeout(r, EMBED_WAIT_MS));

  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 500));

  console.log('Starting screencast...');
  const recorder = await page.screencast({
    path: SCROLL_WEBM,
    crop: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    speed: 1,
  });

  await new Promise((r) => setTimeout(r, HEAD_PAD_MS));

  console.log('Animating scroll...');
  await page.evaluate((durationMs) => {
    return new Promise((resolve) => {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
        window.scrollTo(0, eased * distance);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }, SCROLL_SECONDS * 1000);

  await new Promise((r) => setTimeout(r, TAIL_PAD_MS));

  console.log('Stopping screencast...');
  await recorder.stop();
  await browser.close();

  console.log('Transcoding webm → mp4...');
  await new Promise((resolve, reject) => {
    const ffArgs = [
      '-y',
      '-i', SCROLL_WEBM,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      SCROLL_MP4,
    ];
    const p = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });

  console.log(`\n✓ Wrote ${path.relative(ROOT, SCROLL_MP4)}`);
  console.log('  Drop this into your editor and overlay the ElevenLabs voice.\n');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
