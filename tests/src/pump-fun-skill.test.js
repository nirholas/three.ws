// Validates the pump-fun skill bundle is internally consistent: manifest tools
// list, tools.json schemas, and handlers.js exports all match.

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(__dirname, '../../public/skills/pump-fun');

async function readJSON(rel) {
	return JSON.parse(await readFile(resolve(BUNDLE, rel), 'utf8'));
}

describe('pump-fun skill bundle', () => {
	it('manifest declares 10 tools and matches tools.json', async () => {
		const manifest = await readJSON('manifest.json');
		const toolsJSON = await readJSON('tools.json');

		expect(manifest.name).toBe('pump-fun');
		expect(manifest.spec).toBe('skill/0.1');
		expect(manifest.provides.tools).toHaveLength(10);

		const declared = new Set(manifest.provides.tools);
		const defined = new Set(toolsJSON.tools.map((t) => t.name));
		expect(defined).toEqual(declared);
	});

	it('every tool has an input schema', async () => {
		const { tools } = await readJSON('tools.json');
		for (const t of tools) {
			expect(t.description).toBeTruthy();
			expect(t.input_schema?.type).toBe('object');
		}
	});

	it('handlers.js exports every declared tool', async () => {
		const handlers = await import(resolve(BUNDLE, 'handlers.js'));
		const manifest = await readJSON('manifest.json');
		for (const tool of manifest.provides.tools) {
			expect(typeof handlers[tool]).toBe('function');
		}
	});

	it('skill is listed in the public skills index', async () => {
		const indexPath = resolve(__dirname, '../../public/skills-index.json');
		const index = JSON.parse(await readFile(indexPath, 'utf8'));
		const entry = index.find((s) => s.id === 'pump-fun');
		expect(entry).toBeDefined();
		expect(entry.uri).toBe('skills/pump-fun/');
	});

	it('handlers proxy through ctx.fetch with JSON-RPC tools/call shape', async () => {
		const handlers = await import(resolve(BUNDLE, 'handlers.js'));
		let captured;
		const ctx = {
			fetch: async (url, opts) => {
				captured = { url, body: JSON.parse(opts.body) };
				return {
					ok: true,
					json: async () => ({
						jsonrpc: '2.0',
						id: captured.body.id,
						result: { content: [{ type: 'text', text: '{"hits":[]}' }] },
					}),
				};
			},
			memory: { note: () => {} },
		};
		const result = await handlers.searchTokens({ query: 'pepe', limit: 3 }, ctx);
		expect(result.ok).toBe(true);
		expect(result.data).toEqual({ hits: [] });
		expect(captured.body.method).toBe('tools/call');
		expect(captured.body.params.name).toBe('searchTokens');
		expect(captured.body.params.arguments).toEqual({ query: 'pepe', limit: 3 });
	});

	it('handlers return { ok:false } on non-2xx responses', async () => {
		const handlers = await import(resolve(BUNDLE, 'handlers.js'));
		const ctx = {
			fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }),
			memory: { note: () => {} },
		};
		const result = await handlers.getTrendingTokens({}, ctx);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/502/);
	});
});
