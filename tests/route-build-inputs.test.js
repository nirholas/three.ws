// Every static page a vercel.json route points at has to exist in the production
// build. The dev server hides the failure: vite.config.js carries middleware that
// resolves pretty URLs straight to pages/*.html, so a page that is not a Rollup
// input renders perfectly in `npm run dev` and answers 404 in production. That is
// exactly how /billing/keys (linked from the AWS Marketplace welcome page) and
// every markets stock and coin detail page went dead. This reads the
// route table and the build inputs and fails on any route whose page the build
// would never emit.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const vite = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));

// Rollup inputs are declared as resolve(__dirname, 'pages/<name>.html').
const INPUTS = new Set([...vite.matchAll(/resolve\(__dirname,\s*'([^']+\.html)'\)/g)].map((m) => m[1]));
// Directories whose every page is enumerated into the input map at config time.
const INPUT_DIRS = [...vite.matchAll(/resolve\(__dirname,\s*'(pages\/[a-z0-9-]+)'\)/g)].map((m) => `${m[1]}/`);
// Destinations produced by a build step rather than a source page: the docs site,
// the blog, news, events and demo pages are generated into dist/ by their own
// builders, and a capture-group destination ($1) names no single file.
const GENERATED = /^(docs|blog|news|events|demos)\/|\$\d/;

function unbuiltDestinations() {
	const missing = new Set();
	for (const route of vercel.routes) {
		if (!route.dest || !/\.html(\?|$)/.test(route.dest)) continue;
		const dest = route.dest.replace(/^\//, '').replace(/\?.*$/, '');
		if (GENERATED.test(dest)) continue;
		if (existsSync(resolve(root, 'public', dest))) continue; // copied verbatim
		const source = `pages/${dest}`;
		if (INPUTS.has(source)) continue;
		if (INPUT_DIRS.some((dir) => source.startsWith(dir))) continue;
		missing.add(`${route.src} -> ${source}`);
	}
	return [...missing].sort();
}

describe('vercel.json routes and the production build', () => {
	it('finds the build inputs it is checking against', () => {
		expect(INPUTS.size).toBeGreaterThan(300);
	});

	it('every routed static page is emitted by the build', () => {
		expect(unbuiltDestinations()).toEqual([]);
	});
});
