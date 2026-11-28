// scripts/build-extension.mjs — bundle the Chrome extension for load-unpacked or Web Store.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'extensions', 'walk-avatar');
const out = join(root, 'dist', 'extension');
const isProd = process.argv.includes('--prod');

// Start from a clean output dir so stale artifacts (e.g. dev source maps, or a
// removed entrypoint) never leak into the packaged zip.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// What ships lives in extensions/walk-avatar/build.config.json, shared with the
// Firefox build (extensions/firefox/build.mjs) so the stores never diverge.
// background.js is an ESM service worker; every other entrypoint is a classic
// IIFE. content-narrator.js is injected via chrome.scripting before content.js:
// it publishes a window global and is NOT imported by content.js, so esbuild
// must emit the two separately or chrome.scripting.executeScript fails on a
// missing file.
const config = JSON.parse(readFileSync(join(src, 'build.config.json'), 'utf8'));

await Promise.all(
	config.entrypoints.map((e) => {
		if (!existsSync(join(src, e.file))) {
			throw new Error(`missing required extension entrypoint: ${e.file}`);
		}
		return build({
			entryPoints: [join(src, e.file)],
			outfile: join(out, e.file),
			bundle: true,
			format: e.format,
			platform: 'browser',
			minify: isProd,
			sourcemap: !isProd,
			target: 'chrome109',
		});
	}),
);

// Static files: the manifest, the HTML pages, icons, and the vendored
// readability lib (large, pre-minified, injected as-is rather than re-bundled).
for (const name of config.copy) {
	cpSync(join(src, name), join(out, name), { recursive: true });
}

// Stylesheets referenced by popup.html / options.html (e.g. popup.css). HTML
// pages load these as-is; without them the popup ships unstyled.
for (const file of readdirSync(src)) {
	if (config.copyExtensions.some((ext) => file.endsWith(ext))) cpSync(join(src, file), join(out, file));
}

// Bump version in manifest for prod builds
if (isProd) {
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
	manifest.version = pkg.version || manifest.version;
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');

	// Zip for Web Store submission
	const { execSync } = await import('child_process');
	const zipPath = join(root, 'dist', `extension-${manifest.version}.zip`);
	// Remove any prior zip first — `zip -r` updates in place and would otherwise
	// retain stale entries (e.g. dev source maps) no longer in the output dir.
	rmSync(zipPath, { force: true });
	execSync(`cd "${out}" && zip -r "${zipPath}" .`);
	console.log(`\nZipped → dist/extension-${manifest.version}.zip`);
}

console.log(`\nExtension built → dist/extension/ (${isProd ? 'production' : 'dev'})`);
console.log('Load unpacked: chrome://extensions → Load unpacked → dist/extension/');
