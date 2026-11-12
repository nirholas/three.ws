// The in-browser verifier must read the anchor from the cluster the API reports
// (anchor_network / anchor.network), never from an assumed default.
import { describe, it, expect } from 'vitest';
import { readOnchainAnchor } from '../src/proof-of-custody/verifier.js';

const ROOT = 'a'.repeat(64);
const memoTx = {
	transaction: { message: { instructions: [{ program: 'spl-memo', parsed: JSON.stringify({ kind: 'threews.custody.v1', epoch: 7, root: ROOT, wallet_count: 3 }) }] } },
};

describe('readOnchainAnchor network', () => {
	for (const net of ['mainnet', 'devnet']) {
		it(`fetches from ${net} when the response says ${net}`, async () => {
			const seen = [];
			const out = await readOnchainAnchor('sig1', net, {
				fetchTx: async (sig, network) => { seen.push([sig, network]); return { tx: memoTx, endpoint: `rpc-${network}` }; },
			});
			expect(seen).toEqual([['sig1', net]]);
			expect(out.root).toBe(ROOT);
			expect(out.epoch).toBe(7);
			expect(out.endpoint).toBe(`rpc-${net}`);
		});
	}
});

// api.mainnet-beta.solana.com answers 403 to any request carrying a browser
// Origin, so trying it first put a "Failed to load resource: 403" console error
// on every /integrity and /proof load before failover reached a working node.
describe('readOnchainAnchor default endpoints', () => {
	it('reads mainnet from a browser-reachable endpoint first and never calls the origin-blocked public RPC', async () => {
		const urls = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (url) => {
			urls.push(String(url));
			return { ok: true, json: async () => ({ result: memoTx }) };
		};
		try {
			const out = await readOnchainAnchor('sig1', 'mainnet');
			expect(urls).toEqual(['https://solana-rpc.publicnode.com']);
			expect(out.endpoint).toBe('https://solana-rpc.publicnode.com');
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('falls back to the same-origin proxy, not the origin-blocked RPC, when publicnode fails', async () => {
		const urls = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (url) => {
			urls.push(String(url));
			if (String(url).startsWith('https://solana-rpc.publicnode.com')) return { ok: false, status: 503 };
			return { ok: true, json: async () => ({ result: memoTx }) };
		};
		try {
			const out = await readOnchainAnchor('sig1', 'mainnet');
			expect(urls).toEqual(['https://solana-rpc.publicnode.com', '/api/solana-rpc?network=mainnet']);
			expect(urls).not.toContain('https://api.mainnet-beta.solana.com');
			expect(out.root).toBe(ROOT);
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});
