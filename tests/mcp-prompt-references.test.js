// Every tool, resource and prompt a hosted MCP prompt references exists.
//
// A prompt is a workflow an agent follows verbatim, so a name it points at that
// no server serves is a dead end the user only finds mid-flow. This test holds
// api/_mcp/prompts.js against the live catalogs of every hosted endpoint
// (api/_lib/mcp-census.js loads them from the modules each endpoint answers
// from), in three passes:
//
//   1. Probes: every tool name any prompt checks for with ctx.has / ctx.hasAll,
//      on any server, whether or not that branch renders there, is served by
//      some hosted endpoint. A branch that waits on a tool nobody registered is
//      the failure this catches.
//   2. Renders: every listed prompt, rendered with every argument filled on the
//      server that lists it, names only tools that server publishes and only
//      resources that server can resolve (ctx.tool and ctx.resource throw
//      otherwise), and every prompt it points to by name is listed where the
//      text says it is.
//   3. Source scan: every string-literal tool and resource name in prompts.js,
//      including ones in branches no server takes today, resolves somewhere.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { hostedServers } from '../api/_lib/mcp-census.js';
import { promptReferences, SERVER_URLS } from '../api/_mcp/prompts.js';
import { matchResource } from '../api/_mcp/resources.js';

const SOURCE = readFileSync(new URL('../api/_mcp/prompts.js', import.meta.url), 'utf8');
const SERVER_BY_URL = new Map(Object.entries(SERVER_URLS).map(([id, url]) => [url, id]));

let servers = [];
let allTools = new Set();
const refs = new Map();

beforeAll(async () => {
	servers = (await hostedServers()).filter((s) => s.promptServer);
	allTools = new Set((await hostedServers()).flatMap((s) => s.tools.map((t) => t.name)));
	for (const s of servers) refs.set(s.promptServer, promptReferences(s.promptServer, s.tools));
}, 120_000);

const listedOn = (server) => new Set(refs.get(server)?.listed || []);

describe('MCP prompt references', () => {
	it('loads every hosted server that serves prompts', () => {
		expect([...refs.keys()].sort()).toEqual(Object.keys(SERVER_URLS).sort());
	});

	it('every tool a prompt checks for is served by some hosted endpoint', () => {
		const dangling = new Set();
		for (const [server, r] of refs) {
			for (const name of r.probed) if (!allTools.has(name)) dangling.add(`${name} (probed on ${server})`);
			for (const p of r.rendered) for (const name of p.probed) if (!allTools.has(name)) dangling.add(`${name} (${server}/${p.name})`);
		}
		expect([...dangling], 'prompts check for tools no server registers').toEqual([]);
	});

	it('every rendered prompt names only tools and resources its own server serves', () => {
		const bad = [];
		for (const s of servers) {
			const names = new Set(s.tools.map((t) => t.name));
			for (const p of refs.get(s.promptServer).rendered) {
				for (const t of p.tools) if (!names.has(t)) bad.push(`${s.promptServer}/${p.name}: tool ${t}`);
				for (const uri of p.resources) if (!matchResource(s.promptServer, uri)) bad.push(`${s.promptServer}/${p.name}: resource ${uri}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('every prompt a rendered prompt points to is listed where it says', () => {
		const bad = [];
		const crossServer = /\((https:\/\/three\.ws\/api\/[a-z0-9-]+)\), prompt `([a-z0-9-]+)`/g;
		const sameServer = /the `([a-z0-9-]+)` prompt/g;
		for (const [server, r] of refs) {
			for (const p of r.rendered) {
				for (const [, url, name] of p.text.matchAll(crossServer)) {
					const target = SERVER_BY_URL.get(url);
					if (!target) bad.push(`${server}/${p.name}: unknown server ${url}`);
					else if (!listedOn(target).has(name)) bad.push(`${server}/${p.name}: ${name} is not listed on ${target}`);
				}
				for (const [, name] of p.text.matchAll(sameServer)) {
					if (!listedOn(server).has(name)) bad.push(`${server}/${p.name}: ${name} is not listed on ${server}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('every literal tool, resource and prompt name in prompts.js resolves', () => {
		const bad = [];
		const toolCalls = /(?:ctx\.(?:has|tool|confirmFlag)|spendStep\(ctx,)\s*\(?\s*'([a-z0-9_]+)'/g;
		for (const [, name] of SOURCE.matchAll(toolCalls)) if (!allTools.has(name)) bad.push(`tool ${name}`);
		for (const [, list] of SOURCE.matchAll(/ctx\.hasAll\(([^)]*)\)/g)) {
			for (const [, name] of list.matchAll(/'([a-z0-9_]+)'/g)) if (!allTools.has(name)) bad.push(`tool ${name}`);
		}
		for (const [, uri] of SOURCE.matchAll(/ctx\.(?:resource|hasResource)\('(three:\/\/[^']+)'\)/g)) {
			if (!servers.some((s) => matchResource(s.promptServer, uri))) bad.push(`resource ${uri}`);
		}
		for (const [, server, name] of SOURCE.matchAll(/elsewhere\('([a-z0-9-]+)', '([a-z0-9-]+)'\)/g)) {
			if (!SERVER_URLS[server]) bad.push(`server ${server}`);
			else if (!listedOn(server).has(name)) bad.push(`prompt ${name} on ${server}`);
		}
		expect(bad).toEqual([]);
	});
});
