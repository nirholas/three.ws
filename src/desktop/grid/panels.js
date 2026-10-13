// Canvas painters for the Grid's surfaces. Each takes the live state the
// controller holds and draws one neon-on-black panel. A feed that has not
// landed draws a skeleton; a feed that failed says so and names the retry.

import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three';
import { clip, wrap } from './logic.js';
import { describeEvent, fmtUsd, fmtPct, fmtCount, relTime } from '../../field/logic.js';

export const INK = '#19ffb0';
export const DIM = '#0d7a55';
export const FAINT = '#073d2b';
export const BG = '#020a07';
const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** A canvas surface and the texture that mirrors it. */
export function createSurface(w, h, anisotropy = 4) {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.minFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.anisotropy = anisotropy;
	return { canvas, ctx, texture, w, h, dispose: () => texture.dispose() };
}

function font(ctx, px, weight = 500) {
	ctx.font = `${weight} ${px}px ${FONT}`;
}

function frame(ctx, w, h, hot) {
	ctx.fillStyle = BG;
	ctx.fillRect(0, 0, w, h);
	ctx.strokeStyle = hot ? INK : DIM;
	ctx.lineWidth = hot ? 6 : 3;
	ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
}

function heading(ctx, x, y, title, tag, scale = 1) {
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = INK;
	font(ctx, 46 * scale, 700);
	ctx.fillText(title, x, y);
	if (tag) {
		const tw = ctx.measureText(title).width;
		ctx.fillStyle = DIM;
		font(ctx, 22 * scale, 500);
		ctx.fillText(tag, x + tw + 18 * scale, y);
	}
}

function card(ctx, x, y, w, h, lines, hot) {
	ctx.fillStyle = hot ? '#0a3d2c' : '#05261b';
	ctx.fillRect(x, y, w, h);
	ctx.strokeStyle = DIM;
	ctx.lineWidth = 2;
	ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
	let ly = y + 30;
	for (const l of lines) {
		ctx.fillStyle = l.dim ? DIM : INK;
		font(ctx, l.px || 22, l.bold ? 700 : 500);
		ctx.fillText(l.text, x + 14, ly);
		ly += (l.px || 22) + 8;
	}
}

function skeleton(ctx, x, y, w, rows, rowH, gap) {
	for (let i = 0; i < rows; i++) {
		ctx.fillStyle = FAINT;
		ctx.fillRect(x, y + i * (rowH + gap), w, rowH);
	}
}

function notice(ctx, x, y, w, title, body) {
	ctx.fillStyle = INK;
	font(ctx, 24, 700);
	ctx.fillText(title, x, y);
	ctx.fillStyle = DIM;
	font(ctx, 20, 500);
	wrap(body, Math.floor(w / 12)).forEach((l, i) => ctx.fillText(l, x, y + 32 + i * 26));
}

/** `{ status: 'loading' | 'ok' | 'error', items, error }` per feed. */
const live = (s) => s && s.status === 'ok';

/**
 * The back-wall board: four live columns, the way a task board reads.
 * @param {{ stats: object, agents: object, launches: object, pulse: object, token: object }} S
 */
export function paintBoard(surface, S, hot) {
	const { ctx, w, h } = surface;
	frame(ctx, w, h, hot);
	const pad = 36;
	heading(ctx, pad, 74, 'three.ws', 'LIVE BOARD');
	if (live(S.stats)) {
		const t = S.stats.items;
		ctx.textAlign = 'right';
		ctx.fillStyle = DIM;
		font(ctx, 24, 500);
		ctx.fillText(`${fmtCount(t.agents)} agents  |  ${fmtCount(t.launches)} launches  |  ${fmtCount(t.strategies)} strategies`, w - pad, 70);
		ctx.textAlign = 'left';
	}
	const cols = [
		{ title: 'NEW AGENTS', feed: S.agents, retry: 'agents', rows: (a) => [{ text: clip(a.name || 'Unnamed agent', 20), bold: true, px: 24 }, { text: clip(a.description || 'No description yet', 28), dim: true }], count: 5 },
		{ title: 'LAUNCHES', feed: S.launches, retry: 'launches', rows: (l) => [{ text: clip(l.name || 'Unnamed', 20), bold: true, px: 24 }, { text: `$${clip(String(l.symbol || '').toUpperCase(), 8)}  by ${clip(l.agent?.name || 'an agent', 14)}`, dim: true }], count: 5 },
		{ title: 'WALLET MOVES', feed: S.pulse, retry: 'pulse', rows: (e) => [{ text: clip(describeEvent(e), 30), bold: true, px: 20 }, { text: `${e.kind || 'move'}${e.usd ? `  ${fmtUsd(e.usd)}` : ''}  ${relTime(e.ts)}`, dim: true }], count: 5 },
		{ title: '$THREE', feed: S.token, retry: 'token', rows: null, count: 0 },
	];
	const gap = 20;
	const top = 112;
	const cw = (w - pad * 2 - gap * (cols.length - 1)) / cols.length;
	cols.forEach((c, i) => {
		const x = pad + i * (cw + gap);
		ctx.fillStyle = INK;
		font(ctx, 22, 700);
		ctx.fillText(c.title, x, top + 14);
		ctx.strokeStyle = DIM;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, top + 28);
		ctx.lineTo(x + cw, top + 28);
		ctx.stroke();
		const y0 = top + 46;
		if (!c.feed || c.feed.status === 'loading') return skeleton(ctx, x, y0, cw, 5, 96, 14);
		if (c.feed.status === 'error') return notice(ctx, x, y0 + 24, cw, 'Offline', `${c.feed.error || 'The feed did not answer'}. It retries on its own.`);
		if (c.title === '$THREE') {
			const t = c.feed.items;
			card(ctx, x, y0, cw, 150, [
				{ text: fmtUsd(t.price) || '--', bold: true, px: 44 },
				{ text: fmtPct(t.change) ? `${fmtPct(t.change)} 24h` : '24h change unavailable', dim: true, px: 22 },
			]);
			card(ctx, x, y0 + 164, cw, 118, [{ text: `cap ${fmtUsd(t.cap) || '--'}`, px: 22 }, { text: `vol ${fmtUsd(t.volume) || '--'}`, dim: true }, { text: `${fmtCount(t.holders)} holders`, dim: true }]);
			return;
		}
		const items = c.feed.items.slice(0, c.count);
		if (!items.length) return notice(ctx, x, y0 + 24, cw, 'Nothing yet', 'New entries appear here the moment they land.');
		items.forEach((it, k) => card(ctx, x, y0 + k * 110, cw, 98, c.rows(it)));
	});
}

/** The side wall that lists every app and what it does. */
export function paintDirectory(surface, apps, hot) {
	const { ctx, w, h } = surface;
	frame(ctx, w, h, hot);
	heading(ctx, 36, 70, 'DIRECTORY', `${apps.length} apps`, 0.9);
	const rowH = Math.floor((h - 130) / Math.max(apps.length, 1));
	apps.forEach((a, i) => {
		const y = 112 + i * rowH;
		ctx.fillStyle = i % 2 ? '#04180f' : '#052217';
		ctx.fillRect(28, y, w - 56, rowH - 6);
		ctx.fillStyle = INK;
		font(ctx, 26, 700);
		ctx.fillText(a.title, 46, y + rowH / 2 - 2);
		ctx.fillStyle = DIM;
		font(ctx, 19, 500);
		ctx.fillText(clip(a.desc || '', 56), 46, y + rowH / 2 + 24);
	});
}

/** The wallet-moves wall. */
export function paintPulse(surface, S, hot) {
	const { ctx, w, h } = surface;
	frame(ctx, w, h, hot);
	heading(ctx, 36, 70, 'PULSE', 'WALLET MOVES', 0.9);
	const f = S.pulse;
	if (!f || f.status === 'loading') return skeleton(ctx, 36, 110, w - 72, 6, 60, 14);
	if (f.status === 'error') return notice(ctx, 36, 140, w - 72, 'Pulse is offline', `${f.error || 'The feed did not answer'}. It retries on its own.`);
	if (!f.items.length) return notice(ctx, 36, 140, w - 72, 'Quiet right now', 'Agent wallet moves appear here as they happen.');
	f.items.slice(0, 7).forEach((e, i) => {
		const y = 110 + i * 70;
		ctx.fillStyle = i % 2 ? '#04180f' : '#052217';
		ctx.fillRect(28, y, w - 56, 62);
		ctx.fillStyle = INK;
		font(ctx, 21, 700);
		ctx.fillText(clip(describeEvent(e), 52), 44, y + 27);
		ctx.fillStyle = DIM;
		font(ctx, 18, 500);
		ctx.fillText(`${e.kind || 'move'}${e.usd ? `  ${fmtUsd(e.usd)}` : ''}  ${relTime(e.ts)}`, 44, y + 51);
	});
}

/** One app's standing kiosk. */
export function paintKiosk(surface, app, hot) {
	const { ctx, w, h } = surface;
	frame(ctx, w, h, hot);
	ctx.fillStyle = hot ? '#0a3d2c' : '#05261b';
	ctx.fillRect(24, 24, w - 48, h * 0.34);
	ctx.textAlign = 'center';
	ctx.fillStyle = INK;
	// Shrink the title until it fits the slab, so long names never clip.
	let px = 66;
	font(ctx, px, 700);
	while (px > 30 && ctx.measureText(app.title.toUpperCase()).width > w - 80) font(ctx, (px -= 4), 700);
	ctx.fillText(app.title.toUpperCase(), w / 2, 24 + h * 0.34 / 2 + px * 0.34);
	ctx.fillStyle = DIM;
	font(ctx, 29, 500);
	wrap(app.sub || '', 20).slice(0, 4).forEach((l, i) => ctx.fillText(l, w / 2, h * 0.52 + i * 38));
	ctx.fillStyle = hot ? INK : DIM;
	font(ctx, 30, 700);
	ctx.fillText(hot ? 'PRESS E TO OPEN' : 'OPEN APP', w / 2, h - 30);
	ctx.textAlign = 'left';
}
