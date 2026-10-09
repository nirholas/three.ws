// The public MCP directory at /.well-known/mcp.json is what an agent fetches to
// learn which three.ws servers exist and, through its `clients` block, how to
// connect each AI client to them without a human. This pins its shape and
// checks that every three.ws URL it names is actually served, resolved with the
// production resolver (server/route-resolve.mjs) over vercel.json, so a renamed
// handler or a dropped route fails here instead of in an agent's setup run.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { loadRouteTable, resolvePhase1, resolveApiHandler } from '../server/route-resolve.mjs';
import { slugForEndpoint, grokAuthFor } from '../src/grok-connector.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = 'https://three.ws';
const directory = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/.well-known/mcp.json'), 'utf8'));
const { phase1Routes } = loadRouteTable(path.join(ROOT, 'vercel.json'));
const API_ROOT = path.join(ROOT, 'api');
const pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pages.json'), 'utf8'));
const pagePaths = new Set(pages.sections.flatMap((s) => s.pages.map((p) => p.path)));

const CLIENTS = ['claude', 'chatgpt', 'cursor', 'vscode', 'grok-bot'];
const AUTH_MODES = new Set(['none', 'oauth', 'api-key']);
const endpoints = new Set(directory.servers.map((s) => s.endpoint));

// After the phase-1 rewrites, the filesystem phase serves a page or a public/
// file. These are the source locations each of those comes from.
function staticServed(pathname) {
	const rel = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
	if (pagePaths.has(`/${rel}`)) return true;
	return [`public/${rel}`, `pages/${rel}`, rel].some((c) => {
		const full = path.join(ROOT, c);
		return fs.existsSync(full) && fs.statSync(full).isFile();
	});
}

/** Does production answer this three.ws URL with a handler, page or file? */
function served(raw) {
	const url = new URL(raw);
	const r = resolvePhase1(phase1Routes, { headers: {}, method: 'GET' }, url);
	if (r.terminal === 'status') return r.status < 400;
	if (r.terminal === 'external') return true;
	if (r.status && r.status >= 400) return false;
	if (r.path.startsWith('/api/')) return Boolean(resolveApiHandler(API_ROOT, r.path));
	if (!staticServed(r.path)) return false;
	// /docs/<slug> is one shell page that fetches the doc; without the doc it 404s.
	const doc = url.pathname.match(/^\/docs\/([a-z0-9-]+)\/?$/);
	return doc ? fs.existsSync(path.join(ROOT, 'docs', `${doc[1]}.md`)) : true;
}

/** Every https://three.ws URL anywhere in a JSON value. */
function siteUrls(value, out = new Set()) {
	if (typeof value === 'string') {
		for (const m of value.matchAll(/https:\/\/three\.ws[^\s"',)]*/g)) out.add(m[0].replace(/[.;:]+$/, ''));
	} else if (value && typeof value === 'object') {
		for (const v of Object.values(value)) siteUrls(v, out);
	}
	return out;
}

describe('/.well-known/mcp.json shape', () => {
	it('carries the top-level directory fields', () => {
		for (const key of ['name', 'description', 'website', 'documentation', 'setup', 'llms', 'servers', 'clients']) {
			expect(directory, key).toHaveProperty(key);
		}
		expect(directory.website).toBe(SITE);
		expect(Array.isArray(directory.servers) && directory.servers.length > 0).toBe(true);
	});

	it('describes every server with the fields clients read', () => {
		for (const s of directory.servers) {
			for (const field of ['name', 'endpoint', 'transport', 'auth', 'description', 'documentation']) {
				expect(typeof s[field], `${s.name}.${field}`).toBe('string');
			}
			expect(s.endpoint.startsWith(`${SITE}/`), s.endpoint).toBe(true);
			expect(s.transport, s.name).toBe('streamable-http');
			if (s.signIn) expect(s.signIn.startsWith(s.endpoint), s.name).toBe(true);
		}
		expect(endpoints.size, 'an endpoint is listed twice').toBe(directory.servers.length);
	});

	it('gives setup for every supported client', () => {
		expect(typeof directory.clients.$comment).toBe('string');
		for (const id of CLIENTS) expect(directory.clients, id).toHaveProperty(id);
	});

	for (const [id, client] of Object.entries(directory.clients).filter(([k]) => !k.startsWith('$'))) {
		describe(`client ${id}`, () => {
			it('names a listed server, a known auth mode, steps and a setup page', () => {
				expect(typeof client.name).toBe('string');
				expect(endpoints.has(client.server), client.server).toBe(true);
				expect(AUTH_MODES.has(client.auth), client.auth).toBe(true);
				expect(client.settings || client.command, 'settings or command').toBeTruthy();
				expect(Array.isArray(client.steps) && client.steps.length > 0).toBe(true);
				expect(client.setup).toMatch(/^https:\/\/three\.ws\/connect\?client=[a-z-]+$/);
				for (const alt of client.alternatives ?? []) expect(AUTH_MODES.has(alt.auth), alt.auth).toBe(true);
			});

			it('puts the recommended server in its settings and install link', () => {
				const text = JSON.stringify({ settings: client.settings, command: client.command });
				expect(text.includes(client.server), 'settings name the server').toBe(true);
				if (!client.installLink) return;
				const link = client.installLink;
				if (link.startsWith('cursor://')) {
					const config = new URL(link).searchParams.get('config');
					expect(JSON.parse(Buffer.from(config, 'base64').toString()).url).toBe(client.server);
				} else if (link.startsWith('vscode:')) {
					expect(JSON.parse(decodeURIComponent(link.slice(link.indexOf('?') + 1))).url).toBe(client.server);
				} else {
					expect(decodeURIComponent(link).includes(client.server), link).toBe(true);
				}
			});
		});
	}

	it('gives Grok Bot the exact connector form the /connect card shows', () => {
		const grok = directory.clients['grok-bot'];
		const server = directory.servers.find((s) => s.endpoint === grok.server);
		expect(grok.settings.Name).toBe(slugForEndpoint(grok.server));
		expect(grok.settings['Server URL']).toBe(grok.server);
		expect(grok.settings.Transport).toBe('Streamable HTTP');
		expect(grok.auth).toBe(grokAuthFor(server));
		expect(grok.say).toContain(grok.server);
		const oauth = grok.alternatives.find((a) => a.auth === 'oauth');
		expect(oauth.url).toBe(server.signIn);
	});
});

describe('/.well-known/mcp.json routing', () => {
	const urls = [...siteUrls(directory)];

	it('names three.ws URLs to check', () => {
		expect(urls.length).toBeGreaterThan(directory.servers.length);
	});

	it.each(urls)('%s is served', (url) => {
		expect(served(url)).toBe(true);
	});
});
