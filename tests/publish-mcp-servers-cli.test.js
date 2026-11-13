// CLI argument guard for scripts/publish-mcp-servers.mjs.
//
// The script publishes to npm and the MCP registry by default, so any flag it
// does not recognise used to fall through to a live, unscoped publish run:
// `--help` and a mistyped `--dryrun` both started shipping every package. These
// tests pin the guard: unknown flags exit non-zero before any network call, and
// `--help` prints usage and exits 0 without publishing.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve(__dirname, '..', 'scripts', 'publish-mcp-servers.mjs');

function run(...args) {
	return spawnSync(process.execPath, [script, ...args], {
		encoding: 'utf8',
		timeout: 20_000,
		// Strip publish credentials so a regression can never reach a real write.
		env: { ...process.env, NPM_TOKEN: '', MCP_REGISTRY_TOKEN: '', GITHUB_TOKEN: '' },
	});
}

describe('publish-mcp-servers CLI', () => {
	it('prints usage for --help and does not start a publish run', () => {
		const r = run('--help');
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('--dry-run');
		expect(r.stdout).not.toContain('──');
		expect(r.stdout).not.toContain('Publish run complete');
	});

	it('rejects an unknown flag before touching npm or the registry', () => {
		const r = run('--dryrun');
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('unknown option: --dryrun');
		expect(r.stdout).not.toContain('──');
	});

	it('rejects --apply without --deprecate instead of publishing', () => {
		const r = run('--apply');
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('--apply only applies to --deprecate');
	});

	it('still accepts --only with a separate value argument', () => {
		const r = run('--dry-run', '--only', 'no-such-package');
		expect(r.stderr).not.toContain('unknown option');
	});
});

// A deprecated registry entry can list more than one npm package (the scoped
// @three-ws name and an older unscoped one). Deprecating only one leaves the other
// installable with no warning, so the deprecate plan must cover every npm package
// the live registry entry advertises. Reads the real registry and npm; no writes.
describe('publish-mcp-servers --deprecate plan', () => {
	const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';
	const DEPRECATED = ['io.github.nirholas/claude-code-explorer-mcp', 'io.github.nirholas/data-workbench-mcp'];

	it('names every npm package each deprecated registry entry lists', async () => {
		const r = run('--deprecate');
		expect(r.status).toBe(0);
		for (const name of DEPRECATED) {
			const res = await fetch(`${REGISTRY}?search=${encodeURIComponent(name)}&version=latest`);
			expect(res.ok).toBe(true);
			const { servers = [] } = await res.json();
			const entry = servers.find((s) => s.server?.name === name);
			expect(entry, `${name} missing from the registry`).toBeTruthy();
			const npmIds = (entry.server.packages || [])
				.filter((p) => p.registryType === 'npm')
				.map((p) => p.identifier);
			for (const id of npmIds) {
				const covered =
					r.stdout.includes(`npm: would deprecate ${id}\n`) || r.stdout.includes(`npm: ${id} already deprecated`);
				expect(covered, `${name}: deprecate plan skips npm package ${id}`).toBe(true);
			}
		}
	}, 60_000);
});
