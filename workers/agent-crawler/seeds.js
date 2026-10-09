// Where an agent starts when its owner gave no start pages, or when it has
// walked itself into a dead end: real public search, tried in order until one
// answers. Each source is a free, keyless public endpoint.

import { guardedFetch } from './net.js';

// DuckDuckGo's HTML endpoint. Result anchors carry the target in the uddg
// parameter of a /l/ redirect. It sometimes answers bots with a 202 challenge
// page; that simply yields nothing and the next source takes over.
async function duckduckgo(topic) {
	const res = await guardedFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(topic)}`, {
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
// which is exactly the kind of page a reading agent should land on.
async function hackernews(topic) {
	const res = await guardedFetch(
		`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=20`,
		{ headers: { accept: 'application/json' } },
	);
	if (!res.ok) return [];
	const data = await res.json();
	return (data.hits || []).map((h) => h.url).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
}

// Wikipedia full-text search: always answers, always has something.
async function wikipedia(topic) {
	const res = await guardedFetch(
		`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8&srsearch=${encodeURIComponent(topic)}`,
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

// Gather start pages for a topic. Returns { urls, source } from the first source
// with results, so the crawler can say where its leads came from.
export async function searchSeeds(topic, log = () => {}) {
	for (const { name, fn } of SOURCES) {
		try {
			const urls = [...new Set(await fn(topic))].slice(0, 12);
			if (urls.length) return { urls, source: name };
		} catch (err) {
			log(`seed source ${name} failed: ${err?.message || err}`);
		}
	}
	return { urls: [], source: null };
}
