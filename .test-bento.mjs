import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/home.html', { waitUntil: 'load', timeout: 30000 });
await page.evaluate(async () => {
  const parallax = document.querySelector('.home-parallax');
  const target = document.getElementById('bento-cz-canvas');
  let y = 0, max = parallax.scrollHeight;
  while (y < max - 1000) {
    y += 400;
    parallax.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 80));
    const rect = target.getBoundingClientRect();
    if (rect.top > 0 && rect.top < window.innerHeight - 200) break;
  }
  await new Promise(r => setTimeout(r, 200));
  target.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(8000);

// dump the canvas as PNG via toDataURL — but canvas with alpha=true and DPR has gotchas
const dataUrl = await page.evaluate(() => {
  const c = document.getElementById('bento-cz-canvas');
  // force a render frame to flush
  return new Promise(res => requestAnimationFrame(() => res(c.toDataURL())));
});
console.log('canvas data url len:', dataUrl.length);
// save it
import fs from 'fs';
fs.writeFileSync('/tmp/bento-canvas-direct.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('saved');

// also screenshot the bento card region
const rect = await page.evaluate(() => {
  const c = document.getElementById('bento-cz-canvas');
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('rect', rect);
if (rect.y > -50 && rect.y < 1200) {
  await page.screenshot({ path: '/tmp/bento-card-zoomed.png', clip: { x: Math.max(0,rect.x), y: Math.max(0,rect.y), width: rect.w, height: Math.min(1200-Math.max(0,rect.y), rect.h) } });
}
await browser.close();
