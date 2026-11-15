// The black three.ws card: one 1600x900 frame in the visual system the
// community keeps asking for. Black ground, soft blue and violet glow, the
// three.ws lockup, a Space Grotesk headline, and the product shown inside a
// frame instead of as a raw screenshot.
//
// Used by scripts/make-x-post-card.mjs (a hand-written spec) and by the X
// content heads (scripts/lib/x-heads.mjs), which build a card around a frame of
// a proof reel or around AI key art.
//
// Frames:
//   browser  the shot in a tilted browser window (a landscape page capture)
//   phone    the shot in a phone (a mobile capture)
//   panel    the shot in a rounded panel, any aspect (a square reel frame)
//   art      the shot full-bleed behind the type, faded into the black so the
//            headline sits on it; `inset` adds a real product frame in a corner
//            and `credit` labels the art for what it is

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 900;

const OVERLAYS = ['#tws-corner-stack', '.twx-i18n-fab', '.walk-companion', '.walk-c2w-fx', '.walk-trail-layer', '#market-sidebar-toggle', '.tws-atlas-hint'];
const GL_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function brandAssets(root) {
	const fontFaces = [
		['Space Grotesk', '300 700', 'space-grotesk-latin.woff2'],
		['Inter', '300 800', 'inter-latin.woff2'],
	]
		.map(([family, weight, file]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(root, 'public/fonts', file)).toString('base64')}) format('woff2');}`)
		.join('\n');
	const markUri = `data:image/png;base64,${readFileSync(join(root, 'public/pwa-512x512.png')).toString('base64')}`;
	return { fontFaces, markUri };
}

// A capture whose every channel averages under this is a blank page.
export async function isBlank(buffer) {
	const means = (await sharp(buffer).stats()).channels.slice(0, 3).map((channel) => channel.mean);
	return means.every((mean) => mean < 6);
}

// Image bytes as a data URI the card can embed. A 2x capture of a WebGL page is
// tens of megabytes as PNG, enough to make the card's own screenshot fail, and
// no frame on the card is wider than 1600, so that is the ceiling.
export async function imageUri(buffer, { width = CARD_WIDTH, quality = 90 } = {}) {
	const fitted = await sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
	return `data:image/jpeg;base64,${fitted.toString('base64')}`;
}

// A live page captured the way the card frames it.
export async function capturePage(url, { frame = 'browser', hide = [], scrollBy = 0, settleMs = 9000 } = {}) {
	const { chromium } = await import('playwright');
	const browser = await chromium.launch({ args: GL_ARGS });
	try {
		const page = await browser.newPage({ viewport: frame === 'phone' ? { width: 412, height: 892 } : { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'dark' });
		try {
			await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
		} catch {
			// An open socket never idles; the settle below covers it.
		}
		await page.addStyleTag({ content: `${[...OVERLAYS, ...hide].join(',')}{display:none!important}` });
		if (scrollBy) await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'instant' }), scrollBy);
		await page.waitForTimeout(settleMs);
		return await page.screenshot({ type: 'png' });
	} finally {
		await browser.close();
	}
}

// One pass over a line, each token classed and escaped on its own, so a
// highlight can never break the markup around it. Covers what the cards show:
// HTML tags and attributes, JS/TS, shell, and JSON.
const TOKEN = /((?<![:\w])\/\/.*$|(?<!\S)#(?=\s).*$|<!--.*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[a-zA-Z][\w-]*|\/?>)|(\b(?:import|from|export|const|let|var|await|async|function|return|new|if|else|for|of|in|await|class|extends|true|false|null|undefined|npm|npx|curl|git)\b)|(\b\d[\d_.]*\b)|([a-zA-Z_][\w-]*(?==)|[a-zA-Z_$][\w$]*(?=\())/g;
const TOKEN_CLASS = ['c', 's', 't', 'k', 'n', 'a'];

export function highlightLine(line) {
	let out = '';
	let last = 0;
	for (const match of String(line).matchAll(TOKEN)) {
		out += esc(line.slice(last, match.index));
		const group = match.slice(1).findIndex((value) => value !== undefined);
		out += `<span class="${TOKEN_CLASS[group]}">${esc(match[0])}</span>`;
		last = match.index + match[0].length;
	}
	return out + esc(String(line).slice(last));
}

// Type size for a full-width code card: as large as the longest line and the
// line count allow, so a two-line snippet reads from across a room and twelve
// lines still fit. Monospace advances about 0.6 em per character.
export function codeSize(lines = []) {
	const longest = Math.max(1, ...lines.map((line) => String(line).length));
	const byWidth = Math.floor((1456 - 64) / (longest * 0.6));
	const byHeight = Math.floor(560 / (Math.max(1, lines.length) * 1.6));
	return Math.max(18, Math.min(30, byWidth, byHeight));
}

function codeHtml(lines) {
	return (lines || []).map((line) => `<div>${highlightLine(line) || '&nbsp;'}</div>`).join('');
}

function frameHtml(spec, shotUri) {
	if (spec.frame === 'phone') return `<div class="phone"><img src="${shotUri}" alt=""></div>`;
	if (spec.frame === 'panel') return `<div class="panel"><img src="${shotUri}" alt=""></div>`;
	if (spec.frame === 'art') {
		return [
			`<div class="art" style="background-image:url('${shotUri}')"></div><div class="art-fade"></div>`,
			spec.insetUri ? `<figure class="inset"><img src="${spec.insetUri}" alt=""><figcaption>${esc(spec.insetLabel || 'Filmed live on three.ws')}</figcaption></figure>` : '',
			spec.credit ? `<div class="credit">${esc(spec.credit)}</div>` : '',
		].join('');
	}
	return `<div class="browser"><div class="bar"><u></u><u></u><u></u><span>${esc(spec.label || 'three.ws')}</span></div><img src="${shotUri}" alt=""></div>`;
}

// The card as HTML. `shotUri` is a data URI (imageUri) or null for type alone.
export function cardHtml(spec, shotUri, brand) {
	const W = CARD_WIDTH;
	const H = CARD_HEIGHT;
	const art = spec.frame === 'art';
	const wide = spec.frame === 'code';
	const copyWidth = wide ? W - 144 : spec.frame === 'phone' ? 760 : spec.frame === 'panel' ? 700 : art ? 820 : 650;
	const copyTop = art ? 'auto' : `${wide ? 170 : spec.code ? 196 : 232}px`;
	const headline = esc(spec.headline || '').replace(/\n/g, '<br>');
	const code = codeHtml(spec.code);
	return `<!doctype html><meta charset="utf-8"><style>
${brand.fontFaces}
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:#000;color:#fff;overflow:hidden;position:relative;font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
.glow{position:absolute;inset:0;background:
	radial-gradient(34% 40% at 22% 28%, rgba(78,120,255,.22), transparent 70%),
	radial-gradient(30% 36% at 80% 24%, rgba(56,180,255,.14), transparent 72%),
	radial-gradient(34% 40% at 30% 84%, rgba(140,84,255,.16), transparent 70%),
	radial-gradient(30% 36% at 84% 80%, rgba(104,96,255,.14), transparent 72%)}
.beam{position:absolute;left:4%;right:4%;top:40%;height:220px;transform:rotate(-5deg);filter:blur(60px);
	background:linear-gradient(90deg, transparent, rgba(150,200,255,.09) 22%, rgba(190,220,255,.14) 50%, rgba(150,200,255,.09) 78%, transparent)}
.lockup{position:absolute;left:72px;top:60px;display:flex;align-items:center;gap:16px;z-index:3}
.lockup img{width:64px;height:64px;border-radius:17px}
.lockup span{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:42px;letter-spacing:-.045em}
.copy{position:absolute;left:72px;top:${copyTop};${art ? 'bottom:96px;' : ''}width:${copyWidth}px;z-index:3}
h1{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:-.04em;line-height:1.02;font-size:${spec.headlineSize || (art ? 84 : wide ? 60 : 74)}px;${art ? 'text-shadow:0 4px 40px rgba(0,0,0,.85);' : ''}}
.copy p{margin-top:26px;font-size:27px;line-height:1.45;color:${art ? '#c4d0e8' : '#a7b6d3'};${art ? 'text-shadow:0 2px 24px rgba(0,0,0,.9);' : ''}}
.code{margin-top:34px;padding:22px 24px;border-radius:16px;background:rgba(12,16,32,.78);box-shadow:0 0 0 1px rgba(255,255,255,.10) inset;
	font:500 16px/1.75 ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:#c9d6f2;white-space:nowrap;overflow:hidden}
.code .t{color:#7fb2ff;font-weight:600}.code .a{color:#b79bff}.code .s{color:#8fe3b4}.code .k{color:#ff9ecf}.code .n{color:#ffd28a}.code .c{color:#6b7a99;font-style:italic}
${wide ? `.copy{top:150px;bottom:${spec.foot ? 110 : 70}px;display:flex;flex-direction:column;justify-content:center}.copy p{margin-top:16px;font-size:24px}
.code{margin-top:30px;padding:28px 32px;font-size:${codeSize(spec.code)}px;line-height:1.6;white-space:pre;background:rgba(10,13,26,.88)}` : ''}
.foot{position:absolute;left:72px;bottom:58px;font-size:21px;color:#8fa3c6;letter-spacing:.01em;z-index:3}
.browser{position:absolute;left:760px;top:150px;width:780px;border-radius:18px;overflow:hidden;
	background:#12131f;box-shadow:0 50px 100px rgba(0,0,0,.9), 0 12px 30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.12) inset;
	transform:perspective(2200px) rotateY(-7deg) rotateX(2deg)}
.bar{height:44px;display:flex;align-items:center;gap:8px;padding:0 16px;background:linear-gradient(#262a40,#1a1d2e)}
.bar u{width:11px;height:11px;border-radius:50%;background:#4a5070;display:block}
.bar span{margin-left:14px;flex:1;height:24px;border-radius:12px;background:rgba(255,255,255,.07);font-size:13px;line-height:24px;padding:0 12px;color:#93a2c4}
.browser img{display:block;width:100%}
.phone{position:absolute;left:1180px;top:470px;width:360px;transform:translate(-50%,-50%) perspective(1800px) rotateY(-8deg) rotateX(3deg);
	border-radius:34px;padding:8px;background:linear-gradient(135deg,#4a5070 0%,#2a2e44 26%,#12131f 62%,#31364f 100%);
	box-shadow:0 50px 100px rgba(0,0,0,.92), 0 12px 30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.10) inset}
.phone img{display:block;width:100%;border-radius:27px;background:#000}
.panel{position:absolute;right:72px;top:90px;bottom:90px;width:720px;display:flex;align-items:center;justify-content:center}
.panel img{display:block;max-width:100%;max-height:100%;border-radius:22px;background:#05060c;
	box-shadow:0 50px 100px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.12), 0 0 80px rgba(96,120,255,.22)}
.art{position:absolute;inset:0;background-size:cover;background-position:${spec.artPosition || 'center right'}}
.art-fade{position:absolute;inset:0;background:
	linear-gradient(90deg, rgba(0,0,0,.92) 0%, rgba(0,0,0,.72) 34%, rgba(0,0,0,.18) 62%, transparent 78%),
	linear-gradient(0deg, rgba(0,0,0,.75) 0%, transparent 34%),
	linear-gradient(180deg, rgba(0,0,0,.55) 0%, transparent 22%)}
.inset{position:absolute;right:56px;bottom:56px;width:380px;z-index:3}
.inset img{display:block;width:100%;border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.18)}
.inset figcaption{margin-top:10px;font-size:15px;color:#c4d0e8;text-align:right;letter-spacing:.02em;text-shadow:0 2px 12px rgba(0,0,0,.9)}
.credit{position:absolute;right:56px;top:66px;font-size:14px;color:rgba(220,228,255,.62);letter-spacing:.06em;text-transform:uppercase;z-index:3}
</style>
${art ? '' : '<div class="glow"></div><div class="beam"></div>'}
${shotUri ? frameHtml(spec, shotUri) : ''}
<div class="lockup"><img src="${brand.markUri}" alt=""><span>three.ws</span></div>
<div class="copy"><h1>${headline}</h1>${spec.body ? `<p>${esc(spec.body)}</p>` : ''}${code ? `<div class="code">${code}</div>` : ''}</div>
${spec.foot ? `<div class="foot">${esc(spec.foot)}</div>` : ''}`;
}

// Renders the card in a browser that never touched WebGL: capturing a WebGL
// page can wedge the software GPU process, after which every screenshot in
// that browser fails. Returns PNG bytes.
export async function renderCard(spec, { root, shot = null } = {}) {
	if (shot && (await isBlank(shot))) throw new Error(`the frame for ${spec.out || 'the card'} is effectively blank`);
	const shotUri = shot ? await imageUri(shot) : null;
	const { chromium } = await import('playwright');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: CARD_HEIGHT }, deviceScaleFactor: 1 });
		await page.setContent(cardHtml(spec, shotUri, brandAssets(root)), { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		return await page.screenshot({ type: 'png' });
	} finally {
		await browser.close();
	}
}

// PNG when it fits X's 5 MB image limit with room to spare, JPEG otherwise (a
// full-bleed photographic card compresses badly as PNG).
export async function encodeCard(png, { maxBytes = 4.5 * 1024 * 1024 } = {}) {
	const lossless = await sharp(png).png({ compressionLevel: 9 }).toBuffer();
	if (lossless.length <= maxBytes) return { buffer: lossless, ext: '.png' };
	return { buffer: await sharp(png).jpeg({ quality: 92, mozjpeg: true }).toBuffer(), ext: '.jpg' };
}
