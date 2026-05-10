#!/usr/bin/env node
/**
 * Pre-bundle all Vercel API route functions with esbuild.
 *
 * Problem: Vercel's nft (Node File Tracer) traces every api/**\/*.js against
 * the full node_modules tree (2 GB) to determine what to include in each
 * function package. With 220 route files this takes ~31 minutes.
 *
 * Solution: use esbuild to bundle each route file into a single self-contained
 * JS file BEFORE Vercel sees them. The bundled files have all deps inlined;
 * nft finds nothing external to trace. Bundling 192 route files with esbuild
 * takes ~30 seconds.
 *
 * Notes:
 * - Only Vercel route files are bundled (underscore-prefixed files/dirs are
 *   skipped — they are inlined into each bundle that imports them).
 * - Native modules (sharp) stay external — esbuild cannot inline binaries.
 * - Variable dynamic imports (import(variable)) are preserved as-is. Vercel's
 *   includeFiles handles any runtime assets those imports need.
 * - Files are processed in batches of 25 to stay within memory limits when
 *   bundling large packages (Solana SDK, ethers, etc.).
 *
 * Run via: node scripts/bundle-api.mjs
 */
import { build } from 'esbuild';
import { readdir, stat } from 'fs/promises';
import { resolve, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'api');

async function collectRouteFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		// Vercel skips underscore-prefixed files/dirs (not exposed as functions).
		// We skip them here too — they get inlined into bundles that import them.
		if (e.name.startsWith('_')) continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			await collectRouteFiles(full, out);
		} else if (e.isFile() && e.name.endsWith('.js')) {
			out.push(full);
		}
	}
	return out;
}

const nobleFixPlugin = {
	// Some packages export "./sha3.js" in their exports map but are imported
	// without the extension (e.g. "@noble/hashes/sha3"). Retry with .js suffix.
	name: 'fix-subpath-extensions',
	setup(build) {
		build.onResolve({ filter: /^@noble\// }, async (args) => {
			if (args.path.endsWith('.js')) return null;
			const result = await build.resolve(args.path + '.js', {
				resolveDir: args.resolveDir,
				kind: args.kind,
			});
			return result.errors.length ? null : result;
		});
	},
};

const SHARED_OPTS = {
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	outdir: API_DIR,
	outbase: API_DIR,
	allowOverwrite: true,
	conditions: ['import', 'require', 'node', 'default'],
	external: ['sharp', 'canvas', 'fsevents'],
	treeShaking: true,
	minify: false,
	sourcemap: false,
	logLevel: 'warning',
	logOverride: { 'unsupported-dynamic-import': 'silent' },
	plugins: [nobleFixPlugin],
};

const start = Date.now();
const routeFiles = await collectRouteFiles(API_DIR);
console.log(`[bundle-api] Bundling ${routeFiles.length} route files in ${Math.ceil(routeFiles.length / 25)} batches...`);

const BATCH_SIZE = 25;
let errors = 0;
for (let i = 0; i < routeFiles.length; i += BATCH_SIZE) {
	const batch = routeFiles.slice(i, i + BATCH_SIZE);
	try {
		await build({ ...SHARED_OPTS, entryPoints: batch });
		process.stdout.write('.');
	} catch (err) {
		process.stdout.write('!');
		errors++;
		const msgs = err.errors?.map((e) => `  ${relative(ROOT, e.location?.file || '')} — ${e.text}`).join('\n') || err.message;
		console.error(`\n[bundle-api] Batch ${i}–${i + BATCH_SIZE} failed:\n${msgs}`);
	}
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const sizes = await Promise.all(routeFiles.map(async (f) => (await stat(f)).size));
const totalKB = (sizes.reduce((s, n) => s + n, 0) / 1024).toFixed(0);
console.log(`\n[bundle-api] Done in ${elapsed}s — ${routeFiles.length} files, ${totalKB} KB total${errors ? ` (${errors} batch errors)` : ''}`);
if (errors) process.exit(1);
