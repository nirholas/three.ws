import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	readProvider,
	writeProvider,
	threeWsProvider,
	writeHermesModel,
	hermesConfigPath,
	providerPath,
	complete,
} from '../src/provider.js';
import { previewRows } from '../src/commands/inference.js';
import { parse } from '../src/cli.js';

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-provider-'));
	return { home, platform: process.platform, cwd: home, vars: {} };
}

describe('provider file', () => {
	let env;
	beforeEach(() => {
		env = tempEnv();
	});

	it('is absent until a provider is chosen', () => {
		expect(readProvider(env)).toBeNull();
	});

	it('writes the three.ws provider owner-only and reads it back', () => {
		const record = threeWsProvider({ origin: 'https://three.ws/', key: 'sk_live_abcdefghijklmnopqrstuv', agentId: 'agent-1' });
		expect(record.base_url).toBe('https://three.ws/api/v1');
		expect(record.model).toBe('three-ws/agent');
		const file = writeProvider(record, env);
		expect(file).toBe(providerPath(env));
		if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		expect(readProvider(env)).toMatchObject({ provider: 'three-ws', api_key: 'sk_live_abcdefghijklmnopqrstuv', agent_id: 'agent-1' });
	});

	it('is read fresh on every call, so a switch applies with no restart', () => {
		writeProvider(threeWsProvider({ origin: 'https://a.example', key: 'sk_live_first_key_0000000000' }), env);
		expect(readProvider(env).base_url).toBe('https://a.example/api/v1');
		writeProvider(threeWsProvider({ origin: 'https://b.example', key: 'sk_live_second_key_000000000' }), env);
		expect(readProvider(env).base_url).toBe('https://b.example/api/v1');
	});

	it('refuses a completion with no provider configured', async () => {
		await expect(complete({ messages: [{ role: 'user', content: 'hi' }], env })).rejects.toThrow(/provider use three-ws/);
	});
});

describe('Hermes model block', () => {
	it('points the model at three.ws and keeps comments and other settings', () => {
		const env = tempEnv();
		const file = hermesConfigPath(env);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, '# my hermes config\nmodel:\n  default: "anthropic/claude-opus-4"\n  provider: "auto"\nagent:\n  max_turns: 30\n');
		writeHermesModel(threeWsProvider({ origin: 'https://three.ws', key: 'sk_live_hermes_key_000000000' }), env);
		const text = fs.readFileSync(file, 'utf8');
		expect(text).toContain('# my hermes config');
		expect(text).toContain('max_turns: 30');
		expect(text).toMatch(/provider: "?custom"?/);
		expect(text).toContain('base_url: https://three.ws/api/v1');
		expect(text).toMatch(/default: "?three-ws\/agent"?/);
		expect(text).toContain('api_key: sk_live_hermes_key_000000000');
	});

	it('creates the file when Hermes has none yet', () => {
		const env = tempEnv();
		writeHermesModel(threeWsProvider({ origin: 'https://three.ws', key: 'sk_live_new_hermes_000000000' }), env);
		expect(fs.readFileSync(hermesConfigPath(env), 'utf8')).toContain('provider: custom');
	});
});

describe('fund confirmation table', () => {
	it('names recipient, amount, token, chain and credits', () => {
		const labels = previewRows({
			agent: { id: 'a', name: 'Agent' },
			from: 'FromAddr',
			to: 'ToAddr',
			to_label: 'three.ws treasury',
			amount_usdc: 1,
			token: 'USDC',
			network: 'mainnet',
			credits_usd: 1,
			rate: 1,
			network_fee: 'paid by three.ws',
			balance_after_usd: 1,
			wallet_usdc_after: 4,
			expires_at: new Date().toISOString(),
		}).map(([k]) => k);
		for (const k of ['From', 'To', 'Amount', 'Chain', 'Credits', 'Network fee']) expect(labels).toContain(k);
	});
});

describe('argument parsing', () => {
	it('accepts the fund and provider commands', () => {
		expect(parse(['fund', '--amount', '5', '--agent', 'x', '--yes']).flags).toMatchObject({ amount: '5', agent: 'x', yes: true });
		expect(parse(['provider', 'use', 'three-ws'])).toMatchObject({ command: 'provider', positionals: ['use', 'three-ws'] });
	});
});
