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
