// Build the GitHub Pages site into docs/.
//
// GitHub Pages serves this repository from the `docs/` folder on `main`, which
// is why the output is committed: no Actions workflow, no deploy step, no
// secrets. Push and the site is live.
//
// The bundle is copied in rather than linked from a CDN so the demo keeps
// working if a CDN has a bad day, and so what the page runs is exactly the
// build in this commit.

import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from './layout.mjs';
import { homePage, studioPage, mcpPage } from './pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'docs');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Jekyll would otherwise swallow files and folders beginning with an underscore.
await writeFile(resolve(out, '.nojekyll'), '');

// Only the minified bundle ships to the site: the readable build and its source
// map are for package consumers debugging against `dist/`, and adding six
// megabytes to every clone of this repo to serve them here would be rude.
await cp(resolve(root, 'dist/ar-studio.min.js'), resolve(out, 'ar-studio.min.js'));

const SCRIPT = '<script type="module" src="./ar-studio.min.js"></script>';

const pages = [
	{
		file: 'index.html',
		nav: 'home',
		title: '3D AR Studio: put anything in your room',
		description:
			'A complete augmented-reality studio for any web page: place any number of 3D models in your real space through the camera, generate new ones from a prompt, share the scene as a link, and build together live.',
		body: homePage(),
		head: SCRIPT,
	},
	{
		file: 'studio.html',
		nav: 'studio',
		title: 'Live demo: 3D AR Studio',
		description: 'The full 3D AR Studio, running the published build. Open it on a phone and tap Camera.',
		body: studioPage(),
		head: SCRIPT,
		bare: true,
	},
	{
		file: 'mcp.html',
		nav: 'mcp',
		title: 'MCP server: 3D AR Studio',
		description: 'Let an agent generate 3D models, compose an AR scene, and hand a person one link that opens it in their room.',
		body: mcpPage(),
	},
];

for (const page of pages) {
	await writeFile(resolve(out, page.file), layout(page));
}

// A machine-readable pointer for anything that wants to find the build.
await writeFile(resolve(out, 'version.json'), `${JSON.stringify({
	name: pkg.name,
	version: pkg.version,
	homepage: pkg.homepage,
	bundle: './ar-studio.min.js',
}, null, 2)}\n`);

console.log(`docs/ built: ${pages.length} pages + bundle (v${pkg.version})`);
