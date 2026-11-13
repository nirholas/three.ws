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
