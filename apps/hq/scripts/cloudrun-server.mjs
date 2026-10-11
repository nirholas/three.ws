#!/usr/bin/env node
// Cloud Run entry point: serves the built static app from dist/ and forwards
// /api/* to the desktop sidecar API server (src-tauri/sidecar/local-api-server.mjs)
// running in-process on loopback. Replaces Vercel hosting (vercel.json headers
// and rewrites are reproduced here).
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { createLocalApiServer } from '../src-tauri/sidecar/local-api-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8080);
const API_PORT = Number(process.env.LOCAL_API_PORT ?? 46123);

const CSP_FRAME_ANCESTORS =
  'frame-ancestors https://three.ws https://*.three.ws http://localhost:3000 http://localhost:3001 http://localhost:3210;';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.topojson': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = new Set(['.css', '.geojson', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.topojson', '.txt', '.webmanifest']);

function cacheControlFor(pathname) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/favico/')) return 'public, max-age=604800';
  if (pathname === '/offline.html') return 'public, max-age=86400';
  if (pathname === '/sw.js') return 'public, max-age=0, must-revalidate';
  if (pathname === '/manifest.webmanifest') return 'public, max-age=86400';
  return 'public, max-age=0, must-revalidate';
}

function resolveStaticFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = path.normalize(path.join(DIST, decoded));
  if (!candidate.startsWith(DIST + path.sep) && candidate !== DIST) return null;

  const candidates = [];
  if (decoded === '/' || decoded === '') {
    candidates.push(path.join(DIST, 'index.html'));
  } else {
    candidates.push(candidate);
    if (!path.extname(candidate)) candidates.push(`${candidate}.html`);
  }

  for (const file of candidates) {
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

function sendFile(req, res, file, pathname) {
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'cache-control': cacheControlFor(pathname),
    'content-type': MIME[ext] ?? 'application/octet-stream',
  };
  if (ext === '.html' || pathname === '/' || pathname === '') {
    headers['content-security-policy'] = CSP_FRAME_ANCESTORS;
  }

  let body = readFileSync(file);
  const acceptEncoding = req.headers['accept-encoding'] ?? '';
  if (COMPRESSIBLE.has(ext) && acceptEncoding.includes('gzip') && body.length > 1024) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'Accept-Encoding';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function proxyApi(req, res, pathname) {
  // Desktop-only management routes must never be reachable on a public deployment.
  if (pathname.startsWith('/api/local-')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const upstream = http.request(
    {
      headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
      hostname: '127.0.0.1',
      method: req.method,
      path: req.url,
      port: API_PORT,
    },
    (apiRes) => {
      res.writeHead(apiRes.statusCode ?? 502, apiRes.headers);
      apiRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    console.error('[cloudrun-server] api proxy error', error);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'API upstream unavailable' }));
  });
  req.pipe(upstream);
}

const api = await createLocalApiServer({
  cloudFallback: false,
  mode: 'cloud-run',
  port: API_PORT,
  resourceDir: ROOT,
});
await api.start();

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request' }));
    return;
  }

  if (pathname.startsWith('/api/')) {
    proxyApi(req, res, pathname);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (pathname === '/intel') {
    const intel = resolveStaticFile('/intel.html');
    if (intel) {
      sendFile(req, res, intel, '/intel.html');
      return;
    }
  }

  const file = resolveStaticFile(pathname);
  if (file) {
    sendFile(req, res, file, pathname);
    return;
  }

  res.writeHead(404, { 'content-security-policy': CSP_FRAME_ANCESTORS, 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[cloudrun-server] listening on 0.0.0.0:${PORT} (static=${DIST}, api=127.0.0.1:${API_PORT})`);
});
