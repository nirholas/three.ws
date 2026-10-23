#!/usr/bin/env node
// 3D AR Studio command line.
//
//   npx 3d-ar-studio create my-ar-site     scaffold a publishable page
//   npx 3d-ar-studio dev                   serve it locally over http
//   npx 3d-ar-studio deploy                push it and turn on GitHub Pages
//   npx 3d-ar-studio page > index.html     print a single self-contained page
//
// The point of `create` + `deploy` is that adding AR to a project should be two
// commands, not an afternoon. Neither command hides anything: `create` writes
// plain files you can read, and `deploy` prints every git and gh command it runs
// before running it.

import { cp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPage } from '../mcp/tools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));

const TEMPLATES = ['static', 'vite', 'react'];

const argv = process.argv.slice(2);
const command = argv[0] || 'help';
const flags = parseFlags(argv.slice(1));

const COMMANDS = { create, dev, deploy, page, help, version };
const run = COMMANDS[command] || (() => {
	fail(`Unknown command "${command}". Run \`3d-ar-studio help\` to see what there is.`);
});
await run();

// ── create ──────────────────────────────────────────────────────────────────

async function create() {
	const dir = resolve(process.cwd(), flags._[0] || 'ar-studio-site');
	const template = String(flags.template || flags.t || 'static');
	if (!TEMPLATES.includes(template)) {
		fail(`Unknown template "${template}". Pick one of: ${TEMPLATES.join(', ')}.`);
	}
	if (existsSync(dir) && (await readdir(dir)).length) {
		fail(`${dir} already has files in it. Pass an empty directory, or a new name.`);
	}
	const title = String(flags.title || titleFromDir(dir));
	const accent = String(flags.accent || '#8b7cf8');

	await mkdir(dir, { recursive: true });
	await copyTemplate(resolve(ROOT, 'templates', template), dir, {
		__TITLE__: title,
		__ACCENT__: accent,
		__SLUG__: slug(basename(dir)),
	});

	console.log(`\nCreated ${rel(dir)} from the "${template}" template.\n`);
	if (template === 'static') {
		console.log('  cd ' + rel(dir));
		console.log('  npx 3d-ar-studio dev        # look at it');
		console.log('  npx 3d-ar-studio deploy     # publish it on GitHub Pages\n');
	} else if (template === 'vite') {
		console.log('  cd ' + rel(dir));
		console.log('  npm install');
		console.log('  npm run dev\n');
	} else {
		console.log('  Copy src/ArStudio.jsx into your app, then `npm i 3d-ar-studio three`.\n');
	}
	console.log('Point it at your own models with the `assets` option. Docs: https://github.com/nirholas/3D-AR-Studio#your-own-models\n');
}

async function copyTemplate(from, to, replacements) {
	for (const entry of await readdir(from, { withFileTypes: true })) {
		const src = join(from, entry.name);
		const dest = join(to, entry.name);
		if (entry.isDirectory()) {
			await mkdir(dest, { recursive: true });
			await copyTemplate(src, dest, replacements);
			continue;
		}
		if (['.html', '.js', '.jsx', '.json', '.md', '.css'].includes(extname(entry.name))) {
			let text = await readFile(src, 'utf8');
			for (const [token, value] of Object.entries(replacements)) text = text.split(token).join(value);
			await writeFile(dest, text);
		} else {
			await cp(src, dest);
		}
	}
}

// ── dev ─────────────────────────────────────────────────────────────────────

async function dev() {
	const dir = resolve(process.cwd(), flags.dir || flags._[0] || '.');
	const port = Number(flags.port || flags.p || 5175);
	if (!existsSync(dir)) fail(`${dir} does not exist.`);

	const TYPES = {
		'.html': 'text/html; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.mjs': 'text/javascript; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.map': 'application/json; charset=utf-8',
		'.glb': 'model/gltf-binary',
		'.gltf': 'model/gltf+json',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.svg': 'image/svg+xml',
		'.wasm': 'application/wasm',
		'.hdr': 'image/vnd.radiance',
	};

	const server = createServer(async (req, res) => {
		const path = decodeURIComponent(String(req.url).split('?')[0]);
		let file = resolve(dir, `.${path}`);
		// Never serve outside the served directory, whatever the request says.
		if (!file.startsWith(dir)) {
			res.writeHead(403).end('Forbidden');
			return;
		}
		try {
			if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
		} catch {
			res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
			return;
		}
		try {
			const body = await readFile(file);
			res.writeHead(200, {
				'content-type': TYPES[extname(file)] || 'application/octet-stream',
				'cache-control': 'no-store',
				// The studio itself needs these to open a camera and an XR session.
				'permissions-policy': 'camera=(self), xr-spatial-tracking=(self), gyroscope=(self), accelerometer=(self)',
			});
			res.end(body);
		} catch {
			res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
		}
	});

	server.listen(port, () => {
		console.log(`\nServing ${rel(dir)} on http://localhost:${port}\n`);
		console.log('Camera and WebXR need a secure context. http://localhost counts as one;');
		console.log('a LAN address over plain http does not, so use a tunnel to test on a phone.\n');
	});
}

// ── deploy ──────────────────────────────────────────────────────────────────

async function deploy() {
	const dir = resolve(process.cwd(), flags.dir || '.');
	const name = String(flags.repo || basename(dir));
	const branch = String(flags.branch || 'main');
	if (!existsSync(join(dir, 'index.html'))) {
		fail(`${rel(dir)} has no index.html, so there is nothing for Pages to serve. Run \`3d-ar-studio create\` first.`);
	}
	if (!has('git')) fail('git is not installed, and deploy needs it.');
	if (!has('gh')) {
		fail(
			'This command drives the GitHub CLI (`gh`), which is not installed.\n'
			+ 'Install it from https://cli.github.com, or publish by hand: commit this folder,\n'
			+ 'push it, then enable Pages under Settings -> Pages, serving from the branch root.',
		);
	}

	const git = (...args) => sh('git', args, dir);
	if (!existsSync(join(dir, '.git'))) {
		git('init', '-b', branch);
	}
	git('add', '.');
	// A commit with nothing staged exits non-zero; that is fine when re-deploying.
	sh('git', ['commit', '-m', 'Publish the AR studio page'], dir, { allowFailure: true });

	const slugged = slug(name);
	const exists = sh('gh', ['repo', 'view', slugged, '--json', 'name'], dir, { allowFailure: true, quiet: true }).status === 0;
	if (!exists) {
		console.log(`\nCreating the GitHub repository "${slugged}"…`);
		sh('gh', ['repo', 'create', slugged, '--public', '--source', '.', '--remote', 'origin', '--push'], dir);
	} else {
		if (sh('git', ['remote', 'get-url', 'origin'], dir, { allowFailure: true, quiet: true }).status !== 0) {
			const url = sh('gh', ['repo', 'view', slugged, '--json', 'url', '-q', '.url'], dir, { quiet: true }).stdout.trim();
			git('remote', 'add', 'origin', url);
		}
		git('push', '-u', 'origin', branch);
	}

	const owner = sh('gh', ['api', 'user', '-q', '.login'], dir, { quiet: true }).stdout.trim();
	console.log('\nTurning on GitHub Pages…');
	const pages = sh('gh', [
		'api', '--method', 'POST', `repos/${owner}/${slugged}/pages`,
		'-f', 'source[branch]=' + branch, '-f', 'source[path]=/',
	], dir, { allowFailure: true, quiet: true });
	if (pages.status !== 0 && !/already exists/i.test(pages.stderr)) {
		console.log('\nPages could not be enabled automatically. Turn it on under');
		console.log(`https://github.com/${owner}/${slugged}/settings/pages (branch ${branch}, folder /).`);
	}

	console.log(`\nPublished. It goes live within a minute or two at:\n\n  https://${owner}.github.io/${slugged}/\n`);
	console.log('Open that on a phone and tap Camera.\n');
}

// ── page ────────────────────────────────────────────────────────────────────

async function page() {
	process.stdout.write(renderPage({
		title: String(flags.title || 'AR Studio'),
		accent: String(flags.accent || '#8b7cf8'),
		...(flags.assets ? { assets: String(flags.assets) } : {}),
		...(flags.generate === false ? { generate: false } : {}),
	}));
}

// ── help ────────────────────────────────────────────────────────────────────

async function version() {
	console.log(pkg.version);
}

async function help() {
	console.log(`
3d-ar-studio ${pkg.version}
${pkg.homepage}

  create [dir]     Scaffold a publishable AR page.
                     --template static|vite|react   (default: static)
                     --title "Acme AR"   --accent "#00b894"

  dev [dir]        Serve a folder locally over http.
                     --port 5175

  deploy           Commit, push, and enable GitHub Pages for the current folder.
                     --repo my-ar-site   --branch main   --dir .
                   Needs git and the GitHub CLI (gh).

  page             Print one self-contained AR page to stdout.
                     --title  --accent  --assets https://your.cdn/models.json

  help, version

The MCP server is a separate binary: \`npx 3d-ar-studio-mcp\`.
`);
}

// ── plumbing ────────────────────────────────────────────────────────────────

function parseFlags(args) {
	const out = { _: [] };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith('--')) { out._.push(arg); continue; }
		const [key, inline] = arg.slice(2).split('=');
		if (inline !== undefined) out[key] = inline;
		else if (args[i + 1] && !args[i + 1].startsWith('--')) out[key] = args[++i];
		else if (key.startsWith('no-')) out[key.slice(3)] = false;
		else out[key] = true;
	}
	return out;
}

function sh(cmd, args, cwd, { allowFailure = false, quiet = false } = {}) {
	if (!quiet) console.log(`  $ ${cmd} ${args.join(' ')}`);
	const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : ['inherit', 'inherit', 'pipe'] });
	if (res.status !== 0 && !allowFailure) {
		fail(`\`${cmd} ${args.join(' ')}\` failed.\n${(res.stderr || '').trim()}`);
	}
	return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function has(cmd) {
	return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

function slug(s) {
	return String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'ar-studio-site';
}

function titleFromDir(dir) {
	const name = basename(dir).replace(/[_-]+/g, ' ').trim();
	return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'AR Studio';
}

function rel(p) {
	const r = p.replace(`${process.cwd()}/`, '');
	return r || '.';
}

function fail(message) {
	console.error(`\n${message}\n`);
	process.exit(1);
}
