// What a model reading a three.ws link can see: robots.txt rules for the
// readers that have no token of their own (Grok, X's card crawler), and the
// machine-readable description every creation page carries.
//
// Creation pages are /m/:id (forge creations, head rewritten per request by
// server/creation-head.mjs for every User-Agent), /forge/share/:id, and the
// crawler versions of /avatars/:id and /agents/:id. Each one must parse as
// JSON-LD and name the GLB (model/gltf-binary) as its encoding, the PNG render
// of that GLB as its thumbnail, the creator when one is on record, the date,
// and the terms it is published under.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAllowed } from '../api/_lib/portal/robots.js';
import {
	creationJsonLd,
	renderPosterUrl,
	renderableGlb,
	glbMediaObject,
	RENDER_MAX_GLB_BYTES,
} from '../api/_lib/creation-jsonld.js';
import {
	createCreationHeadRenderer,
	creationIdFromPath,
	rewriteCreationHead,
} from '../server/creation-head.mjs';

const root = resolve(import.meta.dirname, '..');
const ROBOTS = readFileSync(resolve(root, 'public/robots.txt'), 'utf8');
const MODEL_SHELL = readFileSync(resolve(root, 'pages/model.html'), 'utf8');

// Fixture: the GET /api/forge-creation?id=… record for a real public
// production creation, captured 2026-10-08 (fields the head does not read are
// trimmed). Anonymous forge, so there is no creator on record.
const ANON_CREATION_FIXTURE = {
	id: '3abac32f-ced2-4189-b822-d30c96dbc87e',
	prompt: 'a small chrome toy rocket on a launch pad, glossy metal',
	glb_url:
		'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/anon/3abac32f-ced2-4189-b822-d30c96dbc87e.glb',
	web_glb_url: null,
	web_size_bytes: null,
	preview_image_url:
		'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/thumb/3abac32f-ced2-4189-b822-d30c96dbc87e.png',
	model_category: 'other',
	created_at: '2026-07-08T09:02:40.073Z',
	size_bytes: 1803764,
	creatorUsername: null,
	creatorDisplayName: null,
};

// The same record shape for a creation forged while signed in.
const SIGNED_IN_CREATION_FIXTURE = {
	...ANON_CREATION_FIXTURE,
	id: '7f3c2a10-5b4e-4c1d-9a8b-0c1d2e3f4a5b',
	prompt: 'a "brass" <lantern> with stained glass',
	web_glb_url: 'https://three.ws/cdn/forge/web/7f3c2a10.glb',
	web_size_bytes: 412_000,
	model_category: 'prop',
	creatorUsername: 'nirholas',
	creatorDisplayName: 'Nir',
};

/** Every JSON-LD block in an HTML document, parsed. Throws on invalid JSON. */
function jsonLdBlocks(html) {
	const out = [];
	for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
		out.push(JSON.parse(m[1]));
	}
	return out;
}

function nodeOfType(blocks, type) {
	for (const b of blocks) {
		const nodes = Array.isArray(b['@graph']) ? b['@graph'] : [b];
		const hit = nodes.find((n) => n['@type'] === type);
		if (hit) return hit;
	}
	return null;
}

function metaContent(html, attr, key) {
	const tag = html.match(new RegExp(`<meta\\b[^>]*\\b${attr}="${key}"[^>]*>`, 'i'))?.[0];
	return tag ? tag.match(/content="([^"]*)"/)?.[1] ?? null : null;
}

describe('robots.txt: readers without a documented token', () => {
	// Grok Bot browses with a stock Chrome UA, and X's card crawler identifies
	// as Twitterbot; neither has a group, so both are judged by "User-agent: *".
	const GROK_BOT_BROWSER =
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
	const RENDER = '/api/render/glb?glbUrl=https%3A%2F%2Fthree.ws%2Fcdn%2Fm.glb&width=1200&height=630';

	it('lets them fetch every creation page and the model render', () => {
		for (const ua of [GROK_BOT_BROWSER, 'Twitterbot/1.0']) {
			expect(isAllowed(ROBOTS, RENDER, ua)).toBe(true);
			expect(isAllowed(ROBOTS, `/m/${ANON_CREATION_FIXTURE.id}`, ua)).toBe(true);
			expect(isAllowed(ROBOTS, '/avatars/00000000-0000-4000-8000-000000000042', ua)).toBe(true);
			expect(isAllowed(ROBOTS, '/agents/00000000-0000-4000-8000-000000000042', ua)).toBe(true);
			expect(isAllowed(ROBOTS, '/forge/share/00000000-0000-4000-8000-000000000042', ua)).toBe(true);
		}
	});

	it('keeps the rest of /api/ closed to the default group', () => {
		expect(isAllowed(ROBOTS, '/api/agents', GROK_BOT_BROWSER)).toBe(false);
		expect(isAllowed(ROBOTS, '/api/render/animate', GROK_BOT_BROWSER)).toBe(false);
	});

	it('still opens the whole API to the documented live-user fetchers', () => {
		for (const ua of ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'MistralAI-User']) {
			expect(isAllowed(ROBOTS, '/api/agents', ua)).toBe(true);
			expect(isAllowed(ROBOTS, '/dashboard', ua)).toBe(false);
		}
	});

	it('records why Grok has no group of its own', () => {
		expect(ROBOTS).toMatch(/xAI documents no user-agent token/);
		expect(ROBOTS).toMatch(/^Allow: \/api\/render\/glb$/m);
	});
});

describe('creation JSON-LD builder', () => {
	it('names the GLB, its render, creator, date and terms', () => {
		const node = creationJsonLd({
			origin: 'https://three.ws',
			pageUrl: 'https://three.ws/m/x',
			name: 'Lantern',
			description: 'A lantern.',
			glbUrl: 'https://three.ws/cdn/a.glb',
			glbSizeBytes: 2048,
			creator: { username: 'nirholas', displayName: 'Nir' },
			dateCreated: '2026-07-08T09:02:40.073Z',
		});
		expect(node['@type']).toBe('3DModel');
		expect(node.encodingFormat).toBe('model/gltf-binary');
		expect(node.encoding).toEqual([
			{
				'@type': 'MediaObject',
				contentUrl: 'https://three.ws/cdn/a.glb',
				encodingFormat: 'model/gltf-binary',
				contentSize: '2048 B',
			},
		]);
		expect(node.thumbnailUrl).toBe(renderPosterUrl('https://three.ws', 'https://three.ws/cdn/a.glb'));
		expect(node.image).toBe(node.thumbnailUrl);
		expect(node.creator).toEqual({
			'@type': 'Person',
			name: 'Nir',
			alternateName: '@nirholas',
			url: 'https://three.ws/u/nirholas',
		});
		expect(node.dateCreated).toBe('2026-07-08');
		expect(node.license).toBe('https://three.ws/legal/tos');
	});

	it('claims nothing it does not have', () => {
		const node = creationJsonLd({ origin: 'https://three.ws', pageUrl: 'https://three.ws/m/x', name: 'X' });
		expect(node).not.toHaveProperty('encoding');
		expect(node).not.toHaveProperty('thumbnailUrl');
		expect(node).not.toHaveProperty('creator');
		expect(node).not.toHaveProperty('dateCreated');
		expect(glbMediaObject('javascript:alert(1)')).toBeNull();
	});

	it('keeps encodingFormat on the file, not on an agent', () => {
		const node = creationJsonLd({
			origin: 'https://three.ws',
			pageUrl: 'https://three.ws/agents/x',
			name: 'Agent',
			type: 'SoftwareApplication',
			glbUrl: 'https://three.ws/cdn/body.glb',
		});
		expect(node).not.toHaveProperty('encodingFormat');
		expect(node.encoding[0].encodingFormat).toBe('model/gltf-binary');
	});

	it('never points a thumbnail at a model the renderer will refuse', () => {
		const big = RENDER_MAX_GLB_BYTES + 1;
		expect(renderableGlb([{ url: 'https://a/web.glb', sizeBytes: big }, { url: 'https://a/full.glb', sizeBytes: 10 }])).toBe(
			'https://a/full.glb',
		);
		expect(renderableGlb([{ url: 'https://a/full.glb', sizeBytes: big }])).toBeNull();
		const node = creationJsonLd({
			origin: 'https://three.ws',
			pageUrl: 'https://three.ws/m/x',
			name: 'Huge',
			glbUrl: 'https://three.ws/cdn/huge.glb',
			glbSizeBytes: big,
		});
		expect(node.encoding[0].contentUrl).toBe('https://three.ws/cdn/huge.glb');
		expect(node).not.toHaveProperty('thumbnailUrl');
	});
});

describe('/m/:id head (server/creation-head.mjs)', () => {
	it('matches only creation paths', () => {
		expect(creationIdFromPath(`/m/${ANON_CREATION_FIXTURE.id}`)).toBe(ANON_CREATION_FIXTURE.id);
		expect(creationIdFromPath(`/m/${ANON_CREATION_FIXTURE.id.toUpperCase()}/`)).toBe(ANON_CREATION_FIXTURE.id);
		expect(creationIdFromPath('/m/not-a-uuid')).toBeNull();
		expect(creationIdFromPath('/creations')).toBeNull();
	});

	it('gives the real model shell a parseable 3DModel and a render card', () => {
		const html = rewriteCreationHead(MODEL_SHELL, ANON_CREATION_FIXTURE);
		const blocks = jsonLdBlocks(html);
		expect(blocks).toHaveLength(1);
		const model = nodeOfType(blocks, '3DModel');
		const poster = renderPosterUrl('https://three.ws', ANON_CREATION_FIXTURE.glb_url);

		expect(model['@id']).toBe(`https://three.ws/m/${ANON_CREATION_FIXTURE.id}`);
		expect(model.name).toBe('A small chrome toy rocket on a launch pad, glossy metal');
		expect(model.encoding[0]).toMatchObject({
			contentUrl: ANON_CREATION_FIXTURE.glb_url,
			encodingFormat: 'model/gltf-binary',
		});
		expect(model.thumbnailUrl).toBe(poster);
		expect(model.dateCreated).toBe('2026-07-08');
		expect(model.license).toBe('https://three.ws/legal/tos');
		// Anonymous forge: no creator is invented.
		expect(model).not.toHaveProperty('creator');

		expect(metaContent(html, 'name', 'twitter:card')).toBe('summary_large_image');
		expect(metaContent(html, 'name', 'twitter:image')).toBe(poster.replace(/&/g, '&amp;'));
		expect(metaContent(html, 'property', 'og:image')).toBe(poster.replace(/&/g, '&amp;'));
		expect(metaContent(html, 'property', 'og:url')).toBe(`https://three.ws/m/${ANON_CREATION_FIXTURE.id}`);
		expect(html).toContain(`<link rel="canonical" href="https://three.ws/m/${ANON_CREATION_FIXTURE.id}" />`);
		expect(html).toMatch(/<title>A small chrome toy rocket on a launch pad, glossy metal · 3D Model · three\.ws<\/title>/);
		// The localized generic strings can no longer overwrite the creation's own.
		expect(html.match(/<head[\s\S]*<\/head>/)[0]).not.toMatch(/data-i18n-attr="content:model\.meta_og_title"/);
		// The body is untouched.
		expect(html.slice(html.indexOf('<body'))).toBe(MODEL_SHELL.slice(MODEL_SHELL.indexOf('<body')));
	});

	it('credits a signed-in creator, escapes the prompt, and renders the web variant', () => {
		const html = rewriteCreationHead(MODEL_SHELL, SIGNED_IN_CREATION_FIXTURE);
		const model = nodeOfType(jsonLdBlocks(html), '3DModel');
		expect(model.creator).toMatchObject({ name: 'Nir', url: 'https://three.ws/u/nirholas' });
		expect(model.keywords).toBe('prop');
		expect(model.thumbnailUrl).toBe(renderPosterUrl('https://three.ws', SIGNED_IN_CREATION_FIXTURE.web_glb_url));
		// The full-resolution original is the file a reader downloads.
		expect(model.encoding[0].contentUrl).toBe(SIGNED_IN_CREATION_FIXTURE.glb_url);
		expect(html).not.toContain('<lantern>');
		expect(html).toContain('&quot;brass&quot; &lt;lantern&gt;');
	});

	it('caches lookups and falls back to the plain shell on a miss or a fault', async () => {
		const loadCreation = vi.fn(async (id) => (id === ANON_CREATION_FIXTURE.id ? ANON_CREATION_FIXTURE : null));
		const render = createCreationHeadRenderer({ loadCreation });

		expect(await render('/creations', MODEL_SHELL)).toBeNull();
		expect(loadCreation).not.toHaveBeenCalled();

		const first = await render(`/m/${ANON_CREATION_FIXTURE.id}`, MODEL_SHELL);
		const second = await render(`/m/${ANON_CREATION_FIXTURE.id}`, MODEL_SHELL);
		expect(first).toBe(second);
		expect(loadCreation).toHaveBeenCalledTimes(1);

		expect(await render('/m/00000000-0000-4000-8000-000000000000', MODEL_SHELL)).toBeNull();

		const failing = createCreationHeadRenderer({
			loadCreation: async () => {
				throw new Error('db down');
			},
		});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await failing(`/m/${ANON_CREATION_FIXTURE.id}`, MODEL_SHELL)).toBeNull();
		err.mockRestore();
	});

	it('serves the shell rather than waiting on a slow lookup, and retries next time', async () => {
		let calls = 0;
		const render = createCreationHeadRenderer({
			timeoutMs: 20,
			loadCreation: () => {
				calls += 1;
				return calls === 1 ? new Promise(() => {}) : Promise.resolve(ANON_CREATION_FIXTURE);
			},
		});
		expect(await render(`/m/${ANON_CREATION_FIXTURE.id}`, MODEL_SHELL)).toBeNull();
		expect(await render(`/m/${ANON_CREATION_FIXTURE.id}`, MODEL_SHELL)).toContain('"@type":"3DModel"');
	});
});
