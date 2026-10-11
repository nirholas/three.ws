#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_REL, RELEASE_FILES, checkPins, readLedger, releasedVersions, sri } from './lib/agent-3d-releases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
	'dist/agent-3d/latest/agent-3d.js',
	'dist/agent-3d/latest/agent-3d.umd.cjs',
	'dist/agent-3d/versions.json',
	// The one runtime fetch behind /timeline (copied by vite.config.js's
	// copy-timeline-data hook). It was missing from every production build
	// until 2026-09-01, which left the page on its error state.
	'dist/data/timeline.json',
	// The chart-source switcher at its stable URL. /oracle/coin/<mint> is
	// buildless and imports it by this exact name; without it the page falls
	// back to its native line chart and quietly loses every chart terminal.
	'dist/chart-switcher.js',
];



let ok = true;
for (const rel of required) {
	if (!existsSync(resolve(root, rel))) {
		console.error(`[check-dist] MISSING: ${rel}`);
		ok = false;
	}
}

if (ok) {
	const versions = JSON.parse(readFileSync(resolve(root, 'dist/agent-3d/versions.json'), 'utf8'));
	const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	if (versions.latest !== pkg.version) {
		console.error(
			`[check-dist] versions.json "latest" is "${versions.latest}" but package.json is "${pkg.version}"`,
		);
		ok = false;
	}
}

// ── Immutable <agent-3d> releases ──────────────────────────────────────────
// /agent-3d/<version>/ is served `immutable` and pinned with SRI, so its bytes
// must be the released bytes and nothing else. Until 2026-10-01 the publish
// step rebuilt that directory on every deploy, the hash changed under every
// pinned embed, and browsers refused to run the script. Every release in the
// ledger must be present and hash to its recorded value, versions.json must
// advertise exactly those hashes, and so must every SRI pin in the docs.
let ledger = null;
try {
	ledger = readLedger(root);
} catch (err) {
	console.error(`[check-dist] ${LEDGER_REL} is unreadable: ${err.message}`);
	ok = false;
}
if (ledger) {
	const releases = releasedVersions(ledger);
	const manifestPath = resolve(root, 'dist/agent-3d/versions.json');
	const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
	let releaseProblems = 0;
	for (const v of releases) {
		for (const name of RELEASE_FILES) {
			const expected = ledger.releases[v].integrity?.[name];
			const p = resolve(root, 'dist/agent-3d', v, name);
			if (!existsSync(p)) {
				console.error(`[check-dist] MISSING released file: dist/agent-3d/${v}/${name}`);
				releaseProblems++;
				continue;
			}
			const actual = sri(readFileSync(p));
			if (actual !== expected) {
				console.error(`[check-dist] dist/agent-3d/${v}/${name} hashes to ${actual} but release ${v} is ${expected}; an immutable URL would change bytes`);
				releaseProblems++;
			}
			const advertised = manifest?.channels?.[v]?.integrity?.[name];
			if (manifest && advertised !== expected) {
				console.error(`[check-dist] versions.json advertises ${advertised ?? 'nothing'} for ${v} ${name}; the release is ${expected}`);
				releaseProblems++;
			}
		}
	}
	const pins = checkPins(root, ledger);
	for (const p of pins.problems) {
		console.error(`[check-dist] SRI pin ${p.file}:${p.line} ${p.message}`);
		releaseProblems++;
	}
	if (pins.problems.length) console.error('[check-dist] fix the pins with: npm run check:sri-pins -- --fix');
	if (releaseProblems) ok = false;
	else console.log(`[check-dist] ${releases.length} immutable agent-3d release(s) byte-exact; ${pins.checked} documented SRI pin(s) match`);
}

// dist-lib mirror checks
const distLibChecks = [
	{ rel: 'dist/dist-lib/agent-3d.js', min: 1_000_000 },
	{ rel: 'dist/dist-lib/agent-3d.umd.cjs', min: 100_000 },
];
for (const { rel, min } of distLibChecks) {
	const p = resolve(root, rel);
	if (!existsSync(p)) {
		console.error(`[check-dist] MISSING: ${rel}`);
		ok = false;
	} else {
		const size = statSync(p).size;
		if (size < min) {
			console.error(`[check-dist] TOO SMALL: ${rel} (${size} bytes, expected >= ${min})`);
			ok = false;
		}
	}
}

// Known high-traffic static pages, checked directly against server/index.mjs's
// resolveStatic() resolution (directory → index.html fallback). A deploy with
// `npm run build` skipped (or run from a stale checkout) ships an incomplete
// dist/ with no error — that's exactly how /dashboard and /pump-dashboard
// 404'd in production on 2026-07-08 while check:dist reported green, because
// this check only ever looked at the agent-3d embed bundle. This list stays as
// a fast, dependency-free tripwire for "was `npm run build` skipped entirely".
//
// The full sweep of data/pages.json now lives in scripts/check-pages.mjs, which
// runs straight after this one in `build:gcp`. The reason it wasn't done here
// is that a naive "every registered path must have a dist/ file" check
// false-flags the ~200 entries served by api/** handlers at request time
// (docs/*, tutorials/*, .well-known/*). check-pages.mjs resolves each path
// through the real vercel.json route table instead, so it can tell a
// server-rendered page from an unreachable one and needs no allowlist.
const criticalStaticPages = ['/', '/dashboard', '/pump-dashboard', '/dashboard-next', '/create', '/discover', '/chat'];

function resolvesToFile(pagePath) {
	// vercel.json rewrites "/" -> "/desktop.html" (server/index.mjs's phase1Routes,
	// exact literal src, no /? suffix) rather than serving dist/index.html.
	const candidates =
		pagePath === '/'
			? ['desktop.html']
			: [pagePath, `${pagePath}/index.html`, `${pagePath}.html`];
	for (const rel of candidates) {
		const abs = resolve(root, 'dist', rel.replace(/^\//, ''));
		try {
			const st = statSync(abs);
			if (st.isFile()) return true;
			if (st.isDirectory() && existsSync(resolve(abs, 'index.html'))) return true;
		} catch {
			// try next candidate
		}
	}
	return false;
}

const missingPages = criticalStaticPages.filter((p) => !resolvesToFile(p));
if (missingPages.length) {
	console.error(`[check-dist] ${missingPages.length} critical static page(s) missing from dist/ (did \`npm run build\` run?):`);
	for (const p of missingPages) console.error(`[check-dist]   MISSING PAGE: ${p}`);
	ok = false;
}

// ── Chunk-graph integrity ──────────────────────────────────────────────────
// Every hashed asset the build points at must actually exist in dist/. A build
// whose lazy chunk references a sibling that was never emitted (or that a later
// step overwrote with a different build's output) ships green: the entry page
// loads, the page renders, and the feature behind that dynamic import is dead
// with a 404 nobody sees until a user clicks it. That is how the Fork button on
// /radar, /trades and /smart-money died in production on 2026-09-08: the
// deployed fork-trade chunk imported a coin-buy chunk the deployed dist did not
// contain, so every click 404'd into the error toast.
//
// Scope is deliberately narrow: only files inside a built `assets/` directory,
// and only references that point back into one. That covers the whole emitted
// chunk graph (the root build plus the /chat and /avatar-studio sub-apps, each
// with its own assets dir) while ignoring dist/src/**, the raw sources we also
// publish, whose import paths are source-relative and never resolve in dist.
const distRoot = resolve(root, 'dist');
// Vite names every emitted chunk `<name>-<hash>.<ext>` with an 8-character
// hash. Requiring that shape is what keeps unhashed strings that merely look
// like module paths (wasm glue names, editor panel ids that Rollup already
// inlined) from reading as broken references.
const HASHED = String.raw`[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:js|css)`;
const CHUNK_REF = new RegExp(String.raw`["'(,\s](\.{1,2}/${HASHED}|(?:/|(?:\.{1,2}/)*)?[A-Za-z0-9._/-]*assets/${HASHED})`, 'g');
const HTML_REF = new RegExp(String.raw`(?:src|href)=["']([^"']*/assets/${HASHED})["']`, 'g');

const dangling = new Map();
function note(ref, fromAbs, fromLabel) {
	// Three reference shapes, three bases. A root-relative href resolves against
	// dist/. A `./sibling.js` import resolves against the importing file's own
	// directory. A Vite dep-map entry is written as `assets/x.js` relative to the
	// build's BASE, which is the directory holding that assets dir (dist/ for the
	// main build, dist/chat/ and dist/avatar-studio/ for the sub-apps).
	let abs;
	if (ref.startsWith('/')) abs = resolve(distRoot, ref.slice(1));
	else if (ref.startsWith('.')) abs = resolve(dirname(fromAbs), ref);
	else abs = resolve(buildBase(fromAbs), ref);
	if (existsSync(abs)) return;
	if (!dangling.has(ref)) dangling.set(ref, new Set());
	dangling.get(ref).add(fromLabel);
}

/** The directory a chunk's `assets/...` references are relative to. */
function buildBase(fromAbs) {
	let dir = dirname(fromAbs);
	while (dir.startsWith(distRoot) && dir !== distRoot) {
		if (dir.endsWith(`${sep}assets`)) return dirname(dir);
		dir = dirname(dir);
	}
	return distRoot;
}

// Built files worth scanning: every .js/.css that lives in an `assets/` dir,
// plus every HTML entry page (which is what names the entry chunks).
function collect(dir, inAssets, out = []) {
	let entries;
	// dist/ carries symlinked trees, and a concurrent build may be rewriting it,
	// so an unreadable directory is skipped rather than crashing the gate.
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const entry of entries) {
		const abs = resolve(dir, entry.name);
		let isDir = entry.isDirectory();
		if (entry.isSymbolicLink()) {
			try { isDir = statSync(abs).isDirectory(); } catch { continue; }
		}
		if (isDir) collect(abs, inAssets || entry.name === 'assets', out);
		else if (entry.name.endsWith('.html')) out.push(abs);
		else if (inAssets && /\.(?:js|css)$/.test(entry.name)) out.push(abs);
	}
	return out;
}

if (!existsSync(resolve(distRoot, 'assets'))) {
	console.error('[check-dist] MISSING: dist/assets (did `npm run build` run?)');
	ok = false;
} else {
	const files = collect(distRoot, false);
	for (const abs of files) {
		let text;
		try { text = readFileSync(abs, 'utf8'); } catch { continue; }
		const label = abs.slice(root.length + 1);
		for (const m of text.matchAll(abs.endsWith('.html') ? HTML_REF : CHUNK_REF)) note(m[1], abs, label);
	}
	if (dangling.size) {
		console.error(`[check-dist] ${dangling.size} built asset(s) referenced by the chunk graph but missing from dist/:`);
		for (const [ref, from] of dangling) {
			console.error(`[check-dist]   DANGLING: ${ref}  <- ${[...from].slice(0, 4).join(', ')}`);
		}
		ok = false;
	} else {
		console.log(`[check-dist] chunk graph OK - every asset reference across ${files.length} built files resolves`);
	}
}

if (!ok) process.exit(1);
console.log('[check-dist] dist-lib mirror OK');
console.log(`[check-dist] all ${criticalStaticPages.length} critical static pages present`);
console.log('[check-dist] OK — dist/agent-3d/latest/ ready for deploy');
