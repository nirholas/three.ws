// Child sitemaps: /sitemap/<type>.xml and, for the entity types, the later
// pages /sitemap/<type>-<n>.xml.
//
// Entity types (agents, avatars, creations, widgets, profiles) are paged at the
// sitemaps.org limit of 50,000 URLs per file. A page is read by id cursor: the
// first id of page n is found at row offset (n - 1) * 50,000 of the id-ordered
// public set, and the page is the next 50,000 rows from there, so no request
// ever holds more than one page of rows. Ordering by id (not recency) keeps a
// URL in the same file from crawl to crawl. The index (api/sitemap.js) lists
// one file per page from the same predicates, so the two always agree.
//
// core (data/pages.json) and news (the three newest archive months) fit in one
// file each.
//
// Every <lastmod> comes from a real timestamp on the row or the manifest entry.
// An entry with none carries no <lastmod> rather than an invented one.
//
// Cached at the edge for 10 min: long enough to absorb crawl bursts, short
// enough that new pages are discoverable quickly (IndexNow pushes them sooner,
// see api/_lib/indexnow.js).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { reportServerError, redactUrl } from '../_lib/http.js';
import { getMonths, loadMonth } from '../_lib/news-archive-store.js';
import { storyPath } from '../../src/shared/news-links.js';
import { isSuppressed } from '../_lib/news-rights.js';
import { isIndexableAgent, isIndexableAvatar } from '../_lib/indexable-entity.js';
import {
	SITEMAP_PAGE_SIZE,
	parseSitemapName,
	sitemapPageOffset,
	resourceUrl,
	sitemapDate,
	SITEMAP_TYPES,
	isIndexableManifestPage,
} from '../_lib/seo-resources.js';

const ORIGIN = env.APP_ORIGIN;

function xmlEscape(s) {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function urlsetXml(entries) {
	// Advertise the xhtml namespace only when at least one entry carries hreflang
	// alternates, so entity sitemaps that don't localize stay byte-identical.
	const hasAlternates = entries.some((e) => e.alternates?.length);
	const ns =
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` +
		(hasAlternates ? ` xmlns:xhtml="http://www.w3.org/1999/xhtml"` : ``) +
		`>`;
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`${ns}\n` +
		entries
			.map((e) => {
				const parts = [`\t\t<loc>${xmlEscape(e.loc)}</loc>`];
				if (e.lastmod) parts.push(`\t\t<lastmod>${e.lastmod}</lastmod>`);
				if (e.changefreq) parts.push(`\t\t<changefreq>${e.changefreq}</changefreq>`);
				if (e.priority) parts.push(`\t\t<priority>${e.priority}</priority>`);
				for (const alt of e.alternates || []) {
					parts.push(
						`\t\t<xhtml:link rel="alternate" hreflang="${xmlEscape(alt.hreflang)}" href="${xmlEscape(alt.href)}"/>`,
					);
				}
				return `\t<url>\n${parts.join('\n')}\n\t</url>`;
			})
			.join('\n') +
		`\n</urlset>\n`
	);
}

// Load the committed locale manifest + the list of localized page paths so the
// core sitemap can advertise each translated route's language alternates. Both
// ship in public/locales; read defensively (missing files → no alternates,
// never a 500 for the crawler).
async function loadI18n() {
	const readJson = async (rel) => {
		for (const base of [path.join(process.cwd(), 'public'), process.cwd()]) {
			try {
				return JSON.parse(await readFile(path.join(base, rel), 'utf8'));
			} catch {
				// try next base
			}
		}
		return null;
	};
	const manifest = await readJson('locales/manifest.json');
	const localized = await readJson('locales/localized-pages.json');
	const locales = manifest?.locales?.map((l) => l.code) || [];
	const def = manifest?.default || 'en';
	return { locales, def, paths: new Set(localized?.paths || []) };
}

// Build hreflang alternates for one path. Each locale gets a distinct URL
// (?lang=xx); the default locale and x-default share the bare canonical URL.
function alternatesFor(pathname, { locales, def }) {
	if (locales.length < 2) return undefined;
	const url = (code) =>
		code === def ? `${ORIGIN}${pathname}` : `${ORIGIN}${pathname}?lang=${code}`;
	const alts = locales.map((code) => ({ hreflang: code, href: url(code) }));
	alts.push({ hreflang: 'x-default', href: `${ORIGIN}${pathname}` });
	return alts;
}

function send(res, body) {
	res.setHeader('content-type', 'application/xml; charset=utf-8');
	res.setHeader('cache-control', 'public, s-maxage=600, stale-while-revalidate=86400');
	res.statusCode = 200;
	res.end(body);
}

// Core (static) routes are read from data/pages.json, the same source of
// truth that build-page-index.mjs uses for llms.txt / sitemap.html / the
// features manifest. One file to edit; this route + the human sitemap + the
// AI indexes all stay in lockstep.
async function loadPagesManifest() {
	// In the Vercel bundle data/ ships alongside the function via includeFiles;
	// in dev it's at repo root. Try both.
	const candidates = [
		path.join(process.cwd(), 'data', 'pages.json'),
		path.join(process.cwd(), 'public', 'features.json'),
	];
	for (const file of candidates) {
		try {
			const raw = await readFile(file, 'utf8');
			return JSON.parse(raw);
		} catch {
			// try next
		}
	}
	return null;
}

async function coreSitemap() {
	const [manifest, i18n] = await Promise.all([loadPagesManifest(), loadI18n()]);
	if (!manifest?.sections) {
		// Fallback to the home page only, so we never 500 the crawler.
		return [{ loc: `${ORIGIN}/`, changefreq: 'daily', priority: '1.0' }];
	}
	const out = [];
	for (const section of manifest.sections) {
		// News has its own long-tail file; the rest of the rule is shared with
		// the IndexNow reconciler so both announce the same pages.
		for (const p of section.pages || []) {
			if (!isIndexableManifestPage(section, p)) continue;
			out.push({
				loc: `${ORIGIN}${p.path === '/' ? '/' : p.path}`,
				// The manifest records when a page was last changed (lastmod) or
				// first shipped (added). With neither, say nothing: a lastmod of
				// "today" on every crawl teaches a crawler to ignore the field.
				lastmod: sitemapDate(p.lastmod || p.added),
				changefreq: p.changefreq || 'weekly',
				priority: typeof p.priority === 'number' ? p.priority.toFixed(1) : '0.6',
				alternates: i18n.paths.has(p.path) ? alternatesFor(p.path, i18n) : undefined,
			});
		}
	}
	return out.length ? out : [{ loc: `${ORIGIN}/`, changefreq: 'daily', priority: '1.0' }];
}

// Each paged reader returns one page of rows in id order. The inner select
// finds the first id of the page at its row offset (an index-only walk of the
// public set), and the outer select reads at most one page from that id on. A
// page past the end finds no first id, so `id >= null` matches nothing.

async function agentsPage(offset) {
	// Untouched onboarding rows are dropped after the read (1,359 of the 3,397
	// public agents still carried the starter name and description on
	// 2026-09-07, duplicates of each other by construction). The filter runs in
	// JS so one definition of "indexable" serves both this file and the crawler
	// page (api/_lib/indexable-entity.js). It only tests whether the prose is
	// empty or opens with the starter copy, so a prefix keeps the row small.
	const rows = await sql`
		select id, name, left(description, 64) as description, updated_at, created_at
		from agent_identities
		where deleted_at is null and is_public = true
		  and id >= (
			select id from agent_identities
			where deleted_at is null and is_public = true
			order by id offset ${offset} limit 1
		  )
		order by id
		limit ${SITEMAP_PAGE_SIZE}
	`;
	return {
		rows: rows.length,
		entries: rows.filter(isIndexableAgent).map((r) => ({
			loc: resourceUrl(ORIGIN, 'agent', r.id),
			lastmod: sitemapDate(r.updated_at || r.created_at),
			changefreq: 'weekly',
			priority: '0.7',
		})),
	};
}

async function avatarsPage(offset) {
	// Same filter as agents: an avatar still carrying its default name with
	// nothing written about it cannot be told apart from the next one. It removes
	// far less here (170 of 67,164 on 2026-09-07) because a generated avatar
	// gets its own description and tags.
	const rows = await sql`
		select id, name, left(description, 64) as description, left(alt_text, 64) as alt_text,
		       updated_at, created_at
		from avatars
		where deleted_at is null and visibility = 'public'
		  and id >= (
			select id from avatars
			where deleted_at is null and visibility = 'public'
			order by id offset ${offset} limit 1
		  )
		order by id
		limit ${SITEMAP_PAGE_SIZE}
	`;
	return {
		rows: rows.length,
		entries: rows.filter(isIndexableAvatar).map((r) => ({
			loc: resourceUrl(ORIGIN, 'avatar', r.id),
			lastmod: sitemapDate(r.updated_at || r.created_at),
			changefreq: 'weekly',
			priority: '0.6',
		})),
	};
}

async function creationsPage(offset) {
	// Forge models at /m/:id. The predicate is the public gallery's
	// (listRecentCreations in api/_lib/forge-store.js): finished, a GLB on file,
	// not rejected by the quality grader, and public. Unlisted models resolve
	// by link but are served noindex (server/creation-head.mjs), so they stay
	// out of here too.
	const rows = await sql`
		select id, updated_at, completed_at, created_at
		from forge_creations
		where status = 'done' and glb_url is not null
		  and (outcome is null or outcome != 'rejected')
		  and (visibility is null or visibility = 'public')
		  and id >= (
			select id from forge_creations
			where status = 'done' and glb_url is not null
			  and (outcome is null or outcome != 'rejected')
			  and (visibility is null or visibility = 'public')
			order by id offset ${offset} limit 1
		  )
		order by id
		limit ${SITEMAP_PAGE_SIZE}
	`;
	return {
		rows: rows.length,
		entries: rows.map((r) => ({
			loc: resourceUrl(ORIGIN, 'creation', r.id),
			lastmod: sitemapDate(r.updated_at || r.completed_at || r.created_at),
			changefreq: 'monthly',
			priority: '0.6',
		})),
	};
}

async function widgetsPage(offset) {
	// Only widgets surfaced on a public profile/showcase are worth indexing; the
	// raw embed endpoint isn't human content.
	const rows = await sql`
		select id, updated_at, created_at
		from widgets
		where deleted_at is null and is_public = true
		  and id >= (
			select id from widgets
			where deleted_at is null and is_public = true
			order by id offset ${offset} limit 1
		  )
		order by id
		limit ${SITEMAP_PAGE_SIZE}
	`;
	return {
		rows: rows.length,
		entries: rows.map((r) => ({
			loc: resourceUrl(ORIGIN, 'widget', r.id),
			lastmod: sitemapDate(r.updated_at || r.created_at),
			changefreq: 'monthly',
			priority: '0.5',
		})),
	};
}

async function profilesPage(offset) {
	// Public user profiles at /u/<username>, the canonical profile URL the app
	// links to. service_account rows are excluded: the seed crons mint one
	// roughly every minute (29,600 of 29,642 profile rows on 2026-08-16), and
	// their real content (the avatars and agents they own) is already listed in
	// avatars.xml and agents.xml. Same predicate the metrics queries use.
	const rows = await sql`
		select u.username, u.updated_at, u.created_at
		from users u
		where u.deleted_at is null
		  and u.username is not null
		  and u.service_account = false
		  and u.id >= (
			select id from users
			where deleted_at is null and username is not null and service_account = false
			order by id offset ${offset} limit 1
		  )
		order by u.id
		limit ${SITEMAP_PAGE_SIZE}
	`;
	return {
		rows: rows.length,
		entries: rows.map((r) => ({
			loc: resourceUrl(ORIGIN, 'profile', r.username),
			lastmod: sitemapDate(r.updated_at || r.created_at),
			changefreq: 'weekly',
			priority: '0.6',
		})),
	};
}

// Story pages (/markets/news/<YYYY-MM>/<id>-<slug>) for the newest archive
// months. The full 660k-article corpus would blow the 50k/URL cap many times
// over. Recent months are where crawl demand is, and older stories are
// reachable through the archive UI and inter-article links. Months come from
// the same GCS store the archive endpoint serves, so this stays in lockstep
// with what actually resolves.
const NEWS_SITEMAP_MONTHS = 3;

async function newsSitemap() {
	const months = await getMonths();
	const recent = months.slice(-NEWS_SITEMAP_MONTHS).reverse(); // newest first
	const out = [];
	for (const month of recent) {
		const records = await loadMonth(month).catch(() => []);
		for (const a of records) {
			if (isSuppressed(a)) continue; // withdrawn at the rightsholder's demand, so never submit it for crawling
			const loc = storyPath(a);
			if (!loc) continue; // undated/id-less corpus rows have no story page
			out.push({
				loc: `${ORIGIN}${loc}`,
				lastmod: sitemapDate(a.pub_date),
				changefreq: 'monthly',
				priority: '0.6',
			});
			if (out.length >= SITEMAP_PAGE_SIZE) return out;
		}
	}
	return out;
}

// Maps, not object literals: `BUILDERS.constructor` on a literal resolves to
// Object via the prototype chain, so /api/sitemap/constructor (and toString,
// valueOf, hasOwnProperty) passed the lookup guard, called a non-builder, and
// answered a scanner with a 500 plus a bogus sitemap_failed error report. A Map
// only ever returns what was put in it (and parseSitemapName checks the name
// against the known types before either map is consulted).
const SINGLE = new Map([
	['core', coreSitemap],
	['news', newsSitemap],
]);

const PAGED = new Map([
	['agents', agentsPage],
	['avatars', avatarsPage],
	['creations', creationsPage],
	['widgets', widgetsPage],
	['profiles', profilesPage],
]);

function notFound(res, message) {
	res.statusCode = 404;
	res.setHeader('content-type', 'text/plain; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(message);
}

export default async function handler(req, res) {
	const raw = String(req.query?.type || req.query?.id || '');
	const parsed = parseSitemapName(raw);
	if (!parsed) {
		return notFound(res, `unknown sitemap. known types: ${SITEMAP_TYPES.join(', ')}\n`);
	}
	try {
		if (SINGLE.has(parsed.type)) {
			return send(res, urlsetXml(await SINGLE.get(parsed.type)()));
		}
		const { rows, entries } = await PAGED.get(parsed.type)(sitemapPageOffset(parsed.page));
		// Page 1 is always listed in the index, so it answers even when empty (a
		// valid empty <urlset> lets a crawler retry later). A later page with no
		// rows means the set shrank: 404 so the stale file leaves the index.
		if (parsed.page > 1 && rows === 0) {
			return notFound(res, `sitemap ${raw} is past the last page\n`);
		}
		return send(res, urlsetXml(entries));
	} catch (err) {
		const ref = reportServerError(err, { code: 'sitemap_failed', context: { url: redactUrl(req.url), type: raw } });
		res.statusCode = 500;
		res.setHeader('content-type', 'text/plain; charset=utf-8');
		res.setHeader('cache-control', 'no-store');
		res.end(`sitemap failed, quote ref ${ref} to support\n`);
	}
}
