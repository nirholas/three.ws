// Dynamic sitemap index: the top-level /sitemap.xml that Google and Bing crawl
// first (robots.txt names it). Each entry points at one child file served by
// api/sitemap/[type].js.
//
// Why an index instead of one giant file:
//   - sitemaps.org caps a file at 50,000 URLs / 50 MB, and the public avatar
//     set alone is past 130k
//   - each type and each page carries its own lastmod, so a crawler re-reads
//     only the files that changed
//
// The entity types are paged at 50,000 rows in id order. One query per type
// numbers the public rows, groups them into pages, and returns each page's
// newest timestamp, so the index lists exactly the files the child handler
// will serve, each stamped with when its content last changed. The query
// returns one row per page, never the rows themselves.
//
// The lookups are plain tagged queries. They used to go through
// `sql.unsafe(text)`, which on the neon driver builds an interpolation
// fragment and runs nothing, so every lookup came back empty and every
// lastmod here was the day of the crawl (tests/sitemap-paging.test.js).
//
// Wired via vercel.json rewrite: /sitemap.xml -> /api/sitemap

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from './_lib/db.js';
import { env } from './_lib/env.js';
import { method } from './_lib/http.js';
import { SITEMAP_PAGE_SIZE, sitemapFileName, sitemapDate } from './_lib/seo-resources.js';

const ORIGIN = env.APP_ORIGIN;

function xml(res, body) {
	res.setHeader('content-type', 'application/xml; charset=utf-8');
	res.setHeader('cache-control', 'public, s-maxage=600, stale-while-revalidate=86400');
	res.statusCode = 200;
	res.end(body);
}

// Each returns [{ page (0-based), n, lastmod }], one row per 50,000-row page.
// The predicates must match the readers in api/sitemap/[type].js exactly.
const PAGE_STATS = new Map([
	[
		'agents',
		() => sql`
			select ((rn - 1) / ${SITEMAP_PAGE_SIZE})::int as page, count(*)::int as n, max(ts) as lastmod
			from (
				select row_number() over (order by id) as rn, coalesce(updated_at, created_at) as ts
				from agent_identities
				where deleted_at is null and is_public = true
			) s
			group by 1 order by 1
		`,
	],
	[
		'avatars',
		() => sql`
			select ((rn - 1) / ${SITEMAP_PAGE_SIZE})::int as page, count(*)::int as n, max(ts) as lastmod
			from (
				select row_number() over (order by id) as rn, coalesce(updated_at, created_at) as ts
				from avatars
				where deleted_at is null and visibility = 'public'
			) s
			group by 1 order by 1
		`,
	],
	[
		'creations',
		() => sql`
			select ((rn - 1) / ${SITEMAP_PAGE_SIZE})::int as page, count(*)::int as n, max(ts) as lastmod
			from (
				select row_number() over (order by id) as rn,
				       coalesce(updated_at, completed_at, created_at) as ts
				from forge_creations
				where status = 'done' and glb_url is not null
				  and (outcome is null or outcome != 'rejected')
				  and (visibility is null or visibility = 'public')
			) s
			group by 1 order by 1
		`,
	],
	[
		'widgets',
		() => sql`
			select ((rn - 1) / ${SITEMAP_PAGE_SIZE})::int as page, count(*)::int as n, max(ts) as lastmod
			from (
				select row_number() over (order by id) as rn, coalesce(updated_at, created_at) as ts
				from widgets
				where deleted_at is null and is_public = true
			) s
			group by 1 order by 1
		`,
	],
	[
		'profiles',
		// service_account matters here too: the seed crons mint a machine account
		// about once a minute, and without the flag the index would report
		// "profiles changed" on every crawl of a file that lists only humans.
		() => sql`
			select ((rn - 1) / ${SITEMAP_PAGE_SIZE})::int as page, count(*)::int as n, max(ts) as lastmod
			from (
				select row_number() over (order by u.id) as rn, coalesce(u.updated_at, u.created_at) as ts
				from users u
				where u.deleted_at is null and u.username is not null and u.service_account = false
			) s
			group by 1 order by 1
		`,
	],
]);

async function pagedEntries(type) {
	let pages = null;
	try {
		pages = await PAGE_STATS.get(type)();
	} catch {
		pages = null;
	}
	// A failed or empty lookup still lists page 1: the child file decides what
	// it holds, and an empty <urlset> lets a crawler retry later. With no real
	// timestamp it carries no lastmod.
	if (!pages?.length) return [{ loc: `${ORIGIN}/sitemap/${sitemapFileName(type, 1)}`, lastmod: null }];
	return pages.map((p) => ({
		loc: `${ORIGIN}/sitemap/${sitemapFileName(type, Number(p.page) + 1)}`,
		lastmod: sitemapDate(p.lastmod),
	}));
}

// The newest lastmod/added date in data/pages.json: core.xml changes exactly
// when the manifest does.
async function coreLastmod() {
	const candidates = [path.join(process.cwd(), 'data', 'pages.json'), path.join(process.cwd(), 'public', 'features.json')];
	for (const file of candidates) {
		try {
			const manifest = JSON.parse(await readFile(file, 'utf8'));
			let newest = '';
			for (const section of manifest.sections || []) {
				for (const p of section.pages || []) {
					const d = sitemapDate(p.lastmod || p.added);
					if (d && d > newest) newest = d;
				}
			}
			return newest || null;
		} catch {
			// try next
		}
	}
	return null;
}

export default async function handler(req, res) {
	// A crawler surface is GET (and HEAD) only. Without this, a POST or DELETE
	// got the sitemap back with a 200, which is a lie about what the route does.
	if (!method(req, res, ['GET'])) return;

	const [core, ...paged] = await Promise.all([coreLastmod(), ...[...PAGE_STATS.keys()].map(pagedEntries)]);

	const entries = [
		{ loc: `${ORIGIN}/sitemap/core.xml`, lastmod: core },
		...paged.flat(),
		// Story pages for the newest archive months. The archive appends hourly
		// and the month files carry no cheap "newest" stamp, so this entry states
		// no lastmod rather than guessing one.
		{ loc: `${ORIGIN}/sitemap/news.xml`, lastmod: null },
	];

	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		entries
			.map(
				(e) =>
					`\t<sitemap>\n\t\t<loc>${e.loc}</loc>\n` +
					(e.lastmod ? `\t\t<lastmod>${e.lastmod}</lastmod>\n` : '') +
					`\t</sitemap>`,
			)
			.join('\n') +
		`\n</sitemapindex>\n`;

	return xml(res, body);
}
