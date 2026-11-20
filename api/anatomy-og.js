// api/anatomy-og.js: the share card for one Anatomy machine (/anatomy/:id).
//
// GET /api/anatomy-og?id=<uuid> renders a 1200x630 PNG of the machine itself:
// its isometric line drawing (src/anatomy/plot.js walks the spec the way the
// viewer does, so the card shows the view a visitor lands on), its title, its
// subtitle and how many parts and tour steps it has. server/anatomy-head.mjs
// points og:image and twitter:image here, so a turbofan and a carburetor no
// longer unfurl as the same generic Anatomy card on X, in Grok's reading of a
// link, or in any chat unfurler.
//
// A malformed or unknown id, or a design with nothing drawable, redirects to
// the brand card (/og-image.png) rather than serving a broken image. Rendered
// with the shared satori renderer (api/_lib/og-image.js) on the Node runtime.

import { ImageResponse } from './_lib/og-image.js';
import { method } from './_lib/http.js';
import { selfOrigin } from './_lib/self-origin.js';
import { loadDesign, UUID_RE } from './_lib/anatomy/service.js';
import { plotDesignSvg } from '../src/anatomy/plot.js';

const WIDTH = 1200;
const HEIGHT = 630;
const PLOT_W = 600;
const PLOT_H = 540;
const TITLE_MAX = 70;
const SUBTITLE_MAX = 150;

function clean(value, max) {
	const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
	if (s.length <= max) return s;
	const cut = s.slice(0, max);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** What the card says, as data. Pure. */
export function anatomyCardModel(design) {
	const spec = design?.spec || {};
	const parts = Number(design?.stats?.parts) || (Array.isArray(spec.parts) ? spec.parts.length : 0);
	const steps = Number(design?.stats?.steps) || (Array.isArray(spec.steps) ? spec.steps.length : 0);
	const title = clean(design?.title || spec.title || 'A machine', TITLE_MAX);
	return {
		title,
		subtitle: clean(design?.subtitle, SUBTITLE_MAX),
		chips: [
			parts ? `${parts} ${parts === 1 ? 'part' : 'parts'}` : null,
			steps ? `${steps} step tour` : null,
			'Interactive cutaway',
		].filter(Boolean),
		creator: design?.creatorUsername ? `by @${clean(design.creatorUsername, 40)}` : '',
	};
}

/** The design's line drawing as a PNG data URI, or null when it has nothing to draw. */
async function drawingDataUri(spec) {
	const svg = plotDesignSvg(spec, { width: PLOT_W, height: PLOT_H, pad: 28, stroke: 1.6 });
	if (!svg) return null;
	const { default: sharp } = await import('sharp');
	// Rasterize at 2x, then let satori scale it down for crisp strokes.
	const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
	return `data:image/png;base64,${png.toString('base64')}`;
}

function div(style, children) {
	return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}

function card(model, drawing) {
	const titleSize = model.title.length > 34 ? 52 : model.title.length > 20 ? 64 : 76;
	return div({
		width: '100%',
		height: '100%',
		background: 'linear-gradient(135deg, #10131a 0%, #0a0c11 60%, #07080b 100%)',
		color: '#f4f6fa',
		fontFamily: 'geist, system-ui, sans-serif',
	}, [
		div({ flexDirection: 'column', justifyContent: 'space-between', width: 560, padding: '56px 0 56px 64px' }, [
			div({ alignItems: 'center', gap: 14 }, [
				div({ fontSize: 30, fontWeight: 800, letterSpacing: -1 }, 'three.ws'),
				div({ fontSize: 20, letterSpacing: 4, color: '#8fa3c7' }, 'ANATOMY'),
			]),
			div({ flexDirection: 'column' }, [
				div({ fontSize: 24, color: '#8fa3c7', marginBottom: 14 }, 'How it works'),
				div({ fontSize: titleSize, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }, model.title),
				model.subtitle
					? div({ fontSize: 26, lineHeight: 1.35, marginTop: 20, color: '#c3ccdb' }, model.subtitle)
					: null,
			].filter(Boolean)),
			div({ flexDirection: 'column', gap: 16 }, [
				div({ gap: 12, flexWrap: 'wrap' }, model.chips.map((label) => div({
					fontSize: 22,
					padding: '8px 18px',
					borderRadius: 999,
					background: 'rgba(143,163,199,0.12)',
					border: '1px solid rgba(143,163,199,0.32)',
					color: '#dfe6f2',
				}, label))),
				model.creator ? div({ fontSize: 22, color: '#8fa3c7' }, model.creator) : null,
			].filter(Boolean)),
		]),
		div({ flex: 1, alignItems: 'center', justifyContent: 'center', padding: '24px 32px 24px 0' }, [
			{ type: 'img', props: { src: drawing, width: PLOT_W, height: PLOT_H, style: { width: PLOT_W, height: PLOT_H } } },
		]),
	]);
}

function redirectToBrandCard(req, res) {
	res.statusCode = 302;
	res.setHeader('location', `${selfOrigin(req)}/og-image.png`);
	res.setHeader('cache-control', 'public, max-age=300');
	res.end();
}

export default async function handler(req, res) {
	if (!method(req, res, ['GET'])) return;
	const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
	if (!UUID_RE.test(id)) return redirectToBrandCard(req, res);

	let design;
	try {
		design = await loadDesign(id.toLowerCase());
	} catch (err) {
		if (err?.status !== 404 && err?.status !== 400) console.error('[anatomy-og] design lookup failed:', err?.message || err);
		return redirectToBrandCard(req, res);
	}

	try {
		const drawing = await drawingDataUri(design.spec);
		if (!drawing) return redirectToBrandCard(req, res);
		const response = new ImageResponse(card(anatomyCardModel(design), drawing), {
			width: WIDTH,
			height: HEIGHT,
			headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
		});
		const body = Buffer.from(await response.arrayBuffer());
		for (const [key, value] of response.headers.entries()) res.setHeader(key, value);
		res.statusCode = 200;
		res.end(body);
	} catch (err) {
		console.error('[anatomy-og] render failed:', err?.message || err);
		redirectToBrandCard(req, res);
	}
}
