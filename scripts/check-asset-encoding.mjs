#!/usr/bin/env node
// Catches a static asset whose declared length disagrees with the bytes a
// browser actually receives.
//
// On 2026-09-11 the CDN held a variant of the 11 MB MediaPipe WASM runtime
// that carried `content-length: 11153617` (the uncompressed size) with a
// brotli-compressed body and no `content-encoding` header. Every browser that
// advertises zstd alongside br, which is every current Chrome and Edge, waited
// forever for eight megabytes that were never coming. curl with a plain
// `Accept-Encoding: br` saw a perfectly healthy response, and so did every
// page check we run, because a page check reads HTML, not the largest binary
// on the site. /create/selfie hung at "Processing your face..." for as long as
// anyone was willing to wait.
//
//   npm run check:asset-encoding
//   node scripts/check-asset-encoding.mjs --base https://three.ws --min-bytes=500000
//
// What it does: finds the largest compressible files under public/, requests
// each one from the live site with the exact Accept-Encoding a browser sends,
// reads the body to completion under a deadline, and fails when the bytes
// received do not match what the response promised (or when the read never
// finishes).

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
// What a current Chrome sends. The zstd token is the one that shook the bug
// loose, so it stays in the string verbatim.
const BROWSER_ACCEPT_ENCODING = 'gzip, deflate, br, zstd';
const COMPRESSIBLE = new Set(['.wasm', '.js', '.mjs', '.json', '.css', '.svg', '.html', '.txt', '.map']);

// Accepts both `--base=x` and `--base x`, because both forms read naturally on
// a command line and a silently mis-parsed base URL is a confusing failure.
const args = new Map();
for (let i = 0; i < process.argv.length - 2; i++) {
	const raw = process.argv[i + 2];
	if (!raw.startsWith('--')) continue;
	const [key, ...rest] = raw.slice(2).split('=');
	if (rest.length) { args.set(key, rest.join('=')); continue; }
	const next = process.argv[i + 3];
	args.set(key, next && !next.startsWith('--') ? next : 'true');
}

const base = (args.get('base') || 'https://three.ws').replace(/\/$/, '');
const minBytes = Number(args.get('min-bytes') || 400_000);
const limit = Number(args.get('limit') || 12);
const timeoutMs = Number(args.get('timeout') || 30_000);

async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (entry.isFile()) yield full;
	}
}

async function candidates() {
	const found = [];
	for await (const file of walk(PUBLIC_DIR)) {
		if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
		const { size } = await stat(file);
		if (size < minBytes) continue;
		found.push({ size, url: `${base}/${path.relative(PUBLIC_DIR, file).split(path.sep).join('/')}` });
	}
	return found.sort((a, b) => b.size - a.size).slice(0, limit);
}

async function check({ url, size }) {
	const started = Date.now();
	let res;
	try {
		res = await fetch(url, {
			headers: { 'accept-encoding': BROWSER_ACCEPT_ENCODING, 'user-agent': 'three-ws-asset-check' },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		return { url, size, ok: false, reason: `request failed: ${err.name === 'TimeoutError' ? `no response in ${timeoutMs}ms` : err.message}` };
	}
	if (!res.ok) return { url, size, ok: false, reason: `HTTP ${res.status}` };

	// Node's fetch decodes content-encoding transparently, so the decoded byte
	// count is what a browser would end up holding. Reading it to completion is
	// the whole point: a truncated body only reveals itself here.
	let received = 0;
	try {
		for await (const chunk of res.body) received += chunk.length;
	} catch (err) {
		const ms = Date.now() - started;
		return { url, size, ok: false, reason: `body never finished (${received} of ${size} bytes in ${ms}ms): ${err.message}` };
	}

	const encoding = res.headers.get('content-encoding');
	const declared = Number(res.headers.get('content-length') || 0);
	// An identity response must declare exactly what it sends. A compressed one
	// declares the compressed length, which is smaller by design.
	if (!encoding && declared && declared !== received) {
		return { url, size, ok: false, reason: `content-length ${declared} but ${received} bytes arrived, with no content-encoding` };
	}
	// A size difference against the working copy is usually deploy skew (this
	// worktree is ahead of the running revision), not corruption, so it reports
	// rather than fails. Corruption shows up above, as a body that never ends.
	const note = received === size ? null : `live copy is ${received} bytes, this worktree has ${size}`;
	return { url, size, ok: true, ms: Date.now() - started, encoding: encoding || 'identity', note };
}

const assets = await candidates();
if (!assets.length) {
	console.log(`\n  nothing under public/ is both compressible and at least ${minBytes} bytes.\n`);
	process.exit(0);
}

console.log(`\n  ${assets.length} asset(s) against ${base}, as a browser asks for them\n`);
const results = [];
for (const asset of assets) {
	const result = await check(asset);
	results.push(result);
	const name = result.url.replace(base, '');
	console.log(result.ok
		? `  ok    ${name}  (${(result.size / 1048576).toFixed(1)} MB ${result.encoding}, ${result.ms}ms)`
		: `  FAIL  ${name}\n        ${result.reason}`);
	if (result.note) console.log(`        note: ${result.note}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
	console.error(`\n  ${failed.length} asset(s) do not serve cleanly. If the origin is healthy, the CDN is holding a bad copy:\n` +
		`  gcloud compute url-maps invalidate-cdn-cache three-ws-lb --path '<path>' --project aerial-vehicle-466722-p5\n`);
	process.exit(1);
}
console.log(`\n  every asset arrived intact.\n`);
