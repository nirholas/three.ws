#!/usr/bin/env node
// Build the GTC 2027 poster PDF from the template, the measured data, and the
// rendered rig frames in docs/nvidia-gtc-2027.
// ---------------------------------------------------------------------------
// Inputs
//   docs/nvidia-gtc-2027/poster.template.html     layout and copy ({{slots}})
//   docs/nvidia-gtc-2027/data/coverage-*.json     rig coverage by source
//   docs/nvidia-gtc-2027/data/latency-*.json      per-call latency
//   docs/nvidia-gtc-2027/data/a2f-track-sample.json  a real production track
//   docs/nvidia-gtc-2027/figures/*.png            from scripts/gtc-poster-render-rigs.mjs
// Outputs
//   docs/nvidia-gtc-2027/poster.html              filled template (charts inline)
//   docs/nvidia-gtc-2027/poster.pdf               43 in x 24 in, 1 in margin
//   docs/nvidia-gtc-2027/poster-preview.png       half-scale preview
//
// Every number on the poster is computed here from the data files, so a
// re-measurement only needs the JSON refreshed and this script re-run.
//
// Usage: node scripts/gtc-poster-build.mjs
// Needs the Playwright Chromium that `npm test` already uses.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import pw from 'playwright';
import { OCULUS_TO_ARKIT, canonicalARKitName } from '../src/voice/arkit-blendshapes.js';
import { deriveExpressionWeight } from '../src/voice/a2f-player.js';

const { chromium } = pw;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/nvidia-gtc-2027');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const coverage = readJson(path.join(DIR, 'data/coverage-2026-11-04.json'));
const latency = readJson(path.join(DIR, 'data/latency-2026-11-04.json'));
const track = readJson(path.join(DIR, 'data/a2f-track-sample.json'));
const manifest = readJson(path.join(DIR, 'figures/manifest.json'));
const threeVersion = readJson(path.join(ROOT, 'node_modules/three/package.json')).version;

// ---------------------------------------------------------------- palette
// Validated with the dataviz palette validator: blue, orange, aqua pass the
// adjacent-pair gates on the light surface; "no morphs" is a hatched neutral,
// not a series color.
const C = { direct: '#2a78d6', derived: '#eb6834', unmapped: '#1baf7a', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb', neutral: '#f0efec' };
const FONT = `font-family="Inter, 'Inter Fallback', Arial, sans-serif"`;
const fmt = (n, d = 1) => Number(n).toFixed(d);
const pct = (a, b, d = 1) => `${fmt((100 * a) / b, d)}%`;

// ---------------------------------------------------------------- numbers
const totals = coverage.totals;
const morphed = coverage.morphed;
const driven = coverage.driven;
const files = coverage.readable;
const noMorphPct = pct(totals.no_morphs, files);

const calls = latency.calls;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const medianLatency = median(calls.map((c) => c.latency_s));
const medianSpeech = median(calls.map((c) => c.speech_s));
const fastCalls = calls.filter((c) => c.latency_s < c.speech_s);
const ratios = fastCalls.map((c) => c.latency_s / c.speech_s);

// Overshoot replay: mapping-implied jaw opening with and without the rule.
const jawCol = track.blendShapeNames.findIndex((n) => canonicalARKitName(n) === 'jawOpen');
const canon = track.blendShapeNames.map((n) => canonicalARKitName(n));
const visemes = Object.entries(OCULUS_TO_ARKIT).filter(([, comps]) => comps.jawOpen > 0);
const series = track.frames.map((f) => {
	const frame = {};
	canon.forEach((c, i) => { if (c) frame[c] = f.w[i]; });
	const direct = f.w[jawCol];
	let both = direct;
	for (const [, comps] of visemes) both += deriveExpressionWeight(frame, comps) * comps.jawOpen;
	return { t: f.t, direct, both };
});
const voiced = series.filter((s) => s.direct > 0.05);
const overshootPct = pct(voiced.filter((s) => s.both > 1).length, voiced.length, 0);
const cleanPct = pct(voiced.filter((s) => s.direct > 1).length, voiced.length, 0);
const overshootPeak = fmt(Math.max(...voiced.map((s) => s.both / s.direct)), 1);
const peak = series.reduce((best, s, i) => (s.direct > best.v ? { v: s.direct, i, t: s.t } : best), { v: 0, i: 0, t: 0 });

const rigInfo = (id, variant) => manifest.rigs.find((r) => r.id === id).variants.find((v) => v.variant === variant);

// ---------------------------------------------------------------- charts
function coverageChart() {
	const rows = coverage.sources.filter((s) => s.direct + s.derived + s.unmapped + s.no_morphs >= 5);
	const W = 940, labelW = 300, barH = 24, rowH = 40, top = 8;
	const H = top + rows.length * rowH + 44;
	const plotW = W - labelW - 170;
	const maxN = Math.max(...rows.map((s) => s.direct + s.derived + s.unmapped + s.no_morphs));
	const x = (n) => (n / maxN) * plotW;
	let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT} font-size="24">`;
	out += `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${C.neutral}"/><rect width="2.5" height="8" fill="${C.axis}"/></pattern></defs>`;
	for (const tick of [0, 20, 40, 60]) {
		if (tick > maxN) continue;
		const tx = labelW + x(tick);
		out += `<line x1="${tx}" y1="${top}" x2="${tx}" y2="${H - 40}" stroke="${C.grid}" stroke-width="1"/>`;
		out += `<text x="${tx}" y="${H - 14}" text-anchor="middle" fill="${C.muted}" font-size="22">${tick}</text>`;
	}
	out += `<text x="${labelW + plotW + 60}" y="${H - 14}" text-anchor="middle" fill="${C.muted}" font-size="22">files</text>`;
	rows.forEach((s, i) => {
		const y = top + i * rowH + (rowH - barH) / 2;
		out += `<text x="${labelW - 14}" y="${y + barH / 2 + 8}" text-anchor="end" fill="${C.ink2}">${s.source}</text>`;
		let cx = labelW;
		const segs = [[s.direct, C.direct], [s.derived, C.derived], [s.unmapped, C.unmapped], [s.no_morphs, 'url(#hatch)']];
		for (const [n, fill] of segs) {
			if (!n) continue;
			const w = x(n);
			const r = 4;
			// 2px surface gap between touching segments, rounded data end only.
			out += `<path d="M${cx},${y} h${Math.max(w - 2 - r, 0)} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-Math.max(w - 2 - r, 0)} z" fill="${fill}"/>`;
			if (w > 44 && n >= 10) out += `<text x="${cx + 10}" y="${y + barH / 2 + 7}" fill="${fill === 'url(#hatch)' ? C.ink2 : '#fff'}" font-size="20" font-weight="600">${n}</text>`;
			cx += w;
		}
		const drivenHere = s.direct + s.derived, morphedHere = drivenHere + s.unmapped;
		if (morphedHere) out += `<text x="${cx + 10}" y="${y + barH / 2 + 8}" fill="${C.ink2}" font-size="21">${drivenHere}/${morphedHere} driven</text>`;
	});
	return out + '</svg>';
}

function latencyChart() {
	const W = 940, H = 246, left = 90, right = 20, top = 16, bottom = 52;
	const plotW = W - left - right, plotH = H - top - bottom;
	const yMax = 14;
	const y = (s) => top + plotH - (s / yMax) * plotH;
	const x = (i) => left + ((i + 0.5) / calls.length) * plotW;
	let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT} font-size="22">`;
	for (const tick of [0, 2, 4, 6, 8, 10, 12, 14]) {
		out += `<line x1="${left}" y1="${y(tick)}" x2="${W - right}" y2="${y(tick)}" stroke="${tick === 0 ? C.axis : C.grid}" stroke-width="1"/>`;
		out += `<text x="${left - 12}" y="${y(tick) + 7}" text-anchor="end" fill="${C.muted}">${tick}</text>`;
	}
	out += `<text x="${left - 12}" y="${top - 2}" text-anchor="end" fill="${C.muted}" font-size="20">s</text>`;
	// Speech duration: orange bar per call (the budget the latency is measured against).
	calls.forEach((c, i) => {
		out += `<line x1="${x(i) - 22}" y1="${y(c.speech_s)}" x2="${x(i) + 22}" y2="${y(c.speech_s)}" stroke="${C.derived}" stroke-width="3" stroke-linecap="round"/>`;
		out += `<text x="${x(i)}" y="${H - 22}" text-anchor="middle" fill="${C.muted}">${c.call}</text>`;
	});
	out += `<text x="${left + plotW / 2}" y="${H}" text-anchor="middle" fill="${C.muted}" font-size="20">consecutive production calls, 2026-11-04</text>`;
	// Median line.
	out += `<line x1="${left}" y1="${y(medianLatency)}" x2="${W - right}" y2="${y(medianLatency)}" stroke="${C.direct}" stroke-width="2" stroke-dasharray="6 6" opacity="0.7"/>`;
	out += `<text x="${W - right}" y="${y(medianLatency) - 12}" text-anchor="end" fill="${C.ink2}" font-size="21">median ${fmt(medianLatency, 2)} s</text>`;
	// Latency dots with a 2px surface ring; label only the two tails.
	calls.forEach((c, i) => {
		out += `<circle cx="${x(i)}" cy="${y(c.latency_s)}" r="11" fill="${C.surface}"/><circle cx="${x(i)}" cy="${y(c.latency_s)}" r="9" fill="${C.direct}"/>`;
		if (c.latency_s > c.speech_s) out += `<text x="${x(i) + 18}" y="${y(c.latency_s) + 8}" fill="${C.ink2}" font-size="21">${fmt(c.latency_s, 1)} s</text>`;
	});
	return out + '</svg>';
}

function overshootChart() {
	const W = 940, H = 270, left = 90, right = 20, top = 16, bottom = 52;
	const plotW = W - left - right, plotH = H - top - bottom;
	const tMax = series[series.length - 1].t, yMax = 2.0;
	const x = (t) => left + (t / tMax) * plotW;
	const y = (v) => top + plotH - (Math.min(v, yMax) / yMax) * plotH;
	const pathOf = (key) => series.map((s, i) => `${i ? 'L' : 'M'}${fmt(x(s.t), 1)},${fmt(y(s[key]), 1)}`).join('');
	let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT} font-size="22">`;
	for (const tick of [0, 0.5, 1, 1.5, 2]) {
		out += `<line x1="${left}" y1="${y(tick)}" x2="${W - right}" y2="${y(tick)}" stroke="${tick === 0 ? C.axis : C.grid}" stroke-width="1"/>`;
		out += `<text x="${left - 12}" y="${y(tick) + 7}" text-anchor="end" fill="${C.muted}">${tick.toFixed(1)}</text>`;
	}
	// Saturation band above 1.0.
	out += `<rect x="${left}" y="${y(yMax)}" width="${plotW}" height="${y(1) - y(yMax)}" fill="${C.derived}" opacity="0.08"/>`;
	out += `<text x="${left + 10}" y="${y(yMax) + 26}" fill="${C.ink2}" font-size="21">morph saturates above 1.0</text>`;
	for (const tick of [0, 2, 4, 6]) {
		out += `<text x="${x(tick)}" y="${H - 22}" text-anchor="middle" fill="${C.muted}">${tick}</text>`;
	}
	out += `<text x="${left + plotW / 2}" y="${H}" text-anchor="middle" fill="${C.muted}" font-size="20">seconds into the 228-frame production track</text>`;
	out += `<path d="${pathOf('both')}" fill="none" stroke="${C.derived}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
	out += `<path d="${pathOf('direct')}" fill="none" stroke="${C.direct}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
	// Mark the frame used in the rig figures.
	out += `<line x1="${x(peak.t)}" y1="${top}" x2="${x(peak.t)}" y2="${y(0)}" stroke="${C.axis}" stroke-width="1"/>`;
	out += `<text x="${x(peak.t) - 8}" y="${y(yMax) + 26}" text-anchor="end" fill="${C.ink2}" font-size="20">frame ${peak.i}, shown in the figures</text>`;
	return out + '</svg>';
}

function pipelineSvg() {
	const W = 960, H = 300;
	const boxes = [
		['Microphone', 'browser', C.muted],
		['Riva ASR', 'NVCF gRPC', C.direct],
		['Nemotron', 'NIM, tool calls', C.direct],
		['Magpie TTS', '44.1 kHz WAV', C.direct],
		['Resample', '16 kHz mono, on the server', C.muted],
		['Audio2Face-3D', 'NVCF stream, 30 fps', C.direct],
		['A2FPlayer', 'browser, per morph', C.derived],
	];
	const cols = 4, bw = 206, bh = 88, gx = 38, gy = 44;
	let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${FONT} font-size="24">`;
	out += `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.ink2}"/></marker></defs>`;
	const pos = boxes.map((_, i) => {
		const r = Math.floor(i / cols), c = i % cols;
		const cc = r % 2 ? cols - 1 - c : c; // serpentine so arrows stay short
		return { x: 10 + cc * (bw + gx), y: 10 + r * (bh + gy) };
	});
	boxes.forEach(([name, sub, color], i) => {
		const { x, y } = pos[i];
		out += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="${C.surface}" stroke="${color}" stroke-width="3"/>`;
		out += `<rect x="${x}" y="${y}" width="10" height="${bh}" rx="5" fill="${color}"/>`;
		out += `<text x="${x + 24}" y="${y + 40}" fill="${C.ink}" font-weight="600">${name}</text>`;
		out += `<text x="${x + 24}" y="${y + 72}" fill="${C.ink2}" font-size="21">${sub}</text>`;
		if (i < boxes.length - 1) {
			const a = pos[i], b = pos[i + 1];
			if (a.y === b.y) {
				const dir = b.x > a.x ? 1 : -1;
				out += `<line x1="${dir > 0 ? a.x + bw : a.x}" y1="${a.y + bh / 2}" x2="${dir > 0 ? b.x : b.x + bw}" y2="${b.y + bh / 2}" stroke="${C.ink2}" stroke-width="2" marker-end="url(#arr)"/>`;
			} else {
				out += `<line x1="${a.x + bw / 2}" y1="${a.y + bh}" x2="${b.x + bw / 2}" y2="${b.y}" stroke="${C.ink2}" stroke-width="2" marker-end="url(#arr)"/>`;
			}
		}
	});
	// The audio the browser plays bypasses inference: original WAV + JSON track.
	const tts = pos[3], player = pos[6];
	const sx = tts.x + bw - 24, midY = tts.y + bh + gy / 2, railX = W - 6, lowY = player.y + bh + 26, ex = player.x + bw / 2;
	out += `<path d="M${sx},${tts.y + bh} L${sx},${midY} L${railX},${midY} L${railX},${lowY} L${ex},${lowY} L${ex},${player.y + bh + 2}" fill="none" stroke="${C.derived}" stroke-width="2" stroke-linejoin="round" stroke-dasharray="7 7" marker-end="url(#arr)"/>`;
	out += `<text x="${(tts.x + player.x + bw) / 2}" y="${H - 8}" text-anchor="middle" fill="${C.ink2}" font-size="21">original audio plays in the browser; its clock samples the track</text>`;
	return out + '</svg>';
}

const qr = async (url) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: C.ink, light: '#ffffff' } });

// ---------------------------------------------------------------- fill
const slots = {
	driven_pct: pct(driven, morphed),
	driven, morphed, files,
	derived: totals.derived, unmapped: totals.unmapped,
	nonarkit: `${totals.derived + totals.unmapped} of ${morphed}`,
	no_morph_pct: noMorphPct,
	median_latency: fmt(medianLatency, 1),
	median_speech: fmt(medianSpeech, 1),
	fast_calls: fastCalls.length,
	ratio_min: fmt(Math.min(...ratios), 2),
	ratio_max: fmt(Math.max(...ratios), 2),
	peak_frame: peak.i, peak_t: fmt(peak.t, 2), peak_jaw: fmt(peak.v, 2),
	sample_text_short: track.text,
	direct_selfie: rigInfo('selfie', 'direct').direct,
	direct_default: rigInfo('default', 'direct').direct,
	direct_realistic: rigInfo('realistic', 'direct').direct,
	expr_default: rigInfo('default', 'derived-only').expression,
	overshoot_pct: overshootPct, clean_pct: cleanPct, overshoot_peak: overshootPeak,
	three_version: threeVersion,
	pipeline_svg: pipelineSvg(),
	coverage_svg: coverageChart(),
	latency_svg: latencyChart(),
	overshoot_svg: overshootChart(),
	qr_repo: await qr('https://github.com/nirholas/three.ws/tree/main/docs/nvidia-gtc-2027'),
	qr_demo: await qr('https://three.ws/demos/audio2face'),
};
let html = readFileSync(path.join(DIR, 'poster.template.html'), 'utf8');
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
	if (!(k in slots)) throw new Error(`template slot without a value: ${k}`);
	return String(slots[k]);
});
writeFileSync(path.join(DIR, 'poster.html'), html);
writeFileSync(path.join(DIR, 'data/derived-figures.json'), JSON.stringify({
	built_at: new Date().toISOString(),
	driven_pct: slots.driven_pct, median_latency_s: medianLatency, median_speech_s: medianSpeech,
	fast_calls: fastCalls.length, real_time_ratio_range: [Number(slots.ratio_min), Number(slots.ratio_max)],
	overshoot: { voiced_frames: voiced.length, saturated_pct_without_rule: overshootPct, saturated_pct_with_rule: cleanPct, peak_ratio: Number(overshootPeak), visemes_with_jaw_component: visemes.map(([n]) => n) },
	peak_frame: peak,
}, null, 1));

// ---------------------------------------------------------------- render
const MIME = { '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
	const clean = decodeURIComponent(req.url.split('?')[0]);
	const p = path.join(ROOT, clean);
	if (!p.startsWith(ROOT) || !existsSync(p) || !statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
	res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
	createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 4128, height: 2304 }, deviceScaleFactor: 0.5 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('requestfailed', (r) => console.error('[requestfailed]', r.url()));
await page.goto(`http://127.0.0.1:${port}/docs/nvidia-gtc-2027/poster.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const layout = await page.evaluate(() => {
	const px = (v) => Math.round(v);
	const cols = [...document.querySelectorAll(".columns > .col")].map((c) => ({ scroll: px(c.scrollHeight), box: px(c.clientHeight) }));
	const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
	const sections = [...document.querySelectorAll('section')].map((s) => `${s.querySelector('h2 .n')?.textContent}:${px(s.getBoundingClientRect().height)}`);
	return { body: { w: px(document.body.scrollWidth), h: px(document.body.scrollHeight) }, header: px(document.querySelector('header').getBoundingClientRect().height), cols, sections, fonts: [...new Set(fonts)] };
});
console.log('layout', JSON.stringify(layout));
const overflow = layout.cols.filter((c) => c.scroll > c.box + 2);
if (overflow.length) console.error(`WARNING: ${overflow.length} column(s) overflow the 22 in design area: ${JSON.stringify(overflow)}`);
await page.pdf({ path: path.join(DIR, 'poster.pdf'), width: '43in', height: '24in', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await page.screenshot({ path: path.join(DIR, 'poster-preview.png'), fullPage: false });
await browser.close();
server.close();
const bytes = statSync(path.join(DIR, 'poster.pdf')).size;
console.log(`poster.pdf ${(bytes / 1e6).toFixed(1)} MB, preview ${path.relative(ROOT, path.join(DIR, 'poster-preview.png'))}`);
if (overflow.length) process.exitCode = 1;
