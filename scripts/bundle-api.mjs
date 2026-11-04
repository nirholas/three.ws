#!/usr/bin/env node
/**
 * Pre-bundle all Vercel API route functions with esbuild.
 *
 * Problem: Vercel's nft (Node File Tracer) traces every api/*.js against
 * the full node_modules tree (~2 GB) to determine what to include in each
 * function package. With 450+ route files this takes 45+ minutes (exceeding
 * Vercel's build timeout).
 *
 * Solution: use esbuild to bundle each route file into a single self-contained
 * JS file BEFORE Vercel sees them. The bundled files have all deps inlined;
 * nft finds nothing external to trace — drops from ~45 min to under 3 min.
 */
import { readdir, stat, readFile } from 'fs/promises';
import { resolve, join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'api');

// The bundler writes output to --outdir=api with --allow-overwrite, i.e. it
// overwrites every api/*.js source file in place. On Vercel that's fine — the
// checkout is ephemeral and the bundled output is what gets deployed. Locally
// it destroys your route sources, and if those get committed the repo balloons
// by millions of lines (see commits c94190b3 and dabd5884, both reverted).
// Refuse to run unless we're actually on a CI builder, or the operator opts in.
const isCiBuild =
	process.env.VERCEL === '1' ||
	process.env.NOW_BUILDER === '1' ||
	process.env.CI === 'true' ||
	process.env.CI === '1';
if (!isCiBuild && process.env.FORCE_BUNDLE_API !== '1') {
	console.log(
		'[bundle-api] Skipping — not on Vercel/CI. This script overwrites api/*.js in place; running it locally destroys route sources. Set FORCE_BUNDLE_API=1 to override (preferably in a throwaway worktree).',
	);
	process.exit(0);
}

async function collectRouteFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
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

// Externals are NOT inlined into the bundle. esbuild leaves the import
// statement intact and Vercel's NFT resolves it from node_modules. Mark heavy
// or lazy-loaded deps as external so:
//   1. The bundle stays small (faster Vercel function packaging).
//   2. Dynamic imports stay dynamic at runtime instead of being inlined.
// Caveat: an external is left as a bare import, so NFT DOES trace it — once per
// function that imports it. Keep this list to deps that are genuinely heavy AND
// narrowly imported. A heavy external pulled in by a widely-shared module (e.g.
// _lib/http.js → ~360 routes) multiplies into a build-timeout; that is exactly
// why @sentry/node was removed from the http.js path (see api/_lib/sentry.js).
const EXTERNALS = [
	'sharp',
	'canvas',
	'fsevents',
	'@ipshipyard/node-datachannel',
	'@three-ws/solana-agent',
	'@solana/*',
	'@solana-program/*',
	'@metaplex-foundation/*',
	'@bonfida/*',
	'@pump-fun/*',
	'@nirholas/*',
	'@coral-xyz/*',
	'@aws-sdk/*',
	// NOTE: @sentry/* and @opentelemetry/* are intentionally NOT externalized —
	// nothing imports them anymore. api/_lib/sentry.js reports to Sentry's HTTP
	// envelope API via fetch instead of the @sentry/node SDK, specifically so NFT
	// no longer traces that ~50 MB tree once per function across the ~360 routes
	// that import http.js (the 45-min build timeout, deploy 5vphtZz6S). If you
	// re-add the SDK, read api/_lib/sentry.js's header first.
	// @grpc/grpc-js + @grpc/proto-loader power the free NVIDIA Magpie TTS lane
	// (api/_lib/tts-nvidia.js → api/tts/speak.js only). Pure JS (no native
	// addon), but grpc-js's CJS build does lazy internal requires that esbuild's
	// ESM output mangles; external lets Node load it natively, and NFT traces
	// the ~6 MB tree exactly once (single importing route).
	'@grpc/*',
	'@asamuzakjp/*',
	'@csstools/*',
	'@neynar/*',
	'@upstash/*',
	'@sparticuz/*',
	// @x402/extensions v2.13.0 maps both `import` and `require` conditions to
	// its CJS build (./dist/cjs/index.js). When esbuild bundles that CJS into
	// an ESM output it wraps require() calls with a __require shim, but
	// require('url') (a Node.js built-in) throws "Dynamic require of 'url' is
	// not supported" at runtime — crashing every function that imports x402-spec.js.
	// Marking @x402/* and @coinbase/* as external lets Node.js ESM loader
	// handle the CJS→ESM boundary natively (ESM can always import CJS).
	'@x402/*',
	'@coinbase/*',
	// gltf-validator ships only a CJS build (gltf_validator.dart.js) that uses
	// require('url') — same ESM-bundling incompatibility as @x402/extensions.
	// Marking it external lets Node.js load it natively as CJS.
	'gltf-validator',
	// jsdom removed: api/_lib/text-extract.js now uses node-html-parser, so
	// no API route imports jsdom. Keeping it external caused NFT to bundle the
	// jsdom→html-encoding-sniffer@6→@exodus/bytes (ESM-only) chain into every
	// widgets function, crashing them with ERR_REQUIRE_ESM at cold start.
	'ethers',
	'@elevenlabs/elevenlabs-js',
	'playwright',
	'playwright-core',
	'puppeteer',
	'puppeteer-core',
	'puppeteer-extra',
	'puppeteer-extra-plugin-stealth',
	'puppeteer-extra-plugin-*',
];

// Hash every source file BEFORE bundling. After bundling, any file whose
// content still matches its pre-bundle hash was untouched by esbuild — Vercel's
// NFT would then trace it against the full ~2 GB node_modules tree, blowing the
// 45 min build timeout. Fail the build instead so the next deploy points at the
// real cause within minutes instead of after a 45-minute hang.
async function hashFile(path) {
	try {
		const buf = await readFile(path);
		return createHash('sha256').update(buf).digest('hex');
	} catch {
		return null;
	}
}

function esbuildArgs(files) {
	return [
		'--bundle',
		'--platform=node',
		'--target=node20',
		'--format=esm',
		// Some bundled CJS deps call `require("url")` (and other Node built-ins)
		// internally. esbuild inlines those into the ESM output behind a
		// `__require` shim that THROWS "Dynamic require of \"url\" is not
		// supported" because bare ESM has no `require` in scope. Marking the
		// offending packages external is whack-a-mole (the call sites live deep
		// in transitive CJS deps, not just @x402). Inject a real CommonJS
		// `require` via createRequire so the shim resolves built-ins natively.
		//
		// The banner must survive being inlined TWICE into one output: a route file
		// that imports a sibling route file (e.g. pump-fun-mcp.js → ./pump/[action].js)
		// pulls in the sibling's already-bundled copy, which carries this same banner.
		// A top-level `import { … as X }` binding can't be redeclared, so two copies
		// were a SyntaxError ("Identifier '__createRequireForBundle' has already been
		// declared") that crashed the function at load (FUNCTION_INVOCATION_FAILED).
		// `var require` redeclares legally and a dynamic `await import()` has no import
		// binding to collide, so duplication is harmless.
		`--banner:js=var require = (await import('node:module')).createRequire(import.meta.url);`,
		`--outdir=${API_DIR}`,
		`--outbase=${API_DIR}`,
		'--allow-overwrite',
		'--tree-shaking=true',
		// Whitespace+syntax minify cuts total function output from 2.33 GB to
		// 1.55 GB (-33%, measured on all 803 routes) — that volume is what Vercel's
		// post-build packaging phase chews on, and it's what pushed cold builds past
		// the 45-min BUILD_EXCEEDED_MAXIMUM_TIME ceiling on the new team (2026-07-03,
		// every production deploy dead, site down). Identifiers are deliberately NOT
		// minified: stack traces stay readable and code relying on function/class
		// names keeps working.
		'--minify-whitespace',
		'--minify-syntax',
		'--log-level=warning',
		'--log-override:unsupported-dynamic-import=silent',
		'--log-override:duplicate-object-key=silent',
		'--log-override:equals-negative-zero=silent',
		...EXTERNALS.map((e) => `--external:${e}`),
		...files,
	];
}

function runEsbuild(files, timeoutMs) {
	execFileSync(resolve(ROOT, 'node_modules/.bin/esbuild'), esbuildArgs(files), {
		cwd: ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: timeoutMs,
		maxBuffer: 10 * 1024 * 1024,
	});
}

const start = Date.now();
const routeFiles = await collectRouteFiles(API_DIR);
// BATCH_SIZE drives esbuild's native (Go) heap per invocation. On Vercel's
// ~8 GB build container, 20 caused std::bad_alloc/SIGABRT when bundle-api ran
// in parallel with the other Phase 1 native builds. Keep at 10.
const BATCH_SIZE = 10;
const totalBatches = Math.ceil(routeFiles.length / BATCH_SIZE);
console.log(`[bundle-api] Bundling ${routeFiles.length} route files in ${totalBatches} batches...`);

const preHashes = new Map();
await Promise.all(routeFiles.map(async (f) => preHashes.set(f, await hashFile(f))));

let batchErrors = 0;
let individualRetries = 0;
const individualFailures = [];

for (let i = 0; i < routeFiles.length; i += BATCH_SIZE) {
	const batch = routeFiles.slice(i, i + BATCH_SIZE);
	const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
	try {
		runEsbuild(batch, 90_000);
		process.stdout.write('.');
	} catch (err) {
		process.stdout.write('!');
		batchErrors++;
		const stderr = err.stderr?.toString().trim() || err.message || '';
		const short =
			stderr
				.split('\n')
				.filter((l) => l.includes('ERROR'))
				.slice(0, 5)
				.join('\n  ') || stderr.slice(0, 400);
		console.error(
			`\n[bundle-api] Batch ${batchIdx}/${totalBatches} failed — retrying individually:\n  ${short}`,
		);
		// Retry each file in the failed batch on its own so one bad file
		// doesn't poison the other 19. Anything still failing is definitively
		// unbundled and will block the build below.
		for (const file of batch) {
			individualRetries++;
			try {
				runEsbuild([file], 30_000);
			} catch (singleErr) {
				const ss = singleErr.stderr?.toString().trim() || singleErr.message || '';
				const sshort =
					ss
						.split('\n')
						.filter((l) => l.includes('ERROR'))
						.slice(0, 3)
						.join('\n    ') || ss.slice(0, 300);
				individualFailures.push({ file: relative(ROOT, file), error: sshort });
			}
		}
	}
}

const stillRaw = [];
for (const f of routeFiles) {
	const before = preHashes.get(f);
	const after = await hashFile(f);
	if (before && after && before === after) {
		stillRaw.push(relative(ROOT, f));
	}
}

// Verify every bare specifier the bundles still import (the EXTERNALS above)
// resolves from node_modules. esbuild never checks externals, and NFT silently
// skips ones it can't resolve — so a missing external only surfaces as a
// runtime ERR_MODULE_NOT_FOUND. That is exactly how the 2026-06-11 outage
// shipped: helius-sdk (inlined) imports @solana-program/stake (external via
// the @solana-program/* pattern), the package was an uninstalled peer dep,
// and every /api/cron/* invocation died at module load. Fail the build here,
// seconds in, instead.
const { init: lexerInit, parse: lexerParse } = await import('es-module-lexer');
await lexerInit;
const externalSpecifiers = new Map(); // specifier -> { firstUser, static }
for (const f of routeFiles) {
	let imports;
	try {
		[imports] = lexerParse(await readFile(f, 'utf8'));
	} catch {
		continue; // unparseable bundles are already reported via individualFailures/stillRaw
	}
	for (const imp of imports) {
		const spec = imp.n;
		if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:'))
			continue;
		const isStatic = imp.d === -1;
		const seen = externalSpecifiers.get(spec);
		if (!seen) {
			externalSpecifiers.set(spec, { firstUser: relative(ROOT, f), static: isStatic });
		} else if (isStatic && !seen.static) {
			seen.static = true;
			seen.firstUser = relative(ROOT, f);
		}
	}
}
// A missing STATIC import crashes the function at module load (the
// @solana-program/stake outage). A missing DYNAMIC import only throws if its
// code path runs, and packages guard optional peers exactly that way (e.g.
// resend's try/catch around @react-email/render) — warn, don't fail.
const unresolvableExternals = [];
const unresolvableDynamic = [];
for (const [spec, { firstUser, static: isStatic }] of externalSpecifiers) {
	try {
		import.meta.resolve(spec);
	} catch {
		(isStatic ? unresolvableExternals : unresolvableDynamic).push({ spec, firstUser });
	}
}
if (unresolvableDynamic.length) {
	console.warn(
		`\n[bundle-api] WARNING — ${unresolvableDynamic.length} dynamically-imported external(s) do not resolve; fine if the import is guarded (optional peer), a crash if that code path runs:`,
	);
	for (const { spec, firstUser } of unresolvableDynamic) {
		console.warn(`  ${spec} (first imported by ${firstUser})`);
	}
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const sizes = await Promise.all(routeFiles.map(async (f) => (await stat(f)).size));
const totalKB = (sizes.reduce((s, n) => s + n, 0) / 1024).toFixed(0);
console.log(
	`\n[bundle-api] Done in ${elapsed}s — ${routeFiles.length} files, ${totalKB} KB` +
		(batchErrors
			? `, ${batchErrors}/${totalBatches} batch errors (${individualRetries} individual retries)`
			: '') +
		(individualFailures.length ? `, ${individualFailures.length} routes still failing` : '') +
		(stillRaw.length ? `, ${stillRaw.length} routes left as raw source` : ''),
);

if (individualFailures.length) {
	console.error(
		`\n[bundle-api] FAILED — ${individualFailures.length} routes could not be bundled:`,
	);
	for (const { file, error } of individualFailures.slice(0, 25)) {
		console.error(`  ${file}\n    ${error}`);
	}
	if (individualFailures.length > 25)
		console.error(`  …and ${individualFailures.length - 25} more`);
}

if (stillRaw.length) {
	console.error(
		`\n[bundle-api] FAILED — ${stillRaw.length} routes left as raw source (NFT would scan full node_modules):`,
	);
	for (const f of stillRaw.slice(0, 25)) console.error(`  ${f}`);
	if (stillRaw.length > 25) console.error(`  …and ${stillRaw.length - 25} more`);
}

if (unresolvableExternals.length) {
	console.error(
		`\n[bundle-api] FAILED — ${unresolvableExternals.length} external import(s) in the bundled output do not resolve from node_modules (would crash at runtime with ERR_MODULE_NOT_FOUND):`,
	);
	for (const { spec, firstUser } of unresolvableExternals) {
		console.error(
			`  ${spec} (first imported by ${firstUser}) → add it to package.json dependencies; if it came through a peerDependency, remember legacy-peer-deps never auto-installs peers`,
		);
	}
}

// Fail fast on the build container instead of letting Vercel time out at 45 min
// trying to NFT-trace raw route files against the 2 GB node_modules tree, or —
// worse — deploy bundles whose runtime imports are missing.
if (individualFailures.length > 0 || stillRaw.length > 0 || unresolvableExternals.length > 0) {
	process.exit(1);
}
