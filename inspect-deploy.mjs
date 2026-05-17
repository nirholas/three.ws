import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') errs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:3000/deploy', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const dims = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: (el.className?.toString() || '').slice(0, 80),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display, position: cs.position, visibility: cs.visibility, opacity: cs.opacity,
      z: cs.zIndex,
      text: (el.textContent || '').trim().slice(0, 60),
    };
  };
  return {
    bodyClass: document.body.className,
    shell: dims(q('.deploy-shell')),
    hero: dims(q('.deploy-hero')),
    heroText: dims(q('.deploy-hero-text')),
    heroEyebrow: dims(q('.deploy-hero-eyebrow')),
    heroTitle: dims(q('.deploy-hero-title')),
    heroSub: dims(q('.deploy-hero-sub')),
    heroMeta: dims(q('.deploy-hero-meta')),
    heroControls: dims(q('.deploy-hero-controls')),
    chainSelect: dims(q('.deploy-shell .erc8004-chain-select')),
    walletBtn: dims(q('.deploy-wallet-btn')),
    banner: dims(q('[data-role="mainnet-banner"]')),
    grid: dims(q('.deploy-grid')),
    preview: dims(q('.deploy-preview')),
    previewThumb: dims(q('.deploy-preview-thumb')),
    deployPage: dims(q('.deploy-page')),
  };
});

console.log(JSON.stringify(info, null, 2));
console.log('\n--- CONSOLE ---');
console.log(errs.slice(0, 20).join('\n'));

await page.screenshot({ path: '/tmp/deploy-actual.png', fullPage: false });

await browser.close();
