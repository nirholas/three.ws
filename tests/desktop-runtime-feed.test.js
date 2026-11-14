// three.ws Desktop launch feed: when the venue's public HTTP feed refuses this
// network (Cloudflare 403 to datacenter and some residential ranges), the
// runtime must still see new launches, read straight from Solana: a
// logsSubscribe stream on the pump mint authority delivers every CreateEvent,
// and a cold start backfills the newest creates from the mint authority's
// signatures and their create instructions. The RPC replies and log lines
// below follow the real CreateV2 and CreateEvent layouts observed on mainnet,
// with synthetic keys.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { createPumpFeed, parseCreateInstruction, parseCreateEvent, decodeBase58, isPublicMetadataUrl, PUMP_MINT_AUTHORITY } from '../apps/desktop/src/runtime/feed.js';

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RPC = 'https://rpc.test';
const RPC2 = 'https://rpc-fallback.test';
const BASE = 'https://frontend.test';
const BLOCK_TIME = 1_794_623_428;
const SOL_USD = 150;

const mint = Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const curveKey = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();

function borshString(s) {
	const b = Buffer.from(s, 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32LE(b.length);
	return Buffer.concat([len, b]);
}
function createData({ v2 = true, name = 'Synthetic Coin', symbol = 'SYN', uri = 'https://meta.test/syn.json' } = {}) {
	const disc = createHash('sha256').update(v2 ? 'global:create_v2' : 'global:create').digest().subarray(0, 8);
	const parts = [disc, borshString(name), borshString(symbol), borshString(uri), bs58.decode(creator)];
	if (v2) parts.push(Buffer.alloc(11));
	return bs58.encode(Buffer.concat(parts));
}
function curveAccount({ vTok = 1_000_000_000_000_000n, vSol = 40_000_000_000n, realTok = 700_000_000_000_000n, realSol = 10_000_000_000n, supply = 1_000_000_000_000_000n, complete = false } = {}) {
	const buf = Buffer.alloc(49);
	buf.writeBigUInt64LE(vTok, 8);
	buf.writeBigUInt64LE(vSol, 16);
	buf.writeBigUInt64LE(realTok, 24);
	buf.writeBigUInt64LE(realSol, 32);
	buf.writeBigUInt64LE(supply, 40);
	buf[48] = complete ? 1 : 0;
	return buf.toString('base64');
}
function createTx({ inner = false, data = createData() } = {}) {
	// Account order of the create instruction: mint, mint authority, bonding curve, ...
	const keys = [creator, mint, PUMP_MINT_AUTHORITY, curveKey, other, PUMP_PROGRAM];
	const ix = { programIdIndex: 5, accounts: [1, 2, 3, 4, 0], data };
	return {
		blockTime: BLOCK_TIME,
		transaction: { message: { accountKeys: keys, instructions: inner ? [{ programIdIndex: 4, accounts: [], data: '' }] : [ix] } },
		meta: { err: null, innerInstructions: inner ? [{ index: 0, instructions: [ix] }] : [], loadedAddresses: { writable: [], readonly: [] } },
	};
}

function createEventLog({ eventMint = mint, name = 'Streamed Coin', symbol = 'STR', uri = 'https://meta.test/syn.json', vTok = 1_073_000_000_000_000n, vSol = 30_000_000_000n, realTok = 793_100_000_000_000n, supply = 1_000_000_000_000_000n } = {}) {
	const disc = createHash('sha256').update('event:CreateEvent').digest().subarray(0, 8);
	const u64 = (v) => {
		const b = Buffer.alloc(8);
		b.writeBigUInt64LE(v);
		return b;
	};
	const ts = Buffer.alloc(8);
	ts.writeBigInt64LE(BigInt(BLOCK_TIME));
	const data = Buffer.concat([
		disc, borshString(name), borshString(symbol), borshString(uri),
		bs58.decode(eventMint), bs58.decode(curveKey), bs58.decode(other), bs58.decode(creator),
		ts, u64(vTok), u64(vSol), u64(realTok), u64(supply),
		Buffer.alloc(84), // token program and flags appended by newer program versions
	]);
	return `Program data: ${data.toString('base64')}`;
}

// Minimal WebSocket the feed drives the same way it drives the real one.
function fakeSocketClass() {
	const sockets = [];
	class FakeSocket {
		constructor(url) {
			this.url = url;
			this.sent = [];
			this.closed = false;
			sockets.push(this);
			queueMicrotask(() => this.onopen?.());
		}
		send(m) {
			this.sent.push(JSON.parse(m));
		}
		close() {
			this.closed = true;
		}
		emit(logs, err = null) {
			this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'logsNotification', params: { result: { value: { signature: 'sigStream', err, logs } } } }) });
		}
	}
	return { FakeSocket, sockets };
}

function json(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function harness({ frontend = 403, tx = createTx(), curve = curveAccount(), meta = { twitter: 'https://x.com/synthetic' }, metaUrlOk = true, primary = 200 } = {}) {
	const calls = { rpc: [], rpc2: [], frontend: 0, meta: 0, txParams: [] };
	const fetchImpl = async (url, init = {}) => {
		const u = String(url);
		if (u.startsWith(BASE)) {
			calls.frontend += 1;
			if (frontend === 403) return new Response('<!DOCTYPE html><title>Just a moment...</title>', { status: 403, headers: { 'content-type': 'text/html' } });
			return json([{ mint: 'frontend-mint', symbol: 'FRT', created_timestamp: BLOCK_TIME * 1000, real_sol_reserves: 5e9 }]);
		}
		if (u.startsWith('https://api.coinbase.com/')) return json({ data: { amount: String(SOL_USD) } });
		if (u === RPC && primary === 429) {
			calls.rpc.push(JSON.parse(init.body).method);
			return json({ jsonrpc: '2.0', error: { code: 429, message: 'Too many requests for a specific RPC call' } }, 429);
		}
		if (u === RPC || u === RPC2) {
			const body = JSON.parse(init.body);
			(u === RPC ? calls.rpc : calls.rpc2).push(body.method);
			if (body.method === 'getTransaction') calls.txParams.push(body.params[1]);
			if (body.method === 'getSignaturesForAddress') return json({ result: [{ signature: 'sigCreate1', err: null, blockTime: BLOCK_TIME }, { signature: 'sigFailed', err: { InstructionError: [0, 'x'] }, blockTime: BLOCK_TIME }] });
			if (body.method === 'getTransaction') return json({ result: tx });
			if (body.method === 'getMultipleAccounts') return json({ result: { value: body.params[0].map(() => (curve ? { data: [curve, 'base64'] } : null)) } });
			return json({ error: { code: -32601, message: 'unknown' } });
		}
		if (u === 'https://meta.test/syn.json') {
			calls.meta += 1;
			return json(meta);
		}
		throw new Error(`unexpected fetch ${u}`);
	};
	const lookup = async () => (metaUrlOk ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
	const { FakeSocket, sockets } = fakeSocketClass();
	const feed = createPumpFeed({ fetchImpl, base: BASE, rpcUrl: RPC, fallbackRpcUrls: [RPC2], wsUrl: 'wss://rpc.test', WebSocketImpl: FakeSocket, lookup });
	return { feed, calls, sockets };
}

describe('desktop launch feed: on-chain fallback when the venue feed is blocked', () => {
	it('returns launches read from Solana when the frontend answers 403', async () => {
		const { feed, calls } = harness();
		const launches = await feed.launches({ limit: 5 });
		expect(calls.frontend).toBe(1);
		expect(launches).toHaveLength(1);
		const l = launches[0];
		expect(l.mint).toBe(mint);
		expect(l.name).toBe('Synthetic Coin');
		expect(l.symbol).toBe('SYN');
		expect(l.creator).toBe(creator);
		expect(l.created_at).toBe(BLOCK_TIME * 1000);
		expect(l.liquidity_sol).toBe(10);
		// 40 SOL virtual over 1e15 virtual base units, 1e15 supply: 40 SOL cap.
		expect(l.market_cap_usd).toBeCloseTo(40 * SOL_USD, 6);
		expect(l.twitter).toBe('https://x.com/synthetic');
		expect(l.graduated).toBe(false);
		expect(feed.lastSource).toBe('chain');
		// The failed transaction is never fetched, and versioned (v0 and v1)
		// transactions are accepted: mainnet creates are v1 now.
		expect(calls.rpc.filter((m) => m === 'getTransaction')).toHaveLength(1);
		expect(calls.txParams[0].maxSupportedTransactionVersion).toBe(1);
		feed.close();
	});

	it('serves launches streamed over logsSubscribe without any per-launch RPC', async () => {
		const { feed, calls, sockets } = harness();
		await feed.launches({ limit: 5 });
		expect(sockets).toHaveLength(1);
		await new Promise((r) => queueMicrotask(r));
		expect(sockets[0].sent[0]).toMatchObject({ method: 'logsSubscribe', params: [{ mentions: [PUMP_MINT_AUTHORITY] }, { commitment: 'confirmed' }] });

		const streamed = Keypair.generate().publicKey.toBase58();
		sockets[0].emit(['Program log: Instruction: CreateV2', createEventLog({ eventMint: streamed }), 'Program log: unrelated']);
		sockets[0].emit([createEventLog({ eventMint: Keypair.generate().publicKey.toBase58() })], { InstructionError: [0, 'x'] });
		const before = calls.rpc.filter((m) => m === 'getTransaction').length;
		const launches = await feed.launches({ limit: 5 });
		expect(calls.rpc.filter((m) => m === 'getTransaction').length).toBe(before);
		// Newest first; the failed transaction's event is ignored.
		expect(launches.map((l) => l.mint)).toEqual([streamed, mint]);
		expect(launches[0]).toMatchObject({ name: 'Streamed Coin', symbol: 'STR', creator, created_at: BLOCK_TIME * 1000 });
		feed.close();
		expect(sockets[0].closed).toBe(true);
	});

	it('fails over to the next RPC when the public one rate-limits', async () => {
		const { feed, calls } = harness({ primary: 429 });
		const launches = await feed.launches({ limit: 5 });
		expect(launches.map((l) => l.mint)).toEqual([mint]);
		expect(calls.rpc).toContain('getSignaturesForAddress');
		expect(calls.rpc2).toEqual(expect.arrayContaining(['getSignaturesForAddress', 'getTransaction', 'getMultipleAccounts']));
		feed.close();
	});

	it('finds a create made through another program (inner instruction) and the v1 create', async () => {
		for (const tx of [createTx({ inner: true }), createTx({ data: createData({ v2: false }) })]) {
			const { feed } = harness({ tx });
			const launches = await feed.launches({ limit: 5 });
			expect(launches.map((l) => l.mint)).toEqual([mint]);
		}
	});

	it('drops graduated curves and transactions that are not creates', async () => {
		expect(await harness({ curve: curveAccount({ complete: true }) }).feed.launches()).toEqual([]);
		const buyData = bs58.encode(Buffer.concat([createHash('sha256').update('global:buy').digest().subarray(0, 8), Buffer.alloc(16)]));
		expect(await harness({ tx: createTx({ data: buyData }) }).feed.launches()).toEqual([]);
	});

	it('caches parsed transactions so the next sweep only fetches new signatures', async () => {
		const { feed, calls } = harness();
		await feed.launches({ limit: 5 });
		await feed.launches({ limit: 5 });
		expect(calls.rpc.filter((m) => m === 'getTransaction')).toHaveLength(1);
		expect(calls.meta).toBe(1);
	});

	it('never fetches token metadata that resolves to a private address', async () => {
		const { feed, calls } = harness({ metaUrlOk: false });
		const [l] = await feed.launches({ limit: 5 });
		expect(l.mint).toBe(mint);
		expect(l.twitter).toBeNull();
		expect(calls.meta).toBe(0);
	});

	it('keeps using the frontend when it answers, without touching RPC', async () => {
		const { feed, calls } = harness({ frontend: 200 });
		const launches = await feed.launches({ limit: 5 });
		expect(launches.map((l) => l.mint)).toEqual(['frontend-mint']);
		expect(feed.lastSource).toBe('frontend');
		expect(calls.rpc).toEqual([]);
	});
});

describe('create instruction, create event and metadata URL guards', () => {
	it('decodes a CreateEvent log and ignores every other event', () => {
		const ev = parseCreateEvent(Buffer.from(createEventLog().slice(14), 'base64'));
		expect(ev).toMatchObject({ mint, name: 'Streamed Coin', symbol: 'STR', uri: 'https://meta.test/syn.json', creator, created_at: BLOCK_TIME * 1000 });
		expect(ev.curve).toMatchObject({ virtual_token_reserves: 1_073_000_000_000_000, virtual_sol_reserves: 30_000_000_000, token_total_supply: 1_000_000_000_000_000, complete: false });
		const tradeDisc = createHash('sha256').update('event:TradeEvent').digest().subarray(0, 8);
		expect(parseCreateEvent(Buffer.concat([tradeDisc, Buffer.alloc(300)]))).toBeNull();
		expect(parseCreateEvent(Buffer.from(createEventLog().slice(14), 'base64').subarray(0, 60))).toBeNull();
	});
	it('parses name, symbol, uri and creator and rejects other instructions', () => {
		const parsed = parseCreateInstruction(decodeBase58(createData()));
		expect(parsed).toEqual({ name: 'Synthetic Coin', symbol: 'SYN', uri: 'https://meta.test/syn.json', creator });
		expect(parseCreateInstruction(Buffer.alloc(40))).toBeNull();
		expect(parseCreateInstruction(Buffer.alloc(3))).toBeNull();
	});
	it('decodes base58 the same as the reference implementation', () => {
		const bytes = Buffer.from([0, 0, 1, 2, 3, 250, 255]);
		expect(Buffer.from(decodeBase58(bs58.encode(bytes)))).toEqual(bytes);
		expect(decodeBase58('0OIl')).toBeNull();
	});
	it('only allows https metadata on public addresses', async () => {
		const pub = async () => [{ address: '93.184.216.34', family: 4 }];
		expect(await isPublicMetadataUrl('https://meta.test/a.json', pub)).toBe(true);
		expect(await isPublicMetadataUrl('http://meta.test/a.json', pub)).toBe(false);
		expect(await isPublicMetadataUrl('https://127.0.0.1/a.json', pub)).toBe(false);
		expect(await isPublicMetadataUrl('https://localhost/a.json', pub)).toBe(false);
		expect(await isPublicMetadataUrl('https://[::1]/a.json', pub)).toBe(false);
		for (const address of ['10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
			expect(await isPublicMetadataUrl('https://rebind.test/a.json', async () => [{ address, family: address.includes(':') ? 6 : 4 }])).toBe(false);
		}
		expect(await isPublicMetadataUrl('not a url', pub)).toBe(false);
	});
});
