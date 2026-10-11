// Every tool on every three.ws MCP server is deliberately annotated and says
// when to use it.
//
// scripts/lib/mcp-enumerate.mjs loads all of them: the hosted endpoints from
// the exact modules each one answers tools/list from, and every stdio server
// (mcp-server plus each packages/*-mcp package) built in-process and asked over
// an in-memory MCP transport. So this test sees the wire payload a client sees.
//
// Two rules, no allowlist:
//   1. All four hints (readOnlyHint, destructiveHint, idempotentHint,
//      openWorldHint) are explicit booleans. The MCP spec defaults an omitted
//      destructiveHint to TRUE and an omitted openWorldHint to TRUE, so a missing
//      hint is a claim nobody made on purpose.
//   2. The description carries a when-to-use sentence (WHEN_TO_USE_RE in
//      api/_lib/mcp-census.js). Agents choose tools from descriptions alone; the
//      sentence that says when this tool is the right one is what they choose by.

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { allServers } from '../scripts/lib/mcp-enumerate.mjs';
import { WHEN_TO_USE_RE } from '../api/_lib/mcp-census.js';

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

let servers = [];

beforeAll(async () => {
	servers = await allServers();
}, 120_000);

describe('MCP tool quality across every server', () => {
	it('loads every hosted endpoint and every MCP package that ships a server', () => {
		const ids = new Set(servers.map((s) => s.id));
		for (const id of ['mcp', 'mcp-agent', 'mcp-3d', 'mcp-bazaar', 'ibm-mcp', 'mcp-studio', 'mcp-chatgpt', 'mcp-grok', 'pump-fun-mcp', 'three-ws-mcp-server']) {
			expect(ids.has(id), `${id} not enumerated`).toBe(true);
		}
		const packages = readdirSync('packages').filter((d) => d.endsWith('-mcp') && existsSync(`packages/${d}/src/index.js`) && d !== 'spatial-mcp');
		for (const dir of packages) expect(ids.has(dir), `packages/${dir} not enumerated`).toBe(true);
	});

	it('every server serves at least one tool, each with a unique name', () => {
		for (const s of servers) {
			expect(s.tools.length, `${s.id}: no tools`).toBeGreaterThan(0);
			const names = s.tools.map((t) => t.name);
			expect(new Set(names).size, `${s.id}: duplicate tool names`).toBe(names.length);
		}
	});

	it('every tool sets all four annotation hints as explicit booleans', () => {
		const missing = [];
		for (const s of servers) {
			for (const t of s.tools) {
				const gaps = HINTS.filter((h) => typeof t.annotations?.[h] !== 'boolean');
				if (gaps.length) missing.push(`${s.id}:${t.name} (${gaps.join(', ')})`);
			}
		}
		expect(missing, `tools with unset hints:\n${missing.join('\n')}`).toEqual([]);
	});

	it('no read-only tool claims to be destructive', () => {
		const bad = [];
		for (const s of servers) {
			for (const t of s.tools) {
				if (t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true) bad.push(`${s.id}:${t.name}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('every tool description says when to use it', () => {
		const missing = [];
		for (const s of servers) {
			for (const t of s.tools) {
				if (!WHEN_TO_USE_RE.test(String(t.description || ''))) missing.push(`${s.id}:${t.name}`);
			}
		}
		expect(missing, `descriptions without a when-to-use sentence ("Use this when ...", "Use this to ...", "Call this first ..."):\n${missing.join('\n')}`).toEqual([]);
	});
});
