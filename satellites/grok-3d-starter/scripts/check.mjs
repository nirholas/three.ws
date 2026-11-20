#!/usr/bin/env node
// Repository check: the layout a fork relies on, no secrets anywhere in the
// tree, the project stands alone, and every link a reader can follow answers.
//
//   npm run check              all checks, links over the network
//   npm run check -- --offline skip the link requests

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = process.argv.includes('--offline');
const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`ok    ${msg}`);

// Never scanned: installed packages, local keys, local capture output.
const SKIP = new Set(['node_modules', '.git', '.env', 'captures']);
const TEXT = new Set(['.mjs', '.js', '.json', '.md', '.html', '.css', '.svg', '.example', '.yml', '.yaml', '']);

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (SKIP.has(entry.name)) return [];
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}
const files = walk(ROOT).filter((f) => TEXT.has(extname(f)) || ['Dockerfile', '.gitignore', '.dockerignore'].includes(f.split('/').at(-1)));
const rel = (f) => relative(ROOT, f);
const read = (f) => readFileSync(f, 'utf8');

// ---------------------------------------------------------------- structure
const REQUIRED = [
	'package.json', 'package-lock.json', 'README.md', 'LEARN.md', 'CONTRIBUTING.md', '.env.example', '.gitignore',
	'.dockerignore', 'Dockerfile', '.devcontainer/devcontainer.json', 'server.mjs', 'shared/sse.js', 'public/index.html',
	'public/app.js', 'public/stage.js', 'public/styles.css', 'lib/config.mjs', 'lib/xai.mjs', 'lib/chat.mjs',
	'lib/continuation.mjs', 'lib/mcp.mjs', 'lib/errors.mjs', 'lib/validate.mjs', 'lib/status.mjs', 'lib/tool-results.mjs',
];
const absent = REQUIRED.filter((p) => !existsSync(join(ROOT, p)));
if (absent.length) fail(`missing files: ${absent.join(', ')}`);
else ok(`${REQUIRED.length} required files present`);

const pkg = JSON.parse(read(join(ROOT, 'package.json')));
for (const script of ['dev', 'start', 'check', 'test']) if (!pkg.scripts?.[script]) fail(`package.json has no "${script}" script`);
if (pkg.private !== true) fail('package.json must be private');
if (pkg.license !== 'Apache-2.0') fail('package.json license must be Apache-2.0');
if (!/^>=\s*20/.test(pkg.engines?.node || '')) fail('package.json engines.node must require Node 20 or newer');
const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v));
if (loose.length) fail(`dependencies must be pinned to exact versions: ${loose.map(([n, v]) => `${n}@${v}`).join(', ')}`);
if (!failures.length) ok('package.json: private, Apache-2.0, Node 20+, four scripts, pinned dependencies');

const env = read(join(ROOT, '.env.example'));
for (const name of ['XAI_API_KEY', 'THREE_WS_API_KEY']) if (!new RegExp(`^${name}=$`, 'm').test(env)) fail(`.env.example must name ${name}= with no value`);
if (!/console\.x\.ai/.test(env) || !/three\.ws\/dashboard\/api-keys/.test(env)) fail('.env.example must say where each key is created');
const ignored = read(join(ROOT, '.gitignore')).split('\n').map((l) => l.trim());
if (!ignored.includes('.env')) fail('.gitignore must list .env');
if (!read(join(ROOT, '.dockerignore')).split('\n').includes('.env')) fail('.dockerignore must list .env');
if (existsSync(join(ROOT, '.github', 'workflows'))) fail('.github/workflows exists: deploys and checks run from npm scripts, not CI workflows');
ok('.env.example names both keys; .env is ignored by git and docker');

// ---------------------------------------------------------------- secrets
const SECRETS = [
	['three.ws live key', /sk_live_[A-Za-z0-9]{10,}/],
	['xAI key', /xai-[A-Za-z0-9]{20,}/],
	['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['AWS access key', /AKIA[0-9A-Z]{16}/],
	['Google API key', /AIza[0-9A-Za-z_-]{35}/],
	['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/],
	['bearer header with a value', /authorization['"]?\s*[:=]\s*['"]Bearer [A-Za-z0-9_-]{16,}/i],
];
let secretHits = 0;
for (const f of files) {
	const text = read(f);
	for (const [label, pattern] of SECRETS) {
		const m = text.match(pattern);
		if (m) {
			secretHits++;
			fail(`${rel(f)}: looks like a ${label} (${m[0].slice(0, 12)}...)`);
		}
	}
}
if (!secretHits) ok(`no secrets in ${files.length} files`);

// ---------------------------------------------------------------- writing
const DASHES = /[\u2013\u2014]/;
const dashed = files.filter((f) => DASHES.test(read(f)));
if (dashed.length) fail(`em or en dash characters in: ${dashed.map(rel).join(', ')}`);
else ok('no em or en dash characters');

// ---------------------------------------------------------------- standalone
const IMPORT = /(?:^|\n)\s*import\s[^'"]*?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const ALLOWED_BARE = new Set(['three', 'three/addons/']);
let escaped = 0;
for (const f of files.filter((p) => /\.(m?js)$/.test(p))) {
	for (const m of read(f).matchAll(IMPORT)) {
		const spec = m[1] || m[2];
		if (spec.startsWith('node:')) continue;
		if (spec.startsWith('.')) {
			const target = resolve(dirname(f), spec);
			if (!target.startsWith(ROOT + '/')) {
				escaped++;
				fail(`${rel(f)} imports ${spec}, outside this project`);
			} else if (!existsSync(target)) {
				escaped++;
				fail(`${rel(f)} imports ${spec}, which does not exist`);
			}
		} else if (spec.startsWith('/')) {
			const served = spec.startsWith('/vendor/three/') ? join(ROOT, 'node_modules/three', spec.slice('/vendor/three/'.length)) : spec.startsWith('/shared/') ? join(ROOT, spec) : join(ROOT, 'public', spec);
			if (!existsSync(served)) {
				escaped++;
				fail(`${rel(f)} imports ${spec}, which the server does not serve`);
			}
		} else if (![...ALLOWED_BARE].some((b) => spec === b || spec.startsWith(b))) {
			escaped++;
			fail(`${rel(f)} imports ${spec}, which is not a dependency`);
		}
	}
}
if (!escaped) ok('every import is a Node built-in, three, or a file inside this project');

// ---------------------------------------------------------------- links
// Links a reader can follow: in the docs, the page, the key help and the
// error messages. API endpoints are skipped (they want POST and a key), as
// are local addresses and this repository's own URL, which exists once the
// repository is published.
const READER_FILES = files.filter((f) => /\.(md|html|example)$/.test(f) || /devcontainer\.json$/.test(f) || /lib\/(config|errors)\.mjs$/.test(f));
const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/g;
const self = (pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');
const links = new Map();
for (const f of READER_FILES) {
	for (const raw of read(f).match(URL_RE) || []) {
		const url = raw.replace(/[.,;:]+$/, '');
		if (/localhost|127\.0\.0\.1|\$\{|\.\.\.$/.test(url)) continue;
		if (/^https:\/\/api\.x\.ai\/|\/api\/mcp-grok$/.test(url)) continue;
		if (self && url.replace(/\.git$/, '') === self) continue;
		if (!links.has(url)) links.set(url, rel(f));
	}
}

async function reachable(url) {
	for (const method of ['HEAD', 'GET']) {
		try {
			const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'grok-3d-starter link check' } });
			res.body?.cancel().catch(() => {});
			// The server answered and the page exists. 401/403 are sign-in walls
			// and bot screens in front of a real page; 404 and 410 are not.
			if (res.status < 400 || [401, 403, 429].includes(res.status)) return { ok: true, status: res.status };
			if (method === 'GET' || ![400, 403, 405, 501].includes(res.status)) return { ok: false, status: res.status };
		} catch (err) {
			if (method === 'GET') return { ok: false, status: err.name === 'TimeoutError' ? 'timeout' : err.cause?.code || err.message };
		}
	}
	return { ok: false, status: 'no answer' };
}

if (OFFLINE) {
	ok(`${links.size} links found (not requested: --offline)`);
} else {
	const results = await Promise.all([...links].map(async ([url, from]) => ({ url, from, ...(await reachable(url)) })));
	const broken = results.filter((r) => !r.ok);
	for (const r of broken) fail(`${r.from}: ${r.url} answered ${r.status}`);
	if (!broken.length) ok(`${results.length} links reachable${self ? ` (${self} is created when the repository is published)` : ''}`);
}

if (failures.length) {
	console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:`);
	for (const f of failures) console.error(`FAIL  ${f}`);
	process.exit(1);
}
console.log('\nAll checks passed.');
