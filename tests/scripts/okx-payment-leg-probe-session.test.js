// okx-payment-leg-probe: an expired onchainos session is an operator state, not a crash.
//
// The probe signs through the OKX agentic wallet, so the first thing it does is
// ask `onchainos wallet addresses` for the buyer. When the browser-OTP session
// has expired the CLI exits non-zero with `{"ok":false,"error":"not logged in"}`
// on stdout. The probe used to let execFileSync's exception escape, which
// printed a Node stack trace and buried the one fact the operator needed: log in.
//
// The CLI here is a stand-in shell script placed where the probe looks for the
// real binary ($HOME/.local/bin/onchainos); it answers exactly what the real
// CLI answered on 2026-11-14 with an expired session. No network is reached:
// the probe must stop before any HTTP call.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/okx-payment-leg-probe.mjs');
const homes = [];

function homeWithCli(stdout, code) {
	const home = mkdtempSync(join(tmpdir(), 'okx-leg-probe-'));
	homes.push(home);
	mkdirSync(join(home, '.local', 'bin'), { recursive: true });
	const cli = join(home, '.local', 'bin', 'onchainos');
	writeFileSync(cli, `#!/bin/sh\nprintf '%s\\n' '${stdout}'\nexit ${code}\n`);
	chmodSync(cli, 0o755);
	return home;
}

afterEach(() => {
	while (homes.length) rmSync(homes.pop(), { recursive: true, force: true });
});

describe('okx-payment-leg-probe with no wallet session', () => {
	it('exits 2 with the login steps instead of a stack trace', () => {
		const home = homeWithCli('{"ok":false,"error":"not logged in"}', 1);
		const run = spawnSync(process.execPath, [SCRIPT, '--rows', 'forge-draft'], {
			env: { ...process.env, HOME: home },
			encoding: 'utf8',
			timeout: 30_000,
		});
		const out = `${run.stdout}${run.stderr}`;
		expect(run.status).toBe(2);
		expect(out).toContain('not logged in');
		expect(out).toContain('onchainos wallet login --phase init');
		expect(out).not.toMatch(/at .*node:internal|Node\.js v\d/);
	});

	it('reports any other CLI refusal by its own message, still without a stack trace', () => {
		const home = homeWithCli('{"ok":false,"error":"rate limited"}', 1);
		const run = spawnSync(process.execPath, [SCRIPT, '--rows', 'forge-draft'], {
			env: { ...process.env, HOME: home },
			encoding: 'utf8',
			timeout: 30_000,
		});
		const out = `${run.stdout}${run.stderr}`;
		expect(run.status).toBe(2);
		expect(out).toContain('rate limited');
		expect(out).not.toMatch(/at .*node:internal|Node\.js v\d/);
	});
});
