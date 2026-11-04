// Sandbox backend selection and the docker argv (api/_lib/sandbox/backends.js):
// a run stays on the backend it was pinned to, an unavailable backend is never
// picked, and the docker container is locked down (no network, read-only root,
// no capabilities, the plan's memory and CPU, the program as a non-root user).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limitsFor } from '../api/_lib/sandbox/limits.js';

const KEYS = ['SANDBOX_RUNNER_URL', 'SANDBOX_RUNNER_TOKEN', 'SANDBOX_LOCAL', 'SANDBOX_DOCKER'];
let saved;
beforeEach(() => {
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

const { anyBackendAvailable, backendStatus, chooseBackend, dockerArgv } = await import('../api/_lib/sandbox/backends.js');

describe('chooseBackend', () => {
	it('refuses when nothing is configured, and says why per backend', () => {
		expect(anyBackendAvailable()).toBe(false);
		expect(() => chooseBackend()).toThrow(expect.objectContaining({ status: 503, code: 'sandbox_unavailable' }));
		const status = backendStatus();
		expect(status.map((s) => s.id)).toEqual(['cloudrun', 'docker', 'local']);
		expect(status.find((s) => s.id === 'cloudrun').reason).toMatch(/SANDBOX_RUNNER_URL/);
		expect(status.find((s) => s.id === 'docker').reason).toMatch(/SANDBOX_DOCKER/);
	});

	it('prefers the cloud runner, honors an available preference, and keeps a pinned run on its backend', () => {
		process.env.SANDBOX_RUNNER_URL = 'https://runner-{size}.example.test';
		process.env.SANDBOX_RUNNER_TOKEN = 't';
		expect(chooseBackend().id).toBe('cloudrun');
		expect(chooseBackend({ preferred: 'docker' }).id).toBe('cloudrun');
		expect(chooseBackend({ pinned: 'cloudrun' }).id).toBe('cloudrun');
		expect(() => chooseBackend({ pinned: 'docker' })).toThrow(expect.objectContaining({ code: 'backend_unavailable' }));
		expect(() => chooseBackend({ pinned: 'mainframe' })).toThrow(/unknown backend/);
	});
});

describe('dockerArgv', () => {
	const dirs = { workspace: '/data/jobs/j1/workspace', prog: '/data/jobs/j1/prog', sock: '/data/jobs/j1/sock', programFile: '/data/jobs/j1/prog/main.py' };
	const limits = limitsFor('pro');
	const argv = dockerArgv({ name: 'sbx-1', dirs, limits, job: { kind: 'code', language: 'python', code: 'print(1)' }, image: 'three-ws-sandbox:latest', user: '65534:65534' });
	const flag = (f) => argv[argv.indexOf(f) + 1];

	it('locks the container down', () => {
		expect(flag('--network')).toBe('none');
		expect(argv).toContain('--read-only');
		expect(flag('--cap-drop')).toBe('ALL');
		expect(flag('--security-opt')).toBe('no-new-privileges');
		expect(flag('--user')).toBe('65534:65534');
		expect(flag('--memory')).toBe(`${limits.memoryMb}m`);
		expect(flag('--memory-swap')).toBe(`${limits.memoryMb}m`);
		expect(flag('--cpus')).toBe(String(limits.cpu));
		expect(flag('--pids-limit')).toBe('256');
	});

	it('mounts the program read-only and passes no host environment', () => {
		expect(argv).toContain(`type=bind,source=${dirs.prog},target=/sandbox/prog,readonly`);
		expect(argv).toContain(`type=bind,source=${dirs.workspace},target=/workspace`);
		const env = argv.filter((_, i) => argv[i - 1] === '-e');
		expect(env).toContain('THREE_WS_WORKSPACE=/workspace');
		expect(env).toContain('THREE_WS_SOCKET=/run/three_ws/bridge.sock');
		expect(env.some((e) => /^(DATABASE_URL|JWT_SECRET|GOOGLE_|AWS_)/.test(e))).toBe(false);
		const image = argv.indexOf('three-ws-sandbox:latest');
		expect(argv[image - 1]).toBe('');
		expect(argv.slice(image + 1)).toContain('/sandbox/prog/main.py');
	});
});
