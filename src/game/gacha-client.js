// Shared client plumbing for the /play card gacha machine: the 3D landmark
// (gacha-station.js, loaded with the world) and the pull modal (gacha-ui.js,
// lazy-loaded on first interaction) both read machines, winners and card art
// through here, so the network toggle, the image proxy and the rarity palette
// are defined exactly once.
//
// Server side: api/gacha/[action].js, a same-origin bridge to Collector Crypt's
// gacha API (their POST endpoints send no CORS headers, and every transaction
// they build is verified there before a player is asked to sign it).

// `?gachaNet=devnet` points the machine at Collector Crypt's devnet machines
// (paid in their devnet USDC) for QA; everything else is mainnet.
export function gachaNet() {
	try {
		return new URLSearchParams(location.search).get('gachaNet') === 'devnet' ? 'devnet' : 'mainnet';
	} catch {
		return 'mainnet';
	}
}

export class GachaApiError extends Error {
	constructor(status, code, message) {
		super(message || 'Request failed');
		this.status = status;
		this.code = code || 'request_failed';
	}
}

/**
 * Call /api/gacha/<action>. GET when `body` is omitted, POST JSON otherwise.
 * Throws GachaApiError carrying the server's human-readable message.
 */
export async function gachaApi(action, { query = {}, body, signal, timeoutMs = 30_000 } = {}) {
	const net = gachaNet();
	const qs = new URLSearchParams(query);
	if (net === 'devnet') qs.set('net', 'devnet');
	const url = `/api/gacha/${action}${qs.toString() ? `?${qs}` : ''}`;
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	const onAbort = () => ac.abort();
	signal?.addEventListener('abort', onAbort, { once: true });
	let res;
	try {
		res = await fetch(url, body === undefined
			? { signal: ac.signal, credentials: 'same-origin' }
			: { method: 'POST', signal: ac.signal, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new GachaApiError(0, 'network', ac.signal.aborted ? 'The gacha server took too long to answer. Check your connection and try again.' : 'Could not reach the gacha server. Check your connection and try again.');
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
	const data = await res.json().catch(() => null);
	if (!res.ok || !data || data.ok === false) {
		const message = data?.error_description || data?.message || (res.status === 429 ? 'Too many requests. Wait a moment and try again.' : `The gacha server answered ${res.status}.`);
		throw new GachaApiError(res.status, data?.error || data?.code, message);
	}
	return data;
}

/**
 * Card art lives on hosts that send no CORS headers, which taints a WebGL
 * texture and blocks nothing in an <img> but still costs full-size downloads.
 * The platform image proxy fixes both: same-origin, resized, cached.
 */
export function cardImageUrl(src, width = 320) {
	if (!src || typeof src !== 'string') return null;
	return `/api/img?url=${encodeURIComponent(src)}&w=${width}&fallback=none`;
}

// Rarity palette shared by the 3D reveal burst and the modal. Ordered best
// first, matching Collector Crypt's tier numbering (1 = epic).
export const TIERS = ['epic', 'rare', 'uncommon', 'common'];
export const TIER_STYLE = {
	epic: { label: 'Epic', color: '#ffb020', glow: 'rgba(255, 176, 32, 0.55)' },
	rare: { label: 'Rare', color: '#b06bff', glow: 'rgba(176, 107, 255, 0.5)' },
	uncommon: { label: 'Uncommon', color: '#3fb6ff', glow: 'rgba(63, 182, 255, 0.45)' },
	common: { label: 'Common', color: '#9aa4b2', glow: 'rgba(154, 164, 178, 0.35)' },
};

export function usd(n, { cents = true } = {}) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents && v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export function shortAddr(a) {
	return typeof a === 'string' && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '';
}

// The machine the plaza landmark features on its price display: the house
// favourite when it is open, otherwise the cheapest machine with cards left.
export const FEATURED_MACHINE = 'pokemon_50';
export function pickFeatured(machines) {
	const open = (machines || []).filter((m) => m.available);
	return open.find((m) => m.code === FEATURED_MACHINE) || open[0] || null;
}

export const COLLECTOR_CRYPT_CARD_URL = (mint) => `https://collectorcrypt.com/assets/solana/${encodeURIComponent(mint)}`;
