#!/usr/bin/env node
// Gate for the unified MCP endpoint (https://three.ws/mcp, api/mcp/all.js).
//
// Builds the same registry the server boots with and fails on:
//   - a boot problem: two servers publishing one unified name, a name MCP
//     clients reject, a SHADOWED entry that no longer matches a duplicate;
//   - a tool with no group and tier in packages/mcp-policy/src/table.js;
//   - a hosted server's tool missing from the registry (a source silently
//     dropped);
//   - a stale `unified` block in public/tools.json (run `npm run build:mcp-catalog`);
//   - the /mcp route missing from vercel.json.
//
//   node scripts/check-mcp-tools.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRegistry, bootProblems, summarize } from '../api/_mcpall/registry.js';
import { makeOwnTools } from '../api/_mcpall/own-tools.js';
import { SOURCES } from '../api/_mcpall/sources.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

const registry = buildRegistry({ ownTools: makeOwnTools(() => registry) });
for (const p of registry.problems) failures.push(`${p.kind}: ${p.message}`);

const mounted = new Set(registry.tools.flatMap((t) => [`${t.source}:${t.legacyName}`, ...t.alsoOn.map((s) => `${s}:${t.legacyName}`)]));
for (const source of SOURCES) {
	for (const tool of source.tools()) {
		const legacy = tool.def?.name;
		const shadowed = registry.tools.some((t) => t.legacyName === legacy && t.alsoOn.includes(source.id));
		if (!mounted.has(`${source.id}:${legacy}`) && !shadowed) {
			failures.push(`${source.id}: tool "${legacy}" is not in the unified registry`);
		}
	}
}

const { $comment: _a, ...want } = summarize(registry);
try {
	const { $comment: _b, ...have } = JSON.parse(readFileSync(join(ROOT, 'public', 'tools.json'), 'utf8')).unified || {};
	if (JSON.stringify(have) !== JSON.stringify(JSON.parse(JSON.stringify(want)))) {
		failures.push(`public/tools.json "unified" block is stale (registry has ${want.tool_count} tools, file says ${have.tool_count ?? 'none'}). Run: npm run build:mcp-catalog`);
	}
} catch (err) {
	failures.push(`public/tools.json unreadable: ${err.message}`);
}

const routes = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).routes || [];
if (!routes.some((r) => r.dest === '/api/mcp/all')) failures.push('vercel.json has no route to /api/mcp/all');

if (failures.length) {
	console.error(`[check:mcp-tools] ${failures.length} problem(s):`);
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log(`[check:mcp-tools] unified registry ok: ${want.tool_count} tools in ${want.groups.length} groups from ${SOURCES.length} servers`);
process.exit(0);
