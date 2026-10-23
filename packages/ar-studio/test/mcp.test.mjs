// The MCP tools are the agent-facing contract. These tests run them against
// injected fakes so the suite stays offline and deterministic; the shapes they
// assert are the ones the real server returns.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTools, readEnv, renderPage, sceneUrl } from '../mcp/tools.js';
import { createServer } from '../mcp/index.js';

const ENV = readEnv({ AR_STUDIO_PAGE_URL: 'https://acme.com/ar/', AR_STUDIO_ORIGIN: 'https://three.ws' });
const byName = (tools, name) => tools.find((t) => t.name === name);

test('every tool is registered with a schema and honest annotations', () => {
	const tools = createTools({ env: ENV });
	assert.deepEqual(tools.map((t) => t.name).sort(), [
		'check_generation', 'compose_ar_scene', 'create_ar_page',
		'export_ar', 'generate_3d_model', 'search_models',
	]);
	for (const tool of tools) {
		assert.ok(tool.description.length > 80, `${tool.name} needs a description an agent can act on`);
		assert.ok(tool.schema && typeof tool.schema === 'object', `${tool.name} needs an input schema`);
		assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} must declare readOnlyHint`);
	}
	// Only generation is a write; everything else must say so.
	const writes = tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
	assert.deepEqual(writes, ['generate_3d_model']);
});

test('the server builds and registers its tools', async () => {
	const server = createServer({ env: { AR_STUDIO_PAGE_URL: 'https://acme.com/ar/' } });
	assert.ok(server);
});

test('compose_ar_scene returns one link that carries the whole arrangement', async () => {
	const tool = byName(createTools({ env: ENV }), 'compose_ar_scene');
	const res = await tool.run({
		models: [
			{ src: 'https://a.com/lamp.glb', title: 'Lamp', x: 0, z: -1.4 },
			{ src: 'https://a.com/fern.glb', title: 'Fern', x: 0.9, z: -1.2, scale: 1.3 },
		],
		title: 'Living room',
	});
	assert.ok(!res.isError);
	assert.match(res.structuredContent.sceneUrl, /^https:\/\/acme\.com\/ar\/\?src=.*#s=/);
	assert.equal(res.structuredContent.models.length, 2);
	assert.equal(res.structuredContent.models[1].scale, 1.3);
});

test('compose_ar_scene skips unusable models and says so, but still builds a scene', async () => {
	const tool = byName(createTools({ env: ENV }), 'compose_ar_scene');
	const res = await tool.run({ models: [{ src: 'https://a.com/ok.glb' }, { src: 'javascript:alert(1)' }] });
	assert.ok(!res.isError);
	assert.equal(res.structuredContent.models.length, 1);
	assert.equal(res.structuredContent.skipped.length, 1);
	assert.match(res.content[0].text, /skipped/);
});

test('compose_ar_scene fails cleanly when nothing is placeable', async () => {
	const tool = byName(createTools({ env: ENV }), 'compose_ar_scene');
	const res = await tool.run({ models: [{ src: 'http://a.com/x.glb' }] });
	assert.equal(res.isError, true);
	assert.match(res.structuredContent.message, /https \.glb/);
});

test('export_ar names the viewer the caller\'s device will actually open', async () => {
	const tool = byName(createTools({ env: ENV }), 'export_ar');
	const res = await tool.run({
		glb_url: 'https://a.com/x.glb',
		title: 'Crate',
		user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
	});
	assert.equal(res.structuredContent.target, 'ios');
	assert.match(res.content[0].text, /Quick Look/);
	assert.ok(res.structuredContent.arLaunchUrl.startsWith('https://three.ws/api/ar?src='));
});

test('export_ar refuses a URL no AR viewer could open', async () => {
	const tool = byName(createTools({ env: ENV }), 'export_ar');
	const res = await tool.run({ glb_url: 'https://a.com/photo.png' });
	assert.equal(res.isError, true);
	assert.match(res.structuredContent.message, /\.glb/);
});

test('generate_3d_model refuses a disallowed prompt before doing any work', async () => {
	let called = false;
	const forge = { generate: async () => { called = true; }, mcp: {} };
	const tool = byName(createTools({ env: ENV, forge }), 'generate_3d_model');
	const res = await tool.run({ prompt: 'a nude figure' });
	assert.equal(res.isError, true);
	assert.equal(called, false, 'the safety gate must run before the generator');
});

test('generate_3d_model hands back links, not just a file', async () => {
	const forge = {
		generate: async (prompt) => ({ src: 'https://cdn.example.com/out.glb', title: 'A lamp', prompt, rigged: false }),
		mcp: {},
	};
	const tool = byName(createTools({ env: ENV, forge }), 'generate_3d_model');
	const res = await tool.run({ prompt: 'a brass desk lamp' });
	assert.ok(!res.isError);
	const c = res.structuredContent;
	assert.equal(c.glbUrl, 'https://cdn.example.com/out.glb');
	assert.ok(c.arLaunchUrl.includes('/api/ar?src='));
	assert.ok(c.studioUrl.startsWith('https://acme.com/ar/?src='));
	assert.match(res.content[0].text, /Open it in your room/);
});

test('search_models filters a real catalogue payload', async (t) => {
	const catalogue = {
		objects: [
			{ url: 'https://pub-abc.r2.dev/o/wrench.glb', label: 'Adjustable Wrench', categories: ['tools'] },
			{ url: 'https://pub-abc.r2.dev/o/fern.glb', label: 'Potted Fern', categories: ['plants'] },
		],
	};
	const original = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, json: async () => catalogue });
	t.after(() => { globalThis.fetch = original; });

	const tool = byName(createTools({ env: ENV }), 'search_models');
	const hit = await tool.run({ query: 'plants' });
	assert.equal(hit.structuredContent.matched, 1);
	assert.equal(hit.structuredContent.models[0].title, 'Potted Fern');
	// Bucket URLs are rewritten onto the CORS-open first-party path.
	assert.ok(hit.structuredContent.models[0].src.startsWith('https://three.ws/cdn/'));

	const miss = await tool.run({ query: 'spaceship' });
	assert.ok(!miss.isError, 'no matches is an answer, not an error');
	assert.equal(miss.structuredContent.matched, 0);
	assert.match(miss.content[0].text, /generate_3d_model/);
});

test('create_ar_page emits a page that runs as written', async () => {
	const tool = byName(createTools({ env: ENV }), 'create_ar_page');
	const res = await tool.run({ title: 'Acme AR', assets: 'https://acme.com/models.json', models: [{ src: 'https://a.com/x.glb' }] });
	const html = res.structuredContent.html;
	assert.match(html, /^<!doctype html>/);
	assert.match(html, /createArStudio/);
	assert.match(html, /https:\/\/acme\.com\/models\.json/);
	assert.match(html, /https:\/\/a\.com\/x\.glb/);
	// No unreplaced template tokens ever reach a user's file.
	assert.ok(!html.includes('__'), 'the emitted page must not contain template placeholders');
});

test('renderPage escapes a title that contains markup', () => {
	assert.match(renderPage({ title: '</title><script>alert(1)</script>' }), /&lt;script&gt;/);
});

test('sceneUrl is stable for the same arrangement', () => {
	const models = [{ src: 'https://a.com/x.glb', title: 'X', x: 1, z: -2, yaw: 0, scale: 1 }];
	assert.equal(sceneUrl(models, 'https://acme.com/ar/'), sceneUrl(models, 'https://acme.com/ar/'));
});
