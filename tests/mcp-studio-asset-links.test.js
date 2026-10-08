// Agent-first tool results: every asset-returning tool on the free 3D Studio MCP
// server hands back the same four plain, absolute links (viewer_url, glb_url,
// poster_png_url, embed_html), in structuredContent AND in the first lines of its
// text, so a client that renders no widget (Grok Bot, the xAI Responses API, a
// scripted agent) still leaves with something it can open, download and paste.
//
// The generation pipeline, the turntable renderer, the persona store and the
// catalog's storage read are stubbed at their module boundaries; everything
// above them (the result builders, the dispatch, the snippet code) is the real
// code. The catalog rows are FIXTURES captured from the live
// /api/mcp-studio search_catalog answer on 2026-10-08.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		pollOnce: vi.fn(),
		generate: vi.fn(),
		rig: vi.fn(),
		directPrompt: vi.fn(async () => null),
	};
});

vi.mock('../api/_lib/3d-vision.js', () => ({
	renderTurntable: vi.fn(),
	fetchGeometryStats: vi.fn(async () => null),
	describeGeometry: vi.fn(() => []),
}));

vi.mock('../api/_lib/ssrf-guard.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		assertSafePublicUrl: vi.fn(async () => undefined),
		fetchSafePublicUrlPinned: vi.fn(),
	};
});

vi.mock('../api/_lib/persona-store.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		createPersona: vi.fn(),
		getPersona: vi.fn(),
		touchPersona: vi.fn(async () => null),
	};
});

const FIXTURE_CATALOG_ROWS = {
	object: {
		name: 'ArmChair_01',
		label: 'Arm Chair 01',
		url: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb',
		thumb: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/thumbs/ArmChair_01.png',
		bytes: 768216,
		categories: ['furniture', 'seating'],
		tags: ['gothic', 'vintage', 'chair', 'furniture'],
		license: 'CC0',
	},
	character: {
		name: 'abe',
		label: 'Abe',
		url: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/avatars/mixamo/glb/abe.glb',
		thumb: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/avatars/mixamo/thumbs/abe.png',
		bytes: 35947032,
		skins: 1,
		animations: 1,
		source: 'mixamo',
		license: 'Mixamo',
	},
	animation: {
		name: 'mx-135-degree-left-turn-c9cd5a01b96c',
		label: '135 Degree Left Turn',
		url: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/animations/library/clips/mx-135-degree-left-turn-c9cd5a01b96c.json',
		thumb: 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/animations/library/thumbs/mx-135-degree-left-turn-c9cd5a01b96c.webp',
		bytes: 144524,
		duration: 1.9666666984558105,
		loop: false,
	},
};

const MANIFESTS = {
	'objects/library/manifest.json': { objects: [FIXTURE_CATALOG_ROWS.object] },
	'avatars/library/manifest.json': { avatars: [FIXTURE_CATALOG_ROWS.character] },
	'animations/library/manifest.json': { clips: [FIXTURE_CATALOG_ROWS.animation] },
};

vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		getPublicObjectBuffer: vi.fn(async (key) => {
			if (!MANIFESTS[key]) {
				const err = new Error('NoSuchKey');
				err.name = 'NoSuchKey';
				throw err;
			}
			return Buffer.from(JSON.stringify(MANIFESTS[key]), 'utf8');
		}),
	};
});

const { generate, rig, pollOnce } = await import('../api/_mcp-studio/gpt-forge-client.js');
const { renderTurntable } = await import('../api/_lib/3d-vision.js');
const { fetchSafePublicUrlPinned } = await import('../api/_lib/ssrf-guard.js');
const { createPersona, getPersona } = await import('../api/_lib/persona-store.js');
const { resetCatalogCache } = await import('../api/_lib/asset-catalog.js');
const { dispatch } = await import('../api/_mcp-studio/dispatch.js');
const { assetLinks, assetLinksText, posterPngUrl, RENDER_MAX_GLB_BYTES, POSTER_SIZE } = await import(
	'../api/_mcp-studio/asset-links.js'
);

const ORIGIN = 'https://three.ws';
const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };
const LINK_KEYS = ['viewer_url', 'glb_url', 'poster_png_url', 'embed_html'];

// Real-shaped generation payloads: the /cdn form is what the studio hands out
// for a creation saved to the bucket.
const MODEL_GLB = 'https://three.ws/cdn/creations/2026/10/08/teapot.glb';
const RIGGED_GLB = 'https://three.ws/cdn/creations/2026/10/08/knight-rigged.glb';
const PERSONA_ID = 'persona_Qm3xT8vLk2Hd9sPw';

async function call(name, args) {
	const res = await dispatch(
		{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
		{},
		req,
	);
	if (res.error) throw new Error(`${name}: ${res.error.message}`);
	return res.result;
}

function isAbsoluteHttps(url) {
	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
}

// The contract every asset-bearing result is held to.
function expectLinks(links, { glb, embed }) {
	for (const key of LINK_KEYS) expect(typeof links[key]).toBe('string');
	expect(isAbsoluteHttps(links.viewer_url)).toBe(true);
	expect(isAbsoluteHttps(links.glb_url)).toBe(true);
	expect(isAbsoluteHttps(links.poster_png_url)).toBe(true);
	if (glb) expect(links.glb_url).toBe(glb);
	expect(new URL(links.viewer_url).pathname).toBe('/viewer');
	expect(new URL(links.viewer_url).searchParams.get('src')).toBe(links.glb_url);
	expect(links.embed_html).toContain(embed === 'avatar' ? '<agent-3d' : '<model-viewer');
	expect(links.embed_html).toContain(links.glb_url);
}

// The text a widget-less client reads states every link up front.
function expectLinksInText(text, links, maxLine = 6) {
	const lines = text.split('\n');
	const at = (prefix) => lines.findIndex((l) => l.trim().startsWith(prefix));
	expect(lines[at('Viewer:')]).toContain(links.viewer_url);
	expect(lines[at('GLB:')]).toContain(links.glb_url);
	expect(lines[at('Poster PNG:')]).toContain(links.poster_png_url);
	expect(lines[at('Embed HTML:')]).toContain(links.glb_url);
	for (const p of ['Viewer:', 'GLB:', 'Poster PNG:', 'Embed HTML:']) {
		expect(at(p)).toBeGreaterThanOrEqual(0);
		expect(at(p)).toBeLessThan(maxLine);
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	resetCatalogCache();
});

describe('assetLinks', () => {
	it('builds four absolute links from a site-relative GLB path', () => {
		const links = assetLinks({ base: ORIGIN, glbUrl: '/cdn/creations/teapot.glb', kind: 'model', title: 'a red teapot' });
		expectLinks(links, { glb: 'https://three.ws/cdn/creations/teapot.glb', embed: 'prop' });
		expect(links.poster_png_url).toBe(
			`https://three.ws/api/render/glb?glbUrl=${encodeURIComponent(links.glb_url)}&width=${POSTER_SIZE}&height=${POSTER_SIZE}`,
		);
		expect(new URL(links.viewer_url).searchParams.get('title')).toBe('a red teapot');
	});

	it('embeds bodies as <agent-3d> and props as <model-viewer>', () => {
		for (const kind of ['avatar', 'rigged model', 'character', 'persona']) {
			expect(assetLinks({ base: ORIGIN, glbUrl: MODEL_GLB, kind }).embed_html).toContain('<agent-3d');
		}
		for (const kind of ['model', 'mesh', 'refined model', 'object']) {
			expect(assetLinks({ base: ORIGIN, glbUrl: MODEL_GLB, kind }).embed_html).toContain('<model-viewer');
		}
		expect(assetLinks({ base: ORIGIN, glbUrl: MODEL_GLB, kind: 'mesh', rigged: true }).embed_html).toContain('<agent-3d');
	});

	it('escapes a hostile title out of the embed markup', () => {
		const links = assetLinks({ base: ORIGIN, glbUrl: MODEL_GLB, kind: 'model', title: '"><script>alert(1)</script>' });
		expect(links.embed_html).not.toContain('<script>alert');
		expect(links.embed_html).toContain('&quot;&gt;&lt;script&gt;');
	});

	it('uses the published PNG thumbnail when the GLB is too big for the renderer', () => {
		const { character } = FIXTURE_CATALOG_ROWS;
		const big = assetLinks({ base: ORIGIN, glbUrl: character.url, kind: 'character', bytes: character.bytes, thumb: character.thumb });
		expect(character.bytes).toBeGreaterThan(RENDER_MAX_GLB_BYTES);
		expect(big.poster_png_url).toBe(character.thumb);
		const small = assetLinks({ base: ORIGIN, glbUrl: character.url, kind: 'character', bytes: 1024, thumb: character.thumb });
		expect(small.poster_png_url).toBe(posterPngUrl(ORIGIN, character.url));
	});

	it('returns null when there is no usable model URL', () => {
		expect(assetLinks({ base: ORIGIN, glbUrl: '', kind: 'model' })).toBeNull();
		expect(assetLinks({ base: ORIGIN, glbUrl: 'data:model/gltf-binary;base64,AAAA', kind: 'model' })).toBeNull();
		expect(assetLinks({ base: '', glbUrl: MODEL_GLB, kind: 'model' })).toBeNull();
		expect(assetLinksText(null)).toBe('');
	});

	it('keeps the poster size cap in step with the renderer', () => {
		const src = readFileSync(new URL('../api/render/glb.js', import.meta.url), 'utf8');
		const m = /const MAX_GLB_BYTES = ([\d\s*]+);/.exec(src);
		expect(m).not.toBeNull();
		expect(m[1].split('*').reduce((n, f) => n * Number(f.trim()), 1)).toBe(RENDER_MAX_GLB_BYTES);
	});
});

describe('generation results carry the four links', () => {
	it('forge_free', async () => {
		generate.mockResolvedValueOnce({ status: 'done', glb_url: MODEL_GLB });
		const r = await call('forge_free', { prompt: 'a red ceramic teapot' });
		expectLinks(r.structuredContent, { glb: MODEL_GLB, embed: 'prop' });
		expectLinksInText(r.content[0].text, r.structuredContent);
		// The widget contract is untouched.
		expect(r.structuredContent.glbUrl).toBe(MODEL_GLB);
		expect(r.structuredContent.viewerUrl).toContain('/viewer?src=');
	});

	it('mesh_forge', async () => {
		generate.mockResolvedValueOnce({ status: 'done', glb_url: MODEL_GLB });
		const r = await call('mesh_forge', { prompt: 'a red ceramic teapot' });
		expectLinks(r.structuredContent, { glb: MODEL_GLB, embed: 'prop' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});

	it('text_to_avatar embeds as an avatar', async () => {
		generate.mockResolvedValueOnce({ status: 'done', glb_url: MODEL_GLB });
		const r = await call('text_to_avatar', { prompt: 'a knight in silver plate armor' });
		expectLinks(r.structuredContent, { glb: MODEL_GLB, embed: 'avatar' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});

	it('rig_mesh', async () => {
		rig.mockResolvedValueOnce({ status: 'done', glb_url: RIGGED_GLB });
		const r = await call('rig_mesh', { glb_url: MODEL_GLB });
		expectLinks(r.structuredContent, { glb: RIGGED_GLB, embed: 'avatar' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});

	it('forge_avatar', async () => {
		generate.mockResolvedValueOnce({ status: 'done', glb_url: MODEL_GLB });
		rig.mockResolvedValueOnce({ status: 'done', glb_url: RIGGED_GLB });
		const r = await call('forge_avatar', { prompt: 'a knight in silver plate armor' });
		expectLinks(r.structuredContent, { glb: RIGGED_GLB, embed: 'avatar' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});

	it('refine_model', async () => {
		generate.mockResolvedValueOnce({ status: 'done', glb_url: RIGGED_GLB });
		const r = await call('refine_model', { glb_url: MODEL_GLB, instruction: 'make it metallic', parent_prompt: 'a red ceramic teapot' });
		expectLinks(r.structuredContent, { glb: RIGGED_GLB, embed: 'prop' });
		expectLinksInText(r.content[0].text, r.structuredContent);
		expect(r.structuredContent.lineage).toHaveLength(2);
	});

	it('check_job on a finished job', async () => {
		pollOnce.mockResolvedValueOnce({ status: 'done', glb_url: MODEL_GLB, prompt: 'a red ceramic teapot' });
		const r = await call('check_job', { job_id: 'gfj_8c1d4e2a' });
		expectLinks(r.structuredContent, { glb: MODEL_GLB, embed: 'prop' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});

	it('look_at_model', async () => {
		renderTurntable.mockResolvedValueOnce({
			size: 512,
			frames: [{ view: 'front', theta: 0, phi: 75, png: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }],
			failed: [],
		});
		const r = await call('look_at_model', { glb_url: MODEL_GLB });
		expectLinks(r.structuredContent, { glb: MODEL_GLB, embed: 'prop' });
		expectLinksInText(r.content[0].text, r.structuredContent);
		expect(r.structuredContent.model_url).toBe(MODEL_GLB);
	});

	it('a job still rendering hands back a viewer that finishes the wait itself', async () => {
		generate.mockResolvedValueOnce({ _timedOut: true, job_id: 'gfj_8c1d4e2a', eta_remaining_seconds: 90 });
		const r = await call('forge_free', { prompt: 'a red ceramic teapot' });
		expect(r.structuredContent.status).toBe('pending');
		expect(r.structuredContent.viewer_url).toBe('https://three.ws/viewer?job=gfj_8c1d4e2a');
		expect(r.content[0].text).toContain(r.structuredContent.viewer_url);
		// No GLB exists yet, so nothing pretends one does.
		expect(r.structuredContent.glb_url).toBeUndefined();
		expect(r.structuredContent.poster_png_url).toBeUndefined();
	});
});

describe('catalog results carry the four links', () => {
	it('search_catalog states them for every model in plain text and in structuredContent', async () => {
		const r = await call('search_catalog', { limit: 10 });
		const items = r.structuredContent.items;
		const chair = items.find((i) => i.id === 'object:ArmChair_01');
		const abe = items.find((i) => i.id === 'character:abe');
		const clip = items.find((i) => i.kind === 'animation');
		expectLinks(chair, { glb: FIXTURE_CATALOG_ROWS.object.url, embed: 'prop' });
		expectLinks(abe, { glb: FIXTURE_CATALOG_ROWS.character.url, embed: 'avatar' });
		// A motion clip is JSON, not a model: it carries no model links.
		for (const key of LINK_KEYS) expect(clip[key]).toBeUndefined();

		const text = r.content[0].text;
		for (const item of [chair, abe]) {
			const block = text.slice(text.indexOf(`\`${item.id}\``));
			expectLinksInText(block, item);
		}
	});

	it('get_catalog_item leads its text with the links', async () => {
		const r = await call('get_catalog_item', { id: 'object:ArmChair_01' });
		expectLinks(r.structuredContent, { glb: FIXTURE_CATALOG_ROWS.object.url, embed: 'prop' });
		expectLinksInText(r.content[0].text, r.structuredContent);
		// The existing site links survive alongside.
		expect(r.structuredContent.links.download).toBe(FIXTURE_CATALOG_ROWS.object.url);
	});

	it('get_item_source carries them in both the single and the all-frameworks form', async () => {
		const one = await call('get_item_source', { id: 'character:abe' });
		expectLinks(one.structuredContent, { glb: FIXTURE_CATALOG_ROWS.character.url, embed: 'avatar' });
		expectLinksInText(one.content[0].text, one.structuredContent);
		const all = await call('get_item_source', { id: 'object:ArmChair_01', framework: 'all' });
		expectLinks(all.structuredContent, { glb: FIXTURE_CATALOG_ROWS.object.url, embed: 'prop' });
		expectLinksInText(all.content[0].text, all.structuredContent);
	});
});

describe('persona results carry the four links', () => {
	const PERSONA_GLB = `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/personas/${PERSONA_ID}.glb`;
	const record = {
		id: PERSONA_ID,
		name: 'Sir Teapot',
		glb_url: PERSONA_GLB,
		look: { rigged: true, mesh_count: 1, animation_count: 0 },
		turn_count: 2,
	};

	// A real, minimal binary glTF: header plus one JSON chunk.
	function minimalGlb() {
		const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(28, ' '), 'utf8');
		const header = Buffer.alloc(12);
		header.writeUInt32LE(0x46546c67, 0);
		header.writeUInt32LE(2, 4);
		header.writeUInt32LE(12 + 8 + json.length, 8);
		const chunk = Buffer.alloc(8);
		chunk.writeUInt32LE(json.length, 0);
		chunk.writeUInt32LE(0x4e4f534a, 4);
		return Buffer.concat([header, chunk, json]);
	}

	it('create_agent_persona', async () => {
		const glb = minimalGlb();
		fetchSafePublicUrlPinned.mockResolvedValueOnce(new Response(glb, { status: 200 }));
		createPersona.mockResolvedValueOnce(record);
		const r = await call('create_agent_persona', { glb_url: RIGGED_GLB, name: 'Sir Teapot' });
		expect(r.isError).toBeFalsy();
		expectLinks(r.structuredContent, { glb: PERSONA_GLB, embed: 'avatar' });
		expectLinksInText(r.content[0].text, r.structuredContent);
		expect(r.structuredContent.embed_url).toContain(PERSONA_ID);
	});

	it('get_agent_persona', async () => {
		getPersona.mockResolvedValueOnce(record);
		const r = await call('get_agent_persona', { persona_id: PERSONA_ID });
		expectLinks(r.structuredContent, { glb: PERSONA_GLB, embed: 'avatar' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});

	it('persona_say', async () => {
		getPersona.mockResolvedValueOnce(record);
		const r = await call('persona_say', { persona_id: PERSONA_ID, text: 'Tea is ready.' });
		expectLinks(r.structuredContent, { glb: PERSONA_GLB, embed: 'avatar' });
		expectLinksInText(r.content[0].text, r.structuredContent);
	});
});
