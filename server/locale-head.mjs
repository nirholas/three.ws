// Crawlable locales. The client picks a language from ?lang=xx (src/i18n.js),
// but a crawler fetching /pricing?lang=ja gets the English shell: <html lang="en">,
// a canonical that may carry the query, and no alternates. This rewrites the
// served head for a localized page requested with a supported ?lang= so the
// document declares its language, points its canonical at the clean URL and
// lists every locale alternate (the same set the sitemap advertises).

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://three.ws';
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv']);
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

let cache = null;

function loadCatalog(localesDir = path.join(ROOT, 'public', 'locales')) {
	if (cache && cache.dir === localesDir) return cache;
	let codes = [];
	let paths = new Set();
	try {
		codes = readdirSync(localesDir)
			.filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f !== 'localized-pages.json')
			.map((f) => f.slice(0, -5))
			.filter((c) => CODE_RE.test(c));
		const lp = JSON.parse(readFileSync(path.join(localesDir, 'localized-pages.json'), 'utf8'));
		paths = new Set(lp.paths || []);
	} catch {
		// No catalog on disk: nothing is localized, every request serves unchanged.
	}
	cache = { dir: localesDir, codes: new Set(codes), paths };
	return cache;
}

function normalize(pathname) {
	const p = pathname.replace(/\/+$/, '');
	return p === '' ? '/' : p;
}

function urlFor(pathname, lang) {
	const base = pathname === '/' ? ORIGIN + '/' : ORIGIN + pathname;
	return lang ? `${base}?lang=${lang}` : base;
}

// Returns rewritten HTML, or null when the request is not a localized-page +
// supported-locale pair (callers then serve the file untouched).
export function rewriteLocaleHead(html, pathname, lang, catalog = loadCatalog()) {
	if (!lang || !catalog.codes.has(lang) || lang === 'en') return null;
	const p = normalize(pathname);
	if (!catalog.paths.has(p)) return null;
	if (!/<html\b[^>]*>/i.test(html) || !/<\/head>/i.test(html)) return null;

	const dir = RTL.has(lang.split('-')[0]) ? 'rtl' : 'ltr';
	let out = html.replace(/<html\b([^>]*)>/i, (_m, attrs) => {
		const clean = attrs.replace(/\s(?:lang|dir)=("[^"]*"|'[^']*')/gi, '');
		return `<html lang="${lang}" dir="${dir}"${clean}>`;
	});

	out = out.replace(/<link\b[^>]*\brel=["'](?:canonical|alternate)["'][^>]*\bhreflang=[^>]*>\s*/gi, '');
	const canonical = `<link rel="canonical" href="${urlFor(p, null)}">`;
	if (/<link\b[^>]*\brel=["']canonical["'][^>]*>/i.test(out)) {
		out = out.replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i, canonical);
	} else {
		out = out.replace(/<\/head>/i, `${canonical}\n</head>`);
	}

	const alts = [`<link rel="alternate" hreflang="x-default" href="${urlFor(p, null)}">`];
	for (const code of [...catalog.codes].sort()) {
		alts.push(`<link rel="alternate" hreflang="${code}" href="${urlFor(p, code)}">`);
	}
	out = out.replace(/<\/head>/i, `${alts.join('\n')}\n</head>`);
	return out;
}

export const __test = { loadCatalog };
