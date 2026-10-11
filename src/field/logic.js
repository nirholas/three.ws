// Pure rules for the Field: the district map, camera math, the smooth-zoom
// path between two views, agent placement, level of detail, event routing and
// search. No DOM, no fetch; everything here is unit tested
// (tests/field-logic.test.js).

/** Golden angle in radians: consecutive agents never line up. */
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** World units between neighbouring agents in the core. */
export const AGENT_SPACING = 22;
/** Cards are this size in world units; zooming scales them. */
export const CARD = { w: 380, h: 264 };
/** Below this zoom a district shows only its name and one live readout. */
export const NEAR_K = 0.8;
/** Hard zoom limits. */
export const MIN_K = 0.08;
export const MAX_K = 6;

/**
 * The districts, laid out on an ellipse around the agent core. Each one is a
 * real three.ws surface; `kind` picks the live content its card renders.
 */
export const DISTRICTS = [
	{ id: 'create', title: 'Create', href: '/create', hue: 262, kind: 'create', desc: 'Make an agent from a selfie or a sentence', keywords: ['agent', 'avatar', 'new', 'make', 'selfie'] },
	{ id: 'forge', title: 'Forge', href: '/forge', hue: 24, kind: 'forge', desc: 'Type a prompt, get a textured 3D model', keywords: ['text to 3d', 'model', 'glb', 'generate', 'mesh'] },
	{ id: 'gallery', title: 'Gallery', href: '/gallery', hue: 186, kind: 'gallery', desc: 'Every public 3D avatar', keywords: ['avatars', 'browse', 'characters'] },
	{ id: 'launcher', title: 'Launchpad', href: '/launcher', hue: 34, kind: 'launches', desc: 'Coins agents launched on Solana', keywords: ['launch', 'pump', 'token', 'coin', 'mint', 'solana'] },
	{ id: 'trenches', title: 'Trenches', href: '/trenches', hue: 152, kind: 'token', desc: '$THREE and live Solana markets', keywords: ['three', 'price', 'market', 'trade', 'solana', 'runners'] },
	{ id: 'pulse', title: 'Pulse', href: '/pulse', hue: 340, kind: 'pulse', desc: 'Every public agent wallet move, live', keywords: ['feed', 'wallet', 'activity', 'live', 'money', 'trades'] },
	{ id: 'marketplace', title: 'Marketplace', href: '/marketplace', hue: 46, kind: 'skills', desc: 'Buy and sell agent skills', keywords: ['skills', 'buy', 'sell', 'x402', 'store'] },
	{ id: 'chat', title: 'Chat', href: '/chat', hue: 168, kind: 'chat', desc: 'Talk to any agent', keywords: ['assistant', 'talk', 'ai', 'conversation'] },
	{ id: 'studio', title: 'Agent Studio', href: '/agent-studio', hue: 292, kind: 'studio', desc: 'Author brains, skills and personality', keywords: ['persona', 'prompt', 'skills', 'author', 'brain'] },
	{ id: 'dashboard', title: 'Console', href: '/dashboard', hue: 220, kind: 'account', desc: 'Your agents, wallets and usage', keywords: ['dashboard', 'account', 'keys', 'billing', 'wallet'] },
];

/** The agent core sits at the origin; this is its search entry. */
export const CORE = { id: 'discover', title: 'Agents', href: '/discover', hue: 262, kind: 'core', desc: 'Every three.ws agent, newest at the centre', keywords: ['agents', 'directory', 'discover', 'explore', 'people'] };

/** Ellipse radii the districts sit on: wide for landscape, tall for phones. */
// `cap` is how many agents the core draws. A portrait screen gets a smaller
// core so the ring around it can be narrow enough to keep its tags readable.
export const RING = { rx: 1260, ry: 860, cap: 384 };
export const RING_TALL = { rx: 560, ry: 1400, cap: 192, tall: true };

/** The ring that suits a viewport's shape. */
export function ringFor(vw, vh) {
	return vw / Math.max(1, vh) < 0.8 ? RING_TALL : RING;
}

/** World position (card centre) of district `i` of `n`, clockwise from the top. */
export function districtCenter(i, n = DISTRICTS.length, ring = RING) {
	if (ring.tall) {
		// Evenly spaced by height, alternating sides, so no two tags share a row
		// on a narrow screen. Still traces the ellipse, top to bottom.
		const y = n > 1 ? -ring.ry + (i / (n - 1)) * ring.ry * 2 : 0;
		const side = i % 2 ? -1 : 1;
		const x = side * ring.rx * Math.sqrt(Math.max(0, 1 - (y / ring.ry) ** 2));
		return { x: Math.round(x), y: Math.round(y) };
	}
	const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
	return { x: Math.round(Math.cos(a) * ring.rx), y: Math.round(Math.sin(a) * ring.ry) };
}

/** Every district with its world rectangle. */
export function layoutDistricts(list = DISTRICTS, ring = RING) {
	return list.map((d, i) => {
		const c = districtCenter(i, list.length, ring);
		return { ...d, x: c.x, y: c.y, rect: { x: c.x - CARD.w / 2, y: c.y - CARD.h / 2, w: CARD.w, h: CARD.h } };
	});
}

/** World bounds of the whole map, padded. */
export function worldBounds(ring = RING, pad = 120) {
	return {
		x: -ring.rx - CARD.w / 2 - pad,
		y: -ring.ry - CARD.h / 2 - pad,
		w: (ring.rx + CARD.w / 2 + pad) * 2,
		h: (ring.ry + CARD.h / 2 + pad) * 2,
	};
}

/** Agent `i`'s position in the core: a phyllotaxis spiral, newest at the centre. Stable as more load. */
export function agentPosition(i, spacing = AGENT_SPACING) {
	const r = spacing * Math.sqrt(i + 0.5);
	const a = i * GOLDEN;
	return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** Core radius that holds `n` agents. */
export function coreRadius(n, spacing = AGENT_SPACING) {
	return spacing * Math.sqrt(Math.max(1, n) + 0.5) + spacing;
}

/** Star radius in world units, from how much the agent has been talked to. */
export function agentSize(chatCount) {
	const c = Math.max(0, Number(chatCount) || 0);
	return 3 + Math.min(6, Math.log2(1 + c));
}

// ---- camera ----
// A camera is { x, y, k }: the world point at the viewport centre and the zoom.

export const clampK = (k) => Math.min(MAX_K, Math.max(MIN_K, k));

export function worldToScreen(cam, vw, vh, wx, wy) {
	return { x: (wx - cam.x) * cam.k + vw / 2, y: (wy - cam.y) * cam.k + vh / 2 };
}

export function screenToWorld(cam, vw, vh, sx, sy) {
	return { x: (sx - vw / 2) / cam.k + cam.x, y: (sy - vh / 2) / cam.k + cam.y };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(cam, vw, vh, sx, sy, factor) {
	const k = clampK(cam.k * factor);
	const p = screenToWorld(cam, vw, vh, sx, sy);
	return { k, x: p.x - (sx - vw / 2) / k, y: p.y - (sy - vh / 2) / k };
}

/** The camera that fits a world rect in the viewport with `pad` screen pixels around it. */
export function fitRect(rect, vw, vh, pad = 48) {
	const k = clampK(Math.min((vw - pad * 2) / rect.w, (vh - pad * 2) / rect.h));
	return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, k };
}

/** Keep the camera centre inside the world bounds so the map can never be lost. */
export function clampCam(cam, bounds = worldBounds()) {
	return {
		k: clampK(cam.k),
		x: Math.min(bounds.x + bounds.w, Math.max(bounds.x, cam.x)),
		y: Math.min(bounds.y + bounds.h, Math.max(bounds.y, cam.y)),
	};
}

/** 'far' shows labels and one readout per district; 'near' shows full cards. */
export function lodFor(k) {
	return k < NEAR_K ? 'far' : 'near';
}

/**
 * The smooth zoom path between two cameras (van Wijk and Nuij, "Smooth and
 * efficient zooming and panning"): long hops pull out, travel, and dive back
 * in, so you always see where you are going. Returns a function of t in [0,1]
 * and its natural duration in ms.
 */
export function zoomPath(from, to, vw, rho = Math.SQRT2) {
	const ux0 = from.x;
	const uy0 = from.y;
	const w0 = vw / from.k;
	const ux1 = to.x;
	const uy1 = to.y;
	const w1 = vw / to.k;
	const dx = ux1 - ux0;
	const dy = uy1 - uy0;
	const d2 = dx * dx + dy * dy;
	const rho2 = rho * rho;
	const rho4 = rho2 * rho2;
	let at;
	let S;
	if (d2 < 1e-12) {
		S = Math.log(w1 / w0) / rho;
		at = (t) => ({ x: ux0 + t * dx, y: uy0 + t * dy, k: vw / (w0 * Math.exp(rho * t * S)) });
	} else {
		const d1 = Math.sqrt(d2);
		const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
		const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
		const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
		const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
		S = (r1 - r0) / rho;
		at = (t) => {
			const s = t * S;
			const coshr0 = Math.cosh(r0);
			const u = (w0 / (rho2 * d1)) * (coshr0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
			return { x: ux0 + u * dx, y: uy0 + u * dy, k: vw / ((w0 * coshr0) / Math.cosh(rho * s + r0)) };
		};
	}
	const duration = Math.min(2200, Math.max(380, Math.abs(S) * 1000 * (rho / Math.SQRT2) * 0.9));
	return { at, duration };
}

/** Ease for the path parameter. */
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---- events ----

/** Which district a Pulse event flows into. */
export function districtForEvent(kind) {
	switch (kind) {
		case 'launch':
			return 'launcher';
		case 'trade':
		case 'snipe':
			return 'trenches';
		case 'purchase':
		case 'payment':
		case 'x402':
			return 'marketplace';
		default:
			return 'pulse';
	}
}

/** Opacity of a past event's trail: bright for the last hour, fading over a week. */
export function trailAlpha(ageMs) {
	const h = Math.max(0, ageMs) / 3_600_000;
	if (h <= 1) return 0.55;
	if (h >= 168) return 0.06;
	return 0.06 + 0.49 * (1 - Math.log(h) / Math.log(168));
}

/** One-line human summary of a Pulse event. */
export function describeEvent(e) {
	const who = e?.agent?.name || 'An agent';
	const sym = e?.symbol ? `$${String(e.symbol).toUpperCase()}` : e?.coin_name || 'a coin';
	const amt = Number.isFinite(e?.sol) && e.sol > 0 ? ` ${fmtSol(e.sol)} SOL` : '';
	switch (e?.kind) {
		case 'trade':
			return `${who} ${e.side === 'sell' ? 'sold' : 'bought'} ${sym}${amt ? ` for${amt}` : ''}`;
		case 'snipe':
			return `${who} sniped ${sym}${amt ? ` with${amt}` : ''}`;
		case 'launch':
			return `${who} launched ${sym}`;
		case 'tip':
			return `${who} was tipped${amt}`;
		case 'purchase':
			return `${who} sold a skill${amt}`;
		default:
			return `${who} moved${amt || ' funds'}`;
	}
}

export function fmtSol(n) {
	if (!Number.isFinite(n)) return '';
	if (n >= 100) return n.toFixed(0);
	if (n >= 1) return n.toFixed(2);
	return String(Number(n.toPrecision(2)));
}

export function fmtUsd(n) {
	if (!Number.isFinite(n)) return '';
	if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
	if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
	if (n >= 1) return `$${n.toFixed(2)}`;
	return `$${n.toPrecision(3)}`;
}

export function fmtPct(n) {
	if (!Number.isFinite(n)) return '';
	return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function fmtCount(n) {
	if (!Number.isFinite(n)) return '';
	return n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US');
}

/** "now", "4m", "3h", "2d", "Sep 17". */
export function relTime(iso, now = Date.now()) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, (now - t) / 1000);
	if (s < 45) return 'now';
	if (s < 3600) return `${Math.round(s / 60)}m`;
	if (s < 86400) return `${Math.round(s / 3600)}h`;
	if (s < 86400 * 14) return `${Math.round(s / 86400)}d`;
	return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- search ----

/**
 * Rank districts, agents and site pages against a query. Districts win ties,
 * then agents, then pages. Empty query lists the districts.
 * @returns {Array<{type:'district'|'agent'|'page', id:string, title:string, sub:string, href:string, item:object}>}
 */
export function searchField(query, { districts = [], agents = [], pages = [] } = {}, limit = 8) {
	const q = String(query || '').trim().toLowerCase();
	const out = [];
	const score = (title, kws = [], desc = '') => {
		const t = String(title || '').toLowerCase();
		if (!q) return 1;
		if (t === q) return 100;
		if (t.startsWith(q)) return 80;
		if (t.split(/[\s/\-_.]+/).some((w) => w.startsWith(q))) return 60;
		if (kws.some((k) => String(k).toLowerCase().startsWith(q))) return 50;
		if (t.includes(q)) return 40;
		if (kws.some((k) => String(k).toLowerCase().includes(q))) return 30;
		if (String(desc || '').toLowerCase().includes(q)) return 10;
		return 0;
	};
	districts.forEach((d, i) => {
		const s = score(d.title, d.keywords, d.desc);
		if (s) out.push({ s: s + 0.3, i, r: { type: 'district', id: d.id, title: d.title, sub: d.desc, href: d.href, item: d } });
	});
	if (q) {
		agents.forEach((a, i) => {
			const s = score(a.name, a.skills || [], a.description);
			if (s) out.push({ s: s + 0.2, i: 1000 + i, r: { type: 'agent', id: a.id, title: a.name, sub: a.description || 'Agent', href: a.home_url || `/agents/${a.id}`, item: a } });
		});
		pages.forEach((p, i) => {
			const s = score(p.title, p.keywords, p.desc);
			if (s) out.push({ s, i: 100000 + i, r: { type: 'page', id: p.href, title: p.title, sub: p.desc || p.href, href: p.href, item: p } });
		});
	}
	out.sort((a, b) => b.s - a.s || a.i - b.i);
	return out.slice(0, limit).map((o) => o.r);
}

/** Same-origin path only: the Field never frames another site. */
export function isInternalPath(href) {
	return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

/**
 * Where the URL asks the Field to start: `?app=<district id>` or
 * `?go=<same-origin path>` dives straight in; anything else lands on the map.
 */
export function deepLink(search, ids) {
	const p = new URLSearchParams(search || '');
	const app = p.get('app');
	if (app && ids.includes(app)) return { type: 'district', id: app };
	const go = p.get('go');
	if (go && isInternalPath(go)) return { type: 'page', href: go };
	return null;
}

/** The legacy desktop and campus still live at `?view=desktop` and `?world=1`. */
export function wantsLegacy(search) {
	const p = new URLSearchParams(search || '');
	return p.get('view') === 'desktop' || p.has('world') || p.has('boot');
}
