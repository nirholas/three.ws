#!/usr/bin/env node
/**
 * Serve a local production build the way production routes it, with live data.
 *
 * Measuring a fix before it deploys needs two things at once: the BUILT bundle
 * (the Vite dev server ships unbundled modules, so its LCP and blocking time
 * say nothing about production) and REAL data (a plain static server answers
 * every /api call with a 404, so data-driven pages measure their error states).
 * This server gives both:
 *
 *   - HTML and static files come from the build directory, resolved through the
 *     same vercel.json route table production uses (server/route-resolve.mjs),
 *     so /coin/<mint>, /agents/<id> and /marketplace map to the same documents.
 *   - Anything the build does not have (/api/*, /cdn/*, /ingest/*, avatars that
 *     live in the bucket, ...) is streamed from the upstream origin, production
 *     by default, so every page renders the data a visitor would see.
 *   - Responses are compressed with the same filter production uses, so
 *     transfer sizes match what a phone downloads.
 *
 * It is a measurement tool, not a second production server: no SSR head
 * rewrites, no CSP hashing, no API handlers run locally.
 *
 * Usage:
 *   node scripts/perf-preview-server.mjs --dist <build dir> [--port 4317] [--upstream https://three.ws]
 *   node scripts/mobile-perf.mjs --base http://localhost:4317 --budget
 */

import express from 'express';
import compression from 'compression';
import { statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';
import { shouldCompress } from '../server/compression-filter.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Hop-by-hop headers, plus the two that stop being true once Node's fetch has
// decoded the upstream body (it decompresses transparently).
const DROP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding']);
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']);

function parseArgs(argv) {
	const opts = { dist: null, port: 4317, upstream: 'https://three.ws' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dist') opts.dist = argv[++i];
		else if (a === '--port') opts.port = Number(argv[++i]);
		else if (a === '--upstream') opts.upstream = argv[++i].replace(/\/$/, '');
		else if (a === '--help' || a === '-h') opts.help = true;
	}
	return opts;
}

/** A file inside distRoot for this path, trying the directory index and the .html form. */
export function staticFileFor(distRoot, pathname) {
	let rel;
	try {
		rel = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const abs = path.normalize(path.join(distRoot, rel));
	if (!abs.startsWith(distRoot + path.sep) && abs !== distRoot) return null;
	for (const candidate of [abs, path.join(abs, 'index.html'), `${abs}.html`]) {
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {
			// Not this form; try the next one.
		}
	}
	return null;
}

/**
 * Where a request is served from: a build file, a redirect, or the upstream.
 * Mirrors the production order: phase-1 routes, the filesystem, post-filesystem
 * routes, and only then the upstream.
 */
export function resolveRequest({ distRoot, phase1Routes, postFsRoutes }, req, url) {
	const first = resolvePhase1(phase1Routes, req, url);
	if (first.terminal === 'status' && first.headers.Location) {
		return { kind: 'redirect', status: first.status, location: first.headers.Location };
	}
	if (first.terminal === 'external') return { kind: 'upstream' };
	if (first.path.startsWith('/api/')) return { kind: 'upstream' };
	const file = staticFileFor(distRoot, first.path);
	if (file) return { kind: 'file', file };
	const after = resolvePhase1(postFsRoutes, req, new URL(first.path, url));
	if (after.terminal === 'status' && after.headers.Location) {
		return { kind: 'redirect', status: after.status, location: after.headers.Location };
	}
	if (after.path !== first.path && !after.path.startsWith('/api/')) {
		const routed = staticFileFor(distRoot, after.path);
		if (routed) return { kind: 'file', file: routed };
	}
	return { kind: 'upstream' };
}

async function proxy(req, res, upstream) {
	const headers = {};
	for (const [k, v] of Object.entries(req.headers)) {
		if (!DROP_REQUEST.has(k)) headers[k] = v;
	}
	const target = new URL(req.originalUrl, upstream);
	headers.origin &&= upstream;
	headers.referer &&= headers.referer.replace(/^https?:\/\/[^/]+/, upstream);
	try {
		const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
		const r = await fetch(target, {
			method: req.method,
			headers,
			body: hasBody ? Readable.toWeb(req) : undefined,
			duplex: hasBody ? 'half' : undefined,
			redirect: 'manual',
		});
		res.status(r.status);
		r.headers.forEach((v, k) => {
			if (DROP_RESPONSE.has(k)) return;
			if (k === 'location') v = v.replace(upstream, '');
			res.setHeader(k, v);
		});
		if (!r.body || req.method === 'HEAD') return res.end();
		Readable.fromWeb(r.body).pipe(res);
	} catch (err) {
		console.error(`[perf-preview] upstream ${req.method} ${target.pathname} failed: ${err.message}`);
		if (!res.headersSent) res.status(502).type('text/plain').send(`upstream unreachable: ${err.message}`);
		else res.end();
	}
}

export function createApp({ distRoot, upstream }) {
	const { phase1Routes, postFsRoutes } = loadRouteTable(path.join(ROOT, 'vercel.json'));
	const table = { distRoot, phase1Routes, postFsRoutes };
	const app = express();
	app.disable('x-powered-by');
	app.use(compression({ filter: shouldCompress }));
	app.use((req, res) => {
		const url = new URL(req.originalUrl, 'http://perf-preview.local');
		const target = req.method === 'GET' || req.method === 'HEAD' ? resolveRequest(table, req, url) : { kind: 'upstream' };
		if (target.kind === 'redirect') return res.redirect(target.status || 302, target.location);
		if (target.kind === 'file') {
			const immutable = url.pathname.startsWith('/assets/');
			return res.sendFile(target.file, {
				headers: { 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
			});
		}
		return proxy(req, res, upstream);
	});
	return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help || !opts.dist) {
		console.log('usage: node scripts/perf-preview-server.mjs --dist <build dir> [--port 4317] [--upstream https://three.ws]');
		process.exit(opts.help ? 0 : 1);
	}
	const distRoot = path.resolve(opts.dist);
	try {
		statSync(path.join(distRoot, 'index.html'));
	} catch {
		console.error(`[perf-preview] ${distRoot} has no index.html; build first (npm run build).`);
		process.exit(1);
	}
	createApp({ distRoot, upstream: opts.upstream }).listen(opts.port, () => {
		console.log(`[perf-preview] serving ${distRoot} on http://localhost:${opts.port}, upstream ${opts.upstream}`);
	});
}
