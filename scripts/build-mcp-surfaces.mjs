#!/usr/bin/env node
// Publish each hosted MCP server's resources and guided prompts into its
// registry manifest (server*.json) and into the public directory at
// public/.well-known/mcp.json.
//
// Both lists are read from the code that serves them, never typed by hand:
// resources and templates from api/_mcp/resources.js, prompts from
// api/_mcp/prompts.js rendered against each server's real tools/list catalog
// (a prompt is only offered where every tool it names exists). Registry
// manifests carry them under _meta["io.modelcontextprotocol.registry/publisher-provided"],
// the slot the official server.json schema reserves for publisher metadata.
//
// Run: node scripts/build-mcp-surfaces.mjs          (write)
//      node scripts/build-mcp-surfaces.mjs --check  (exit 1 if any file is stale)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const PUBLISHER_KEY = 'io.modelcontextprotocol.registry/publisher-provided';

const SERVERS = [
	{ id: 'mcp', manifest: 'server.json', endpoint: 'https://three.ws/api/mcp', catalog: '../api/_mcp/catalog.js' },
	{ id: 'mcp-agent', manifest: 'server-agent.json', endpoint: 'https://three.ws/api/mcp-agent', catalog: '../api/_mcpagent/catalog.js' },
	{ id: 'mcp-3d', manifest: 'server-3d.json', endpoint: 'https://three.ws/api/mcp-3d', catalog: '../api/_mcp3d/catalog.js' },
	{ id: 'mcp-bazaar', manifest: 'server-bazaar.json', endpoint: 'https://three.ws/api/mcp-bazaar', catalog: '../api/_mcpbazaar/catalog.js' },
];

const { resourcesFor } = await import('../api/_mcp/resources.js');
const { promptsFor } = await import('../api/_mcp/prompts.js');

async function surfaceFor(server) {
	const { TOOL_CATALOG } = await import(server.catalog);
	const defs = resourcesFor(server.id);
	return {
		resources: defs.filter((d) => d.uri).map((d) => ({ uri: d.uri, name: d.name, title: d.title, mimeType: 'application/json' })),
		resourceTemplates: defs
			.filter((d) => d.uriTemplate)
			.map((d) => ({ uriTemplate: d.uriTemplate, name: d.name, title: d.title, mimeType: 'application/json' })),
		prompts: promptsFor(server.id, TOOL_CATALOG).map((p) => ({
			name: p.name,
			title: p.title,
			arguments: p.arguments.map((a) => a.name),
		})),
	};
}

async function formatted(path, value) {
	const options = (await prettier.resolveConfig(join(ROOT, path))) || {};
	return prettier.format(JSON.stringify(value, null, '\t'), { ...options, filepath: join(ROOT, path) });
}

const stale = [];
async function emit(path, value) {
	const next = await formatted(path, value);
	const current = readFileSync(join(ROOT, path), 'utf8');
	if (current === next) return;
	if (CHECK) stale.push(path);
	else writeFileSync(join(ROOT, path), next);
}

const surfaces = new Map();
for (const server of SERVERS) surfaces.set(server.endpoint, await surfaceFor(server));

for (const server of SERVERS) {
	const manifest = JSON.parse(readFileSync(join(ROOT, server.manifest), 'utf8'));
	const surface = surfaces.get(server.endpoint);
	manifest._meta = {
		...(manifest._meta || {}),
		[PUBLISHER_KEY]: {
			...(manifest._meta?.[PUBLISHER_KEY] || {}),
			resources: surface.resources,
			resourceTemplates: surface.resourceTemplates,
			prompts: surface.prompts,
		},
	};
	await emit(server.manifest, manifest);
}

const dirPath = 'public/.well-known/mcp.json';
const directory = JSON.parse(readFileSync(join(ROOT, dirPath), 'utf8'));
for (const entry of directory.servers || []) {
	const surface = surfaces.get(entry.endpoint);
	if (!surface) continue;
	entry.resources = surface.resources.map((r) => r.uri);
	entry.resourceTemplates = surface.resourceTemplates.map((r) => r.uriTemplate);
	entry.prompts = surface.prompts.map((p) => p.name);
}
await emit(dirPath, directory);

if (stale.length) {
	console.error(`MCP resource/prompt listings are stale in: ${stale.join(', ')}\nRun: node scripts/build-mcp-surfaces.mjs`);
	process.exit(1);
}
console.log(CHECK ? 'MCP resource/prompt listings are current.' : 'Wrote MCP resource/prompt listings.');
process.exit(0);
