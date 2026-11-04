// One-command release: preflight, publish to each registry whose token is set,
// then poll the Marketplace until the new version is listed.
//
//   VSCE_PAT=... OVSX_PAT=... npm run release
//
// With no tokens set it runs the preflight, skips both publishes and exits 0.
// Token values are passed to child processes through the environment and are
// never printed.

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	EXPECTED_FILES,
	checkFileList,
	galleryVersions,
	hasChangelogSection,
	isNewVersion,
	parseVsceLs,
} from './release-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const ext = `${pkg.publisher}.${pkg.name}`;
const POLL_MS = 15_000;
const POLL_BUDGET_MS = 10 * 60_000;

function step(msg) {
	console.log(`\n== ${msg}`);
}

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit', env: process.env });
	if (r.status !== 0) {
		if (opts.capture) process.stderr.write(`${r.stdout || ''}${r.stderr || ''}`);
		throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
	}
	return r.stdout || '';
}

async function queryGallery() {
	const res = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.2-preview.1' },
		body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: ext }] }], flags: 1 }),
	});
	if (!res.ok) throw new Error(`gallery query failed: HTTP ${res.status}`);
	return galleryVersions(await res.json());
}

function cleanVsix() {
	for (const f of readdirSync(root)) if (f.endsWith('.vsix')) rmSync(join(root, f));
}

async function preflight() {
	step('Preflight: tests');
	run('npm', ['test']);

	step('Preflight: package and file list');
	run('npm', ['run', 'package']);
	const listing = run('npx', ['--yes', '@vscode/vsce', 'ls', '--no-dependencies'], { capture: true });
	cleanVsix();
	const files = checkFileList(parseVsceLs(listing));
	if (!files.ok) {
		throw new Error(`packaged file list drifted from PUBLISHING.md. missing: [${files.missing}] unexpected: [${files.extra}]. Fix .vscodeignore.`);
	}
	console.log(`file list matches the documented ${EXPECTED_FILES.length} files`);

	step('Preflight: CHANGELOG section');
	if (!hasChangelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), pkg.version)) {
		throw new Error(`CHANGELOG.md has no non-empty "## ${pkg.version}" section`);
	}
	console.log(`CHANGELOG.md documents ${pkg.version}`);

	step('Preflight: version is newer than the published ones');
	const published = await queryGallery();
	console.log(`published on the Marketplace: ${published.length ? published.join(', ') : 'nothing yet'}`);
	if (!isNewVersion(pkg.version, published)) {
		throw new Error(`version ${pkg.version} is not greater than the published ${published.join(', ')}. Bump package.json and CHANGELOG.md.`);
	}
	console.log(`${pkg.version} is new`);
}

async function waitForListing() {
	step('Waiting for the Marketplace listing');
	const deadline = Date.now() + POLL_BUDGET_MS;
	while (Date.now() < deadline) {
		const versions = await queryGallery().catch(() => []);
		if (versions.includes(pkg.version)) {
			console.log(`listed: https://marketplace.visualstudio.com/items?itemName=${ext}`);
			return true;
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	console.log(`not listed after ${POLL_BUDGET_MS / 60_000} minutes. The Marketplace scan can run longer; re-run the gallery query in PUBLISHING.md section 3 later.`);
	return false;
}

try {
	await preflight();
	let published = false;

	step('Marketplace');
	if (process.env.VSCE_PAT) {
		run('npm', ['run', 'publish:marketplace']);
		published = true;
	} else {
		console.log('VSCE_PAT is not set: skipping the Visual Studio Marketplace publish.');
	}

	step('Open VSX');
	if (process.env.OVSX_PAT) {
		run('npm', ['run', 'publish:openvsx']);
		console.log(`listed: https://open-vsx.org/extension/${pkg.publisher}/${pkg.name}`);
	} else {
		console.log('OVSX_PAT is not set: skipping the Open VSX publish.');
	}

	if (published) {
		const ok = await waitForListing();
		cleanVsix();
		process.exit(ok ? 0 : 1);
	}
	cleanVsix();
	console.log('\nNothing published. Set VSCE_PAT and/or OVSX_PAT and re-run `npm run release`.');
} catch (err) {
	cleanVsix();
	console.error(`\nrelease aborted: ${err.message}`);
	process.exit(1);
}
