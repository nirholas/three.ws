// The ERC-7710 DelegationManager is one shared contract per chain: every app
// built on it emits RedeemedDelegation / DisabledDelegation from the same
// address, so a 2000-block eth_getLogs batch on Base can return hundreds of
// events, almost none about a delegation three.ws holds. The indexer paid one
// eth_call (and an eth_getBlockByNumber per block) for every one of them before
// discovering it was foreign, with no deadline inside that loop and the cursor
// only advancing once the whole batch finished. One busy batch outlasted the
// route's 300s cap, every retry replayed the same batch, and production logged
// `index-delegations exceeded its 300000ms budget` 114 times on 2026-11-25 in
// two hour-long stalls.
//
// The indexer now decodes each log locally (free) and skips any whose delegator
// is not one it tracks on that chain, before spending an RPC call or a DB write.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Interface, getAddress } from 'ethers';
import { DELEGATION_MANAGER_ABI } from '../src/erc7710/abi.js';

const TRACKED = getAddress('0x1111111111111111111111111111111111111111');
const HEAD = 1_000_000;

const db = vi.hoisted(() => ({ calls: [] }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: vi.fn(() => true) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...vals) => {
		const text = strings.join('?');
		db.calls.push({ text, vals });
		if (/FROM indexer_state/i.test(text)) return [{ last_indexed_block: HEAD - 5 - 100 }];
		if (/SELECT[\s\S]*delegator_address[\s\S]*FROM agent_delegations/i.test(text)) {
			return [{ delegator_address: TRACKED }];
		}
		return [];
	}),
}));

const iface = new Interface(DELEGATION_MANAGER_ABI);
const redeemed = iface.getEvent('RedeemedDelegation');
const disabled = iface.getEvent('DisabledDelegation');

function addr(n) {
	return getAddress('0x' + n.toString(16).padStart(40, '0'));
}

function delegation(delegator, salt) {
	return [addr(0xabc), delegator, '0x' + 'ff'.repeat(32), [], salt, '0x'];
}

function redeemedLog(delegator, i) {
	const { data, topics } = iface.encodeEventLog(redeemed, [delegator, addr(0xbeef), delegation(delegator, i)]);
	return { data, topics, blockNumber: '0x' + (HEAD - 50 - i).toString(16), transactionHash: '0x' + i.toString(16).padStart(64, '0') };
}

function disabledLog(delegator, i) {
	const hash = '0x' + (i + 1).toString(16).padStart(64, '0');
	const { data, topics } = iface.encodeEventLog(disabled, [hash, delegator, addr(0xabc), delegation(delegator, i)]);
	return { data, topics, blockNumber: '0x' + (HEAD - 50 - i).toString(16), transactionHash: '0x' + (i + 9000).toString(16).padStart(64, '0') };
}

const rpc = { counts: {}, logs: [] };

beforeEach(() => {
	db.calls.length = 0;
	rpc.counts = {};
	const foreign = [];
	for (let i = 0; i < 150; i++) foreign.push(redeemedLog(addr(0x5000 + i), i));
	for (let i = 0; i < 50; i++) foreign.push(disabledLog(addr(0x7000 + i), 200 + i));
	rpc.logs = [...foreign, redeemedLog(TRACKED, 400), disabledLog(TRACKED, 401)];
	vi.stubGlobal('fetch', vi.fn(async (url, init) => {
		const { method } = JSON.parse(init.body);
		rpc.counts[method] = (rpc.counts[method] || 0) + 1;
		let result;
		if (method === 'eth_blockNumber') result = '0x' + HEAD.toString(16);
		else if (method === 'eth_getLogs') result = String(url).includes('mainnet.base.org') ? rpc.logs : [];
		else if (method === 'eth_getBlockByNumber') result = { timestamp: '0x6740f000' };
		else if (method === 'eth_call') result = '0x' + '22'.repeat(32);
		return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
	}));
});

const { default: handler } = await import('../api/cron/[name].js');

function call() {
	const req = { method: 'GET', url: '/api/cron/index-delegations?name=index-delegations', query: { name: 'index-delegations' }, headers: {} };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
	};
	return handler(req, res).then(() => res);
}

describe('index-delegations on a shared DelegationManager', () => {
	it('spends no RPC call on delegations three.ws does not track', async () => {
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(rpc.counts.eth_call).toBe(1);
		expect(rpc.counts.eth_getBlockByNumber).toBe(2);
	});

	it('writes only the tracked revocation and redemption', async () => {
		await call();
		const revokes = db.calls.filter((c) => /SET status = 'revoked'/i.test(c.text));
		const redeems = db.calls.filter((c) => /redemption_count = redemption_count \+ 1/i.test(c.text));
		expect(revokes).toHaveLength(1);
		expect(redeems).toHaveLength(1);
	});

	it('still advances the Base cursor past the batch', async () => {
		const res = await call();
		const base = JSON.parse(res.body).chains.find((c) => c.chainId === 8453);
		expect(base.toBlock).toBe(HEAD - 5);
		expect(base.skippedForeign).toBe(200);
	});
});
