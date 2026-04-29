#!/usr/bin/env node
/**
 * One-time bootstrap: register the three.ws credential + schemas on Solana
 * Attestation Service (SAS). Idempotent — safe to re-run; existing accounts
 * are left untouched.
 *
 * Usage:
 *   SAS_AUTHORITY_SECRET=<base58 secret key> \
 *   node scripts/sas-bootstrap.js devnet
 *
 * The authority secret is the keypair that:
 *   - Pays for credential + schema rent
 *   - Owns the credential (can later authorize additional signers via
 *     changeAuthorizedSigners)
 *   - Signs every attestation issued under these schemas
 *
 * On success, sdk/src/sas-config.json is updated with the derived PDAs.
 *
 * Funding: the authority wallet needs ~0.05 SOL on the target cluster to cover
 * one credential + N schemas. Use https://faucet.solana.com for devnet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import {
	createSolanaRpc, createSolanaRpcSubscriptions, createKeyPairSignerFromBytes,
	address, lamports, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
	signTransactionMessageWithSigners, getSignatureFromTransaction,
	sendAndConfirmTransactionFactory,
} from '@solana/kit';
import {
	deriveCredentialPda, deriveSchemaPda,
	getCreateCredentialInstruction, getCreateSchemaInstruction,
	fetchMaybeCredential, fetchMaybeSchema,
} from 'sas-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'sdk', 'src', 'sas-config.json');

const NETWORK = process.argv[2] || 'devnet';
if (!['devnet', 'mainnet'].includes(NETWORK)) {
	console.error('usage: node scripts/sas-bootstrap.js <devnet|mainnet>');
	process.exit(1);
}

const SECRET = process.env.SAS_AUTHORITY_SECRET;
if (!SECRET) {
	console.error('SAS_AUTHORITY_SECRET (base58) required');
	process.exit(1);
}

const RPC_URL = NETWORK === 'mainnet'
	? (process.env.SOLANA_RPC_URL        || 'https://api.mainnet-beta.solana.com')
	: (process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com');
const WSS_URL = RPC_URL.replace(/^http/, 'ws');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

(async () => {
	const rpc     = createSolanaRpc(RPC_URL);
	const rpcSubs = createSolanaRpcSubscriptions(WSS_URL);
	const send    = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSubs });
	const authority = await createKeyPairSignerFromBytes(bs58.decode(SECRET));

	console.log('network  :', NETWORK);
	console.log('authority:', authority.address);

	// ── Credential ────────────────────────────────────────────────────────────
	const [credentialPda] = await deriveCredentialPda({
		authority: authority.address,
		name:      config.credentialName,
	});
	console.log('credential PDA:', credentialPda);

	const existingCred = await fetchMaybeCredential(rpc, credentialPda);
	if (!existingCred.exists) {
		await sendIx(rpc, send, authority, getCreateCredentialInstruction({
			payer:         authority,
			credential:    credentialPda,
			authority,
			name:          config.credentialName,
			signers:       [authority.address],
		}));
		console.log('  created');
	} else {
		console.log('  already exists, skipping');
	}

	// ── Schemas ───────────────────────────────────────────────────────────────
	const out = { credential: credentialPda, schemas: {} };
	for (const [kind, def] of Object.entries(config.schemas)) {
		const [schemaPda] = await deriveSchemaPda({
			credential: address(credentialPda),
			name:       def.name,
			version:    def.version,
		});
		console.log(`schema ${kind} PDA:`, schemaPda);

		const existingSchema = await fetchMaybeSchema(rpc, schemaPda);
		if (!existingSchema.exists) {
			await sendIx(rpc, send, authority, getCreateSchemaInstruction({
				payer:       authority,
				authority,
				credential:  credentialPda,
				schema:      schemaPda,
				name:        def.name,
				description: def.description,
				layout:      Uint8Array.from(def.layout),
				fieldNames:  def.fieldNames,
			}));
			console.log('  created');
		} else {
			console.log('  already exists, skipping');
		}
		out.schemas[kind] = schemaPda;
	}

	// ── Persist PDAs ──────────────────────────────────────────────────────────
	config.pdas[NETWORK] = out;
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n');
	console.log('\n✓ wrote', CONFIG_PATH);
	console.log('\nNext: set SAS_AUTHORITY_SECRET on Vercel and deploy.');
})().catch((e) => {
	console.error('\n✗ bootstrap failed:', e);
	process.exit(1);
});

async function sendIx(rpc, send, payer, ix) {
	const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
	const msg = pipe(
		createTransactionMessage({ version: 0 }),
		(m) => setTransactionMessageFeePayerSigner(payer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
		(m) => appendTransactionMessageInstructions([ix], m),
	);
	const signed = await signTransactionMessageWithSigners(msg);
	await send(signed, { commitment: 'confirmed' });
	return getSignatureFromTransaction(signed);
}
