// scripts/forge-load-test.mjs fires N real generations at whatever origin it is
// pointed at. It used to default to https://three.ws, so running it with no
// arguments spent production's one GPU and its one-image-per-45-seconds rung on
// test prompts while real people waited. It must refuse production unless told
// explicitly, and say what it is about to do before doing anything.
//
// Every run here preloads a fetch that records the URL and exits, so even a
// script that ignored the guard could never reach the network from this test.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'forge-load-test.mjs');
const NO_NETWORK =
	'data:text/javascript,' +
	encodeURIComponent(
		"globalThis.fetch = async (u) => { process.stderr.write('NETWORK ' + String(u) + '\\n'); process.exit(99); };",
	);

function run(args, env = {}) {
	const out = spawnSync(process.execPath, ['--import', NO_NETWORK, SCRIPT, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		timeout: 20_000,
		env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
	});
	return { code: out.status, stdout: out.stdout || '', stderr: out.stderr || '' };
}

describe('forge load script safety', () => {
	it('refuses production with no arguments and touches no network', () => {
		const r = run(['--origin', 'https://three.ws']);
		expect(r.stderr).not.toMatch(/NETWORK/);
		expect(r.code).toBe(2);
		expect(r.stderr).toMatch(/production/i);
		expect(r.stderr).toMatch(/--allow-production/);
	});

	it('treats every production host as production', () => {
		for (const origin of ['https://www.three.ws', 'https://THREE.WS/', 'https://three-ws-api-abc123-uc.a.run.app']) {
			const r = run(['--origin', origin]);
			expect(r.stderr).not.toMatch(/NETWORK/);
			expect(r.code).toBe(2);
		}
	});

	it('defaults to a local server, not production', () => {
		const r = run(['--dry-run']);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/http:\/\/localhost:/);
		expect(r.stdout).not.toMatch(/three\.ws/);
		expect(r.stderr).not.toMatch(/NETWORK/);
	});

	it('prints what it will do before doing it', () => {
		const r = run(['--dry-run', '--n', '4', '--tiers', 'draft', '--origin', 'http://localhost:4178']);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/4 real generations/);
		expect(r.stdout).toMatch(/http:\/\/localhost:4178/);
		expect(r.stdout).toMatch(/draft/);
		expect(r.stdout).toMatch(/dry run/i);
		expect(r.stderr).not.toMatch(/NETWORK/);
	});

	it('runs against production only with the explicit flag, after printing the plan', () => {
		const r = run(['--origin', 'https://three.ws', '--allow-production', '--n', '1']);
		// The stubbed fetch proves the guard let it through to the network.
		expect(r.stdout).toMatch(/1 real generation/);
		expect(r.stderr).toMatch(/NETWORK https:\/\/three\.ws\/api\/forge/);
	});
});
