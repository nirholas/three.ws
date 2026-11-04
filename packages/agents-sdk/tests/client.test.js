// Request-shape tests: every client method against a real node:http server,
// asserting the verb, path, query and body the server receives.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ThreeAgents } from '../src/index.ts';
import { startServer, json } from './_helpers/server.js';

let srv;
let c;
const ID = '3f2b1c9e-0000-4000-8000-000000000001';

beforeAll(async () => {
	srv = await startServer((req, res) => json(res, 200, { data: { ok: true }, meta: { requestId: 'r' } }));
	c = new ThreeAgents({ apiKey: 'k', baseUrl: srv.baseUrl, retries: 0 });
});
afterAll(() => srv.close());

const last = () => srv.seen[srv.seen.length - 1];

const CASES = [
	['getAgent', () => c.getAgent(ID), 'GET', `/agents/${ID}`],
	['listAgents', () => c.listAgents({ limit: 5, cursor: 'x' }), 'GET', '/agents', { limit: '5', cursor: 'x' }],
	['updateAgent', () => c.updateAgent(ID, { name: 'n' }), 'PATCH', `/agents/${ID}`, null, { name: 'n' }],
	['startAgent', () => c.startAgent(ID), 'POST', `/agents/${ID}/start`],
	['stopAgent', () => c.stopAgent(ID), 'POST', `/agents/${ID}/stop`],
	['deleteAgent', () => c.deleteAgent(ID), 'DELETE', `/agents/${ID}`],
	['sendMessage', () => c.sendMessage(ID, { message: 'hi' }), 'POST', `/agents/${ID}/messages`, null, { message: 'hi' }],
	['getRun', () => c.getRun('r1'), 'GET', '/runs/r1'],
	['cancelRun', () => c.cancelRun('r1'), 'POST', '/runs/r1/cancel'],
	['getPrice', () => c.getPrice('MINT1'), 'GET', '/intel/price', { mint: 'MINT1' }],
	['getTopMovers', () => c.getTopMovers({ window: '6h', board: 'smart_money', limit: 3 }), 'GET', '/intel/top-movers', { window: '6h', board: 'smart_money', limit: '3' }],
	['getIndicators', () => c.getIndicators({ mint: 'M', indicators: ['rsi', 'ema'], interval: '1h' }), 'GET', '/intel/indicators', { mint: 'M', indicators: 'rsi,ema', interval: '1h' }],
	['getSignals', () => c.getSignals('M'), 'GET', '/intel/signals', { mint: 'M' }],
	['getAnomalies', () => c.getAnomalies({ window: '24h' }), 'GET', '/intel/anomalies', { window: '24h' }],
	['getMacro', () => c.getMacro(), 'GET', '/intel/macro', {}],
	['getWallet', () => c.getWallet(ID, { network: 'devnet' }), 'GET', `/agents/${ID}/wallet`, { network: 'devnet' }],
	['getWalletHistory', () => c.getWalletHistory(ID, { limit: 2 }), 'GET', `/agents/${ID}/wallet/history`, { limit: '2' }],
	['swapQuote', () => c.swapQuote({ inputMint: 'SOL', outputMint: 'USDC', amount: 0.5, slippageBps: 50, agentId: ID }), 'POST', '/trading/swap/quote', null,
		{ input_mint: 'SOL', output_mint: 'USDC', amount: 0.5, slippage_bps: 50, agent_id: ID }],
	['getUsage', () => c.getUsage(), 'GET', '/me/usage'],
	['getBudget', () => c.getBudget(), 'GET', '/me/budget'],
	['getTransactions', () => c.getTransactions({ limit: 10 }), 'GET', '/me/transactions', { limit: '10' }],
	['listIntegrations', () => c.listIntegrations(), 'GET', '/me/integrations'],
	['removeIntegration', () => c.removeIntegration('x'), 'DELETE', '/me/integrations/x'],
	['generateLinkCode', () => c.generateLinkCode({ deviceKind: 'cli', label: 'laptop' }), 'POST', '/me/link-code', null, { deviceKind: 'cli', label: 'laptop' }],
	['redeemLinkCode', () => c.redeemLinkCode({ code: 'ABCDEFGH' }), 'POST', '/me/link-code/redeem', null, { code: 'ABCDEFGH' }],
];

describe('request shapes', () => {
	for (const [name, call, method, path, query, body] of CASES) {
		it(`${name} sends ${method} ${path}`, async () => {
			await call();
			const r = last();
			expect(r.method).toBe(method);
			expect(r.path).toBe(`/api/v1${path}`);
			if (query) expect(r.query).toEqual(query);
			if (body) expect(r.body).toEqual(JSON.parse(JSON.stringify(body)));
			if (method === 'GET') expect(r.headers['idempotency-key']).toBeUndefined();
			else expect(r.headers['idempotency-key']).toBeTruthy();
		});
	}

	it('no money-moving method exists on the client', () => {
		for (const m of ['swapExecute', 'transfer', 'transferQuote', 'setExternalWallet']) expect(c[m]).toBeUndefined();
	});
});

describe('seg() and path injection', () => {
	it.each([
		['getAgent', (x) => c.getAgent(x)],
		['startAgent', (x) => c.startAgent(x)],
		['getRun', (x) => c.getRun(x)],
		['removeIntegration', (x) => c.removeIntegration(x)],
		['getWallet', (x) => c.getWallet(x)],
	])('%s refuses an empty id before sending', async (_n, fn) => {
		const before = srv.seen.length;
		await expect(Promise.resolve().then(() => fn(''))).rejects.toMatchObject({ name: 'ValidationError', code: 'missing_parameter' });
		expect(srv.seen.length).toBe(before);
	});

	it('percent-encodes slashes, dots and query characters so an id cannot escape its segment', async () => {
		await c.getAgent('../../me/budget?x=1#frag');
		const r = last();
		expect(r.url).toBe('/api/v1/agents/..%2F..%2Fme%2Fbudget%3Fx%3D1%23frag');
		expect(r.query).toEqual({});
	});

	it('refuses non-string ids', async () => {
		await expect(Promise.resolve().then(() => c.getAgent(undefined))).rejects.toMatchObject({ name: 'ValidationError' });
		await expect(Promise.resolve().then(() => c.getAgent(42))).rejects.toMatchObject({ name: 'ValidationError' });
	});
});

describe('constructor', () => {
	it('requires an api key', () => {
		expect(() => new ThreeAgents({ apiKey: '  ' })).toThrow(/apiKey is required/);
	});
	it('strips trailing slashes from baseUrl', () => {
		expect(new ThreeAgents({ apiKey: 'k', baseUrl: 'http://h/api/v1///' }).baseUrl).toBe('http://h/api/v1');
	});
});
