#!/usr/bin/env node
// Validates the three PnP gallery samples staged in this folder against the
// rules each gallery enforces on a pull request:
//   - assets/sample.json against the gallery's metadata schema (vendored in
//     ./schemas from the gallery repository; see README.md for the commits)
//   - name, url, downloadUrl and thumbnails aligned with the sample folder
//   - thumbnails point at files committed under the sample's assets folder
//   - screenshots are real PNG files of the size the gallery asks for
//   - the README has the template sections and ends with the visitor tracker
//   - no build output, dependencies, packages or local secret files
//
// Usage: node integrations/microsoft/pnp-samples/scripts/validate-sample-json.mjs
// Exit code 0 means every sample passed every check.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const CONTRIBUTOR = 'nirholas';
const BANNED_DASHES = /[\u2013\u2014]/;

export const SAMPLES = [
	{
		gallery: 'copilot-pro-dev-samples',
		folder: 'da-threews-3d-studio',
		folderPattern: /^da-[a-z0-9-]+$/,
		namePrefix: 'pnp-copilot-pro-dev-',
		products: ['Microsoft 365 Copilot'],
		requiredFiles: ['README.md', 'assets/sample.json', '.gitignore', 'm365agents.yml', 'appPackage/manifest.json', 'appPackage/declarativeAgent.json', 'appPackage/color.png', 'appPackage/outline.png'],
		readmeSections: ['## Summary', '## Compatibility', '## Contributors', '## Version history', '## Prerequisites', '## Minimal path to awesome', '## Features', '## Help', '## Disclaimer'],
		screenshot: { width: 1920, height: 1080 },
	},
	{
		gallery: 'teams-dev-samples',
		folder: 'msgext-threews-3d-models-ts',
		folderPattern: /^msgext-[a-z0-9-]+$/,
		namePrefix: 'pnp-sp-dev-teams-sample-',
		products: ['Teams'],
		requiredFiles: ['README.md', 'assets/sample.json', '.gitignore', 'package.json', 'package-lock.json', 'm365agents.yml', 'appPackage/manifest.json', 'appPackage/color.png', 'appPackage/outline.png', 'env/.env.local.sample', 'env/.env.local.user.sample'],
		readmeSections: ['## Summary', '## Tools and Frameworks', '## Prerequisites', '## Contributors', '## Version history', '## Disclaimer', '## Minimal Path to Awesome', '## Features'],
		screenshot: { width: 1920, height: 1080 },
	},
	{
		gallery: 'sp-dev-fx-webparts',
		folder: 'react-threews-3d-viewer',
		folderPattern: /^react-(?!.*(?:sample|webpart|-wp(?:-|$)))[a-z0-9-]+$/,
		namePrefix: 'pnp-sp-dev-spfx-web-parts-',
		products: ['SharePoint'],
		requiredFiles: ['README.md', 'assets/sample.json', '.gitignore', '.nvmrc', 'package.json', 'package-lock.json', 'config/package-solution.json'],
		readmeSections: ['## Summary', '## Compatibility', '## Applies to', '## Contributors', '## Version history', '## Prerequisites', '## Minimal path to awesome', '## Features', '## Help', '## Disclaimer'],
		screenshot: { width: 1920, height: 1080 },
		metadata: { 'SAMPLE-TYPE': 'SPFx-WebPart', 'CLIENT-SIDE-DEV': 'React' },
	},
];

// Paths no gallery accepts in a pull request.
const FORBIDDEN = [
	{ test: (p) => /(^|\/)node_modules(\/|$)/.test(p), why: 'installed dependencies' },
	{ test: (p) => /(^|\/)(lib|lib-commonjs|lib-dts|dist|temp|release|solution|\.heft)(\/|$)/.test(p), why: 'build output' },
	{ test: (p) => /\.sppkg$/.test(p), why: 'a packaged SPFx solution' },
	{ test: (p) => /(^|\/)appPackage\/build(\/|$)/.test(p), why: 'a built app package' },
	{ test: (p) => /(^|\/)\.localConfigs/.test(p), why: 'Agents Toolkit local config with secrets' },
	{ test: (p) => /(^|\/)env\/\.env\.[^/]+\.user$/.test(p), why: 'a user env file that holds secrets' },
	{ test: (p) => /(^|\/)env\/\.env\.local$/.test(p), why: 'a generated local env file' },
	{ test: (p) => /(^|\/)welcome-(dark|light)\.png$/.test(p), why: 'unused SPFx welcome assets' },
	{ test: (p) => /\.(zip|log)$/.test(p), why: 'an archive or log file' },
];

function walk(dir, base = dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const rel = relative(base, full).split('\\').join('/');
		if (statSync(full).isDirectory()) {
			out.push(`${rel}/`);
			out.push(...walk(full, base));
		} else out.push(rel);
	}
	return out;
}

/** Reads width and height from a PNG IHDR chunk, or null when the file is not a PNG. */
export function pngSize(buffer) {
	const signature = '89504e470d0a1a0a';
	if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null;
	if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function loadSchema(gallery) {
	return JSON.parse(readFileSync(join(here, 'schemas', `${gallery}.metadata-schema.json`), 'utf8'));
}

export function validateSample(sample) {
	const errors = [];
	const dir = join(root, sample.gallery, sample.folder);
	const fail = (msg) => errors.push(msg);
	if (!existsSync(dir)) return [`missing folder ${relative(root, dir)}`];

	if (!sample.folderPattern.test(sample.folder)) fail(`folder name ${sample.folder} breaks the gallery naming rule ${sample.folderPattern}`);
	if (sample.folder.includes('.')) fail('folder name contains a dot');

	const files = walk(dir);
	for (const required of sample.requiredFiles) {
		if (!existsSync(join(dir, required))) fail(`missing ${required}`);
	}
	for (const file of files) {
		const rule = FORBIDDEN.find((r) => r.test(file));
		if (rule) fail(`${file} must not be submitted (${rule.why})`);
	}

	// sample.json
	const samplePath = join(dir, 'assets', 'sample.json');
	if (existsSync(samplePath)) {
		const raw = readFileSync(samplePath, 'utf8');
		let data;
		try {
			data = JSON.parse(raw);
		} catch (err) {
			fail(`assets/sample.json is not valid JSON: ${err.message}`);
		}
		if (data) {
			const ajv = new Ajv({ allErrors: true, strict: false });
			addFormats(ajv);
			const validate = ajv.compile(loadSchema(sample.gallery));
			if (!validate(data)) {
				for (const e of validate.errors) fail(`sample.json${e.instancePath} ${e.message}`);
			}
			if (!Array.isArray(data) || data.length !== 1) fail('sample.json must be an array with exactly one entry');
			const entry = Array.isArray(data) ? data[0] || {} : {};
			const expectedName = `${sample.namePrefix}${sample.folder}`;
			const expectedUrl = `https://github.com/pnp/${sample.gallery}/tree/main/samples/${sample.folder}`;
			if (entry.name !== expectedName) fail(`sample.json name is ${entry.name}, expected ${expectedName}`);
			if (entry.url !== expectedUrl) fail(`sample.json url is ${entry.url}, expected ${expectedUrl}`);
			if (entry.downloadUrl && entry.downloadUrl !== `https://pnp.github.io/download-partial/?url=${expectedUrl}`) {
				fail('sample.json downloadUrl does not match the sample folder');
			}
			if (sample.gallery === 'teams-dev-samples' && entry.reponame !== sample.folder) fail(`sample.json reponame must be ${sample.folder}`);
			for (const product of sample.products) {
				if (!entry.products?.includes(product)) fail(`sample.json products must include ${product}`);
			}
			const dates = [entry.creationDateTime, entry.updateDateTime];
			for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) fail(`sample.json date ${d} is not YYYY-MM-DD`);
			if (entry.updateDateTime < entry.creationDateTime) fail('sample.json updateDateTime is before creationDateTime');
			const meta = Object.fromEntries((entry.metadata || []).map((m) => [m.key, m.value]));
			for (const [key, value] of Object.entries(sample.metadata || {})) {
				if (meta[key] !== value) fail(`sample.json metadata ${key} must be ${value}`);
			}
			if (sample.gallery === 'sp-dev-fx-webparts') {
				const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
				const spfx = pkg.dependencies?.['@microsoft/sp-core-library'];
				if (meta['SPFX-VERSION'] !== spfx) fail(`sample.json SPFX-VERSION ${meta['SPFX-VERSION']} does not match package.json ${spfx}`);
			}
			if (!entry.authors?.some((a) => a.gitHubAccount === CONTRIBUTOR)) fail(`sample.json authors must include ${CONTRIBUTOR}`);
			const images = (entry.thumbnails || []).filter((t) => t.type === 'image');
			if (!images.length) fail('sample.json needs at least one image thumbnail');
			const rawPrefix = `https://github.com/pnp/${sample.gallery}/raw/main/samples/${sample.folder}/assets/`;
			for (const t of images) {
				if (!t.url?.startsWith(rawPrefix)) {
					fail(`thumbnail ${t.url} must start with ${rawPrefix}`);
					continue;
				}
				const local = join(dir, 'assets', t.url.slice(rawPrefix.length));
				if (!existsSync(local)) {
					fail(`thumbnail file assets/${t.url.slice(rawPrefix.length)} does not exist`);
					continue;
				}
				const size = pngSize(readFileSync(local));
				if (!size) fail(`thumbnail ${relative(dir, local)} is not a PNG`);
				else if (size.width !== sample.screenshot.width || size.height !== sample.screenshot.height) {
					fail(`thumbnail ${relative(dir, local)} is ${size.width}x${size.height}, expected ${sample.screenshot.width}x${sample.screenshot.height}`);
				}
				if (!t.alt || t.alt.length < 10) fail(`thumbnail ${t.url} needs descriptive alt text`);
			}
			if (BANNED_DASHES.test(raw)) fail('sample.json contains an en dash or em dash');
		}
	}

	// README
	const readmePath = join(dir, 'README.md');
	if (existsSync(readmePath)) {
		const readme = readFileSync(readmePath, 'utf8');
		const lines = readme.trimEnd().split('\n');
		const tracker = `<img src="https://m365-visitor-stats.azurewebsites.net/${sample.gallery}/samples/${sample.folder}" />`;
		if (lines[lines.length - 1].trim() !== tracker) fail(`README.md must end with ${tracker}`);
		for (const section of sample.readmeSections) {
			if (!lines.some((l) => l.trim() === section)) fail(`README.md is missing the "${section}" section`);
		}
		if (!readme.includes(`https://github.com/${CONTRIBUTOR}`)) fail(`README.md contributors must link https://github.com/${CONTRIBUTOR}`);
		if (!/THIS CODE IS PROVIDED \*AS IS\* WITHOUT WARRANTY/.test(readme)) fail('README.md is missing the gallery disclaimer');
		if (BANNED_DASHES.test(readme)) fail('README.md contains an en dash or em dash');
		if (/YOUR[-_ ](SOLUTION|AGENT|SAMPLE|IMAGE)|Author Name|LinkToYourGitHubProfile|\{sample-path\}/.test(readme)) fail('README.md still has template placeholders');
		for (const match of readme.matchAll(/\]\((assets\/[^)\s]+)\)/g)) {
			if (!existsSync(join(dir, match[1]))) fail(`README.md links ${match[1]}, which does not exist`);
		}
	}

	if (sample.gallery === 'sp-dev-fx-webparts' && existsSync(join(dir, '.nvmrc'))) {
		const nvmrc = readFileSync(join(dir, '.nvmrc'), 'utf8').trim();
		const engines = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).engines?.node || '';
		const major = nvmrc.replace(/^v/, '').split('.')[0];
		if (!new RegExp(`>=${major}\\.`).test(engines)) fail(`.nvmrc ${nvmrc} is outside package.json engines ${engines}`);
	}

	return errors;
}

function main() {
	let failed = 0;
	for (const sample of SAMPLES) {
		const errors = validateSample(sample);
		const label = `${sample.gallery}/${sample.folder}`;
		if (errors.length) {
			failed++;
			console.log(`FAIL ${label}`);
			for (const e of errors) console.log(`  - ${e}`);
		} else {
			console.log(`PASS ${label}`);
		}
	}
	console.log(failed ? `\n${failed} of ${SAMPLES.length} samples failed.` : `\nAll ${SAMPLES.length} samples pass their gallery checks.`);
	process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
