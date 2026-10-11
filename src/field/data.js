// The Field's live feeds. Every value on the map comes from one of these real
// endpoints; when a feed fails the district says so instead of inventing data.

const NAV_DATA = '/nav-data.js';

async function getJson(url, init) {
	const r = await fetch(url, { credentials: 'include', ...init });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.json();
}

/** Platform totals: agents, launches, active strategies. */
export async function loadStats() {
	const d = await getJson('/api/stats', { credentials: 'omit' });
	const s = d?.stats || {};
	return {
		agents: Number(s.agents?.value) || 0,
		launches: Number(s.launches?.value) || 0,
		strategies: Number(s.active_strategies?.value) || 0,
	};
}

/** $THREE price, change, market cap and holders. */
export async function loadToken() {
	const d = await getJson('/api/three-token/stats', { credentials: 'omit' });
	const t = d?.token;
	if (!t || !Number.isFinite(Number(t.price_usd))) throw new Error('no price');
	return {
		price: Number(t.price_usd),
		change: Number(t.price_change_24h),
		cap: Number(t.market_cap),
		volume: Number(t.volume_24h),
		holders: Number(t.holders),
	};
}

/**
 * Public agents, newest first, streamed page by page so the core fills in as
 * each page lands. Stops after `maxPages` or when the directory runs out.
 */
export async function streamAgents(onPage, { maxPages = 8, signal } = {}) {
	let cursor = null;
	for (let i = 0; i < maxPages; i++) {
		const url = `/api/agents/public?sort=newest&limit=48${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`;
		const d = await getJson(url, { credentials: 'omit', signal });
		onPage(Array.isArray(d.agents) ? d.agents : []);
		if (!d.has_more || !d.next_cursor) return;
		cursor = d.next_cursor;
	}
}

/** Newest public avatars that have a thumbnail. */
export async function loadAvatars(n = 8) {
	const d = await getJson('/api/avatars/public?limit=24', { credentials: 'omit' });
	return (d.avatars || []).filter((a) => a.thumbnail_url).slice(0, n);
}

/** Coins agents launched through three.ws (the platform's own launch records). */
export async function loadLaunches(n = 4) {
	const d = await getJson(`/api/pump/launches?limit=${n}`, { credentials: 'omit' });
	return d?.data?.launches || [];
}

/** The Pulse feed. Pass `since` (a head cursor) for only newer events. */
export async function loadPulse({ since = null, limit = 40 } = {}) {
	const url = since ? `/api/pulse?since=${encodeURIComponent(since)}&limit=${limit}` : `/api/pulse?limit=${limit}`;
	const d = await getJson(url, { credentials: 'omit' });
	return { events: d?.data?.events || [], head: d?.data?.head_cursor || since || null };
}

/** The signed-in account, or null. */
export async function loadAccount() {
	try {
		const d = await getJson('/api/auth/me');
		const u = d?.user;
		return u ? { name: u.display_name || u.username || 'You', avatar: u.avatar_url || null } : null;
	} catch {
		return null;
	}
}

/** Every same-origin page in the site navigation, for search. */
export async function loadPages() {
	try {
		// public/ files are served as-is; a variable keeps vite from bundling it.
		const mod = await import(/* @vite-ignore */ NAV_DATA);
		const seen = new Set();
		const out = [];
		const take = (it) => {
			if (!it || typeof it.href !== 'string' || !it.href.startsWith('/') || it.href.startsWith('//')) return;
			const key = it.href.split('#')[0];
			if (seen.has(key)) return;
			seen.add(key);
			out.push({ title: String(it.title || it.href).replace(/<[^>]*>/g, '').trim(), href: it.href, desc: it.desc || '', keywords: [] });
		};
		for (const g of mod.NAV_GROUPS || []) {
			(g.items || []).forEach(take);
			(g.columns || []).forEach((c) => (c.items || []).forEach(take));
		}
		return out;
	} catch {
		return [];
	}
}
