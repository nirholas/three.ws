import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getClient, detectClients, readServers, writeServer } from '../src/clients/index.js';

const STUDIO_URL = 'https://three.ws/api/mcp-studio';

function tempEnv() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-bob-'));
	const cwd = path.join(home, 'project');
	fs.mkdirSync(cwd);
	return { home, platform: process.platform, cwd, vars: {} };
}

describe('IBM Bob client', () => {
	const bob = getClient('bob');

	it('is detected only when ~/.bob exists', () => {
		const env = tempEnv();
		expect(detectClients(env).map((c) => c.id)).not.toContain('bob');
		fs.mkdirSync(path.join(env.home, '.bob'));
		expect(detectClients(env).map((c) => c.id)).toContain('bob');
	});

	it('writes the streamable-http entry to the global settings file and keeps other servers', () => {
		const env = tempEnv();
		const file = path.join(env.home, '.bob', 'settings', 'mcp.json');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { type: 'streamable-http', url: 'https://example.com/mcp' } } }, null, 2));

		const written = writeServer(bob, 'three-ws-studio', bob.http({ url: STUDIO_URL, headers: {} }), env);

		expect(written).toBe(file);
		const servers = readServers(bob, env);
		expect(servers['three-ws-studio']).toEqual({ type: 'streamable-http', url: STUDIO_URL });
		expect(servers.other.url).toBe('https://example.com/mcp');
	});

	it('writes .bob/mcp.json in the project when project-scoped, with headers when a key is used', () => {
		const env = tempEnv();
		const entry = bob.http({ url: STUDIO_URL, headers: { Authorization: 'Bearer sk_test_bob' } });
		const file = writeServer(bob, 'three-ws-studio', entry, env, { project: true });

		expect(file).toBe(path.join(env.cwd, '.bob', 'mcp.json'));
		expect(bob.scopes).toEqual(['user', 'project']);
		expect(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['three-ws-studio']).toEqual({
			type: 'streamable-http',
			url: STUDIO_URL,
			headers: { Authorization: 'Bearer sk_test_bob' },
		});
	});
});
