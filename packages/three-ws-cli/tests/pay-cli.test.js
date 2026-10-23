// The command surface: `three-ws pay` through main() for exit codes and --json,
// and `three-ws pay mcp` as a real stdio child process driven by an MCP client.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { generateKeyPairSigner } from '@solana/kit';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { EXIT } from '../src/pay/errors.js';
import { SOLANA_DEVNET, USDC_DEVNET } from '../src/pay/permissions.js';
import { startPaidServer, startRpc, tempEnv, writePermissions } from './pay-helpers.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const PASSPHRASE = 'correct horse battery staple';

let rpc;
const servers = [];
beforeAll(async () => {
	rpc = await startRpc();
});
afterAll(() => rpc.close());
afterEach(async () => {
	vi.restoreAllMocks();
	while (servers.length) await servers.pop().close();
});

async function fixture(perms = {}) {
	const payTo = (await generateKeyPairSigner()).address;
	const server = await startPaidServer({ payTo });
	servers.push(server);
	const env = tempEnv({ THREE_WS_SOLANA_RPC_URL: rpc.url, THREE_WS_WALLET_PASSPHRASE: PASSPHRASE, NO_COLOR: '1' });
	env.vars.XDG_CONFIG_HOME = path.join(env.home, '.config');
	writePermissions(env, { version: 1, allowedOrigins: [server.origin], allowedNetworks: [SOLANA_DEVNET], allowedAssets: [USDC_DEVNET], maxPerCall: '0.05', ...perms });
	return { server, env, payTo };
}

async function run(argv, env) {
	let out = '';
	let err = '';
	vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((out += chunk.toString()), true));
	vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((err += chunk.toString()), true));
	const code = await main(argv, env);
	vi.restoreAllMocks();
	return { code, out, err };
}

describe('three-ws wallet', () => {
	it('init, address and export-public agree, and no command prints the key', async () => {
		const { env } = await fixture();
		const init = await run(['wallet', 'init', '--storage', 'file', '--json'], env);
		expect(init.code).toBe(0);
		const { address } = JSON.parse(init.out);
		expect((await run(['wallet', 'export-public'], env)).out.trim()).toBe(address);
		expect(JSON.parse((await run(['wallet', 'address', '--json'], env)).out)).toMatchObject({ address, storage: 'file' });
		const again = await run(['wallet', 'init', '--storage', 'file'], env);
		expect(again.code).toBe(1);
		expect(again.err).toMatch(/never overwrites/);
		const all = fs.readdirSync(path.join(env.home, '.config', 'three-ws')).map((f) => fs.readFileSync(path.join(env.home, '.config', 'three-ws', f), 'utf8')).join('');
		expect(all).not.toMatch(/secret|privateKey/i);
	});
});

describe('three-ws pay', () => {
	it('--dry-run prints payee, amount and network and exits 0 without a wallet', async () => {
		const { server, env, payTo } = await fixture();
		const human = await run(['pay', server.url, '--dry-run'], env);
		expect(human.code).toBe(0);
		expect(human.out).toContain(payTo);
		expect(human.out).toContain('0.01');
		expect(human.out).toContain(SOLANA_DEVNET);

		const json = await run(['pay', server.url, '--dry-run', '--json'], env);
		const parsed = JSON.parse(json.out);
		expect(parsed).toMatchObject({ dryRun: true, decision: 'allowed', chosen: { payTo, amountAtomic: '10000', network: SOLANA_DEVNET } });
		expect(server.paid).toHaveLength(0);
	});

	it('exits 10 with a stable reason when the challenge is outside the permissions', async () => {
		const { server, env } = await fixture({ maxPerCall: '0.005' });
		const refused = await run(['pay', server.url, '--json'], env);
		expect(refused.code).toBe(EXIT.PERMISSION_DENIED);
		expect(JSON.parse(refused.out)).toMatchObject({ error: 'per_call_limit', exit: 10 });
		const dry = await run(['pay', server.url, '--dry-run'], env);
		expect(dry.code).toBe(EXIT.PERMISSION_DENIED);
		expect(dry.err).toMatch(/maxPerCall/);
		expect(server.paid).toHaveLength(0);
	});

	it('pays and prints the body, with the receipt on stderr', async () => {
		const { server, env } = await fixture();
		await run(['wallet', 'init', '--storage', 'file'], env);
		const paid = await run(['pay', server.url], env);
		expect(paid.code).toBe(0);
		expect(JSON.parse(paid.out).data).toBe('paid content');
		expect(paid.err).toMatch(/paid 0\.01 to/);
	});

	it('init writes the default permissions file once', async () => {
		const env = tempEnv();
		env.vars.XDG_CONFIG_HOME = path.join(env.home, '.config');
		expect((await run(['pay', 'init', '--json'], env)).out).toContain('"created": true');
		expect((await run(['pay', 'init', '--json'], env)).out).toContain('"created": false');
	});

	it('--max is a hard ceiling and a bad flag is a usage error', async () => {
		const { server, env } = await fixture();
		expect((await run(['pay', server.url, '--max', '0.001', '--json'], env)).code).toBe(EXIT.PERMISSION_DENIED);
		expect((await run(['pay'], env)).code).toBe(EXIT.USAGE);
	});
});

describe('three-ws pay mcp', () => {
	it('serves pay_quote and pay_fetch over stdio under the same permissions', async () => {
		const { server, env } = await fixture();
		await run(['wallet', 'init', '--storage', 'file'], env);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [CLI, 'pay', 'mcp'],
			env: { PATH: process.env.PATH, HOME: env.home, XDG_CONFIG_HOME: env.vars.XDG_CONFIG_HOME, THREE_WS_SOLANA_RPC_URL: rpc.url, THREE_WS_WALLET_PASSPHRASE: PASSPHRASE },
		});
		const client = new Client({ name: 'test', version: '1.0.0' });
		await client.connect(transport);
		try {
			const tools = (await client.listTools()).tools.map((t) => t.name).sort();
			expect(tools).toEqual(['pay_fetch', 'pay_quote']);

			const quoted = await client.callTool({ name: 'pay_quote', arguments: { url: server.url } });
			expect(JSON.parse(quoted.content[0].text)).toMatchObject({ paymentRequired: true, chosen: { amount: '0.01', network: SOLANA_DEVNET } });
			expect(server.paid).toHaveLength(0);

			const refused = await client.callTool({ name: 'pay_fetch', arguments: { url: server.url, max: '0.001' } });
			expect(refused.isError).toBe(true);
			expect(JSON.parse(refused.content[0].text)).toMatchObject({ error: 'max_flag_exceeded', exit: 10 });

			const fetched = await client.callTool({ name: 'pay_fetch', arguments: { url: server.url } });
			const body = JSON.parse(fetched.content[0].text);
			expect(body).toMatchObject({ paid: true, status: 200 });
			expect(JSON.parse(body.body).data).toBe('paid content');
			expect(server.paid).toHaveLength(1);
		} finally {
			await client.close();
		}
	}, 30_000);
});
