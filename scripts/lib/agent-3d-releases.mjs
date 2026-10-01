// The <agent-3d> release ledger: which versions exist, the exact bytes each one
// is (as SRI hashes), and where those bytes are archived.
//
// Why a ledger at all: `/agent-3d/<MAJOR>.<MINOR>.<PATCH>/` is served with
// `cache-control: immutable`, and embedders pin it with an `integrity` hash. The
// old publish step rewrote that directory from whatever dist-lib/ held on every
// deploy while package.json stayed at 1.5.2 for months, so the bytes behind an
// "immutable" URL changed on every deploy and every documented SRI pin broke
// (the browser refuses a script whose hash does not match). A version is now
// cut once, by `npm run release:lib`, which archives its bytes and records their
// hashes here; every build after that serves those archived bytes under that
// version, verified against this file, and only the moving channels (latest,
// <major>, <major>.<minor>) follow the current build.
//
// Node builtins only: check-dist runs this inside Cloud Build's verify-context
// step, which has no node_modules.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const LEDGER_REL = 'data/agent-3d-releases.json';

// Every file a release carries. agent-3d.js is the ES module embedders load;
// agent-3d.umd.cjs is the same build for non-ESM environments.
export const RELEASE_FILES = ['agent-3d.js', 'agent-3d.umd.cjs'];

export function sri(bytes) {
	return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

export function readLedger(root) {
	const ledger = JSON.parse(readFileSync(resolve(root, LEDGER_REL), 'utf8'));
	if (!ledger || typeof ledger.archive !== 'string' || !ledger.releases || typeof ledger.releases !== 'object') {
		throw new Error(`${LEDGER_REL} must carry "archive" (a URL) and "releases" (an object)`);
	}
	return ledger;
}

export function writeLedger(root, ledger) {
	writeFileSync(resolve(root, LEDGER_REL), JSON.stringify(ledger, null, '\t') + '\n');
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export function parseVersion(v) {
	const m = SEMVER.exec(String(v));
	if (!m) return null;
	return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: String(v).includes('-') };
}

/** Released versions, oldest first. Prereleases sort before their release. */
export function releasedVersions(ledger) {
	return Object.keys(ledger.releases).sort((a, b) => {
		const x = parseVersion(a);
		const y = parseVersion(b);
		return x.major - y.major || x.minor - y.minor || x.patch - y.patch || Number(y.pre) - Number(x.pre);
	});
}

export function archiveUrl(ledger, version, file) {
	return `${ledger.archive.replace(/\/+$/, '')}/${version}/${file}`;
}

/**
 * The archived bytes of one released file, verified against the ledger. A local
 * cache keeps rebuilds offline-friendly; a cached copy is re-verified on every
 * read, so a corrupt cache entry is refetched rather than served.
 */
export async function fetchReleaseFile(ledger, version, file, { cacheDir = null } = {}) {
	const expected = ledger.releases[version]?.integrity?.[file];
	if (!expected) throw new Error(`${LEDGER_REL} has no ${file} hash for ${version}`);
	const cached = cacheDir ? join(cacheDir, version, file) : null;
	if (cached && existsSync(cached)) {
		const bytes = readFileSync(cached);
		if (sri(bytes) === expected) return bytes;
	}
	const url = archiveUrl(ledger, version, file);
	const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}; the archived release is unreachable`);
	const bytes = Buffer.from(await res.arrayBuffer());
	const actual = sri(bytes);
	if (actual !== expected) {
		throw new Error(`${url} hashes to ${actual} but ${LEDGER_REL} records ${expected}; refusing to publish altered bytes`);
	}
	if (cached) {
		mkdirSync(dirname(cached), { recursive: true });
		writeFileSync(cached, bytes);
	}
	return bytes;
}

// ── Documented pins ─────────────────────────────────────────────────────────
//
// Any <script> tag in the docs that loads a versioned agent-3d file with an
// integrity attribute is a promise to the reader that those exact bytes exist.
// These helpers find every such pin so check-dist can hold it to the ledger and
// `npm run check:sri-pins -- --fix` can rewrite it from the ledger.

// Where documentation lives. Tests are deliberately absent: their fixtures pin
// wrong hashes on purpose to exercise stale-pin detection.
export const PIN_ROOTS = ['docs', 'specs', 'blog', 'examples', '.agents/skills', 'public/skills', 'README.md', 'packages'];
const PIN_EXT = /\.(md|mdx|html?|txt)$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '.git']);

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const PINNED_SRC = /\bsrc\s*=\s*["']?[^"'\s>]*\/agent-3d\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\/(agent-3d\.(?:js|umd\.cjs))\b/i;
const INTEGRITY = /\bintegrity\s*=\s*["'](sha384-[A-Za-z0-9+/]{64})["']/i;

/** Every pinned, integrity-carrying agent-3d script tag in one text. */
export function findPins(text) {
	const pins = [];
	for (const m of text.matchAll(SCRIPT_TAG)) {
		const tag = m[0];
		const src = PINNED_SRC.exec(tag);
		const integrity = INTEGRITY.exec(tag);
		if (!src || !integrity) continue;
		const offset = m.index + integrity.index + integrity[0].indexOf(integrity[1]);
		pins.push({
			version: src[1],
			file: src[2],
			integrity: integrity[1],
			start: offset,
			end: offset + integrity[1].length,
			line: text.slice(0, offset).split('\n').length,
		});
	}
	return pins;
}

function walkDocs(abs, out) {
	const st = statSync(abs);
	if (st.isFile()) {
		if (PIN_EXT.test(abs)) out.push(abs);
		return;
	}
	for (const name of readdirSync(abs)) {
		if (SKIP_DIRS.has(name)) continue;
		walkDocs(join(abs, name), out);
	}
}

export function docFiles(root, roots = PIN_ROOTS) {
	const out = [];
	for (const r of roots) {
		const abs = resolve(root, r);
		if (existsSync(abs)) walkDocs(abs, out);
	}
	return out.sort();
}

/**
 * Check (and optionally rewrite) every documented pin against the ledger.
 * Returns { checked, problems: [{ file, line, message }], fixed }.
 * A pin on a version the ledger does not know cannot be fixed by rewriting a
 * hash, so it stays a problem even with fix=true.
 */
export function checkPins(root, ledger, { fix = false, roots = PIN_ROOTS } = {}) {
	const problems = [];
	let checked = 0;
	let fixed = 0;
	for (const abs of docFiles(root, roots)) {
		const text = readFileSync(abs, 'utf8');
		if (!text.includes('/agent-3d/')) continue;
		const pins = findPins(text);
		if (!pins.length) continue;
		const rel = relative(root, abs);
		let next = text;
		// Right to left, so earlier offsets stay valid while later ones are rewritten.
		for (const pin of [...pins].reverse()) {
			checked++;
			const expected = ledger.releases[pin.version]?.integrity?.[pin.file];
			if (!expected) {
				problems.push({ file: rel, line: pin.line, message: `pins agent-3d ${pin.version}, which ${LEDGER_REL} has never released` });
				continue;
			}
			if (pin.integrity === expected) continue;
			if (fix) {
				next = next.slice(0, pin.start) + expected + next.slice(pin.end);
				fixed++;
			} else {
				problems.push({
					file: rel,
					line: pin.line,
					message: `${pin.file} ${pin.version} is pinned to ${pin.integrity} but the release is ${expected}; browsers will refuse it`,
				});
			}
		}
		if (next !== text) writeFileSync(abs, next);
	}
	return { checked, problems, fixed };
}
