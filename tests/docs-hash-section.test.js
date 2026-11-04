// Docs reader: a bare "#section" hash on the doc already on screen.
//
// The reader hash-routes docs (`#<doc>`, with in-page sections written as
// `#<doc>@<section>`). On first load a bare `/docs/mcp-studio#any-mcp-client`
// already meant "that doc, that section". After boot it did not: editing the
// address bar from one section of the open doc to another, or following a
// hand-written `#section` link, fired hashchange, the router read the section
// as a doc name, fetched /docs/any-mcp-client.md, got a 404, and replaced the
// page the reader was on with the "doc not found" panel. Every live "Send"
// block on the page went with it, which is how the studio-jobs X proof reel
// found it ("nothing visible matches Send POST").
//
// The router is inline in docs/index.html, so this extracts the shipped
// functions and runs them against a stubbed page rather than testing a copy.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHELL = readFileSync(resolve(import.meta.dirname, '..', 'docs/index.html'), 'utf8');

function extractFunction(name) {
	const marker = `function ${name}(`;
	const start = SHELL.indexOf(marker);
	if (start === -1) throw new Error(`${name} not found in docs/index.html`);
	const open = SHELL.indexOf('{', SHELL.indexOf(')', start));
	let depth = 0;
	for (let j = open; j < SHELL.length; j++) {
		if (SHELL[j] === '{') depth++;
		else if (SHELL[j] === '}' && --depth === 0) return SHELL.slice(start, j + 1);
	}
	throw new Error(`unbalanced braces in ${name}`);
}

const SOURCE = ['currentRoute', 'navigate'].map(extractFunction).join('\n');

let page;

function boot({ pathname, hash, headings, pages }) {
	page = {
		location: { pathname, hash },
		loads: [],
		scrolls: [],
		replaced: [],
		headings: new Set(headings),
	};
	const scope = {
		location: page.location,
		history: { replaceState: (_s, _t, url) => page.replaced.push(url) },
		document: { getElementById: () => null },
		ALL_PAGES: pages.map((path) => ({ path })),
		loadPage: (path, anchor) => page.loads.push([path, anchor]),
		scrollToAnchor: (anchor) => {
			page.scrolls.push(anchor);
			return !anchor || page.headings.has(anchor);
		},
		findAnchor: (anchor) => (page.headings.has(anchor) ? { id: anchor } : null),
	};
	const run = new Function(
		...Object.keys(scope),
		`let booted = false; let loadedPath = '';\n${SOURCE}\nreturn { navigate, get loadedPath() { return loadedPath; } };`,
	);
	page.router = run(...Object.values(scope));
	page.router.navigate();
	return page;
}

function changeHash(hash) {
	page.location.hash = hash;
	page.router.navigate();
}

const DOC = { pathname: '/docs/mcp-studio', headings: ['long-jobs', 'any-mcp-client'], pages: ['mcp-studio', 'forge', 'start-here'] };

describe('docs router: section hashes after boot', () => {
	beforeEach(() => boot({ ...DOC, hash: '#long-jobs' }));

	it('loads the doc in the URL and scrolls to its section on first load', () => {
		expect(page.loads).toEqual([['mcp-studio', 'long-jobs']]);
	});

	it('scrolls to a bare #section of the open doc instead of loading it as a doc', () => {
		changeHash('#any-mcp-client');
		expect(page.loads).toEqual([['mcp-studio', 'long-jobs']]);
		expect(page.scrolls).toContain('any-mcp-client');
		expect(page.router.loadedPath).toBe('mcp-studio');
	});

	it('rewrites the address to the routed #doc@section form so a reload lands in the same place', () => {
		changeHash('#any-mcp-client');
		expect(page.replaced).toEqual(['/docs/mcp-studio#mcp-studio@any-mcp-client']);
	});

	it('still opens a listed doc from a bare hash, even when a heading shares its name', () => {
		page.headings.add('forge');
		changeHash('#forge');
		expect(page.loads.at(-1)).toEqual(['forge', '']);
	});

	it('still treats a hash that matches no heading here as a doc to load', () => {
		changeHash('#tutorials/first-agent');
		expect(page.loads.at(-1)).toEqual(['tutorials/first-agent', '']);
	});

	it('keeps the routed #doc@section form working', () => {
		changeHash('#mcp-studio@any-mcp-client');
		expect(page.loads).toHaveLength(1);
		expect(page.scrolls.at(-1)).toBe('any-mcp-client');
	});
});
