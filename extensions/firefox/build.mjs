// Build one three.ws extension for Firefox Add-ons.
//
//   node extensions/firefox/build.mjs <walk-avatar|checkout-companion> <outDir> [--version X.Y.Z]
//
// Self-contained on purpose: it needs only Node and esbuild, so the same file
// ships inside the AMO source package and the reviewer rebuilds the exact
// package from it (see scripts/package-firefox-addons.mjs and
// extensions/FIREFOX.md). Bundled output is NOT minified, so what AMO reviews
// reads like the source.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toFirefoxManifest } from './manifest.mjs';
import { FIREFOX_MIN_VERSION, TARGETS } from './targets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function bundleWalkAvatar(src, out) {
	const config = JSON.parse(readFileSync(join(src, 'build.config.json'), 'utf8'));
	await Promise.all(
		config.entrypoints.map((e) =>
			build({
				entryPoints: [join(src, e.file)],
				outfile: join(out, e.file),
				bundle: true,
				format: e.format,
				platform: 'browser',
				minify: false,
				sourcemap: false,
				target: `firefox${FIREFOX_MIN_VERSION.split('.')[0]}`,
				logLevel: 'warning',
			}),
		),
	);
	for (const name of config.copy) cpSync(join(src, name), join(out, name), { recursive: true });
	for (const file of readdirSync(src)) {
		if (config.copyExtensions.some((ext) => file.endsWith(ext))) cpSync(join(src, file), join(out, file));
	}
}

// No bundler: ship the runtime files as written. Docs stay in the repo.
function copyPlain(src, out) {
	for (const name of readdirSync(src)) {
		if (name.endsWith('.md') || name.startsWith('.')) continue;
		cpSync(join(src, name), join(out, name), { recursive: true });
	}
}

/**
 * Build `name` into `outDir` (wiped first). Returns the Firefox manifest.
 * @param {string} name  a key of TARGETS
 * @param {string} outDir
 * @param {{ version?: string }} [opts]
 */
export async function buildFirefoxTarget(name, outDir, opts = {}) {
	const target = TARGETS[name];
	if (!target) throw new Error(`unknown extension "${name}" (expected one of: ${Object.keys(TARGETS).join(', ')})`);
	const src = join(repoRoot, target.source);
	if (!existsSync(join(src, 'manifest.json'))) throw new Error(`${name}: no manifest.json in ${target.source}`);

	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	if (target.bundled) await bundleWalkAvatar(src, outDir);
	else copyPlain(src, outDir);

	const chromium = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
	const manifest = toFirefoxManifest(chromium, target, { version: opts.version, label: name });
	writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	const vi = args.indexOf('--version');
	const version = vi >= 0 ? args[vi + 1] : undefined;
	const [name, outDir] = args.filter((a, i) => !a.startsWith('--') && (vi < 0 || i !== vi + 1));
	if (!name || !outDir) {
		console.error('usage: node extensions/firefox/build.mjs <walk-avatar|checkout-companion> <outDir> [--version X.Y.Z]');
		process.exit(2);
	}
	const manifest = await buildFirefoxTarget(name, resolve(outDir), { version });
	console.log(`${name} ${manifest.version} built for Firefox -> ${outDir}`);
}
