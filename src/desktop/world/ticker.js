// The exchange's ticker board. Rows come from real market feeds: $THREE from
// /api/three-token/stats and the top coins from /api/coin/markets. When a
// feed is down the board says so instead of inventing numbers.

import { CanvasTexture, SRGBColorSpace } from 'three';

const W = 2048;
const H = 192;

function fmtPrice(p) {
	if (p == null || !Number.isFinite(p)) return '--';
	if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
	if (p >= 1) return p.toFixed(2);
	if (p >= 0.01) return p.toFixed(4);
	return p.toPrecision(3);
}
function fmtPct(c) {
	if (c == null || !Number.isFinite(c)) return '';
	return `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`;
}

/** Fetch the two feeds; always resolves. */
export async function loadTickerItems(fetchFn = fetch) {
	const items = [];
	const notes = [];
	const [three, markets] = await Promise.all([
		fetchFn('/api/three-token/stats', { headers: { accept: 'application/json' } })
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null),
		fetchFn('/api/coin/markets?per_page=12&sparkline=0', { headers: { accept: 'application/json' } })
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null),
	]);
	const t = three?.token;
	if (t && t.price_usd != null) items.push({ symbol: '$THREE', price: t.price_usd, change: t.price_change_24h, lead: true });
	else notes.push('$THREE feed offline');
	// /api/coin/markets answers { coins: [...] }; a bare array and { rows } are
	// accepted too so a cached or older shape never blanks the board.
	const rows = Array.isArray(markets) ? markets : markets?.coins || markets?.rows;
	if (Array.isArray(rows) && rows.length) {
		for (const r of rows) if (r?.symbol && r.price != null) items.push({ symbol: r.symbol, price: r.price, change: r.change_24h });
	} else notes.push('market feed offline');
	return { items, notes, three: t || null };
}

export function createTickerBoard() {
	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const g = canvas.getContext('2d');
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.anisotropy = 8;

	let items = [];
	let notes = ['connecting to the market feed'];
	let offset = 0;
	let textW = 1;

	function segments() {
		if (!items.length) return notes.map((n) => ({ text: n.toUpperCase(), color: 'rgba(255,255,255,0.55)' }));
		const out = items.map((it) => ({
			text: `${it.symbol}  ${fmtPrice(it.price)}  ${fmtPct(it.change)}`,
			color: it.lead ? '#c4b5fd' : it.change == null ? '#fff' : it.change >= 0 ? '#34d399' : '#f87171',
		}));
		for (const n of notes) out.push({ text: n.toUpperCase(), color: 'rgba(255,255,255,0.5)' });
		return out;
	}

	function paint() {
		g.fillStyle = '#07070a';
		g.fillRect(0, 0, W, H);
		g.fillStyle = 'rgba(255,255,255,0.08)';
		g.fillRect(0, 0, W, 2);
		g.fillRect(0, H - 2, W, 2);
		g.font = '600 92px "JetBrains Mono", ui-monospace, monospace';
		g.textBaseline = 'middle';
		const segs = segments();
		const gap = 120;
		textW = segs.reduce((n, s) => n + g.measureText(s.text).width + gap, 0) || 1;
		// Draw two copies so the scroll wraps seamlessly.
		for (let copy = 0; copy < 2; copy++) {
			let x = -offset + copy * textW;
			for (const s of segs) {
				g.fillStyle = s.color;
				g.fillText(s.text, x, H / 2 + 4);
				x += g.measureText(s.text).width;
				g.fillStyle = 'rgba(255,255,255,0.25)';
				g.fillRect(x + gap / 2 - 2, H * 0.3, 4, H * 0.4);
				x += gap;
			}
		}
		texture.needsUpdate = true;
	}

	return {
		texture,
		setItems(next, nextNotes = []) {
			items = next || [];
			notes = nextNotes;
			paint();
		},
		/** Scroll by dt seconds. 260 canvas px/s reads at a comfortable pace from the street. */
		tick(dt) {
			offset = (offset + dt * 260) % textW;
			paint();
		},
		dispose: () => texture.dispose(),
	};
}
