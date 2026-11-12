// /m/:id robots policy (server/creation-head.mjs).
//
// An unlisted forge model resolves for anyone holding the link, which is the
// point of "unlisted", and a model the quality grader rejected stays reachable
// for its maker. Neither is listed in the gallery or in /sitemap/creations.xml.
// Until 2026-11-11 the per-creation head carried no robots tag and a
// self-canonical, so a crawler that met either link (a share on X, a referrer
// log) indexed it like any public model. The head now says noindex for both,
// keeps the links followable, and leaves public models indexable.

import { describe, it, expect } from 'vitest';
import { rewriteCreationHead } from '../server/creation-head.mjs';

const SHELL = `<!doctype html><html lang="en"><head>
<title>3D Model · three.ws</title>
<meta name="description" content="A 3D model on three.ws." />
<link rel="canonical" href="https://three.ws/creations" />
</head><body></body></html>`;

const base = {
	id: 'aaaaaaaa-0000-4000-8000-000000000001',
	prompt: 'a brass astrolabe with engraved star charts',
	glb_url: 'https://three.ws/cdn/forge/a.glb',
	size_bytes: 1_000_000,
	created_at: '2026-11-01T00:00:00Z',
	outcome: null,
};

const robots = (html) => /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? null;
const canonical = (html) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null;

describe('creation head robots', () => {
	it('keeps a public model indexable with a self-canonical', () => {
		const html = rewriteCreationHead(SHELL, { ...base, visibility: 'public' });
		expect(robots(html)).toBeNull();
		expect(canonical(html)).toBe('https://three.ws/m/aaaaaaaa-0000-4000-8000-000000000001');
	});

	it('serves an unlisted model noindex, follow', () => {
		const html = rewriteCreationHead(SHELL, { ...base, visibility: 'unlisted' });
		expect(robots(html)).toBe('noindex, follow');
	});

	it('serves a grader-rejected model noindex, follow', () => {
		const html = rewriteCreationHead(SHELL, { ...base, visibility: 'public', outcome: 'rejected' });
		expect(robots(html)).toBe('noindex, follow');
	});

	it('replaces a robots tag the shell already carries instead of adding a second', () => {
		const shell = SHELL.replace('</head>', '<meta name="robots" content="index, follow" />\n</head>');
		const html = rewriteCreationHead(shell, { ...base, visibility: 'unlisted' });
		expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
		expect(robots(html)).toBe('noindex, follow');
	});
});
