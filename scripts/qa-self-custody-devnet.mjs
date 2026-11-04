#!/usr/bin/env node
// Devnet proof of the self-custody path: build a transfer with signer "external",
// sign it with a throwaway keypair the platform never sees, submit it through
// POST /api/tx/submit and print the confirmed signature and the ledger row.
//
//   BASE_URL=http://localhost:3000 API_KEY=<key with wallet:write> AGENT_ID=<uuid> \
//     node scripts/qa-self-custody-devnet.mjs
//
// Devnet only: the build request pins network "devnet" and the script refuses to
// continue if the RPC genesis hash is not devnet's. No mainnet funds are touched.

import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY;
const AGENT_ID = process.env.AGENT_ID;
const RPC = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

if (!API_KEY || !AGENT_ID) {
	console.error('Set API_KEY (a key with the wallet:write scope) and AGENT_ID (an agent that key owns).');
	process.exit(2);
}

const conn = new Connection(RPC, 'confirmed');
if ((await conn.getGenesisHash()) !== DEVNET_GENESIS) {
	console.error(`refusing to run: ${RPC} is not devnet`);
	process.exit(2);
}

async function api(path, body) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
		body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`${path} answered ${res.status}: ${json.error_description || json.error || 'no body'}`);
	return json.data ?? json;
}

async function fund(kp) {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
			const bh = await conn.getLatestBlockhash();
			await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
			return;
		} catch (err) {
			if (attempt === 4) throw new Error(`devnet airdrop failed after 5 tries: ${err.message}`);
			await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
		}
	}
}

const signer = Keypair.generate();
const recipient = Keypair.generate();
console.log(`throwaway signer: ${signer.publicKey.toBase58()}`);
await fund(signer);

const prepared = await api('/api/tx/solana/build-transfer', {
	sender: signer.publicKey.toBase58(),
	recipient: recipient.publicKey.toBase58(),
	amount: 0.01,
	token: 'SOL',
	network: 'devnet',
	signer: 'external',
	agent_id: AGENT_ID,
});
console.log(`prepared tx_id: ${prepared.tx_id}`);

const tx = VersionedTransaction.deserialize(Buffer.from(prepared.transaction, 'base64'));
tx.sign([signer]);

const settled = await api('/api/tx/submit', {
	tx_id: prepared.tx_id,
	signed_transaction: Buffer.from(tx.serialize()).toString('base64'),
});
console.log(`status: ${settled.status}`);
console.log(`signature: ${settled.signature}`);
console.log(`ledger row: ${JSON.stringify(settled.ledger ?? null)}`);
if (settled.status !== 'confirmed' || !settled.ledger) {
	console.error('the transaction did not confirm with a ledger row');
	process.exit(1);
}
