// scripts/package-edge-addons.mjs
// Build both MV3 extensions and write Edge Add-ons ready zips to dist/edge/.
//   dist/edge/three-ws-walk-avatar-<version>.zip
//   dist/edge/three-ws-checkout-companion-<version>.zip
// Run: npm run package:edge
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'edge');
const stageRoot = join(root, 'dist', 'edge-stage');

/** Manifest keys and values the Edge Add-ons store rejects or ignores. */
function checkEdgeManifest(dir, label) {
	const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
	const problems = [];
	if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
	// Edge Add-ons hosts updates itself; a self-hosted update URL is rejected.
	if ('update_url' in manifest) problems.push('update_url is not allowed');
	// The store assigns the extension ID; a pinned key would conflict.
	if ('key' in manifest) problems.push('key must not be set');
	if (!manifest.name || !manifest.version || !manifest.description) {
		problems.push('name, version and description are required');
	}
	for (const size of ['16', '48', '128']) {
		const icon = manifest.icons?.[size];
		if (!icon || !existsSync(join(dir, icon))) problems.push(`icons.${size} missing`);
	}
	if (problems.length) throw new Error(`${label} manifest is not Edge-ready: ${problems.join('; ')}`);
	return manifest;
}

function zipDir(dir, zipPath) {
	rmSync(zipPath, { force: true });
	// -X drops extra file attributes, -r recurses; manifest.json ends up at the zip root.
	execFileSync('zip', ['-X', '-r', '-q', zipPath, '.'], { cwd: dir });
	return statSync(zipPath).size;
}

rmSync(outDir, { recursive: true, force: true });
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(stageRoot, { recursive: true });

const results = [];

// 1. Walk Avatar: esbuild bundle (production, minified, no source maps).
execFileSync('node', [join(root, 'scripts', 'build-extension-icons.mjs')], { stdio: 'inherit' });
execFileSync('node', [join(root, 'scripts', 'build-extension.mjs'), '--prod'], { stdio: 'inherit' });
const walkDir = join(root, 'dist', 'extension');
const walk = checkEdgeManifest(walkDir, 'walk-avatar');
const walkZip = join(outDir, `three-ws-walk-avatar-${walk.version}.zip`);
results.push({ name: 'walk-avatar', zip: walkZip, bytes: zipDir(walkDir, walkZip) });

// 2. Checkout Companion: plain MV3 sources, no bundler. Ship runtime files only.
const companionSrc = join(root, 'extensions', 'checkout-companion');
const companionStage = join(stageRoot, 'checkout-companion');
mkdirSync(companionStage, { recursive: true });
for (const name of readdirSync(companionSrc)) {
	if (name.endsWith('.md')) continue; // docs stay in the repo, not in the package
	cpSync(join(companionSrc, name), join(companionStage, name), { recursive: true });
}
const companion = checkEdgeManifest(companionStage, 'checkout-companion');
const companionZip = join(outDir, `three-ws-checkout-companion-${companion.version}.zip`);
results.push({ name: 'checkout-companion', zip: companionZip, bytes: zipDir(companionStage, companionZip) });

rmSync(stageRoot, { recursive: true, force: true });

console.log('\nEdge Add-ons packages:');
for (const r of results) console.log(`  ${r.name}: ${r.zip.replace(root + '/', '')} (${r.bytes} bytes)`);
