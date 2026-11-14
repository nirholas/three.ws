// okx-e2e-gauntlet: a signing run with an expired onchainos session must stop
// before its first case with the login steps, not crash mid-run on a stack trace.
//
// `--no-spend` signs real authorizations the server is meant to refuse, so it
// needs the OKX agentic wallet session. On 2026-11-14 the session had expired
// and the run died inside case 5b with execFileSync's raw exception. The CLI here
// is a stand-in placed where the gauntlet looks for the real binary
// ($HOME/.local/bin/onchainos), answering `wallet status` exactly as the real CLI
// does when logged out. The run must stop before any HTTP call.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/okx-e2e-gauntlet.mjs');
const dirs = [];

function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function homeWithStatus(statusJson) {
	const home = tempDir('okx-gauntlet-home-');
	mkdirSync(join(home, '.local', 'bin'), { recursive: true });
	const cli = join(home, '.local', 'bin', 'onchainos');
	writeFileSync(cli, `#!/bin/sh\nprintf '%s\\n' '${statusJson}'\nexit 0\n`);
	chmodSync(cli, 0o755);
	return home;
}

afterEach(() => {
	while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('okx-e2e-gauntlet --no-spend with no wallet session', () => {
	it('exits 4 before any case, naming the login steps', () => {
		const home = homeWithStatus('{"ok":true,"data":{"accountCount":0,"email":"","loggedIn":false}}');
		const run = spawnSync(process.execPath, [SCRIPT, '--no-spend', '--out', tempDir('okx-gauntlet-out-')], {
			cwd: resolve(__dirname, '../..'),
			env: { ...process.env, HOME: home },
			encoding: 'utf8',
			timeout: 30_000,
		});
		const out = `${run.stdout}${run.stderr}`;
		expect(run.status).toBe(4);
		expect(out).toContain('onchainos wallet login --phase init');
		expect(out).not.toMatch(/PASS|FAIL\s+\d/);
		expect(out).not.toMatch(/at .*node:internal|Node\.js v\d/);
	});
});
