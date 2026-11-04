// The kit transport must split a getMultipleAccounts call that exceeds the
// 100-account limit public RPC lanes enforce (lending SDKs load a whole market in
// one call), then stitch the replies back in order.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { chunkMultipleAccounts } from '../api/_lib/solana/kit-rpc.js';

const addr = (i) => `Addr${i}`;

describe('chunkMultipleAccounts', () => {
	afterEach(() => vi.restoreAllMocks());

	it('passes small and unrelated calls straight through', async () => {
		const send = vi.fn(async (p) => ({ jsonrpc: '2.0', id: p.id, result: { context: { slot: 1 }, value: (p.params[0] || []).map((a) => a) } }));
		const out = await chunkMultipleAccounts({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [[addr(1), addr(2)], {}] }, send);
		expect(send).toHaveBeenCalledTimes(1);
		expect(out.result.value).toEqual([addr(1), addr(2)]);
		await chunkMultipleAccounts({ jsonrpc: '2.0', id: 2, method: 'getSlot', params: [] }, send);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('splits 250 accounts into three requests of at most 100 and keeps order', async () => {
		const sizes = [];
		const send = vi.fn(async (p) => {
			sizes.push(p.params[0].length);
			return { jsonrpc: '2.0', id: p.id, result: { context: { slot: 7 }, value: p.params[0].map((a) => ({ a })) } };
		});
		const keys = Array.from({ length: 250 }, (_, i) => addr(i));
		const out = await chunkMultipleAccounts({ jsonrpc: '2.0', id: 9, method: 'getMultipleAccounts', params: [keys, { encoding: 'base64' }] }, send);
		expect(sizes).toEqual([100, 100, 50]);
		expect(out.id).toBe(9);
		expect(out.result.value.map((v) => v.a)).toEqual(keys);
		expect(out.result.context.slot).toBe(7);
	});

	it('returns the first error reply instead of a partial result', async () => {
		let n = 0;
		const send = vi.fn(async (p) => (++n === 2 ? { jsonrpc: '2.0', id: p.id, error: { code: -32000, message: 'boom' } } : { jsonrpc: '2.0', id: p.id, result: { context: { slot: 1 }, value: p.params[0] } }));
		const keys = Array.from({ length: 150 }, (_, i) => addr(i));
		const out = await chunkMultipleAccounts({ jsonrpc: '2.0', id: 3, method: 'getMultipleAccounts', params: [keys, {}] }, send);
		expect(out.error.message).toBe('boom');
		expect(out.result).toBeUndefined();
	});
});
