// Where an agent starts when its owner gave no start pages, or when it has
// walked itself into a dead end: real public search, tried in order until the
// agent has enough leads it has not read yet. Each source is a free, keyless
// public endpoint, and each one pages deeper on every round so a long-running
// agent keeps finding new ground instead of being handed the same top hits.

import { guardedFetch } from './guard.js';

// DuckDuckGo's HTML endpoint. Result anchors carry the target in the uddg
// parameter of a /l/ redirect. It sometimes answers bots with a 202 challenge
// page; that simply yields nothing and the next source takes over.
async function duckduckgo(topic, round) {
	const res = await guardedFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(topic)}&s=${round * 30}`, {
		headers: { accept: 'text/html' },
	});
	if (res.status !== 200) return [];
	const html = await res.text();
	const out = [];
	for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)) {
		const href = m[1].replace(/&amp;/g, '&');
		try {
			const u = new URL(href, 'https://duckduckgo.com');
			const target = u.searchParams.get('uddg') || (u.hostname.endsWith('duckduckgo.com') ? null : u.href);
			if (target && !/duckduckgo\.com\/y\.js/.test(target)) out.push(target);
		} catch { /* skip malformed result */ }
	}
	return out;
}

// Hacker News search (Algolia): stories carry the outside URL they link to,
// which is exactly the kind of page a reading agent should land on. Every word
// is optional, so a long topic still matches stories that share most of it.
async function hackernews(topic, round) {
	const q = encodeURIComponent(topic);
	const res = await guardedFetch(
		`https://hn.algolia.com/api/v1/search?query=${q}&optionalWords=${q}&tags=story&hitsPerPage=20&page=${round}`,
		{ headers: { accept: 'application/json' } },
	);
	if (!res.ok) return [];
	const data = await res.json();
	return (data.hits || []).map((h) => h.url).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
}

// Wikipedia full-text search: always answers, always has something.
async function wikipedia(topic, round) {
	const res = await guardedFetch(
		`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=12&sroffset=${round * 12}&srsearch=${encodeURIComponent(topic)}`,
		{ headers: { accept: 'application/json' } },
	);
	if (!res.ok) return [];
	const data = await res.json();
	return (data.query?.search || []).map((s) => `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`);
}

export const SOURCES = [
	{ name: 'duckduckgo', fn: duckduckgo },
	{ name: 'hackernews', fn: hackernews },
	{ name: 'wikipedia', fn: wikipedia },
];

const ENOUGH = 6;

// Gather leads for a topic. `fresh(url)` says whether the agent still wants a
// URL (it has not read it); sources are asked in order and their fresh results
// pooled until there are ENOUGH. Returns { urls, source } so the crawler can
// say where its leads came from.
export async function searchSeeds(topic, { log = () => {}, fresh = () => true, round = 0 } = {}) {
	const urls = [];
	const used = [];
	for (const { name, fn } of SOURCES) {
		try {
			const found = (await fn(topic, round)).filter((u) => !urls.includes(u) && fresh(u));
			if (found.length) {
				urls.push(...found);
				used.push(name);
			}
		} catch (err) {
			log(`seed source ${name} failed: ${err?.message || err}`);
		}
		if (urls.length >= ENOUGH) break;
	}
	return { urls: urls.slice(0, 12), source: used.join(' and ') || null };
}
