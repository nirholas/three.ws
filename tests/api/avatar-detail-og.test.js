// /avatars/:id serves a static shell, so a bot-UA rewrite lands crawlers on
// api/avatar-detail-og.js instead. That page is the only version of the avatar
// a search engine ever sees, so it has to carry the avatar's real content, must
// never leak a private or deleted avatar, and must never hand an indexing
// crawler a script that navigates back to the URL it is already on (that loop,
// plus content that lived only inside <noscript>, is what collapsed 45k avatar
// URLs into one duplicate cluster in Search Console).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeReq, makeRes } from '../_helpers/monetization.js';

const sqlState = { rows: [], queue: null, calls: 0 };

vi.mock('../../api/_lib/db.js', () => {
	const sql = vi.fn(async () => {
		const rows = sqlState.queue ? (sqlState.queue[sqlState.calls] ?? []) : sqlState.rows;
		sqlState.calls += 1;
		return rows;
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const { default: handler } = await import('../../api/avatar-detail-og.js');

const AVATAR_ID = '00000000-0000-4000-8000-000000000042';
const GOOGLEBOT =
	'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/128.0.0.0 Safari/537.36';
const UNFURLER = 'Mozilla/5.0 (compatible; Embedly/0.2; snap; +http://support.embed.ly/)';

const AVATAR_ROW = {
	id: AVATAR_ID,
	name: 'Nova <Scout>',
	description: 'A chrome scout.',
	alt_text: null,
	tags: ['scout', 'chrome'],
	model_category: 'avatar',
	view_count: 41,
	fork_count: 3,
	parent_avatar_id: null,
	created_at: new Date('2026-05-04T00:00:00Z'),
	updated_at: new Date('2026-06-01T00:00:00Z'),
	owner_username: 'nirholas',
};

async function invokeHtml(reqOpts) {
	const req = makeReq({ headers: { 'user-agent': GOOGLEBOT }, ...reqOpts });
	const res = makeRes();
	await handler(req, res);
	return { status: res.statusCode, headers: res.headers, html: res.body };
}

beforeEach(() => {
	sqlState.rows = [];
	sqlState.queue = null;
	sqlState.calls = 0;
});

describe('avatar-detail-og', () => {
	it('rejects a non-GET method with 405 before touching the db', async () => {
		const { status } = await invokeHtml({
			method: 'POST',
			url: `/api/avatar-detail-og?id=${AVATAR_ID}`,
		});
		expect(status).toBe(405);
		expect(sqlState.calls).toBe(0);
	});

	it('serves a noindex page for a malformed id without querying', async () => {
		const { status, html } = await invokeHtml({ url: '/api/avatar-detail-og?id=not-a-uuid' });
		expect(status).toBe(200);
		expect(html).toMatch(/name="robots" content="noindex/);
		expect(sqlState.calls).toBe(0);
	});

	it('404s an unknown avatar instead of redirecting to the gallery', async () => {
		const { status, html } = await invokeHtml({ url: `/api/avatar-detail-og?id=${AVATAR_ID}` });
		expect(status).toBe(404);
		expect(html).toMatch(/name="robots" content="noindex/);
		// Avatar miss, then the cross-store probe for an agent with the same id.
		expect(sqlState.calls).toBe(2);
	});

	it('301s to /agents/:id when the id names an agent, not an avatar', async () => {
		sqlState.queue = [[], [{ id: AVATAR_ID }]];
		const { status, headers } = await invokeHtml({ url: `/api/avatar-detail-og?id=${AVATAR_ID}` });
		expect(status).toBe(301);
		expect(headers.location).toBe(`https://three.ws/agents/${AVATAR_ID}`);
	});

	it('renders the avatar as real indexable content, not a spinner', async () => {
		sqlState.rows = [AVATAR_ROW];
		const { status, headers, html } = await invokeHtml({
			url: `/api/avatar-detail-og?id=${AVATAR_ID}`,
		});
		expect(status).toBe(200);
		expect(headers['content-type']).toContain('text/html');
		// The name and description are in the body, not only in <meta>/<noscript>.
		expect(html).toMatch(/<h1>Nova &lt;Scout&gt;<\/h1>/);
		expect(html).toContain('A chrome scout.');
		expect(html).toContain('@nirholas');
		expect(html).toContain(`/api/avatars/${AVATAR_ID}/og`);
		expect(html).toMatch(/rel="canonical" href="https:\/\/three\.ws\/avatars\//);
		expect(html).toContain('og:image');
		expect(html).toContain('twitter:card');
		expect(html).not.toContain('<noscript>');
		// Structured data and internal links a crawler can follow.
		expect(html).toContain('application/ld+json');
		expect(html).toContain('"@type":"3DModel"');
		expect(html).toContain('BreadcrumbList');
		expect(html).toContain('href="/gallery"');
	});

	it('describes the GLB, its render, creator, date and terms as parseable JSON-LD', async () => {
		sqlState.rows = [
			{
				...AVATAR_ROW,
				storage_key: 'https://three.ws/cdn/u/nova/scout.glb',
				size_bytes: 4_096_000,
				owner_display_name: 'Nir',
			},
		];
		const { html } = await invokeHtml({ url: `/api/avatar-detail-og?id=${AVATAR_ID}` });
		const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
		const model = ld['@graph'].find((n) => n['@type'] === '3DModel');
		expect(model.encodingFormat).toBe('model/gltf-binary');
		expect(model.encoding[0]).toMatchObject({
			'@type': 'MediaObject',
			contentUrl: 'https://three.ws/cdn/u/nova/scout.glb',
			encodingFormat: 'model/gltf-binary',
		});
		expect(model.thumbnailUrl).toContain('/api/render/glb?glbUrl=https%3A%2F%2Fthree.ws%2Fcdn%2Fu%2Fnova%2Fscout.glb');
		// The card stays the named avatar card; the thumbnail is the bare render.
		expect(model.image).toBe(`https://three.ws/api/avatars/${AVATAR_ID}/og`);
		expect(model.creator).toMatchObject({ name: 'Nir', url: 'https://three.ws/u/nirholas' });
		expect(model.dateCreated).toBe('2026-05-04');
		expect(model.license).toBe('https://three.ws/legal/tos');
		expect(model.keywords).toBe('scout, chrome');
	});

	it('renders a default-named, undescribed avatar noindex', async () => {
		sqlState.rows = [{ ...AVATAR_ROW, name: 'Avatar', description: null, alt_text: null }];
		const { status, html } = await invokeHtml({ url: `/api/avatar-detail-og?id=${AVATAR_ID}` });
		expect(status).toBe(200);
		expect(html).toMatch(/name="robots" content="noindex, follow"/);
		expect(html).not.toContain('rel="canonical"');
	});

	it('never emits a self-navigating script for an indexing crawler', async () => {
		sqlState.rows = [AVATAR_ROW];
		const { html } = await invokeHtml({ url: `/api/avatar-detail-og?id=${AVATAR_ID}` });
		expect(html).not.toContain('location.replace');
	});

	it('still bounces a link unfurler to the app', async () => {
		sqlState.rows = [AVATAR_ROW];
		const { html } = await invokeHtml({
			url: `/api/avatar-detail-og?id=${AVATAR_ID}`,
			headers: { 'user-agent': UNFURLER },
		});
		expect(html).toContain(`location.replace("/avatars/${AVATAR_ID}")`);
	});

	it('escapes the avatar name everywhere it lands in the document', async () => {
		sqlState.rows = [{ ...AVATAR_ROW, name: '"><script>alert(1)</script>' }];
		const { html } = await invokeHtml({ url: `/api/avatar-detail-og?id=${AVATAR_ID}` });
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
	});
});
