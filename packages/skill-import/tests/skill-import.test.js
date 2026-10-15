// Serves a synthetic OpenAPI fixture from a real local HTTP server, generates
// a bundle, validates it, loads it into src/skills/index.js's SkillRegistry
// (the real skill runtime, see specs/SKILL_SPEC.md), and calls a generated
// handler against the same local server to prove ctx.fetch actually works.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { importFromUrl, validateBundle, generateDeclarativeBundle } from '../src/index.js';
import { SkillRegistry } from '../../../src/skills/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEY = 'test-key';

let server;
let baseUrl;
let bundle;
const widgets = new Map([['seed-1', { id: 'seed-1', title: 'Widget One' }]]);

function requireApiKey(req, res) {
	if (req.headers['x-api-key'] !== API_KEY) {
		res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'missing or wrong api key' }));
		return false;
	}
	return true;
}

beforeAll(async () => {
	server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');

		if (req.method === 'GET' && url.pathname === '/openapi.json') {
			const spec = await readFile(resolve(__dirname, 'fixtures/sample-openapi.json'), 'utf8');
			res.writeHead(200, { 'content-type': 'application/json' }).end(spec);
			return;
		}

		if (url.pathname.startsWith('/bundle/') && bundle) {
			const file = url.pathname.slice('/bundle/'.length);
			const byFile = {
				'manifest.json': JSON.stringify(bundle.manifest),
				'SKILL.md': bundle.skillMd,
				'tools.json': JSON.stringify(bundle.tools),
				'handlers.js': bundle.handlersSrc,
			};
			if (byFile[file] !== undefined) {
				res.writeHead(200, { 'content-type': 'application/json' }).end(byFile[file]);
				return;
			}
			res.writeHead(404).end();
			return;
		}

		if (req.method === 'POST' && url.pathname === '/widgets') {
			if (!requireApiKey(req, res)) return;
			let raw = '';
			for await (const chunk of req) raw += chunk;
			const data = JSON.parse(raw);
			const id = randomUUID();
			const widget = { id, title: data.title };
			widgets.set(id, widget);
			res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(widget));
			return;
		}

		const getMatch = req.method === 'GET' && url.pathname.match(/^\/widgets\/([^/]+)$/);
		if (getMatch) {
			if (!requireApiKey(req, res)) return;
			const widget = widgets.get(getMatch[1]);
			if (!widget) {
				res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
				return;
			}
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(widget));
			return;
		}

		res.writeHead(404).end();
	});
	await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
	bundle = await importFromUrl(`${baseUrl}/openapi.json`, { fetchUrl: fetch });
});

afterAll(() => new Promise((resolveClose) => server.close(resolveClose)));

describe('importFromUrl against a synthetic OpenAPI fixture', () => {
	it('generates a manifest, tools.json and handlers.js that pass validation', () => {
		expect(bundle.manifest.spec).toBe('skill/0.1');
		expect(new Set(bundle.manifest.provides.tools)).toEqual(new Set(['createWidget', 'getWidget']));
		expect(bundle.manifest.requires.secrets).toEqual(['AUTH_APIKEY']);

		const toolNames = new Set(bundle.tools.tools.map((t) => t.name));
		expect(toolNames).toEqual(new Set(['createWidget', 'getWidget']));
		for (const tool of bundle.tools.tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.input_schema.type).toBe('object');
		}

		expect(validateBundle(bundle)).toEqual([]);
	});

	it('loads into the real skill runtime (SkillRegistry.install)', async () => {
		const registry = new SkillRegistry();
		const skill = await registry.install({ uri: `${baseUrl}/bundle/` });

		expect(skill.manifest.name).toBe(bundle.manifest.name);
		expect(new Set(skill.tools.map((t) => t.name))).toEqual(new Set(['createWidget', 'getWidget']));
		expect(skill.instructions).toContain('createWidget');
		// Not a trusted-main-thread bundle: handler source is kept as text for the sandbox worker.
		expect(skill.handlersSrc).toBe(bundle.handlersSrc);
		expect(skill.handlers).toEqual({});
	});

	it('generated handlers.js makes real HTTP calls that round-trip through the fixture server', async () => {
		const file = resolve(tmpdir(), `skill-import-handlers-${randomUUID()}.mjs`);
		await writeFile(file, bundle.handlersSrc);
		try {
			const handlers = await import(/* @vite-ignore */ file);
			const ctx = { fetch, secrets: { AUTH_APIKEY: API_KEY } };

			const created = await handlers.createWidget({ body: { title: 'Lamp' } }, ctx);
			expect(created.title).toBe('Lamp');
			expect(created.id).toBeTruthy();

			const fetched = await handlers.getWidget({ id: created.id }, ctx);
			expect(fetched).toEqual(created);

			await expect(handlers.getWidget({ id: created.id }, { fetch, secrets: {} })).rejects.toThrow(/missing secret/);
		} finally {
			await rm(file, { force: true });
		}
	});
});

describe('declarative bundles (README-only repos)', () => {
	it('never produces tools.json or handlers.js', () => {
		const { manifest, skillMd } = generateDeclarativeBundle({
			repoName: 'example-docs',
			readmeText: '# Example\n\nJust documentation, no API.',
			sourceUrl: 'https://github.com/example/example-docs',
		});
		expect(manifest.provides.tools).toEqual([]);
		expect(validateBundle({ manifest, skillMd })).toEqual([]);
		expect(validateBundle({ manifest, skillMd, tools: { tools: [] } })).not.toEqual([]);
	});
});
