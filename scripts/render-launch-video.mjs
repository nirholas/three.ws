#!/usr/bin/env node
// Render launch-week.html as a smooth-scroll video.
// Uses a deterministic frame-by-frame approach (decoupled from real time) so
// the output is perfectly smooth regardless of how slow the screenshots are.
//
// Output: scroll.mp4 at the repo root.
//
// Prereqs: dev server running at http://localhost:3000 (`npm run dev`)
// Usage:   node scripts/render-launch-video.mjs
//          node scripts/render-launch-video.mjs --duration 120 --fps 30
//          node scripts/render-launch-video.mjs --width 1920 --height 1080

import fs from 'node:fs/promises';
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
const DURATION = parseFloat(args.duration || '90');
const FPS = parseInt(args.fps || '24', 10);
const WIDTH = parseInt(args.width || '1280', 10);
const HEIGHT = parseInt(args.height || '800', 10);
const DPR = parseFloat(args.dpr || '1');
const HEAD_PAD = parseFloat(args['head-pad'] || '1.5');
const TAIL_PAD = parseFloat(args['tail-pad'] || '2');
const FRAMES_DIR = path.join(ROOT, '.video-frames');
const SCROLL_MP4 = path.join(ROOT, 'scroll.mp4');
const EMBED_WAIT_MS = 12_000;

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function main() {
  console.log(`Page:      ${PAGE_URL}`);
  console.log(`Viewport:  ${WIDTH}x${HEIGHT} @ 2x DPR`);
  console.log(`Duration:  ${DURATION}s scroll · ${HEAD_PAD}s head · ${TAIL_PAD}s tail`);
  console.log(`Framerate: ${FPS}fps`);

  const totalFrames = Math.round((HEAD_PAD + DURATION + TAIL_PAD) * FPS);
  const headFrames = Math.round(HEAD_PAD * FPS);
  const tailFrames = Math.round(TAIL_PAD * FPS);
  const scrollFrames = totalFrames - headFrames - tailFrames;
  console.log(`Frames:    ${totalFrames} total (${scrollFrames} scrolling, ${headFrames} head pad, ${tailFrames} tail pad)`);

  await rmrf(FRAMES_DIR);
  await fs.mkdir(FRAMES_DIR, { recursive: true });

  console.log('\nLaunching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--window-size=${WIDTH},${HEIGHT}`,
      '--font-render-hinting=none',
      `--force-device-scale-factor=${DPR}`,
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.warn(`  [page error] ${m.text().slice(0, 200)}`);
  });

  console.log(`Loading ${PAGE_URL}...`);
  await page.goto(PAGE_URL, { waitUntil: 'networkidle2', timeout: 60_000 });

  console.log(`Waiting ${EMBED_WAIT_MS / 1000}s for tweet embeds to render...`);
  await new Promise((r) => setTimeout(r, EMBED_WAIT_MS));

  // Compute scroll bounds
  const distance = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  );
  console.log(`Page height: scrollable distance ${distance}px`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 500));

  console.log('\nCapturing frames...');
  const frameStart = Date.now();
  const pad = (n, w) => String(n).padStart(w, '0');

  for (let i = 0; i < totalFrames; i++) {
    let scrollY;
    if (i < headFrames) {
      scrollY = 0;
    } else if (i < headFrames + scrollFrames) {
      const t = (i - headFrames) / Math.max(1, scrollFrames - 1);
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * t); // smooth in/out
      scrollY = eased * distance;
    } else {
      scrollY = distance;
    }
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.screenshot({
      path: path.join(FRAMES_DIR, `frame-${pad(i, 5)}.jpg`),
      type: 'jpeg',
      quality: 92,
      captureBeyondViewport: false,
    });
    if (i % 30 === 0 || i === totalFrames - 1) {
      const pct = ((i + 1) / totalFrames * 100).toFixed(1);
      const elapsed = ((Date.now() - frameStart) / 1000).toFixed(1);
      process.stdout.write(`\r  frame ${i + 1}/${totalFrames} (${pct}%) · ${elapsed}s elapsed     `);
    }
  }
  process.stdout.write('\n');
  await browser.close();
  console.log(`Captured ${totalFrames} frames in ${((Date.now() - frameStart) / 1000).toFixed(1)}s`);

  console.log('\nEncoding mp4...');
  await new Promise((resolve, reject) => {
    const ffArgs = [
      '-y',
      '-framerate', String(FPS),
      '-i', path.join(FRAMES_DIR, 'frame-%05d.jpg'),
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

  // Cleanup PNGs but keep the mp4
  await rmrf(FRAMES_DIR);

  const stat = await fs.stat(SCROLL_MP4);
  console.log(`\n✓ Wrote ${path.relative(ROOT, SCROLL_MP4)} (${(stat.size / 1024 / 1024).toFixed(1)} MB · ${WIDTH * 2}x${HEIGHT * 2})`);
  console.log('  Drop this into your editor and overlay the ElevenLabs voice.\n');
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
