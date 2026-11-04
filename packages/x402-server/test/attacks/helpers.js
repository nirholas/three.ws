import http from 'node:http';
import { Keypair } from '@solana/web3.js';
import { createFacilitator, createFacilitatorHandler, USDC_DEVNET } from '../../src/facilitator/index.js';

export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

// An RPC double that refuses every call: attack cases must be refused statically,
// so any RPC read in a refusal path is itself a finding.
export const refusingRpc = new Proxy({}, {
	get: (_, name) => async () => {
		throw new Error(`unexpected rpc call: ${String(name)}`);
	},
});

export async function startFacilitator(overrides = {}) {
	const sponsor = Keypair.generate();
	const payTo = Keypair.generate().publicKey.toBase58();
	const facilitator = createFacilitator({
		connection: refusingRpc,
		feePayer: sponsor,
		payToAllowlist: [payTo],
		settleableMints: [USDC_DEVNET],
		guards: { sponsorSolFloorLamports: 20_000_000, minSponsoredSettleAtomic: 1000 },
		...overrides,
	});
	const server = http.createServer(createFacilitatorHandler(facilitator, { network: DEVNET }));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const url = `http://127.0.0.1:${server.address().port}`;
	return {
		facilitator,
		sponsor,
		payTo,
		url,
		mint: USDC_DEVNET,
		close: () => new Promise((r) => server.close(r)),
	};
}
