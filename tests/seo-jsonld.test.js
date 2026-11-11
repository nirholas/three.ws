// Structured data per page type, the schema.org graph Bing and Copilot read to
// decide what a three.ws URL is (docs/ops/bing-and-indexnow.md):
//
//   home        Organization with sameAs: the Microsoft Marketplace listing
//               plus the official profiles (pages/desktop.html)
//   any page    BreadcrumbList below the root (server/seo-head.mjs appends one
//               to a page that owns its meta and lacks one)
//   product     WebApplication on the build and labs tool pages
//   creation    3DModel with the GLB as its encoding, plus a BreadcrumbList
//               (server/creation-head.mjs)
//   agent       SoftwareApplication with the body GLB as its encoding
//               (api/agent-detail-og.js)
//   FAQ         FAQPage only on a page that shows a FAQ

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...args) => sqlMock(...args) }));

import { rewriteHead, isProductPage } from '../server/seo-head.mjs';
import { rewriteCreationHead } from '../server/creation-head.mjs';
import { jsonLdNodes, jsonLdTypes, pathTrail, breadcrumbListNode, faqVisibility } from '../api/_lib/structured-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const pagesJson = JSON.parse(read('data/pages.json'));
const allPages = pagesJson.sections.flatMap((s) => (s.pages || []).map((p) => ({ ...p, sectionId: s.id })));
const headOf = (html) => html.match(/<head[^>]*>[\s\S]*?<\/head>/i)[0];
const MARKETPLACE = 'https://marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview';

/** A minimal page that owns its meta: its canonical is its own URL. */
function ownedShell(urlPath, extraHead = '') {
	return `<!doctype html><html lang="en"><head>
<title>Owned · three.ws</title>
<meta name="description" content="Owned page." />
<link rel="canonical" href="https://three.ws${urlPath}" />
${extraHead}
</head><body><h1>Owned</h1></body></html>`;
}

function crumbs(html) {
	const [list] = jsonLdNodes(html, 'BreadcrumbList');
	return list ? list.itemListElement.map((i) => [i.position, i.name, i.item]) : null;
}

describe('home: Organization', () => {
	for (const file of ['pages/desktop.html', 'pages/home.html']) {
		it(`${file} names the Marketplace listing and the official profiles in sameAs`, () => {
			const [org] = jsonLdNodes(read(file), 'Organization').filter((n) => n['@id'] === 'https://three.ws/#organization');
			expect(org).toBeTruthy();
			expect(org.url).toBe('https://three.ws');
			expect(org.sameAs).toContain(MARKETPLACE);
			expect(org.sameAs).toContain('https://x.com/trythreews');
			expect(org.sameAs).toContain('https://github.com/nirholas/three.ws');
			expect(new Set(org.sameAs).size).toBe(org.sameAs.length);
		});
	}
});

describe('BreadcrumbList on pages that own their meta', () => {
	const pricing = allPages.find((p) => p.path === '/pricing');

	it('appends Home > Pricing to /pricing and changes nothing else in the head', () => {
		const src = read('pages/pricing.html');
		const out = rewriteHead('/pricing', src);
		expect(out).toBeTruthy();
		expect(crumbs(out)).toEqual([
			[1, 'Home', 'https://three.ws/'],
			[2, pricing.title, 'https://three.ws/pricing'],
		]);
		// Only one block was added: the original head is a prefix-preserving subset.
		const before = headOf(src).replace(/<\/head>$/i, '');
		expect(headOf(out).startsWith(before)).toBe(true);
		expect(out.slice(out.indexOf('</head>'))).toBe(src.slice(src.indexOf('</head>')));
	});

	it('does not add a second BreadcrumbList when the page ships one', () => {
		const existing = `<script type="application/ld+json">${JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [breadcrumbListNode([{ name: 'Home', path: '/' }, { name: 'Pricing', path: '/pricing' }], 'https://three.ws')],
		})}</script>`;
		expect(rewriteHead('/pricing', ownedShell('/pricing', existing))).toBeNull();
	});

	it('names intermediate crumbs from the catalog, not the slug', () => {
		const nested = allPages.find((p) => /^\/docs\/[a-z0-9-]+$/.test(p.path) && p.indexable !== false && p.auth !== 'required');
		const docs = allPages.find((p) => p.path === '/docs');
		const out = rewriteHead(nested.path, ownedShell(nested.path));
		expect(crumbs(out)).toEqual([
			[1, 'Home', 'https://three.ws/'],
			[2, docs.title, 'https://three.ws/docs'],
			[3, nested.title, `https://three.ws${nested.path}`],
		]);
	});

	it('gives the home page no breadcrumb', () => {
		expect(pathTrail('/', 'Home')).toEqual([]);
	});

	it('the shared-shell rewrite carries a breadcrumb too', () => {
		const out = rewriteHead('/docs/swarms', read('docs/index.html'));
		expect(crumbs(out)?.[0]).toEqual([1, 'Home', 'https://three.ws/']);
		expect(crumbs(out)?.at(-1)?.[2]).toBe('https://three.ws/docs/swarms');
	});
});

describe('product pages: WebApplication', () => {
	const product = allPages.find((p) => isProductPage(p.sectionId, p) && p.indexable !== false && p.auth !== 'required' && !p.path.startsWith('http'));

	it('treats build and labs tools as products and docs as articles', () => {
		expect(product).toBeTruthy();
		expect(isProductPage('build', { path: '/forge' })).toBe(true);
		expect(isProductPage('labs', { path: '/anatomy' })).toBe(true);
		expect(isProductPage('build', { path: '/docs/forge' })).toBe(false);
		expect(isProductPage('main', { path: '/pricing' })).toBe(false);
	});

	it('adds a WebApplication to a product page that has none', () => {
		const out = rewriteHead(product.path, ownedShell(product.path));
		const [app] = jsonLdNodes(out, 'WebApplication');
		expect(app).toMatchObject({
			name: product.title,
			url: `https://three.ws${product.path}`,
			operatingSystem: 'Any',
			publisher: { '@id': 'https://three.ws/#organization' },
		});
		expect(['DeveloperApplication', 'MultimediaApplication']).toContain(app.applicationCategory);
		expect(jsonLdTypes(out).has('BreadcrumbList')).toBe(true);
	});

	it('keeps a page-authored SoftwareApplication instead of adding another', () => {
		const authored = `<script type="application/ld+json">${JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'SoftwareApplication',
			name: 'Authored',
		})}</script>`;
		const out = rewriteHead(product.path, ownedShell(product.path, authored));
		expect(jsonLdNodes(out, 'WebApplication')).toHaveLength(0);
		expect(jsonLdNodes(out, 'SoftwareApplication')).toHaveLength(1);
	});
});

describe('creations: 3DModel with a GLB encoding', () => {
	const SHELL = `<!doctype html><html lang="en"><head>
<title>3D Model · three.ws</title>
<link rel="canonical" href="https://three.ws/creations" />
</head><body></body></html>`;
	const creation = {
		id: 'aaaaaaaa-0000-4000-8000-000000000002',
		prompt: 'a brass astrolabe with engraved star charts',
		glb_url: 'https://cdn.three.ws/forge/a.glb',
		size_bytes: 1_000_000,
		created_at: '2026-11-01T00:00:00Z',
		visibility: 'public',
		creatorUsername: 'maker',
	};

	it('describes the model, its GLB and its trail', () => {
		const html = rewriteCreationHead(SHELL, creation);
		const [model] = jsonLdNodes(html, '3DModel');
		expect(model).toBeTruthy();
		expect(model.encoding[0]).toMatchObject({
			'@type': 'MediaObject',
			contentUrl: 'https://cdn.three.ws/forge/a.glb',
			encodingFormat: 'model/gltf-binary',
		});
		expect(model.creator).toMatchObject({ '@type': 'Person' });
		expect(crumbs(html)).toEqual([
			[1, 'Home', 'https://three.ws/'],
			[2, 'Creations', 'https://three.ws/creations'],
			[3, model.name, 'https://three.ws/m/aaaaaaaa-0000-4000-8000-000000000002'],
		]);
		// Exactly one JSON-LD block: the shell's own is replaced, never doubled.
		expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
	});

	it('gives pipeline creations with no prompt their own title and description', () => {
		const head = (c) => {
			const html = rewriteCreationHead(SHELL, c);
			return {
				title: html.match(/<title>([^<]*)<\/title>/)[1],
				description: html.match(/<meta name="description" content="([^"]*)"/)[1],
			};
		};
		const a = head({ ...creation, prompt: 'auto-rig', creatorUsername: null });
		const b = head({ ...creation, id: 'bbbbbbbb-0000-4000-8000-000000000003', prompt: 'auto-rig', creatorUsername: null });
		expect(a.title).toBe('Rigged 3D model aaaaaaaa · 3D Model · three.ws');
		expect(a.title).not.toBe(b.title);
		expect(a.description).not.toBe(b.description);
		expect(a.description).not.toContain('auto-rig');
	});
});

describe('agents: SoftwareApplication', () => {
	beforeEach(() => {
		sqlMock.mockReset();
		vi.stubEnv('S3_PUBLIC_DOMAIN', 'https://cdn.three.ws');
	});
	afterEach(() => vi.unstubAllEnvs());

	it('renders the agent crawler page as a SoftwareApplication with its body GLB', async () => {
		sqlMock.mockResolvedValueOnce([
			{
				id: '11111111-2222-4333-8444-555555555555',
				name: 'Atlas',
				description: 'Maps the forge gallery and answers questions about 3D formats.',
				skills: ['search', 'glb-inspect'],
				home_url: null,
				erc8004_agent_id: null,
				chain_id: null,
				created_at: '2026-10-01T00:00:00Z',
				updated_at: '2026-11-01T00:00:00Z',
				body_storage_key: 'u/abc/body.glb',
				body_size_bytes: 2_000_000,
				owner_username: 'maker',
				owner_display_name: 'Maker',
			},
		]);
		const { default: handler } = await import('../api/agent-detail-og.js');
		const res = {
			statusCode: 0,
			headers: {},
			body: '',
			setHeader(k, v) {
				this.headers[k.toLowerCase()] = v;
			},
			getHeader(k) {
				return this.headers[k.toLowerCase()];
			},
			end(b) {
				this.body = b || '';
			},
		};
		await handler(
			{
				method: 'GET',
				url: '/api/agent-detail-og?id=11111111-2222-4333-8444-555555555555',
				headers: { 'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' },
			},
			res,
		);
		expect(res.statusCode).toBe(200);
		const [app] = jsonLdNodes(res.body, 'SoftwareApplication');
		expect(app).toMatchObject({ name: 'Atlas', applicationCategory: 'AI agent' });
		expect(app.encoding?.[0]).toMatchObject({
			contentUrl: 'https://cdn.three.ws/u/abc/body.glb',
			encodingFormat: 'model/gltf-binary',
		});
		expect(crumbs(res.body)?.map((c) => c[1])).toEqual(['Home', 'Agents', 'Atlas']);
	});

	it('names the owner in the head title and description so same-named agents stay distinct', async () => {
		// 4.6k public agents share about 2k names; owner plus name separates 94%.
		// Most owners have no username yet, so their display name stands in.
		const { default: handler } = await import('../api/agent-detail-og.js');
		const headOf = async (r) => {
			sqlMock.mockResolvedValueOnce([r]);
			const res = crawlerRes();
			await handler({ method: 'GET', url: `/api/agent-detail-og?id=${r.id}`, headers: { 'user-agent': BINGBOT } }, res);
			return {
				title: res.body.match(/<title>([^<]*)<\/title>/)[1],
				desc: res.body.match(/<meta name="description" content="([^"]*)"/)[1],
				h1: res.body.match(/<h1>([^<]*)<\/h1>/)[1],
			};
		};
		const base = { name: 'Zhu Su', description: null, skills: [], created_at: '2026-06-16T00:00:00Z' };
		const a = await headOf({ ...base, id: '11111111-2222-4333-8444-555555555561', owner_username: null, owner_display_name: 'EYHE…PcTr' });
		const b = await headOf({ ...base, id: '11111111-2222-4333-8444-555555555562', owner_username: 'kai', owner_display_name: 'Kai' });
		expect(a.title).toBe('Zhu Su by EYHE…PcTr · three.ws');
		expect(b.title).toBe('Zhu Su by @kai · three.ws');
		expect(a.h1).toBe('Zhu Su');
		expect(a.desc).toBe('Zhu Su is an AI agent on three.ws, with a body, a place, and an identity. By EYHE…PcTr.');
		expect(a.desc).not.toBe(b.desc);
	});

	it('leads a shared template description with the agent name so two agents never share one', async () => {
		const row = (id, name) => ({
			id,
			name,
			description: 'Vets a token: mint authority, venue, holder structure.',
			skills: [],
			created_at: '2026-10-01T00:00:00Z',
			updated_at: '2026-11-01T00:00:00Z',
		});
		const { default: handler } = await import('../api/agent-detail-og.js');
		const descOf = async (r) => {
			sqlMock.mockResolvedValueOnce([r]);
			const res = crawlerRes();
			await handler({ method: 'GET', url: `/api/agent-detail-og?id=${r.id}`, headers: { 'user-agent': BINGBOT } }, res);
			return res.body.match(/<meta name="description" content="([^"]*)"/)[1];
		};
		const a = await descOf(row('11111111-2222-4333-8444-555555555551', 'Scout'));
		const b = await descOf(row('11111111-2222-4333-8444-555555555552', 'Ranger'));
		expect(a).toBe('Scout: Vets a token: mint authority, venue, holder structure.');
		expect(a).not.toBe(b);
	});
});

describe('profiles: ProfilePage with a Person', () => {
	beforeEach(() => sqlMock.mockReset());

	const user = {
		id: 'u1',
		username: 'kai',
		display_name: 'Kai Rivers',
		bio: 'I build low-poly ships.',
		website: 'https://kai.example',
		location: 'Lisbon',
		avatar_url: null,
		created_at: '2026-03-02T00:00:00Z',
		updated_at: '2026-11-01T00:00:00Z',
		service_account: false,
	};

	async function render(username, rows) {
		for (const r of rows) sqlMock.mockResolvedValueOnce(r);
		const { default: handler } = await import('../api/profile-detail-og.js');
		const res = crawlerRes();
		await handler({ method: 'GET', url: `/u/${username}?username=${username}`, headers: { 'user-agent': BINGBOT } }, res);
		return res;
	}

	it('renders a canonical, a unique title and description, a Person and a trail', async () => {
		const res = await render('kai', [
			[user],
			[{ avatars: 3, agents: 1, widgets: 0 }],
			[{ id: '11111111-2222-4333-8444-555555555555', name: 'Atlas' }],
			[{ id: 'aaaaaaaa-2222-4333-8444-555555555555', name: 'Skiff' }],
		]);
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('<link rel="canonical" href="https://three.ws/u/kai">');
		expect(res.body).toContain('<title>Kai Rivers (@kai) · three.ws</title>');
		expect(res.body).toContain('<meta name="description" content="I build low-poly ships. Kai Rivers (@kai) on three.ws: 3 avatars, 1 agent. Joined Mar 2026.">');
		const [page] = jsonLdNodes(res.body, 'ProfilePage');
		expect(page.mainEntity).toMatchObject({ '@type': 'Person', name: 'Kai Rivers', alternateName: '@kai', sameAs: ['https://kai.example'] });
		expect(crumbs(res.body)?.map((c) => c[1])).toEqual(['Home', 'Kai Rivers']);
		expect(res.body).toContain('href="/agents/11111111-2222-4333-8444-555555555555"');
		expect(res.body).toContain('href="/avatars/aaaaaaaa-2222-4333-8444-555555555555"');
	});

	it('answers 404 for a username nobody holds, and keeps a service account out of the index', async () => {
		expect((await render('nobody', [[]])).statusCode).toBe(404);
		const bot = await render('kai', [[{ ...user, service_account: true }], [{ avatars: 0, agents: 0, widgets: 0 }], [], []]);
		expect(bot.body).toContain('noindex');
	});
});

const BINGBOT = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';

function crawlerRes() {
	return {
		statusCode: 0,
		headers: {},
		body: '',
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b || '';
		},
	};
}

describe('FAQPage only where a FAQ is shown', () => {
	it('marks up every visible pricing question', () => {
		const { questions, hidden } = faqVisibility(read('pages/pricing.html'));
		expect(questions).toHaveLength(7);
		expect(hidden).toEqual([]);
	});

	it('no static page declares a FAQPage without showing at least one of its questions', () => {
		const offenders = [];
		for (const f of readdirSync(path.join(ROOT, 'pages')).filter((n) => n.endsWith('.html'))) {
			const { questions, visible } = faqVisibility(read(`pages/${f}`));
			if (questions.length && !visible.length) offenders.push(f);
		}
		expect(offenders).toEqual([]);
	});

	it('tells a shown question from a markup-only one', () => {
		const html = `<html><head><script type="application/ld+json">${JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'FAQPage',
			mainEntity: [
				{ '@type': 'Question', name: "What's free?", acceptedAnswer: { '@type': 'Answer', text: 'All of it.' } },
				{ '@type': 'Question', name: 'Hidden one?', acceptedAnswer: { '@type': 'Answer', text: 'Never shown.' } },
			],
		})}</script></head><body><details><summary>What&#39;s free?</summary>All of it.</details></body></html>`;
		expect(faqVisibility(html)).toEqual({ questions: ["What's free?", 'Hidden one?'], visible: ["What's free?"], hidden: ['Hidden one?'] });
	});
});
