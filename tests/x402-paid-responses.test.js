// The paid-response store (api/_lib/x402/paid-responses.js) on a real in-process
// Postgres carrying migration 20261121120000: every paid x402 call keeps its full
// body, bodies dedupe by content, a tx is booked once, big bodies go to object
// storage, a dead database spools instead of losing the data, and the rows can
// never be deleted. The last block drives the real payX402 against a local
// 402-then-200 server and asserts the body it paid for lands in the table.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { Keypair } from '@solana/web3.js';

import { createPgliteSql } from './_helpers/pglite-sql.js';
import {
	recordPaidResponse, buildPaidRecord, ingestSpoolEnvelope, drainPaidSpool, listPaidResponses, loadPaidBody,
	paidDataSummary, walletAccounting, resetPaidResponsesSchemaCache, INLINE_MAX_BYTES, SPOOL_PREFIX, BODY_PREFIX,
} from '../api/_lib/x402/paid-responses.js';

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261121120000_x402_paid_responses.sql', import.meta.url), 'utf8');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_MINT_SOLANA = USDC;

// One PGlite per file (booting one is the slow part); each test gets a clean
// public schema. DROP SCHEMA fires no row or truncate triggers.
let pg;
let sql;
beforeAll(async () => {
	pg = new PGlite();
	sql = createPgliteSql({ pg }).sql;
});
beforeEach(async () => {
	resetPaidResponsesSchemaCache();
	await pg.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
	await pg.exec(MIGRATION);
});

const paid = (over = {}) => ({ success: true, paid: true, amountAtomic: 1000, txSig: 'tx1', status: 200, responseBody: { items: [1, 2, 3] }, ...over });
const base = { url: 'https://seller.example/api/data?x=1', method: 'post', requestBody: { q: 'sol' }, payer: 'PayerPubkey1', asset: USDC, network: 'solana:mainnet', durationMs: 42 };
const noStorage = async () => false;
const failPut = async () => { throw new Error('put should not be called'); };

describe('buildPaidRecord', () => {
	it('returns null for anything that was not paid', () => {
		expect(buildPaidRecord({ ...base, result: { ...paid(), paid: false } })).toBeNull();
		expect(buildPaidRecord({ ...base, result: null })).toBeNull();
	});

	it('hashes the canonical body and strips NUL escapes Postgres refuses', () => {
		const a = buildPaidRecord({ ...base, result: paid({ responseBody: { s: 'a\u0000b' } }) });
		const b = buildPaidRecord({ ...base, result: paid({ responseBody: { s: 'ab' } }) });
		expect(a.sha256).toBe(b.sha256);
		expect(a.endpointPath).toBe('/api/data');
		expect(a.method).toBe('POST');
		expect(buildPaidRecord({ ...base, result: paid({ responseBody: 'plain text' }) }).contentType).toBe('text/plain');
	});
});

describe('recordPaidResponse', () => {
	it('stores the full body and the receipt, attributed to its wallet', async () => {
		const out = await recordPaidResponse({ ...base, sql, result: paid(), context: { pipeline: 'ring-tick', endpointKey: 'k', walletKind: 'fresh', freshWalletId: 7, runId: 'run-1' }, put: failPut, storageConfigured: noStorage });
		expect(out).toMatchObject({ stored: true, where: 'db', duplicate: false });
		const [row] = await sql`SELECT * FROM x402_paid_responses`;
		expect(row).toMatchObject({ tx_sig: 'tx1', pipeline: 'ring-tick', endpoint_key: 'k', wallet_kind: 'fresh', payer: 'PayerPubkey1', endpoint_path: '/api/data', method: 'POST', status: 200, run_id: 'run-1' });
		expect(Number(row.fresh_wallet_id)).toBe(7);
		expect(Number(row.amount_atomic)).toBe(1000);
		expect(row.request_body).toEqual({ q: 'sol' });
		expect(await loadPaidBody({ sql, sha256: out.sha256 })).toEqual({ items: [1, 2, 3] });
	});

	it('skips unpaid results without writing', async () => {
		const out = await recordPaidResponse({ ...base, sql, result: { ...paid(), paid: false }, put: failPut, storageConfigured: noStorage });
		expect(out).toEqual({ stored: false, reason: 'not_paid' });
		expect(await sql`SELECT 1 FROM x402_paid_responses`).toHaveLength(0);
	});

	it('stores an identical body once across many purchases', async () => {
		await recordPaidResponse({ ...base, sql, result: paid({ txSig: 'a' }), put: failPut, storageConfigured: noStorage });
		await recordPaidResponse({ ...base, sql, result: paid({ txSig: 'b' }), put: failPut, storageConfigured: noStorage });
		expect(await sql`SELECT 1 FROM x402_paid_responses`).toHaveLength(2);
		expect(await sql`SELECT 1 FROM x402_paid_response_bodies`).toHaveLength(1);
		const [summary] = await paidDataSummary({ sql });
		expect(summary).toMatchObject({ endpoint_path: '/api/data', calls: 2, distinct_bodies: 1, payers: 1 });
	});

	it('books a transaction signature once', async () => {
		await recordPaidResponse({ ...base, sql, result: paid(), put: failPut, storageConfigured: noStorage });
		const again = await recordPaidResponse({ ...base, sql, result: paid(), put: failPut, storageConfigured: noStorage });
		expect(again).toMatchObject({ stored: true, duplicate: true, id: null });
		expect(await sql`SELECT 1 FROM x402_paid_responses`).toHaveLength(1);
	});

	it('moves a body over the inline limit to object storage and reads it back', async () => {
		const big = { blob: 'x'.repeat(INLINE_MAX_BYTES + 10) };
		const objects = new Map();
		const put = async ({ key, body }) => { objects.set(key, body); };
		const out = await recordPaidResponse({ ...base, sql, result: paid({ responseBody: big }), put, storageConfigured: noStorage });
		const [row] = await sql`SELECT body, object_key FROM x402_paid_response_bodies`;
		expect(row.body).toBeNull();
		expect(row.object_key).toBe(`${BODY_PREFIX}/${out.sha256.slice(0, 2)}/${out.sha256}.json`);
		const loaded = await loadPaidBody({ sql, sha256: out.sha256, getObject: async (k) => Buffer.from(objects.get(k)) });
		expect(loaded.blob.length).toBe(big.blob.length);
	});

	it('keeps a big body inline when the object upload fails', async () => {
		const big = { blob: 'y'.repeat(INLINE_MAX_BYTES + 10) };
		const out = await recordPaidResponse({ ...base, sql, result: paid({ responseBody: big }), put: async () => { throw new Error('r2 401'); }, storageConfigured: noStorage });
		expect(out.stored).toBe(true);
		const [row] = await sql`SELECT object_key FROM x402_paid_response_bodies`;
		expect(row.object_key).toBeNull();
	});

	it('spools to object storage when the database write fails, and the spool replays', async () => {
		const brokenSql = () => Promise.reject(new Error('db down'));
		const spooled = [];
		const out = await recordPaidResponse({ ...base, sql: brokenSql, result: paid(), put: async (o) => { spooled.push(o); }, storageConfigured: async () => true });
		expect(out).toMatchObject({ stored: true, where: 'spool' });
		expect(spooled[0].key.startsWith(`${SPOOL_PREFIX}/`)).toBe(true);
		resetPaidResponsesSchemaCache();
		await ingestSpoolEnvelope({ sql, envelope: JSON.parse(spooled[0].body), put: failPut });
		const [row] = await sql`SELECT tx_sig, body_sha256 FROM x402_paid_responses`;
		expect(row).toEqual({ tx_sig: 'tx1', body_sha256: out.sha256 });
	});

	it('refuses a spool envelope whose body was altered', async () => {
		const rec = buildPaidRecord({ ...base, result: paid() });
		const { bodyText, ...record } = rec;
		await expect(ingestSpoolEnvelope({ sql, envelope: { v: 1, record, body: bodyText + ' ' }, put: failPut })).rejects.toThrow(/sha256/);
	});

	it('drains the spool into the tables, deleting only what landed and keeping a tampered envelope', async () => {
		const brokenSql = () => Promise.reject(new Error('db down'));
		const store = new Map();
		const put = async (o) => { store.set(o.key, o.body); };
		await recordPaidResponse({ ...base, sql: brokenSql, result: paid({ txSig: 'txA' }), put, storageConfigured: async () => true });
		await recordPaidResponse({ ...base, sql: brokenSql, result: paid({ txSig: 'txB', responseBody: { other: true } }), put, storageConfigured: async () => true });
		const [goodKey] = [...store.keys()];
		const badKey = `${SPOOL_PREFIX}/2026-11-21/tampered.json`;
		const env = JSON.parse(store.get(goodKey));
		store.set(badKey, JSON.stringify({ ...env, body: env.body + ' ' }));

		const deleted = [];
		const out = await drainPaidSpool({
			sql,
			list: async (prefix) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)), errors: ['r2 list 401'] }),
			get: async (k) => Buffer.from(store.get(k)),
			del: async (k) => { deleted.push(k); store.delete(k); },
			put: failPut,
		});
		expect(out).toMatchObject({ listed: 3, ingested: 2, duplicates: 0, list_errors: ['r2 list 401'] });
		expect(out.failed).toEqual([{ key: badKey, error: expect.stringMatching(/sha256/) }]);
		expect([...store.keys()]).toEqual([badKey]);
		expect(deleted).toHaveLength(2);
		const rows = await sql`SELECT tx_sig FROM x402_paid_responses ORDER BY tx_sig`;
		expect(rows.map((r) => r.tx_sig)).toEqual(['txA', 'txB']);

		// A second pass over an already-ingested envelope books nothing twice.
		store.set(goodKey, JSON.stringify(env));
		const again = await drainPaidSpool({ sql, list: async () => ({ keys: [goodKey], errors: [] }), get: async (k) => Buffer.from(store.get(k)), del: async (k) => store.delete(k), put: failPut });
		expect(again).toMatchObject({ ingested: 0, duplicates: 1, failed: [] });
		expect(await sql`SELECT 1 FROM x402_paid_responses`).toHaveLength(2);
	});

	it('keeps a spool object when the database is still down', async () => {
		const deleted = [];
		const rec = buildPaidRecord({ ...base, result: paid() });
		const { bodyText, ...record } = rec;
		const out = await drainPaidSpool({
			sql: () => Promise.reject(new Error('db down')),
			list: async () => ({ keys: ['x402-paid-spool/d/k.json'], errors: [] }),
			get: async () => Buffer.from(JSON.stringify({ v: 1, record, body: bodyText })),
			del: async (k) => deleted.push(k),
			put: failPut,
		});
		expect(out.failed).toHaveLength(1);
		expect(deleted).toEqual([]);
	});

	it('never throws, even with no store at all', async () => {
		const saved = process.env.DATABASE_URL;
		delete process.env.DATABASE_URL;
		try {
			const out = await recordPaidResponse({ ...base, result: paid(), put: failPut, storageConfigured: noStorage });
			expect(out).toMatchObject({ stored: false, reason: 'no_store_configured' });
		} finally {
			if (saved !== undefined) process.env.DATABASE_URL = saved;
		}
	});
});

describe('listPaidResponses', () => {
	it('pages receipts with their bodies, filtered by endpoint, and reports a body that will not load', async () => {
		const objects = new Map();
		const put = async (o) => { objects.set(o.key, o.body); };
		await recordPaidResponse({ ...base, sql, result: paid({ txSig: 't1' }), put, storageConfigured: noStorage });
		await recordPaidResponse({ ...base, sql, url: 'https://seller.example/api/other', result: paid({ txSig: 't2', responseBody: { o: 1 } }), put, storageConfigured: noStorage });
		await recordPaidResponse({ ...base, sql, result: paid({ txSig: 't3', responseBody: { blob: 'z'.repeat(INLINE_MAX_BYTES + 1) } }), put, storageConfigured: noStorage });

		const first = await listPaidResponses({ sql, limit: 2, getObject: async (k) => Buffer.from(objects.get(k)) });
		expect(first.map((r) => r.tx_sig)).toEqual(['t1', 't2']);
		expect(first[0].body).toEqual({ items: [1, 2, 3] });
		const rest = await listPaidResponses({ sql, afterId: first[1].id, getObject: async () => { throw new Error('object gone'); } });
		expect(rest).toHaveLength(1);
		expect(rest[0]).toMatchObject({ tx_sig: 't3', body: null, body_error: 'object gone' });

		const filtered = await listPaidResponses({ sql, endpoint: '/api/other', withBodies: false });
		expect(filtered.map((r) => r.tx_sig)).toEqual(['t2']);
		expect(filtered[0].body).toBeUndefined();
	});
});

describe('guard triggers', () => {
	beforeEach(async () => {
		await recordPaidResponse({ ...base, sql, result: paid(), put: failPut, storageConfigured: noStorage });
	});

	it('refuses deleting a receipt or a body', async () => {
		await expect(pg.exec('DELETE FROM x402_paid_responses')).rejects.toThrow(/never deleted/);
		await expect(pg.exec('DELETE FROM x402_paid_response_bodies')).rejects.toThrow(/never deleted/);
	});

	it('refuses truncating either table', async () => {
		await expect(pg.exec('TRUNCATE x402_paid_responses')).rejects.toThrow(/never deleted/);
	});

	it('refuses rewriting a stored body or re-pointing a receipt', async () => {
		await expect(pg.exec(`UPDATE x402_paid_response_bodies SET body = '{"forged":true}'::jsonb`)).rejects.toThrow(/immutable/);
		await expect(pg.exec(`UPDATE x402_paid_responses SET tx_sig = 'other'`)).rejects.toThrow(/immutable/);
	});
});

describe('walletAccounting', () => {
	it('joins each payer to its fresh wallet ledger', async () => {
		await pg.exec(`CREATE TABLE x402_fresh_wallets (id bigserial PRIMARY KEY, pubkey text UNIQUE, state text, usdc_funded_atomic bigint, usdc_returned_atomic bigint,
			sol_funded_lamports bigint, sol_reclaimed_lamports bigint, rent_reclaimed_lamports bigint, fund_sig text, pay_sig text, sweep_sig text)`);
		await pg.exec(`INSERT INTO x402_fresh_wallets (pubkey, state, usdc_funded_atomic, usdc_returned_atomic, sol_funded_lamports, sol_reclaimed_lamports, rent_reclaimed_lamports, fund_sig, pay_sig, sweep_sig)
			VALUES ('PayerPubkey1', 'closed', 1000, 0, 900000, 895000, 2039280, 'f', 'tx1', 's')`);
		await recordPaidResponse({ ...base, sql, result: paid(), context: { walletKind: 'fresh' }, put: failPut, storageConfigured: noStorage });
		const [row] = await walletAccounting({ sql });
		expect(row).toMatchObject({ payer: 'PayerPubkey1', wallet_kind: 'fresh', responses: 1, fresh_state: 'closed', pay_sig: 'tx1', sweep_sig: 's' });
		expect(Number(row.paid_atomic)).toBe(1000);
		expect(row.endpoints).toEqual(['/api/data']);
	});
});

describe('payX402 captures what it paid for', () => {
	let server;
	let origin;
	const payTo = Keypair.generate().publicKey.toBase58();
	beforeAll(async () => {
		server = http.createServer((req, res) => {
			res.setHeader('content-type', 'application/json');
			// No keep-alive: a pooled socket the server already closed resets the next call.
			res.setHeader('connection', 'close');
			if (!req.headers['x-payment']) {
				res.statusCode = 402;
				res.end(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: USDC, payTo, amount: '1000', extra: { name: 'USDC', decimals: 6 } }] }));
				return;
			}
			res.setHeader('x-payment-response', Buffer.from(JSON.stringify({ success: true, transaction: 'settledSig123' })).toString('base64'));
			res.statusCode = 200;
			res.end(JSON.stringify({ dataset: 'bought', rows: [{ a: 1 }] }));
		});
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		origin = `http://127.0.0.1:${server.address().port}`;
	});
	afterAll(async () => { await new Promise((r) => server.close(r)); });

	const ctx = (buyer) => ({
		buyer,
		conn: { getAccountInfo: async () => ({ lamports: 1 }), getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }) },
		mintInfo: { decimals: 6 },
		selfPay: true,
		remainingCap: 100_000,
	});

	it('writes the paid body and receipt before returning', async () => {
		const { payX402 } = await import('../api/_lib/x402/pay.js');
		const buyer = Keypair.generate();
		const r = await payX402({ url: `${origin}/feed`, method: 'GET', ...ctx(buyer), capture: { sql, pipeline: 'ring-tick', endpointKey: 'feed', walletKind: 'fresh' } });
		expect(r.paid).toBe(true);
		expect(r.capture).toMatchObject({ stored: true, where: 'db' });
		const [row] = await sql`SELECT tx_sig, payer, wallet_kind, endpoint_path, asset, body_sha256 FROM x402_paid_responses`;
		expect(row).toMatchObject({ tx_sig: 'settledSig123', payer: buyer.publicKey.toBase58(), wallet_kind: 'fresh', endpoint_path: '/feed', asset: USDC });
		expect(await loadPaidBody({ sql, sha256: row.body_sha256 })).toEqual({ dataset: 'bought', rows: [{ a: 1 }] });
	});

	it('writes nothing when the caller opts out with capture:false', async () => {
		const { payX402 } = await import('../api/_lib/x402/pay.js');
		const r = await payX402({ url: `${origin}/feed`, method: 'GET', ...ctx(Keypair.generate()), capture: false });
		expect(r.paid).toBe(true);
		expect(r.capture).toBeUndefined();
		expect(await sql`SELECT 1 FROM x402_paid_responses`).toHaveLength(0);
	});
});
