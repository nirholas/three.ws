#!/usr/bin/env node
// Verifies the listing packages under integrations/ (Zed, Raycast, n8n, Gradio Space, Poe bot,
// Docker MCP Catalog entry).
// Each package is tested and built with its own toolchain. A package whose toolchain is not
// installed is reported as skipped and makes the run exit 2, so a green exit means everything ran.
//
//   npm run check:integrations            all packages
//   npm run check:integrations -- raycast one package
//
// The Raycast lint step fails on exactly one known error until the owner creates the Raycast
// account (integrations/raycast/SUBMITTING.md). That single error is tolerated; any other fails.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = (name) => join(root, 'integrations', name);
// rustup installs cargo outside the default PATH of non-login shells.
const cargoPath = `${join(homedir(), '.cargo', 'bin')}${delimiter}${process.env.PATH || ''}`;
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

function run(cwd, cmd, args, env = {}) {
	const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
	return { ok: result.status === 0, out: strip(`${result.stdout || ''}${result.stderr || ''}`), missing: result.error?.code === 'ENOENT' };
}

const packages = {
	raycast: () => {
		const cwd = dir('raycast');
		if (!existsSync(join(cwd, 'node_modules'))) return { skip: 'run npm install in integrations/raycast' };
		const steps = [
			['npm', ['test']],
			['npx', ['tsc', '--noEmit']],
			['npm', ['run', 'build']],
		];
		for (const [cmd, args] of steps) {
			const r = run(cwd, cmd, args);
			if (!r.ok) return { fail: `${cmd} ${args.join(' ')}\n${r.out.slice(-1500)}` };
		}
		const lint = run(cwd, 'npm', ['run', 'lint']);
		if (!lint.ok) {
			const errors = lint.out.split('\n').filter((l) => /\berror\b/i.test(l) && !/validate package\.json file|linting issues found/.test(l));
			const onlyAuthor = errors.length > 0 && errors.every((l) => /Invalid author/.test(l));
			if (!onlyAuthor) return { fail: `npm run lint\n${lint.out.slice(-1500)}` };
			return { ok: 'tests, types, build pass; lint reports only the owner-owned author error' };
		}
		return { ok: 'tests, types, build and lint pass' };
	},
	n8n: () => {
		const cwd = dir('n8n');
		if (!existsSync(join(cwd, 'node_modules'))) return { skip: 'run npm install in integrations/n8n' };
		for (const [cmd, args] of [['npm', ['test']], ['npm', ['run', 'build']], ['npx', ['eslint', '.', '--max-warnings', '5']]]) {
			const r = run(cwd, cmd, args);
			if (!r.ok) return { fail: `${cmd} ${args.join(' ')}\n${r.out.slice(-1500)}` };
		}
		return { ok: 'tests, build and lint pass' };
	},
	'huggingface-space': () => {
		const r = run(dir('huggingface-space'), 'python3', ['-m', 'pytest', '-q', 'test_app.py']);
		if (r.missing) return { skip: 'python3 not installed' };
		return r.ok ? { ok: r.out.trim().split('\n').pop() } : { fail: r.out.slice(-1500) };
	},
	poe: () => {
		const r = run(dir('poe'), 'python3', ['-m', 'pytest', '-q', 'test_forge_bot.py']);
		if (r.missing) return { skip: 'python3 not installed' };
		return r.ok ? { ok: r.out.trim().split('\n').pop() } : { fail: r.out.slice(-1500) };
	},
	// Runs Docker's own validator (docker/mcp-registry `cmd/validate`) on the entry in
	// integrations/docker-mcp-catalog/servers/three-ws, then confirms the live 401 names
	// the scopes Docker's gateway registers for (it never reads scopes_supported).
	'docker-mcp-catalog': () => {
		const go = run(root, 'go', ['version']);
		if (go.missing || !go.ok) return { skip: 'install Go 1.24+ (Docker\'s validator is a Go program)' };
		const npx = run(root, 'npx', ['--version']);
		if (npx.missing || !npx.ok) return { skip: 'npx not on PATH (the validator runs prettier through it)' };
		// Outside the repo on purpose: prettier would otherwise apply this repo's config to the entry.
		const registry = join(homedir(), '.cache', 'three-ws', 'docker-mcp-registry');
		const sync = existsSync(join(registry, '.git'))
			? run(registry, 'git', ['pull', '--ff-only', '--depth', '1', '-q'])
			: run(root, 'git', ['clone', '--depth', '1', '-q', 'https://github.com/docker/mcp-registry.git', registry]);
		if (!sync.ok) return { fail: `could not fetch docker/mcp-registry\n${sync.out.slice(-800)}` };
		const entry = join(registry, 'servers', 'three-ws');
		const copy = run(root, 'cp', ['-R', join(dir('docker-mcp-catalog'), 'servers', 'three-ws'), join(registry, 'servers')]);
		if (!copy.ok || !existsSync(join(entry, 'server.yaml'))) return { fail: `could not stage the entry\n${copy.out}` };
		const validate = run(registry, 'go', ['run', './cmd/validate', '--name', 'three-ws']);
		if (!validate.ok) return { fail: `docker/mcp-registry validate\n${validate.out.slice(-1500)}` };
		const probe = run(root, 'curl', [
			'-s', '-o', '/dev/null', '-D', '-', '-X', 'POST', 'https://three.ws/mcp',
			'-H', 'content-type: application/json', '-H', 'accept: application/json, text/event-stream',
			'-d', '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check-integrations","version":"1"}}}',
		]);
		if (probe.missing) return { ok: 'docker validator passes; curl missing, live challenge not probed' };
		const challenge = probe.out.split('\n').find((l) => /^www-authenticate:/i.test(l)) || '';
		if (!/scope="[^"]*agents:read[^"]*"/.test(challenge)) {
			return { fail: `docker validator passes, but https://three.ws/mcp 401 names no scope, so Docker Desktop would mint an avatars:read token (deploy api/_mcp/auth.js)\n${challenge}` };
		}
		return { ok: 'docker validator passes; live /mcp challenge names the scope set' };
	},
	zed: () => {
		const cargo = run(dir('zed'), 'cargo', ['--version'], { PATH: cargoPath });
		if (cargo.missing || !cargo.ok) return { skip: 'install Rust (rustup) and the wasm32-wasip2 target' };
		const r = run(dir('zed'), 'cargo', ['build', '--target', 'wasm32-wasip2', '--release'], {
			PATH: cargoPath,
			CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(root, 'node_modules', '.cache', 'zed-target'),
		});
		return r.ok ? { ok: 'wasm32-wasip2 release build succeeds' } : { fail: r.out.slice(-1500) };
	},
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const names = wanted.length ? wanted : Object.keys(packages);
let failed = 0;
let skipped = 0;
for (const name of names) {
	if (!packages[name]) {
		console.error(`unknown package ${name}; choose from ${Object.keys(packages).join(', ')}`);
		process.exit(1);
	}
	const result = packages[name]();
	if (result.ok) console.log(`ok       ${name}: ${result.ok}`);
	else if (result.skip) {
		skipped += 1;
		console.log(`skipped  ${name}: ${result.skip}`);
	} else {
		failed += 1;
		console.log(`FAILED   ${name}\n${result.fail}`);
	}
}
process.exit(failed ? 1 : skipped ? 2 : 0);
