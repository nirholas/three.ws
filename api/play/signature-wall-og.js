// api/play/signature-wall-og.js: the shareable artifact of the $THREE signature wall.
// A real 1200x630 PNG (social crawlers do not preview SVG), same ImageResponse path
// as api/og-leaderboard.js.
//
//   /api/play/signature-wall-og            the wall: live count + the newest signatures
//   /api/play/signature-wall-og?id=<id>    one signature card ("<name> signed the wall")
//
// Signature text is untrusted. It is only ever placed in satori text nodes, which
// draw glyphs and never parse markup, so "<script>" renders as the literal characters.
import { ImageResponse } from '@vercel/og';
import { method } from '../_lib/http.js';
import { listByOffset, getSignature, countSignatures } from '../_lib/signature-wall-store.js';
import { styleFor, rng, hashString } from '../../src/game/signature-wall-style.js';

const WIDTH = 1200;
const HEIGHT = 630;
const BG = '#0b0d12';
const ACCENT = '#ffe14d';
const ID_RE = /^[A-Za-z0-9]{8,32}$/;

const div = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

function shell(children) {
	return div({
		width: '100%', height: '100%', flexDirection: 'column', position: 'relative',
		background: `radial-gradient(circle at 20% 0%, #1b2030, ${BG} 70%)`, color: '#f4f4f0',
		fontFamily: 'sans-serif',
	}, [
		...children,
		div({
			position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, alignItems: 'center',
			justifyContent: 'space-between', padding: '0 56px', background: '#06070a',
			borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 20, fontWeight: 700,
			color: 'rgba(244,244,240,0.55)', letterSpacing: '0.04em',
		}, [
			div({}, 'THREE.WS · $THREE SIGNATURE WALL'),
			div({ color: 'rgba(244,244,240,0.35)' }, 'three.ws/play'),
		]),
	]);
}

// One line, cut with an ellipsis rather than mid-letter.
const clip = { display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '100%' };

// The hero name on a single-signature card shrinks with its length so a full
// 24-character name still fits the card on one line.
function heroSize(name) {
	const n = String(name || '').length;
	return n <= 12 ? 110 : Math.max(60, Math.floor((110 * 12) / n));
}

function chip(sig, i, total) {
	const st = styleFor(sig);
	const r = rng(hashString(`${sig.id}:pos`));
	const cols = 4;
	const col = i % cols;
	const row = Math.floor(i / cols);
	const left = 60 + col * 280 + (r() - 0.5) * 24;
	const top = 282 + row * 96 + (r() - 0.5) * 16;
	return div({
		position: 'absolute', left, top, width: 260, flexDirection: 'column',
		transform: `rotate(${(st.rot * 40).toFixed(1)}deg)`,
	}, [
		div({ fontSize: 40, fontWeight: 800, color: st.ink, lineHeight: 1.05, ...clip }, sig.name),
		sig.line ? div({ fontSize: 20, color: st.ink2, marginTop: 2, ...clip }, sig.line) : div({}, ''),
	]);
}

function wallCard(total, sigs) {
	return shell([
		div({ flexDirection: 'column', padding: '48px 56px 0' }, [
			div({ fontSize: 26, fontWeight: 800, color: ACCENT, letterSpacing: '0.12em' }, 'WE SIGNED THE WALL'),
			div({ alignItems: 'baseline', marginTop: 8 }, [
				div({ fontSize: 120, fontWeight: 900, lineHeight: 1 }, total.toLocaleString('en-US')),
				div({ fontSize: 34, fontWeight: 700, marginLeft: 24, color: 'rgba(244,244,240,0.7)' }, total === 1 ? 'name on the $THREE wall' : 'names on the $THREE wall'),
			]),
		]),
		...sigs.slice(0, 12).map((s, i) => chip(s, i, total)),
	]);
}

function signatureCard(sig, total) {
	const st = styleFor(sig);
	return shell([
		div({ flexDirection: 'column', padding: '64px 72px 0' }, [
			div({ fontSize: 26, fontWeight: 800, color: ACCENT, letterSpacing: '0.12em' }, `SIGNATURE NO. ${sig.no} OF ${total.toLocaleString('en-US')}`),
			div({ fontSize: heroSize(sig.name), fontWeight: 900, color: st.ink, marginTop: 36, lineHeight: 1.05, maxWidth: WIDTH - 144, ...clip, transform: `rotate(${(st.rot * 20).toFixed(1)}deg)` }, sig.name),
			sig.line ? div({ display: 'block', fontSize: 44, color: st.ink2, marginTop: 28, lineHeight: 1.2, maxWidth: WIDTH - 144, wordBreak: 'break-word', lineClamp: 3 }, sig.line) : div({}, ''),
			div({ fontSize: 28, color: 'rgba(244,244,240,0.55)', marginTop: 40 }, 'Signed the $THREE wall at the community meetup.'),
		]),
	]);
}

async function sendImage(res, node) {
	const response = new ImageResponse(node, {
		width: WIDTH,
		height: HEIGHT,
		headers: {
			'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
			'access-control-allow-origin': '*',
		},
	});
	for (const [key, value] of response.headers.entries()) res.setHeader(key, value);
	const ab = await response.arrayBuffer();
	res.statusCode = response.status;
	res.end(Buffer.from(ab));
}

export default async function handler(req, res) {
	if (req.method === 'OPTIONS') {
		res.setHeader('access-control-allow-origin', '*');
		res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
		res.statusCode = 204;
		res.end();
		return;
	}
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const id = (url.searchParams.get('id') || '').trim();
	try {
		const total = await countSignatures();
		if (id) {
			const sig = ID_RE.test(id) ? await getSignature(id) : null;
			if (sig) return await sendImage(res, signatureCard(sig, total));
		}
		const sigs = await listByOffset(0, 12);
		return await sendImage(res, wallCard(total, sigs));
	} catch (err) {
		console.error('[signature-wall-og]', err?.message || err);
		// Never break a crawler's preview: fall back to the static brand card.
		res.statusCode = 302;
		res.setHeader('location', 'https://three.ws/og-image.png');
		res.setHeader('cache-control', 'no-cache');
		res.end();
	}
}
