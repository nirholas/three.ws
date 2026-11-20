#!/usr/bin/env node
// npm run grok:craft-verify
//
// Proves that every code block in the threejs-craft Grok Build plugin
// (integrations/grok/threejs-craft) runs. For each SKILL.md it:
//   1. downloads a real CC0 GLB from the three.ws catalog as `model.glb`,
//   2. runs every glTF Transform shell block the skill teaches against it, so
//      the compressed files (meshopt, Draco, KTX2) the JS blocks load are the
//      CLI's real output,
//   3. builds each non-partial JS block into a page with the pinned three.js
//      (the documented jsDelivr import map, answered from node_modules/three),
//   4. runs it in Playwright Chromium and fails on a thrown error, an
//      unhandled rejection, a console error or warning, a request to a host
//      the skills do not name, or a blank canvas (pixel check).
//
// Flags: --only <skill>[,<skill>]  --port <n> (default 3285)  --keep (save
// every canvas screenshot under .cache/grok-craft/shots)  --json  --verbose (echo
// every page console message, for debugging a block)

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allBlocks, importSpecifiers, usesWebGPU } from '../integrations/grok/threejs-craft/tests/extract-blocks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'integrations/grok/threejs-craft');
const CACHE = join(ROOT, '.cache/grok-craft');
const require = createRequire(join(ROOT, 'package.json'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ONLY = opt('only', '') ? new Set(opt('only', '').split(',')) : null;
const PORT = Number(opt('port', 3285));
const KEEP = flag('keep');
const JSON_OUT = flag('json');
const VERBOSE = flag('verbose');

const log = (...a) => {
	if (!JSON_OUT) console.log(...a);
};

// The catalog item every skill's relative `model*.glb` paths resolve to. A
// small CC0 prop keeps the run fast; the search is live, so a renamed item
// fails loudly here rather than silently testing nothing.
const CATALOG_QUERY = 'https://three.ws/api/catalog?q=armchair&kind=object&limit=1';

// Hosts a skill's code may reach. Everything else is aborted and reported.
const ALLOWED_HOSTS = new Set([
	'three.ws', // free catalog search
	'pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev', // catalog CDN (CC0 GLBs)
	'dl.polyhaven.org', // CC0 HDRIs
	'cdn.jsdelivr.net', // pinned three.js, answered locally below
]);

// Browser-environment messages that say nothing about the code under test:
// software rasterizer chatter, and WebGPURenderer reporting that this
// headless Chromium has no WebGPU adapter (it then runs its WebGL2 backend,
// which is exactly the fallback the skill describes).
const ENV_NOISE = [
	/GPU stall due to ReadPixels/i,
	/swiftshader/i,
	/WebGL-[0-9a-f]+/i,
	/Automatic fallback to software WebGL/i,
	/WebGPU is not available, running under WebGL2 backend/i,
	/No available adapters/i,
];

// ---------- three.js pin ----------

function threeRoot() {
	return dirname(dirname(require.resolve('three')));
}

async function threeRevision() {
	const mod = await import(require.resolve('three').replace(/three\.cjs$/, 'three.module.js'));
	return mod.REVISION;
}

function pinnedVersion() {
	const pkg = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));
	const v = pkg.devDependencies?.three;
	if (!/^\d+\.\d+\.\d+$/.test(v || '')) throw new Error(`plugin package.json must pin three to an exact version, found ${v}`);
	return v;
}

// ---------- KTX-Software (the `ktx` CLI glTF Transform shells out to) ----------

const KTX_VERSION = '4.4.2';

function hasKtx(env) {
	const r = spawnSync('ktx', ['--version'], { env, encoding: 'utf8' });
	return r.status === 0;
}

// GNU tar shells out to bzip2, which slim images leave out. Python's tarfile
// carries its own bz2 codec, and the 'data' filter refuses absolute paths and
// links that escape the target directory.
function extractTarBz2(archive, dest) {
	if (spawnSync('bzip2', ['--help'], { stdio: 'ignore' }).status === 0) {
		execFileSync('tar', ['-xjf', archive, '-C', dest]);
		return;
	}
	execFileSync('python3', [
		'-I',
		'-c',
		'import sys, tarfile\nwith tarfile.open(sys.argv[1], "r:bz2") as t: t.extractall(sys.argv[2], filter="data")',
		archive,
		dest,
	]);
}

async function ensureKtx(env) {
	if (hasKtx(env)) return env;
	if (process.platform !== 'linux' || process.arch !== 'x64') {
		throw new Error(`KTX2 blocks need Khronos KTX-Software ${KTX_VERSION}+ on PATH (https://github.com/KhronosGroup/KTX-Software/releases)`);
	}
	const name = `KTX-Software-${KTX_VERSION}-Linux-x86_64`;
	const dir = join(CACHE, name);
	if (!existsSync(join(dir, 'bin/ktx'))) {
		const base = `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/${name}.tar.bz2`;
		log(`  fetching ${name} (official Khronos release)`);
		const [tar, sha1] = await Promise.all([
			fetch(base).then((r) => {
				if (!r.ok) throw new Error(`KTX-Software download ${r.status}`);
				return r.arrayBuffer();
			}),
			fetch(`${base}.sha1`).then((r) => r.text()),
		]);
		const buf = Buffer.from(tar);
		const got = createHash('sha1').update(buf).digest('hex');
		const want = sha1.trim().split(/\s+/)[0].toLowerCase();
		if (got !== want) throw new Error(`KTX-Software checksum mismatch: ${got} != ${want}`);
		mkdirSync(CACHE, { recursive: true });
		const archive = join(CACHE, `${name}.tar.bz2`);
		writeFileSync(archive, buf);
		extractTarBz2(archive, CACHE);
		rmSync(archive);
	}
	const next = {
		...env,
		PATH: `${join(dir, 'bin')}${sep === '\\' ? ';' : ':'}${env.PATH}`,
		LD_LIBRARY_PATH: [join(dir, 'lib'), env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
	};
	if (!hasKtx(next)) throw new Error(`ktx from ${dir} does not run`);
	return next;
}

// ---------- the real catalog model ----------

async function fetchCatalogModel(workdir) {
	const res = await fetch(CATALOG_QUERY);
	if (!res.ok) throw new Error(`catalog search answered ${res.status}`);
	const body = await res.json();
	const item = body.items?.[0];
	if (!item || item.license !== 'CC0' || !item.url) throw new Error(`catalog search returned no CC0 item: ${JSON.stringify(body).slice(0, 200)}`);
	const cached = join(CACHE, 'models', `${item.id.replace(/[^a-z0-9_-]/gi, '_')}.glb`);
	if (!existsSync(cached)) {
		const glb = await fetch(item.url);
		if (!glb.ok) throw new Error(`catalog GLB answered ${glb.status}`);
		mkdirSync(dirname(cached), { recursive: true });
		writeFileSync(cached, Buffer.from(await glb.arrayBuffer()));
	}
	copyFileSync(cached, join(workdir, 'model.glb'));
	return item;
}

// ---------- shell blocks ----------

function runShellBlock(block, workdir, env) {
	for (const cmd of block.commands) {
		const argv = cmd.split(/\s+/);
		const r = spawnSync(argv[0], argv.slice(1), { cwd: workdir, env, encoding: 'utf8', timeout: 600_000 });
		if (r.status !== 0) {
			return `\`${cmd}\` exited ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-6).join(' | ')}`;
		}
	}
	return null;
}

// ---------- static server ----------

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.glb': 'model/gltf-binary',
	'.wasm': 'application/wasm',
	'.ktx2': 'image/ktx2',
	'.hdr': 'application/octet-stream',
};

function importMap(version, webgpu) {
	const base = `https://cdn.jsdelivr.net/npm/three@${version}`;
	const core = webgpu ? `${base}/build/three.webgpu.js` : `${base}/build/three.module.js`;
	return {
		imports: {
			three: core,
			'three/webgpu': `${base}/build/three.webgpu.js`,
			'three/tsl': `${base}/build/three.tsl.js`,
			'three/addons/': `${base}/examples/jsm/`,
		},
	};
}

function pageHtml(block, version) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>${block.id}</title>
<style>html,body{margin:0;height:100%;background:#000}canvas{display:block}</style>
<script type="importmap">${JSON.stringify(importMap(version, usesWebGPU(block.code)))}</script>
</head><body><script type="module" src="/__block/${block.id}.js"></script></body></html>`;
}

function startServer(workdir, blocks, version) {
	const byId = new Map(blocks.map((b) => [b.id, b]));
	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const send = (status, type, body) => {
			res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
			res.end(body);
		};
		let m = url.pathname.match(/^\/([a-z0-9-]+--\d+)\.html$/);
		if (m && byId.has(m[1])) return send(200, MIME['.html'], pageHtml(byId.get(m[1]), version));
		m = url.pathname.match(/^\/__block\/([a-z0-9-]+--\d+)\.js$/);
		if (m && byId.has(m[1])) return send(200, MIME['.js'], byId.get(m[1]).code);
		if (url.pathname === '/favicon.ico') return send(204, 'text/plain', '');
		const file = resolve(workdir, `.${decodeURIComponent(url.pathname)}`);
		if (file.startsWith(workdir) && existsSync(file) && statSync(file).isFile()) {
			return send(200, MIME[extname(file)] || 'application/octet-stream', readFileSync(file));
		}
		send(404, 'text/plain', 'not found');
	});
	return new Promise((ok, fail) => {
		server.once('error', fail);
		server.listen(PORT, '127.0.0.1', () => ok(server));
	});
}

// ---------- pixel check ----------

async function canvasVerdict(png) {
	const sharp = require('sharp');
	const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	const px = info.width * info.height;
	if (!px) return { blank: true, why: 'canvas has zero size' };
	const counts = new Map();
	for (let i = 0; i < data.length; i += 3) {
		const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	let top = 0;
	for (const c of counts.values()) top = Math.max(top, c);
	const varied = 1 - top / px;
	return { blank: varied < 0.02, varied, colors: counts.size, size: `${info.width}x${info.height}` };
}

// ---------- browser ----------

async function runJsBlock(context, block, origin) {
	const page = await context.newPage();
	const problems = [];
	const offHost = new Set();
	page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
	page.on('console', (msg) => {
		const type = msg.type();
		if (VERBOSE) console.log(`       [${block.id}] console.${type}: ${msg.text()}`);
		if (type !== 'error' && type !== 'warning') return;
		const text = msg.text();
		if (ENV_NOISE.some((re) => re.test(text))) return;
		problems.push(`console.${type}: ${text}`);
	});
	page.on('requestfailed', (req) => {
		const host = new URL(req.url()).hostname;
		if (host !== '127.0.0.1' && !offHost.has(host)) problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`);
	});
	page.on('response', (res) => {
		if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) problems.push(`HTTP ${res.status()}: ${res.url()}`);
	});
	await page.route('**/*', (route) => {
		const host = new URL(route.request().url()).hostname;
		if (host === '127.0.0.1' || ALLOWED_HOSTS.has(host)) return route.fallback();
		offHost.add(host);
		problems.push(`request to a host no skill names: ${route.request().url()}`);
		return route.abort();
	});

	// Heavy passes (GTAO at full size) keep SwiftShader busy every frame, so a screenshot never
	// gets a compositor slot. During capture the page's rAF callbacks are queued, the canvas keeps
	// its last presented frame, and the queue is replayed afterwards.
	await page.addInitScript(() => {
		const native = window.requestAnimationFrame.bind(window);
		let held = null;
		window.requestAnimationFrame = (cb) => (held ? held.push(cb) : native(cb));
		window.__craftHold = () => {
			held = held || [];
		};
		window.__craftRelease = () => {
			const queued = held || [];
			held = null;
			for (const cb of queued) native(cb);
		};
	});

	let verdict = { blank: true, why: 'no canvas' };
	let shot = null;
	try {
		await page.goto(`${origin}/${block.id}.html`, { waitUntil: 'load', timeout: 120_000 });
		await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => problems.push('network never went idle within 120 s'));
		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			await page.waitForTimeout(1500);
			const handle = await page.evaluateHandle(() =>
				[...document.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null,
			);
			const el = handle.asElement();
			if (!el) {
				verdict = { blank: true, why: 'no canvas in the page' };
				continue;
			}
			await page.evaluate(() => window.__craftHold());
			await page.waitForTimeout(500); // let the frame already in flight present
			shot = await el.screenshot({ timeout: 60_000 });
			await page.evaluate(() => window.__craftRelease());
			verdict = await canvasVerdict(shot);
			if (!verdict.blank) break;
		}
	} catch (e) {
		problems.push(`harness: ${e.message.split('\n')[0]}`);
	}
	if (KEEP && shot) {
		mkdirSync(join(CACHE, 'shots'), { recursive: true });
		writeFileSync(join(CACHE, 'shots', `${block.id}.png`), shot);
	}
	if (verdict.blank) problems.push(`blank canvas (${verdict.why || `only ${(verdict.varied * 100).toFixed(2)}% of pixels differ from the dominant color`})`);
	await page.close();
	return { problems, verdict };
}

// ---------- main ----------

async function main() {
	const version = pinnedVersion();
	const revision = await threeRevision();
	if (`0.${revision}.0` !== version) {
		throw new Error(`plugin pins three@${version} but node_modules has r${revision}; update the skills and the pin together`);
	}

	const blocks = allBlocks(PLUGIN).filter((b) => !ONLY || ONLY.has(b.skill));
	const js = blocks.filter((b) => b.kind === 'js');
	const runnable = js.filter((b) => !b.partial);
	const shell = blocks.filter((b) => b.kind === 'gltf-transform');
	const failures = [];
	const results = [];

	// Every runnable block may import only the pinned three.js entry points.
	for (const b of runnable) {
		for (const s of importSpecifiers(b.code)) {
			if (!/^three(\/webgpu|\/tsl|\/addons\/.+\.js)?$/.test(s)) failures.push({ id: b.id, line: b.line, problems: [`imports ${s}; blocks may import only three, three/webgpu, three/tsl and three/addons/*`] });
		}
		const cdn = [...b.code.matchAll(/cdn\.jsdelivr\.net\/npm\/three@([0-9.]+)/g)].map((m) => m[1]);
		for (const v of cdn) if (v !== version) failures.push({ id: b.id, line: b.line, problems: [`decoder path pins three@${v}, plugin pins ${version}`] });
	}
	for (const b of js.filter((x) => x.partial && !x.partialReason)) failures.push({ id: b.id, line: b.line, problems: ['partial marker without a reason'] });

	const workdir = join(CACHE, 'work');
	rmSync(workdir, { recursive: true, force: true });
	mkdirSync(workdir, { recursive: true });

	log(`three.js ${version} (r${revision}); ${runnable.length} runnable JS blocks, ${js.length - runnable.length} partial, ${shell.length} glTF Transform blocks`);
	const item = await fetchCatalogModel(workdir);
	log(`model.glb = ${item.id} (${item.license}, ${(item.bytes / 1e6).toFixed(2)} MB) from the three.ws catalog`);

	let env = { ...process.env, npm_config_yes: 'true' };
	if (shell.some((b) => b.code.includes('ktx2'))) env = await ensureKtx(env);
	for (const b of shell) {
		const t = Date.now();
		const err = runShellBlock(b, workdir, env);
		results.push({ id: b.id, kind: 'gltf-transform', ok: !err, ms: Date.now() - t });
		if (err) failures.push({ id: b.id, line: b.line, problems: [err] });
		log(`${err ? 'FAIL' : 'ok  '} ${b.id} (shell, line ${b.line}) ${err || ''}`);
	}
	const produced = readdirSync(workdir).filter((f) => f.endsWith('.glb'));
	log(`  files: ${produced.map((f) => `${f} ${(statSync(join(workdir, f)).size / 1e6).toFixed(2)} MB`).join(', ')}`);

	const server = await startServer(workdir, runnable, version);
	const origin = `http://127.0.0.1:${server.address().port}`;
	const { chromium } = require('playwright');
	const browser = await chromium.launch({
		args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
	});
	const tRoot = threeRoot();
	const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
	await context.route(`https://cdn.jsdelivr.net/npm/three@${version}/**`, (route) => {
		const rel = new URL(route.request().url()).pathname.replace(`/npm/three@${version}/`, '');
		const file = resolve(tRoot, rel);
		if (!file.startsWith(tRoot) || !existsSync(file)) return route.fulfill({ status: 404, body: `not in three@${version}: ${rel}` });
		return route.fulfill({ status: 200, contentType: MIME[extname(file)] || 'application/octet-stream', body: readFileSync(file), headers: { 'access-control-allow-origin': '*' } });
	});

	try {
		for (const b of runnable) {
			const t = Date.now();
			const { problems, verdict } = await runJsBlock(context, b, origin);
			const ok = problems.length === 0;
			results.push({ id: b.id, kind: 'js', ok, ms: Date.now() - t, canvas: verdict.size, varied: verdict.varied });
			if (!ok) failures.push({ id: b.id, line: b.line, problems });
			log(`${ok ? 'ok  ' : 'FAIL'} ${b.id} (line ${b.line}) ${verdict.size || ''} ${verdict.varied != null ? `${(verdict.varied * 100).toFixed(1)}% varied` : ''} ${((Date.now() - t) / 1000).toFixed(1)}s`);
			for (const p of problems) log(`       ${p}`);
		}
	} finally {
		await browser.close();
		server.close();
	}

	const passedJs = results.filter((r) => r.kind === 'js' && r.ok).length;
	const summary = { three: version, model: item.id, jsRunnable: runnable.length, jsPassed: passedJs, partial: js.length - runnable.length, shellBlocks: shell.length, failures, results };
	if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
	else log(`\n${passedJs}/${runnable.length} JS blocks and ${shell.length - failures.filter((f) => f.id.includes('--') && shell.some((s) => s.id === f.id)).length}/${shell.length} glTF Transform blocks verified${failures.length ? `; ${failures.length} failing` : ''}`);
	process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
	console.error(`grok:craft-verify: ${e.message}`);
	process.exit(1);
});
