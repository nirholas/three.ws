// Sitemap index paging, real lastmod values, the forge creations file, and the
// exclusion rules every child sitemap shares.
//
// Pinned regressions, all live on 2026-11-11:
//
//   - api/sitemap.js read its lastmod values through `sql.unsafe(text)`. On the
//     neon driver that call does not run a query, it returns an UnsafeRawSql
//     wrapper meant for interpolation, so every lookup came back empty and
//     every <lastmod> in the index was the day of the crawl. The mock below
//     reproduces neon's behaviour exactly: `unsafe` returns a wrapper object.
//   - Each child sitemap stopped at 45,000 rows with no second page, so 85k of
//     the 130k public avatars were never submitted.
//   - Forge creations (/m/<uuid>, 53k public models) had no sitemap at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XMLValidator } from 'fast-xml-parser';

const db = vi.hoisted(() => ({ queries: [], stats: new Map(), rows: new Map() }));

vi.mock('../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'https://three.ws' } }));

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = strings.join('?');
		db.queries.push({ text, values });
		const isStats = text.includes('row_number()');
		for (const [table, rows] of isStats ? db.stats : db.rows) {
			if (text.includes(`from ${table}`)) return Promise.resolve(rows);
		}
		return Promise.resolve([]);
	};
	// neon: unsafe() builds a raw fragment for interpolation; it never queries.
	sql.unsafe = (raw) => ({ sql: raw });
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

vi.mock('../api/_lib/http.js', () => ({
	method: () => true,
	reportServerError: () => 'ref00000deadbeef',
	redactUrl: (u) => String(u ?? ''),
}));

vi.mock('../api/_lib/news-archive-store.js', () => ({ getMonths: async () => [], loadMonth: async () => [] }));

const { default: indexHandler } = await import('../api/sitemap.js');
const { default: typeHandler } = await import('../api/sitemap/[type].js');
const { parseSitemapName, sitemapFileName, SITEMAP_PAGE_SIZE } = await import('../api/_lib/seo-resources.js');

function makeRes() {
	return {
		statusCode: 0,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(chunk) { this.body = chunk == null ? this.body : String(chunk); return this; },
	};
}

async function callIndex() {
	const res = makeRes();
	await indexHandler({ method: 'GET', query: {}, url: '/api/sitemap' }, res);
	return res;
}

async function callType(type) {
	const res = makeRes();
	await typeHandler({ query: { type }, url: `/api/sitemap/${type}` }, res);
	return res;
}

const today = new Date().toISOString().slice(0, 10);

function indexEntries(xml) {
	return [...xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)].map((m) => ({
		loc: /<loc>([^<]*)<\/loc>/.exec(m[1])?.[1],
		lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(m[1])?.[1] ?? null,
	}));
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

beforeEach(() => {
	db.queries = [];
	db.stats = new Map([
		['agent_identities', [{ page: 0, n: 4602, lastmod: new Date('2026-11-09T10:00:00Z') }]],
		[
			'avatars',
			[
				{ page: 0, n: 50000, lastmod: new Date('2026-10-01T00:00:00Z') },
				{ page: 1, n: 50000, lastmod: new Date('2026-11-02T00:00:00Z') },
				{ page: 2, n: 30229, lastmod: new Date('2026-11-10T00:00:00Z') },
			],
		],
		['forge_creations', [{ page: 0, n: 3, lastmod: new Date('2026-11-08T00:00:00Z') }]],
		['widgets', [{ page: 0, n: 648, lastmod: new Date('2026-09-15T00:00:00Z') }]],
		['users u', [{ page: 0, n: 65, lastmod: new Date('2026-08-20T00:00:00Z') }]],
	]);
	db.rows = new Map();
});

describe('sitemap file names', () => {
	it('names page 1 by the bare type and later pages with a numeric suffix', () => {
		expect(parseSitemapName('avatars')).toEqual({ type: 'avatars', page: 1 });
		expect(parseSitemapName('avatars.xml')).toEqual({ type: 'avatars', page: 1 });
		expect(parseSitemapName('avatars-2')).toEqual({ type: 'avatars', page: 2 });
		expect(parseSitemapName('creations-3.xml')).toEqual({ type: 'creations', page: 3 });
		expect(sitemapFileName('avatars', 1)).toBe('avatars.xml');
		expect(sitemapFileName('avatars', 2)).toBe('avatars-2.xml');
	});

	it.each(['avatars-1', 'avatars-0', 'avatars-02', 'avatars-x', 'core-2', 'news-2', 'bogus', 'constructor', ''])(
		'rejects %j so one file never has two names',
		(name) => {
			expect(parseSitemapName(name)).toBeNull();
		},
	);

	it('pages at the sitemaps.org protocol limit', () => {
		expect(SITEMAP_PAGE_SIZE).toBe(50_000);
	});
});

describe('GET /sitemap.xml: the index', () => {
	it('stamps each child with the newest real timestamp of its rows, not the crawl date', async () => {
		const entries = indexEntries((await callIndex()).body);
		const agents = entries.find((e) => e.loc === 'https://three.ws/sitemap/agents.xml');
		expect(agents.lastmod).toBe('2026-11-09');
		const widgets = entries.find((e) => e.loc === 'https://three.ws/sitemap/widgets.xml');
		expect(widgets.lastmod).toBe('2026-09-15');
	});

	it('lists one child file per 50,000-row page, each with its own lastmod', async () => {
		const res = await callIndex();
		expect(XMLValidator.validate(res.body)).toBe(true);
		const avatars = indexEntries(res.body).filter((e) => e.loc.includes('/sitemap/avatars'));
		expect(avatars).toEqual([
			{ loc: 'https://three.ws/sitemap/avatars.xml', lastmod: '2026-10-01' },
			{ loc: 'https://three.ws/sitemap/avatars-2.xml', lastmod: '2026-11-02' },
			{ loc: 'https://three.ws/sitemap/avatars-3.xml', lastmod: '2026-11-10' },
		]);
	});

	it('lists the forge creations file', async () => {
		const entries = indexEntries((await callIndex()).body);
		expect(entries).toContainEqual({ loc: 'https://three.ws/sitemap/creations.xml', lastmod: '2026-11-08' });
	});

	it('takes the core lastmod from the page manifest and fabricates none for news', async () => {
		const entries = indexEntries((await callIndex()).body);
		const core = entries.find((e) => e.loc === 'https://three.ws/sitemap/core.xml');
		expect(core.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const news = entries.find((e) => e.loc === 'https://three.ws/sitemap/news.xml');
		expect(news.lastmod).toBeNull();
	});

	it('still lists page 1 of a type, without a lastmod, when its stats query fails', async () => {
		db.stats.delete('widgets');
		const entries = indexEntries((await callIndex()).body);
		expect(entries).toContainEqual({ loc: 'https://three.ws/sitemap/widgets.xml', lastmod: null });
		const agents = entries.find((e) => e.loc === 'https://three.ws/sitemap/agents.xml');
		expect(agents.lastmod).not.toBe(today);
	});
});

describe('GET /sitemap/<type>-<n>.xml: paged children', () => {
	it('reads page n from the id cursor at (n - 1) * 50,000', async () => {
		db.rows.set('avatars', [
			{ id: '00000000-0000-4000-8000-000000000001', name: 'Nova', description: 'A chrome scout.', updated_at: new Date('2026-11-10T00:00:00Z') },
		]);
		const res = await callType('avatars-2');
		expect(res.statusCode).toBe(200);
		expect(locs(res.body)).toEqual(['https://three.ws/avatars/00000000-0000-4000-8000-000000000001']);
		const q = db.queries.find((x) => x.text.includes('from avatars'));
		expect(q.text).toContain('order by id');
		expect(q.values).toContain(50_000);
		expect(q.values).toContain(SITEMAP_PAGE_SIZE);
	});

	it('404s a page past the end so a shrunken set drops its stale file', async () => {
		const res = await callType('avatars-9');
		expect(res.statusCode).toBe(404);
	});

	it('serves an empty but valid page 1', async () => {
		const res = await callType('creations');
		expect(res.statusCode).toBe(200);
		expect(XMLValidator.validate(res.body)).toBe(true);
		expect(locs(res.body)).toEqual([]);
	});
});

describe('vercel.json routes every file the index lists', () => {
	it('rewrites paged and creations files to the child handler with the full name', async () => {
		const { readFile } = await import('node:fs/promises');
		const { substitute } = await import('../server/route-resolve.mjs');
		const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
		const route = config.routes.find((r) => r.dest === '/api/sitemap/[type]?type=$1');
		expect(route, 'the /sitemap/<name>.xml rewrite').toBeTruthy();
		const re = new RegExp(`^${route.src}$`);
		for (const name of ['core', 'news', 'avatars', 'avatars-2', 'avatars-13', 'creations', 'creations-2', 'profiles']) {
			const m = re.exec(`/sitemap/${name}.xml`);
			expect(m, name).toBeTruthy();
			const type = new URL(substitute(route.dest, m), 'http://x').searchParams.get('type');
			expect(parseSitemapName(type)).not.toBeNull();
		}
		expect(re.exec('/sitemap/bogus.xml')).toBeNull();
	});
});

describe('GET /sitemap/creations.xml: forge models', () => {
	it('lists public finished models at /m/<id> with their newest real timestamp', async () => {
		db.rows.set('forge_creations', [
			{ id: 'AAAAAAAA-0000-4000-8000-000000000001', updated_at: null, completed_at: new Date('2026-11-07T00:00:00Z'), created_at: new Date('2026-11-06T00:00:00Z') },
			{ id: 'aaaaaaaa-0000-4000-8000-000000000002', updated_at: new Date('2026-11-08T00:00:00Z'), completed_at: null, created_at: new Date('2026-11-01T00:00:00Z') },
		]);
		const res = await callType('creations');
		expect(XMLValidator.validate(res.body)).toBe(true);
		expect(locs(res.body)).toEqual([
			'https://three.ws/m/aaaaaaaa-0000-4000-8000-000000000001',
			'https://three.ws/m/aaaaaaaa-0000-4000-8000-000000000002',
		]);
		expect(res.body).toContain('<lastmod>2026-11-07</lastmod>');
		expect(res.body).toContain('<lastmod>2026-11-08</lastmod>');
	});

	it('excludes unfinished, rejected, unlisted and private models in SQL', async () => {
		await callType('creations');
		const q = db.queries.find((x) => x.text.includes('from forge_creations'));
		expect(q.text).toContain("status = 'done'");
		expect(q.text).toContain('glb_url is not null');
		expect(q.text).toContain("outcome != 'rejected'");
		expect(q.text).toContain("visibility = 'public'");
		expect(q.text).not.toContain("'unlisted'");
	});
});

describe('exclusion rules shared by every entity file', () => {
	it.each([
		['agents', 'agent_identities', ['deleted_at is null', 'is_public = true']],
		['avatars', 'avatars', ['deleted_at is null', "visibility = 'public'"]],
		['widgets', 'widgets', ['deleted_at is null', 'is_public = true']],
		['profiles', 'users u', ['deleted_at is null', 'username is not null', 'service_account = false']],
	])('%s filters private and deleted rows in SQL', async (type, table, preds) => {
		await callType(type);
		const q = db.queries.find((x) => x.text.includes(`from ${table}`));
		expect(q, `${type} must query ${table}`).toBeTruthy();
		for (const p of preds) expect(q.text).toContain(p);
	});
});
