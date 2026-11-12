// Process isolation for sandboxed programs (api/_lib/sandbox/exec-core.js
// isolate / detectIsolation): a program gets no network, cannot see the
// process that launched it, and runs as an unprivileged uid. These run a real
// child under the host's best isolation mode and skip only when the host has
// none (the runner itself refuses to serve in that case).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SANDBOX_UID, detectIsolation, hasExternalInterface, isolate, programEnv, runProcess } from '../api/_lib/sandbox/exec-core.js';
import { limitsFor } from '../api/_lib/sandbox/limits.js';

const iso = process.platform === 'linux' ? detectIsolation() : { mode: null, tried: [] };

describe('hasExternalInterface', () => {
	const header = 'Inter-|   Receive\n face |bytes packets\n';
	it('accepts a namespace with only loopback', () => {
		expect(hasExternalInterface(`${header}    lo: 0 0 0\n`)).toBe(false);
	});
	it('flags any other interface', () => {
		expect(hasExternalInterface(`${header}    lo: 0 0\n  eth0: 10 2\n`)).toBe(true);
	});
});

describe('isolate argv', () => {
	it('drops to nobody with no capabilities in root mode', () => {
		const argv = isolate(['python3', 'main.py'], 'root');
		expect(argv[0]).toBe('unshare');
		expect(argv).toContain('--net');
		expect(argv).toContain('--pid');
		expect(argv).toContain(`--reuid=${SANDBOX_UID}`);
		expect(argv).toContain('--bounding-set=-all');
		expect(argv).toContain('--no-new-privs');
		expect(argv.slice(-2)).toEqual(['python3', 'main.py']);
	});
	it('maps the program to nobody in a user namespace in userns mode', () => {
		const argv = isolate(['node', 'main.mjs'], 'userns');
		expect(argv).toContain('--user');
		expect(argv).toContain(`--map-user=${SANDBOX_UID}`);
		expect(argv).toContain('--net');
	});
	it('refuses an unknown mode', () => {
		expect(() => isolate(['true'], 'none')).toThrow(/unknown isolation mode/);
	});
});

describe.runIf(iso.mode)(`an isolated program (${iso.mode} mode)`, () => {
	let dir;
	beforeAll(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sbx-iso-'));
		await fs.chmod(dir, 0o777);
	});
	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});
	const run = (script) =>
		runProcess({
			argv: isolate(['node', '-e', script], iso.mode),
			cwd: dir,
			env: programEnv({ workspace: dir, socketPath: path.join(dir, 'b.sock'), clientsDir: dir, tmpDir: dir, cpu: 1 }),
			limits: limitsFor('free', { timeoutSeconds: 20 }),
			language: 'javascript',
		});

	it('cannot open a connection to the internet', async () => {
		const r = await run(`
			const net = require('node:net');
			const s = net.connect({ host: '1.1.1.1', port: 53, timeout: 3000 });
			s.on('connect', () => { console.log('CONNECTED'); process.exit(0); });
			s.on('timeout', () => { console.log('TIMEOUT'); process.exit(3); });
			s.on('error', (e) => { console.log('ERR ' + e.code); process.exit(2); });
		`);
		expect(r.stdout.text).not.toContain('CONNECTED');
		expect(r.stdout.text).toMatch(/ERR (ENETUNREACH|EHOSTUNREACH|EACCES|EPERM)/);
	}, 20_000);

	it('cannot resolve a hostname', async () => {
		const r = await run(`require('node:dns').lookup('three.ws', (e, a) => { console.log(e ? 'ERR ' + e.code : 'RESOLVED ' + a); })`);
		expect(r.stdout.text).toMatch(/^ERR /);
	}, 20_000);

	it('runs as an unprivileged uid and sees only its own processes', async () => {
		const r = await run(`
			const fs = require('node:fs');
			const pids = fs.readdirSync('/proc').filter((n) => /^\\d+$/.test(n)).map(Number);
			console.log(JSON.stringify({ uid: process.getuid(), maxPid: Math.max(...pids), count: pids.length, ppid: process.ppid }));
		`);
		const out = JSON.parse(r.stdout.text);
		expect(out.uid).toBe(SANDBOX_UID);
		expect(out.count).toBeLessThan(10);
		expect(out.maxPid).toBeLessThan(10);
		expect(out.ppid).toBeLessThanOrEqual(1);
	}, 20_000);

	it('still dies at the wall-clock cap through the namespace launcher', async () => {
		const r = await runProcess({
			argv: isolate(['node', '-e', 'for(;;){}'], iso.mode),
			cwd: dir,
			env: programEnv({ workspace: dir, socketPath: path.join(dir, 'b.sock'), clientsDir: dir, tmpDir: dir, cpu: 1 }),
			limits: limitsFor('free', { timeoutSeconds: 1 }),
			language: 'javascript',
		});
		expect(r.timedOut).toBe(true);
		expect(r.wallMs).toBeLessThan(5000);
		// The busy loop's CPU is metered through the namespace launcher. How much
		// it gets inside a one second cap depends on host load, so only assert
		// that the tree was measured and the loop actually ran.
		expect(r.cpuMs).toBeGreaterThan(0);
	}, 20_000);
});
