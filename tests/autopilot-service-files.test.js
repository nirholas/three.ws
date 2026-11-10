// The production autopilot VM (services/autopilot) installs two systemd units
// and is stood up by provision.sh. These tests pin the properties that, when
// wrong, make the loop silently never run or silently ship.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'services', 'autopilot');
const read = (f) => readFileSync(join(dir, f), 'utf8');

function parseIni(text) {
	const out = {};
	let section = null;
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const m = line.match(/^\[(.+)\]$/);
		if (m) { section = m[1]; out[section] = {}; continue; }
		const kv = line.match(/^([A-Za-z]+)=(.*)$/);
		expect(kv, `unparseable line: ${line}`).toBeTruthy();
		expect(section, `key outside a section: ${line}`).toBeTruthy();
		(out[section][kv[1]] ||= []).push(kv[2]);
	}
	return out;
}

describe('autopilot systemd units', () => {
	it('ships every file the scripts install', () => {
		for (const f of ['autopilot.service', 'autopilot.timer', 'provision.sh', 'bootstrap.sh', 'run.sh']) {
			expect(existsSync(join(dir, f)), f).toBe(true);
		}
	});

	it('service runs run.sh as the autopilot user and never times out a long tick', () => {
		const svc = parseIni(read('autopilot.service')).Service;
		expect(svc.Type).toEqual(['oneshot']);
		expect(svc.User).toEqual(['autopilot']);
		expect(svc.ExecStart).toEqual(['/bin/bash /home/autopilot/three.ws/services/autopilot/run.sh']);
		expect(svc.TimeoutStartSec).toEqual(['infinity']);
		expect(svc.Environment).toContain('AUTOPILOT_HOME=/home/autopilot');
		expect(svc.EnvironmentFile).toEqual(['-/etc/autopilot/env']);
		expect(svc.Nice).toEqual(['10']);
	});

	it('timer measures from the end of the previous tick so ticks cannot overlap', () => {
		const t = parseIni(read('autopilot.timer'));
		expect(t.Timer.OnUnitInactiveSec).toEqual(['2h']);
		expect(t.Timer.OnBootSec).toEqual(['10min']);
		expect(t.Timer.Persistent).toEqual(['true']);
		expect(t.Install.WantedBy).toEqual(['timers.target']);
		expect(read('autopilot.timer')).not.toMatch(/^OnCalendar=/m);
	});

	it('carries no secret', () => {
		for (const f of ['autopilot.service', 'autopilot.timer']) {
			expect(read(f)).not.toMatch(/token|secret|password|ghp_|AKIA/i);
		}
	});

	const analyze = spawnSync('systemd-analyze', ['--version']);
	it.skipIf(analyze.error)('passes systemd-analyze verify', () => {
		const r = spawnSync('systemd-analyze', ['verify', join(dir, 'autopilot.service'), join(dir, 'autopilot.timer')], { encoding: 'utf8' });
		const complaints = (r.stderr || '').split('\n').filter((l) => /autopilot\.(service|timer)/.test(l) && !/Command .* is not executable|No such file or directory|run\.sh/.test(l));
		expect(complaints).toEqual([]);
	});
});

describe('autopilot scripts', () => {
	for (const f of ['provision.sh', 'bootstrap.sh', 'run.sh']) {
		it(`${f} passes bash -n`, () => {
			const r = spawnSync('bash', ['-n', join(dir, f)], { encoding: 'utf8' });
			expect(r.stderr).toBe('');
			expect(r.status).toBe(0);
		});
	}

	it('provision.sh is safe to re-run and never writes a secret or replaces env', () => {
		const src = read('provision.sh');
		// The closing heredoc only prints the owner's command; it never runs it.
		const code = src.split('<<OUT')[0].split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
		expect(code).toContain('set -euo pipefail');
		expect(code).not.toContain('--set-env-vars');
		expect(code).not.toMatch(/\bdelete\b/);
		expect(code).not.toMatch(/ghp_|github_pat_|AKIA|BEGIN [A-Z ]*PRIVATE KEY/);
		expect(code).not.toMatch(/secrets (create|versions add)/);
		expect(src).toContain('--no-ship');
	});

	it('provision.sh --dry-run changes nothing and shows the VM flags', () => {
		const r = spawnSync('bash', [join(dir, 'provision.sh'), '--no-ship', '--dry-run'], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('autopilot-no-ship=1');
		expect(r.stdout).toContain('autopilot-github-token');
	});

	it('provision.sh without --no-ship clears the flag in metadata, so a reboot cannot drop the VM back into no-ship', () => {
		const r = spawnSync('bash', [join(dir, 'provision.sh'), '--dry-run'], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
		expect(r.status).toBe(0);
		expect(r.stdout).toContain('autopilot-no-ship=0');
		expect(read('bootstrap.sh')).toMatch(/autopilot-no-ship\)" = "0" \]; then\s+sed -i '\/\^AUTOPILOT_NO_SHIP=\/d' \/etc\/autopilot\/env/);
	});

	it('bootstrap.sh installs both units, reloads systemd and fails loudly when a unit is missing', () => {
		const src = read('bootstrap.sh');
		expect(src).toContain('systemctl daemon-reload');
		expect(src).toContain('/etc/autopilot/env');
		expect(src).toContain('FATAL');
		expect(src.indexOf('daemon-reload')).toBeLessThan(src.indexOf('enable --now autopilot.timer'));
	});

	it('run.sh is committed executable, so a unit that execs it directly cannot fail with 203/EXEC', () => {
		const r = spawnSync('git', ['ls-files', '-s', '--', join(dir, 'run.sh')], { encoding: 'utf8' });
		expect(r.status).toBe(0);
		expect(r.stdout.split(/\s+/)[0]).toBe('100755');
	});

	it('bootstrap.sh syncs the clone to threews/main and installs the clone units ahead of metadata copies', () => {
		const src = read('bootstrap.sh');
		const sync = src.indexOf('checkout -f -B main threews/main');
		expect(sync).toBeGreaterThan(-1);
		const clone = src.indexOf('"$REPO/services/autopilot/$unit"');
		const meta = src.indexOf('meta_get "$key"');
		expect(sync).toBeLessThan(clone);
		expect(clone).toBeGreaterThan(-1);
		expect(clone).toBeLessThan(meta);
	});

	it('provision.sh lets the VM write logs, so startup-script and tick output reach Cloud Logging', () => {
		expect(read('provision.sh')).toMatch(/^grant roles\/logging\.logWriter$/m);
	});

	it('bootstrap.sh installs git-lfs, because the repo pre-push hook refuses to run without it', () => {
		expect(read('bootstrap.sh')).toMatch(/apt-get install[^\n]*\bgit-lfs\b/);
	});

	it('run.sh jq filters avoid reserved words and null signatures', () => {
		const src = read('run.sh');
		expect(src).not.toMatch(/as \$def\b/);
		expect(src).toContain('.signature | select(. != null)');
	});
});
