// Share cards for the three page types that travel on X: models, avatars and
// anatomy designs. Each must unfurl as a large image card (summary_large_image,
// or player only once order 931 approved it) whose image is a real render of
// that entity: /api/render/glb for models, the avatar's own GLB render for
// avatars, and the design's own line drawing card for anatomy.
//
// The unit half pins each head builder. The live half fetches each page's HTML
// from a running dev server and reads the meta a crawler gets; run it with
//   SHARE_CARDS_BASE=http://localhost:3284 npx vitest run tests/share-cards.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const sqlMock = vi.fn(async () => []);
const loadDesignMock = vi.fn();

vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => sqlMock(...a),
	isDbUnavailableError: () => false,
}));
vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'https://three.ws', S3_PUBLIC_DOMAIN: 'https://pub-legacy.r2.dev' },
}));
vi.mock('../api/_lib/anatomy/service.js', async (orig) => ({
	...(await orig()),
	loadDesign: (...a) => loadDesignMock(...a),
}));

const { default: forgeShare } = await import('../api/forge-share.js');
const { default: anatomyOg } = await import('../api/anatomy-og.js');
const { anatomyIdFromPath, rewriteAnatomyHead, createAnatomyHeadRenderer } = await import('../server/anatomy-head.mjs');
const { plotDesignSvg, projectDesign } = await import('../src/anatomy/plot.js');

const MODEL_ID = '0001e5f4-adff-464d-859e-95867eae2f2c';
const ANATOMY_ID = 'dfebfc22-f9d8-4928-8216-c97d074113ec';

// Two parts of the real "Honda CD70 carburetor" design (GET /api/anatomy?id=dfebfc22-...).
const DESIGN = {
	id: ANATOMY_ID,
	title: 'Honda CD70 carburetor',
	subtitle: 'Keihin PB14 slide carburetor on the 72 cc overhead-cam single',
	url: `https://three.ws/anatomy/${ANATOMY_ID}`,
	creatorUsername: null,
	createdAt: '2026-11-18T10:00:00.000Z',
	stats: { parts: 2, steps: 1 },
	spec: {
		title: 'Honda CD70 carburetor',
		parts: [
			{
				id: 'body', name: 'Carburetor body', color: '#8a8a8a', group: 'Body', parent: null, repeat: null,
				position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
				shape: { axis: 'x', type: 'lathe', profile: [[1.2, -2.5], [1.2, -1.5], [0.9, -1.5], [0.7, -0.5], [0.7, 0.5], [0.9, 1.5], [1.2, 1.5], [1.2, 2.5], [1, 2.5], [1, -2.5]] },
			},
			{
				id: 'slide', name: 'Throttle slide', group: 'Throttle', parent: 'body', repeat: null,
				position: [0, 1.4, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
				shape: { type: 'cylinder', axis: 'y', radius: 0.5, height: 1.2 },
			},
		],
		steps: [{ title: 'Air enters the bore' }],
	},
};

function mkRes() {
	return {
		statusCode: 200,
		_h: {},
		_body: undefined,
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(b) { this._body = b; this.writableEnded = true; },
		write(b) { this._chunks = (this._chunks || []).concat(b); return true; },
	};
}

function meta(html, key) {
	const re = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${key.replace(/[:]/g, '\\:')}["'][^>]*>`, 'i');
	const tag = re.exec(html)?.[0];
	return tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1].replace(/&amp;/g, '&') : undefined;
}

function pngSize(buf) {
	const b = Buffer.from(buf);
	expect(b.subarray(1, 4).toString()).toBe('PNG');
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

beforeEach(() => {
	sqlMock.mockReset();
	sqlMock.mockResolvedValue([]);
	loadDesignMock.mockReset();
	delete process.env.X_PLAYER_CARD_APPROVED;
});
afterEach(() => {
	delete process.env.X_PLAYER_CARD_APPROVED;
});

describe('model share card (/forge/share/:id)', () => {
	const finished = {
		id: MODEL_ID,
		prompt: 'a red vintage motorcycle',
		preview_image_url: 'https://three.ws/cdn/forge/thumb/0001e5f4.jpg',
		status: 'done',
		glb_url: 'https://three.ws/cdn/forge/glb/0001e5f4.glb',
		web_glb_url: null,
		web_size_bytes: null,
		size_bytes: 4_000_000,
		model_category: 'vehicle',
		created_at: '2026-11-18T10:00:00.000Z',
		creator_username: null,
		creator_display_name: null,
	};

	async function render() {
		sqlMock.mockResolvedValueOnce([finished]);
		const res = mkRes();
		await forgeShare({ method: 'GET', url: `/api/forge-share?id=${MODEL_ID}`, headers: { host: 'three.ws' } }, res);
		expect(res.statusCode).toBe(200);
		return res._body;
	}

	it('is a summary_large_image card whose image is the /api/render/glb poster of the model', async () => {
		const html = await render();
		expect(meta(html, 'twitter:card')).toBe('summary_large_image');
		expect(meta(html, 'og:image')).toMatch(/^https:\/\/three\.ws\/api\/render\/glb\?glbUrl=/);
		expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
		expect(meta(html, 'og:image:width')).toBe('1200');
		expect(meta(html, 'og:image:height')).toBe('630');
		expect(meta(html, 'twitter:player')).toBeUndefined();
	});

	it('serves the player card only once order 931 approval is recorded (X_PLAYER_CARD_APPROVED=1)', async () => {
		process.env.X_PLAYER_CARD_APPROVED = '1';
		const html = await render();
		expect(meta(html, 'twitter:card')).toBe('player');
		expect(meta(html, 'twitter:player')).toMatch(/^https:\/\/three\.ws\/forge\/embed\?src=/);
		expect(meta(html, 'twitter:image')).toMatch(/\/api\/render\/glb\?/);
	});
});

describe('anatomy plot', () => {
	it('draws every part as coloured strokes, own colour first, group palette otherwise', () => {
		const svg = plotDesignSvg(DESIGN.spec, { width: 400, height: 300 });
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="400" height="300"/);
		expect(svg).toContain('stroke="#8a8a8a"');
		expect((svg.match(/<path /g) || []).length).toBe(2);
		const { segments } = projectDesign(DESIGN.spec);
		expect(segments).toBeGreaterThan(50);
	});

	it('expands repeats and returns null for a spec with nothing to draw', () => {
		const spec = { parts: [{ ...DESIGN.spec.parts[1], parent: null, repeat: { mode: 'radial', axis: 'y', count: 6, angle: 360 }, position: [2, 0, 0] }] };
		expect(projectDesign(spec).strokes).toHaveLength(6);
		expect(plotDesignSvg({ parts: [] })).toBeNull();
	});
});

describe('anatomy share card (/api/anatomy-og)', () => {
	it('renders a 1200x630 PNG of the design', async () => {
		loadDesignMock.mockResolvedValueOnce(DESIGN);
		const res = mkRes();
		await anatomyOg({ method: 'GET', url: `/api/anatomy-og?id=${ANATOMY_ID}`, headers: { host: 'three.ws' } }, res);
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('content-type')).toBe('image/png');
		expect(pngSize(res._body)).toEqual({ width: 1200, height: 630 });
		expect(loadDesignMock).toHaveBeenCalledWith(ANATOMY_ID);
	}, 30000);

	it('redirects to the brand card for an unknown or malformed id instead of failing', async () => {
		const res = mkRes();
		await anatomyOg({ method: 'GET', url: '/api/anatomy-og?id=nope', headers: { host: 'three.ws' } }, res);
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe('https://three.ws/og-image.png');
	});
});

describe('anatomy page head (/anatomy/:id)', () => {
	const shell = readFileSync(new URL('../pages/anatomy.html', import.meta.url), 'utf8');

	it('recognises only design paths', () => {
		expect(anatomyIdFromPath(`/anatomy/${ANATOMY_ID}`)).toBe(ANATOMY_ID);
		expect(anatomyIdFromPath(`/anatomy/${ANATOMY_ID.toUpperCase()}/`)).toBe(ANATOMY_ID);
		expect(anatomyIdFromPath('/anatomy')).toBeNull();
		expect(anatomyIdFromPath('/anatomy/turbofan')).toBeNull();
	});

	it('gives the shell the design title, canonical and a large image card of the design', () => {
		const html = rewriteAnatomyHead(shell, DESIGN);
		expect(html).toContain('<title>Honda CD70 carburetor · How it works · three.ws Anatomy</title>');
		expect(html).toMatch(new RegExp(`<link rel="canonical" href="https://three\\.ws/anatomy/${ANATOMY_ID}"`));
		expect(meta(html, 'og:url')).toBe(`https://three.ws/anatomy/${ANATOMY_ID}`);
		expect(meta(html, 'description')).toContain('Keihin PB14 slide carburetor');
		expect(meta(html, 'twitter:card')).toBe('summary_large_image');
		expect(meta(html, 'og:image')).toBe(`https://three.ws/api/anatomy-og?id=${ANATOMY_ID}`);
		expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
		expect(meta(html, 'og:image:width')).toBe('1200');
		expect(meta(html, 'og:image:height')).toBe('630');
		expect(html.match(/name=["']twitter:card["']/g)).toHaveLength(1);
		expect(html).toContain('"@type":"LearningResource"');
	});

	it('gives a reader that runs no scripts the tour and the parts, not only their counts', () => {
		// The @grok bot browses a link it is asked about. A question such as "how
		// does it work, step by step?" needs the steps themselves in the HTML.
		const design = {
			...DESIGN,
			spec: {
				...DESIGN.spec,
				summary: 'A slide carburetor meters fuel into the air stream by venturi suction.',
				parts: [{ ...DESIGN.spec.parts[0], description: 'Cast housing with the <venturi> bore.' }, DESIGN.spec.parts[1]],
				steps: [{ title: 'Air enters the bore', body: 'The piston draws air through the venturi, which speeds it up.' }, { title: 'Fuel rises through the jet' }],
			},
		};
		const html = rewriteAnatomyHead(shell, design);
		const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])['@graph'][0];
		expect(ld.abstract).toBe('A slide carburetor meters fuel into the air stream by venturi suction.');
		expect(ld.hasPart).toEqual([
			{ '@type': 'CreativeWork', position: 1, name: 'Air enters the bore', text: 'The piston draws air through the venturi, which speeds it up.' },
			{ '@type': 'CreativeWork', position: 2, name: 'Fuel rises through the jet' },
		]);
		expect(ld.about).toEqual([
			{ '@type': 'Thing', name: 'Carburetor body', description: 'Cast housing with the <venturi> bore.' },
			{ '@type': 'Thing', name: 'Throttle slide' },
		]);

		const outline = /<main[^>]*>\s*<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1];
		expect(outline).toBeTruthy();
		expect(outline).toContain('How a Honda CD70 carburetor works');
		expect(outline).toContain('A slide carburetor meters fuel into the air stream by venturi suction.');
		expect(outline).toMatch(/<ol>\s*<li><strong>Air enters the bore\.<\/strong> The piston draws air through the venturi, which speeds it up\.<\/li>\s*<li><strong>Fuel rises through the jet\.<\/strong><\/li>/);
		expect(outline).toContain('<li><strong>Carburetor body:</strong> Cast housing with the &lt;venturi&gt; bore.</li>');
		expect(outline).toContain('<li><strong>Throttle slide</strong></li>');
		expect(html.match(/<noscript>/g)).toHaveLength(1);
	});

	it('adds no outline when the design has no steps or parts to read', () => {
		const html = rewriteAnatomyHead(shell, { ...DESIGN, spec: { title: DESIGN.title } });
		expect(html).not.toContain('<noscript>');
		const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])['@graph'][0];
		expect(ld).not.toHaveProperty('hasPart');
		expect(ld).not.toHaveProperty('about');
	});

	it('escapes the design text and never fails the page', async () => {
		const html = rewriteAnatomyHead(shell, { ...DESIGN, title: 'A <b>"pump"</b>' });
		expect(html).not.toContain('<b>"pump"</b>');
		const render = createAnatomyHeadRenderer({ loadDesign: async () => { throw new Error('db down'); } });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await render(`/anatomy/${ANATOMY_ID}`, shell)).toBeNull();
		spy.mockRestore();
		const ok = createAnatomyHeadRenderer({ loadDesign: async () => DESIGN });
		expect(await ok(`/anatomy/${ANATOMY_ID}`, shell)).toContain('Honda CD70 carburetor');
		expect(await ok('/anatomy', shell)).toBeNull();
	});
});

// Real pages from a running dev server, read the way X's crawler reads them.
const BASE = process.env.SHARE_CARDS_BASE;
const LIVE = {
	model: process.env.SHARE_CARDS_MODEL || MODEL_ID,
	avatar: process.env.SHARE_CARDS_AVATAR || '000027c6-127e-4de8-bea2-a4f44efa7b47',
	anatomy: process.env.SHARE_CARDS_ANATOMY || ANATOMY_ID,
};

describe.runIf(BASE)('live page meta from the dev server', () => {
	const get = async (path) => {
		const r = await fetch(`${BASE}${path}`, { headers: { 'user-agent': 'Twitterbot/1.0', accept: 'text/html' }, redirect: 'manual' });
		expect(r.status, path).toBe(200);
		return r.text();
	};
	// The image URL names the public origin; fetch the same path from the dev server.
	const image = async (url) => {
		const u = new URL(url);
		const r = await fetch(`${BASE}${u.pathname}${u.search}`);
		expect(r.ok, url).toBe(true);
		expect(r.headers.get('content-type')).toMatch(/^image\/(png|jpeg|webp)/);
		return Buffer.from(await r.arrayBuffer());
	};
	const cases = [
		['model page', `/m/${LIVE.model}`, /\/api\/render\/glb\?glbUrl=/],
		['model share link', `/forge/share/${LIVE.model}`, /\/api\/render\/glb\?glbUrl=/],
		['avatar page', `/avatars/${LIVE.avatar}`, new RegExp(`/api/avatars/${LIVE.avatar}/og$`)],
		['anatomy design', `/anatomy/${LIVE.anatomy}`, new RegExp(`/api/anatomy-og\\?id=${LIVE.anatomy}$`)],
	];
	for (const [label, path, imageRe] of cases) {
		it(`${label} is a summary_large_image card with the entity's own render`, async () => {
			const html = await get(path);
			expect(meta(html, 'twitter:card')).toBe('summary_large_image');
			const img = meta(html, 'twitter:image') || meta(html, 'og:image');
			expect(img).toMatch(imageRe);
			const buf = await image(img);
			expect(buf.length).toBeGreaterThan(5000);
		}, 60000);
	}
});
