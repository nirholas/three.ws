// A complete self-hosted Solana x402 facilitator in one file.
//
//   FEE_PAYER_SECRET_BASE58=...  PAY_TO=<your wallet>  RPC_URL=https://api.devnet.solana.com \
//   NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 MINT=<usdc mint> node server.mjs
//
// Then point your resource server's facilitator URL at http://host:8080 and test it:
//   npx @three-ws/x402-server attack --facilitator http://localhost:8080

import http from 'node:http';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createFacilitator, createFacilitatorHandler } from '@three-ws/x402-server/facilitator';

const need = (k) => {
	const v = process.env[k];
	if (!v) {
		console.error(`missing env ${k}`);
		process.exit(1);
	}
	return v;
};

const facilitator = createFacilitator({
	rpcUrls: need('RPC_URL').split(','),
	feePayer: Keypair.fromSecretKey(bs58.decode(need('FEE_PAYER_SECRET_BASE58'))),
	payToAllowlist: need('PAY_TO').split(','),
	settleableMints: need('MINT').split(','),
	guards: {
		sponsorSolFloorLamports: 20_000_000,
		minSponsoredSettleAtomic: 1000,
		feeBudget: { lamports: 50_000_000, windowMs: 24 * 3600 * 1000 },
	},
});

const handler = createFacilitatorHandler(facilitator, { network: need('NETWORK'), name: 'my x402 facilitator' });
http.createServer(handler).listen(Number(process.env.PORT || 8080), () => console.log('facilitator listening'));
