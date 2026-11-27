// loadCloudRunEnv copies production credentials into an operator CLI's process.
// It overwrites by design, so a CLI acts on production's values. The one
// exception is `keep`: a credential the operator already put in the shell
// (the eval's local xAI key) must win over whatever the service carries, and
// the service's copy must not even be read.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync }));

import { loadCloudRunEnv } from '../scripts/lib/cloud-run-env.mjs';

const NAMES = ['GROK_API_KEY', 'XAI_API_KEY', 'NVIDIA_API_KEY', 'GROQ_API_KEY', 'UNRELATED'];
const WANTED = /^(GROK_API_KEY|XAI_API_KEY|NVIDIA_API_KEY|GROQ_API_KEY)$/;

// A service that carries a literal xAI key, a secret-backed xAI alias, a
// secret-backed NVIDIA key and one var the caller did not ask for.
const SERVICE_ENV = [
	{ name: 'GROK_API_KEY', value: 'service-grok' },
	{ name: 'XAI_API_KEY', valueFrom: { secretKeyRef: { name: 'xai-secret', key: 'latest' } } },
	{ name: 'NVIDIA_API_KEY', valueFrom: { secretKeyRef: { name: 'nvidia-secret', key: '3' } } },
	{ name: 'UNRELATED', value: 'nope' },
];
const SECRETS = { 'xai-secret': 'service-xai', 'nvidia-secret': 'service-nvidia' };

function fakeGcloud(_bin, args) {
	if (args[0] === 'run') {
		return { status: 0, stdout: JSON.stringify({ spec: { template: { spec: { containers: [{ env: SERVICE_ENV }] } } } }), stderr: '' };
	}
	if (args[0] === 'secrets') {
		const name = args.find((a) => a.startsWith('--secret=')).slice('--secret='.length);
		return { status: 0, stdout: `${SECRETS[name]}\n`, stderr: '' };
	}
	return { status: 1, stdout: '', stderr: `unexpected gcloud ${args.join(' ')}` };
}

const secretsRead = () => spawnSync.mock.calls.filter(([, args]) => args[0] === 'secrets').map(([, args]) => args.find((a) => a.startsWith('--secret=')).slice('--secret='.length));

describe('loadCloudRunEnv', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
		for (const k of NAMES) delete process.env[k];
		spawnSync.mockReset();
		spawnSync.mockImplementation(fakeGcloud);
	});
	afterEach(() => {
		for (const k of NAMES) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it('loads literals and secret references that match, and nothing else', () => {
		const n = loadCloudRunEnv({ wanted: WANTED, required: ['NVIDIA_API_KEY'] });
		expect(n).toBe(3);
		expect(process.env.GROK_API_KEY).toBe('service-grok');
		expect(process.env.XAI_API_KEY).toBe('service-xai');
		expect(process.env.NVIDIA_API_KEY).toBe('service-nvidia');
		expect(process.env.UNRELATED).toBeUndefined();
	});

	it('overwrites a value already in the shell when the name is not kept', () => {
		process.env.NVIDIA_API_KEY = 'shell-nvidia';
		loadCloudRunEnv({ wanted: WANTED });
		expect(process.env.NVIDIA_API_KEY).toBe('service-nvidia');
	});

	it('does not replace a pre-set GROK_API_KEY that the caller keeps', () => {
		process.env.GROK_API_KEY = 'shell-grok';
		const n = loadCloudRunEnv({ wanted: WANTED, keep: ['GROK_API_KEY', 'XAI_API_KEY'] });
		expect(process.env.GROK_API_KEY).toBe('shell-grok');
		expect(process.env.NVIDIA_API_KEY).toBe('service-nvidia');
		expect(n).toBe(1);
	});

	it('leaves every kept alias unread once the shell holds any one of them', () => {
		process.env.XAI_API_KEY = 'shell-xai';
		loadCloudRunEnv({ wanted: WANTED, keep: ['GROK_API_KEY', 'XAI_API_KEY'] });
		expect(process.env.XAI_API_KEY).toBe('shell-xai');
		// The service's GROK_API_KEY must not appear beside the shell's alias: the
		// lane reads GROK_API_KEY first, so it would win over the operator's key.
		expect(process.env.GROK_API_KEY).toBeUndefined();
		expect(secretsRead()).toEqual(['nvidia-secret']);
	});

	it('still loads a kept name from the service when the shell has none of them', () => {
		loadCloudRunEnv({ wanted: WANTED, keep: ['GROK_API_KEY', 'XAI_API_KEY'] });
		expect(process.env.GROK_API_KEY).toBe('service-grok');
		expect(process.env.XAI_API_KEY).toBe('service-xai');
	});

	it('throws when a required name is still unset afterwards', () => {
		expect(() => loadCloudRunEnv({ wanted: /^GROQ_API_KEY$/, required: ['GROQ_API_KEY'] })).toThrow(/missing GROQ_API_KEY/);
	});
});
