#!/usr/bin/env node
/**
 * Benchmark behind docs/partners/microsoft/tech-community-onnx-speech.md.
 *
 * Serves onnx-speech-bench.html with the repo's own onnxruntime-web build and
 * openWakeWord graphs, then times in headless Chromium:
 *   - the wake-word chain (mel, embedding, classifier) per 80 ms chunk;
 *   - Moonshine Base and Whisper Base (q8, wasm) on the 11 s JFK clip, four
 *     runs each after one warm-up run.
 * The JFK clip is the public-domain sample Transformers.js documents with,
 * fetched from Hugging Face at run time. Model files download from Hugging
 * Face the same way they do for a visitor; their requests are logged.
 *
 * Usage: node scripts/microsoft-pack/onnx-speech-bench.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// onnxruntime-web does not export its package.json or dist/ directory, so the
// runtime files are read from the installed package the app itself bundles.
const ortDist = join(root, 'node_modules/onnxruntime-web/dist/');
const wakeWordDir = join(root, 'public/models/voice/wake-word/');
const JFK_URL = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';
const PORT = 3925;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.wav': 'audio/wav' };

const jfkRes = await fetch(JFK_URL);
if (!jfkRes.ok) throw new Error(`JFK clip download failed: HTTP ${jfkRes.status}`);
const jfk = Buffer.from(await jfkRes.arrayBuffer());

const server = createServer(async (req, res) => {
	const path = req.url.split('?')[0];
	let file = join(here, 'onnx-speech-bench.html');
	if (path === '/jfk.wav') {
		res.writeHead(200, { 'content-type': 'audio/wav' });
		return res.end(jfk);
	}
	if (path.startsWith('/ort/')) file = join(ortDist, path.slice(5));
	else if (path.startsWith('/ww/')) file = join(wakeWordDir, path.slice(4));
	try {
		const body = await readFile(file);
		res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}).listen(PORT, '127.0.0.1');

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	page.on('response', (r) => {
		if (/\.onnx(\?|$)/.test(r.url()) && !r.url().startsWith('http://127.0.0.1')) {
			console.log(`model file: ${r.status()} ${r.url()} ${r.headers()['content-length'] || ''}`);
		}
	});
	page.on('console', (m) => {
		if (m.type() === 'error') console.error(`console: ${m.text()}`);
	});
	await page.goto(`http://127.0.0.1:${PORT}/`);
	await page.waitForFunction(() => window.__done, null, { timeout: 900_000, polling: 1000 });
	const result = await page.evaluate(() => window.__result);
	console.log(JSON.stringify({ chromium: browser.version(), jfkBytes: jfk.length, ...result }, null, 2));
	if (result.error) process.exitCode = 1;
} finally {
	await browser.close();
	server.close();
}
