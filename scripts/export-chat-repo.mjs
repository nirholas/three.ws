#!/usr/bin/env node
// Builds the standalone three.ws/chat repository (github.com/nirholas/three.ws-chat)
// from this monorepo's chat/ directory, and nothing else.
//
//   node scripts/export-chat-repo.mjs                 tree + fresh git repo under dist/three.ws-chat
//   node scripts/export-chat-repo.mjs --out <dir>     somewhere else
//   node scripts/export-chat-repo.mjs --verify        also npm install + npm run build inside the export
//
// Why this exists: on 2026-05-02 the chat repo was created by pushing the whole
// monorepo instead of chat/, so it carried every other surface, its history,
// and its GitHub Pages site. The export here is a single orphan commit holding
// only the chat app. chat/ reaches outside itself in two places (the shared
// portable wallet under src/shared and the site nav in public/nav-data.js);
// those files and their import closure are vendored into src/vendor/three-ws
// and the imports rewritten, so the export builds with no monorepo around it.
// Pushing is deliberately left to a human: the target already has history and
// replacing it is a force-push.

import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = (name) => (argv.indexOf(name) === -1 ? null : argv[argv.indexOf(name) + 1]);
const OUT = resolve(value('--out') || join(REPO, 'dist', 'three.ws-chat'));
const VERIFY = argv.includes('--verify');
const VENDOR = 'src/vendor/three-ws';
// Entry points outside chat/ that chat/src imports. Their closure is computed, not listed.
const EXTERNAL_ENTRIES = ['src/shared/portable-wallet.js', 'public/nav-data.js'];

const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts })?.toString() ?? '';
const fail = (msg) => {
	console.error(`export-chat-repo: ${msg}`);
	process.exit(1);
};
const toPosix = (p) => p.split(sep).join('/');

// 1. Tracked chat/ files only, at HEAD, so nothing ignored or uncommitted leaks in.
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const tar = join(mkdtempSync(join(tmpdir(), 'chat-export-')), 'chat.tar');
run('git', ['-C', REPO, 'archive', '--format=tar', '-o', tar, 'HEAD:chat']);
run('tar', ['-xf', tar, '-C', OUT]);
rmSync(dirname(tar), { recursive: true, force: true });

// 2. Vendor the out-of-tree import closure, keeping monorepo-relative paths so
//    the vendored files' own relative imports keep resolving. Workers loaded with
//    new URL('./x.js', import.meta.url) are invisible to the import graph, so
//    they are added as further entries until the set stops growing.
const entries = new Set(EXTERNAL_ENTRIES);
const externalPkgs = new Set();
let vendored = [];
for (;;) {
	const meta = (
		await build({
			entryPoints: [...entries].map((e) => join(REPO, e)),
			absWorkingDir: REPO,
			bundle: true,
			format: 'esm',
			packages: 'external',
			write: false,
			metafile: true,
			outdir: join(OUT, '.esbuild-unused'),
			logLevel: 'silent',
		})
	).metafile;
	vendored = Object.keys(meta.inputs);
	// Read inputs, not outputs: outputs drop dynamic import() of an external package.
	for (const input of Object.values(meta.inputs))
		for (const i of input.imports || [])
			if (i.external)
				externalPkgs.add(
					i.path
						.split('/')
						.slice(0, i.path.startsWith('@') ? 2 : 1)
						.join('/'),
				);
	const before = entries.size;
	for (const file of vendored) {
		for (const [, spec] of readFileSync(join(REPO, file), 'utf8').matchAll(
			/new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
		)) {
			const target = posix.normalize(posix.join(posix.dirname(file), spec));
			if (/\.(m?js|ts)$/.test(target)) entries.add(target);
		}
	}
	if (entries.size === before) break;
}
for (const file of vendored) {
	const dest = join(OUT, VENDOR, file);
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(join(REPO, file), dest);
}

// 3. Rewrite every chat/src import that escapes chat/ to its vendored copy.
const walk = (dir) =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory()
			? p.includes(`${sep}vendor${sep}three-ws`)
				? []
				: walk(p)
			: [p];
	});
let rewrites = 0;
for (const file of walk(join(OUT, 'src')).filter((f) => /\.(js|ts|svelte|mjs)$/.test(f))) {
	const src = readFileSync(file, 'utf8');
	const relInChat = toPosix(relative(OUT, file));
	const next = src.replace(
		/(from\s+|import\s*\(\s*)(['"])([^'"]+)\2/g,
		(whole, lead, q, spec) => {
			let monoPath = null;
			if (spec.startsWith('$shared/'))
				monoPath = posix.join('src/shared', spec.slice('$shared/'.length));
			else if (spec.startsWith('.')) {
				const joined = posix.normalize(posix.join('chat', posix.dirname(relInChat), spec));
				if (!joined.startsWith('chat/')) monoPath = joined;
			}
			if (!monoPath) return whole;
			if (!vendored.includes(monoPath))
				fail(
					`${relInChat} imports ${spec} (${monoPath}), which is outside chat/ and not in the vendored closure`,
				);
			let rel = posix.relative(posix.dirname(relInChat), posix.join(VENDOR, monoPath));
			if (!rel.startsWith('.')) rel = `./${rel}`;
			rewrites++;
			return `${lead}${q}${rel}${q}`;
		},
	);
	if (next !== src) writeFileSync(file, next);
}

// 4. vite.config.js: drop every path into the parent monorepo.
const vitePath = join(OUT, 'vite.config.js');
let vite = readFileSync(vitePath, 'utf8');
const swap = (from, to, label) => {
	if (!from.test(vite))
		fail(
			`vite.config.js no longer matches the "${label}" rewrite; update scripts/export-chat-repo.mjs`,
		);
	vite = vite.replace(from, to);
};
swap(
	/const ROOT_PUBLIC[^\n]*\nconst DIST_LIB[^\n]*\n\nfunction serveDevAssets\(\) \{[\s\S]*?\n\}\n\n/,
	'',
	'monorepo dev-asset middleware',
);
swap(/outDir: '\.\.\/public\/chat',/, "outDir: 'dist',", 'build outDir');
swap(/\n\t\t\tfs: \{[\s\S]*?\n\t\t\t\},/, '', 'fs.allow on the parent directory');
swap(
	/(\n\t\t\tproxy: \{)/,
	`$1
				// Avatars, animations and the agent-3d runtime are served by three.ws itself.
				'/animations': { target: 'https://three.ws', changeOrigin: true, secure: true },
				'/avatars': { target: 'https://three.ws', changeOrigin: true, secure: true },
				'/agent-3d': { target: 'https://three.ws', changeOrigin: true, secure: true },`,
	'dev proxy',
);
swap(/\n\t\t\tserveDevAssets\(\),/, '', 'serveDevAssets plugin');
swap(/import fs from 'fs';\n/, '', 'fs import (only the dev-asset middleware used it)');
swap(
	/\n\t\t\t\t\/\/ Shared wallet layer[^\n]*\n\t\t\t\t\/\/[^\n]*\n\t\t\t\t'\$shared': [^\n]*\n/,
	'\n',
	'$shared alias',
);
if (/\.\.\/|'\.\.'/.test(vite))
	fail('vite.config.js still references the parent directory after rewriting');
writeFileSync(vitePath, vite);

// 5. package.json: the vendored wallet code needs its npm deps declared here.
const rootPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const pkgPath = join(OUT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
for (const name of externalPkgs) {
	if (pkg.dependencies?.[name] || pkg.devDependencies?.[name]) continue;
	const range = rootPkg.dependencies?.[name] || rootPkg.devDependencies?.[name];
	if (!range) fail(`vendored code imports ${name}, which the monorepo package.json does not pin`);
	pkg.dependencies = Object.fromEntries(
		Object.entries({ ...pkg.dependencies, [name]: range }).sort(([a], [b]) =>
			a.localeCompare(b),
		),
	);
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);
// The chat/ lockfile lacks the vendored code's deps, so resolve a fresh one for the export.
rmSync(join(OUT, 'package-lock.json'), { force: true });
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
	cwd: OUT,
});

// 6. Final guard: nothing in the export may still reach into the monorepo.
const leakPattern = /\$shared\/|\.\.\/\.\.\/\.\.\/public\/|path\.resolve\([^)]*'\.\.\//;
const leaks = walk(OUT)
	.filter((f) => /\.(js|ts|svelte|mjs)$/.test(f) && !f.includes(`${sep}node_modules${sep}`))
	.flatMap((f) =>
		readFileSync(f, 'utf8')
			.split('\n')
			.map((line, i) =>
				leakPattern.test(line)
					? `${toPosix(relative(OUT, f))}:${i + 1}: ${line.trim()}`
					: null,
			),
	)
	.filter(Boolean);
if (leaks.length) fail(`monorepo references remain:\n${leaks.join('\n')}`);

if (VERIFY) {
	run('npm', ['install', '--no-audit', '--no-fund'], { cwd: OUT, stdio: 'inherit' });
	run('npm', ['run', 'build'], { cwd: OUT, stdio: 'inherit' });
	rmSync(join(OUT, 'dist'), { recursive: true, force: true });
	rmSync(join(OUT, 'node_modules'), { recursive: true, force: true });
}

// 7. One orphan commit: no monorepo history, authorship trail or SHAs carried over.
run('git', ['init', '-q', '-b', 'main'], { cwd: OUT });
run('git', ['add', '-A'], { cwd: OUT });
run('git', ['commit', '-q', '-m', 'three.ws/chat: standalone chat app'], { cwd: OUT });
const files = run('git', ['ls-files'], { cwd: OUT }).trim().split('\n').length;
console.log(
	`export-chat-repo: ${files} files, ${vendored.length} vendored from the monorepo, ${rewrites} imports rewritten`,
);
console.log(`export-chat-repo: ${OUT}`);
console.log(
	`export-chat-repo: publish with  git -C ${OUT} push --force https://github.com/nirholas/three.ws-chat.git main`,
);
