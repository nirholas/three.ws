// The Solana RPC spend board (api/ops/rpc-spend.js) ranks callers by route. On
// 2026-11-19 /api/pump-fun-mcp was the top caller again (26,222 getTransaction
// and 8,644 getSignaturesForAddress calls in 6h, with both paid lanes over
// quota), and the board could not say which of its 40+ tools spent them. Every
// tool call now tags its RPC reads with the tool name under the route that
// carried it, so the board names the tool directly.
import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { runWithRpcCaller } from '../api/_lib/request-context.js';
import { currentRpcCaller } from '../api/_lib/solana/rpc-spend.js';

const state = vi.hoisted(() => ({ seen: [] }));

vi.mock('../api/_lib/pump.js', async (orig) => ({
	...(await orig()),
	getConnection: () => ({
		getSignaturesForAddress: vi.fn(async () => {
			state.seen.push(currentRpcCaller());
			return [];
		}),
		getTransactions: vi.fn(async () => []),
	}),
	getAmmPoolState: async () => null,
	getPumpSdkV2: async () => ({ bondingCurvePda: (pk) => pk }),
}));

const { callPumpFunTool, pumpFunToolEntry } = await import('../api/pump-fun-mcp.js');

describe('pump-fun-mcp attributes Solana RPC spend to the tool that made it', () => {
	it('tags reads made inside a tool call with the tool name under the route', async () => {
		state.seen = [];
		const mint = Keypair.generate().publicKey.toBase58();
		await runWithRpcCaller('/api/pump-fun-mcp', () => callPumpFunTool('get_token_trades', { mint }));
		expect(state.seen).toEqual(['/api/pump-fun-mcp#get_token_trades']);
	});

	it('resolves legacy camelCase names to the canonical tag', async () => {
		state.seen = [];
		const mint = Keypair.generate().publicKey.toBase58();
		await runWithRpcCaller('/api/pump-fun-mcp', () => callPumpFunTool('getTokenTrades', { mint }));
		expect(state.seen).toEqual(['/api/pump-fun-mcp#get_token_trades']);
	});

	it('keeps the mounting route when another server runs the tool in-process', async () => {
		state.seen = [];
		const mint = Keypair.generate().publicKey.toBase58();
		const entry = pumpFunToolEntry('get_token_trades');
		await runWithRpcCaller('/mcp', () => entry.handler({ mint }));
		expect(state.seen).toEqual(['/mcp#get_token_trades']);
	});

	it('restores the route tag once the tool returns', async () => {
		state.seen = [];
		const mint = Keypair.generate().publicKey.toBase58();
		let after = null;
		await runWithRpcCaller('/api/pump-fun-mcp', async () => {
			await callPumpFunTool('get_token_trades', { mint });
			after = currentRpcCaller();
		});
		expect(after).toBe('/api/pump-fun-mcp');
	});
});
