#!/usr/bin/env node
// Create the three.ws native-launchpad partner config on Meteora's Dynamic Bonding
// Curve program. The config fixes the curve, the fee split, the graduation target and
// the quote mint for every coin launched under it. The quote mint is $THREE.
//
//   node scripts/native-launchpad-create-config.mjs --simulate
//       Mainnet dry run. Needs no key and spends nothing: simulates creating the
//       config AND a coin's pool under it in one transaction, which proves the DBC
//       program accepts $THREE as a quote mint with this curve and can open a
//       $THREE-quoted pool (Token-2022 quote vault included).
//
//   node scripts/native-launchpad-create-config.mjs --network devnet --create-quote-mint [--airdrop]
//       $THREE exists on mainnet only, so devnet first mints a stand-in with the same
//       token program (Token-2022), decimals and extensions, then creates the config
//       against it. Prints both env lines to pin.
//
//   node scripts/native-launchpad-create-config.mjs --network mainnet
//       The real thing. Spends SOL on rent and fees from the partner wallet, so it is
//       owner-approved only.
//
// Signer: NATIVE_LAUNCH_PARTNER_SECRET_BASE58, else X402_TREASURY_SECRET_BASE58.
// Fee claimer: NATIVE_LAUNCH_FEE_WALLET, else the signer.

import 'dotenv/config';
import bs58 from 'bs58';
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	ExtensionType,
	TOKEN_2022_PROGRAM_ID,
	TYPE_SIZE,
	LENGTH_SIZE,
	getMintLen,
	getAssociatedTokenAddressSync,
	createInitializeMintInstruction,
	createInitializeMetadataPointerInstruction,
	createAssociatedTokenAccountIdempotentInstruction,
	createMintToInstruction,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import { DynamicBondingCurveClient, buildCurveWithMarketCap } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { curveBuildParams, quoteMintFor, NATIVE_LANE } from '../api/_lib/native-launch/config.js';
import { withQuoteTokenProgram } from '../api/_lib/native-launch/dbc.js';

const args = process.argv.slice(2);
const simulate = args.includes('--simulate');
const network = args.includes('--network') ? args[args.indexOf('--network') + 1] : simulate ? 'mainnet' : 'devnet';
const doAirdrop = args.includes('--airdrop');
const createQuoteMint = args.includes('--create-quote-mint');
if (!['mainnet', 'devnet'].includes(network)) {
	console.error('--network must be mainnet or devnet');
	process.exit(1);
}
if (createQuoteMint && network !== 'devnet') {
	console.error('--create-quote-mint is devnet only: mainnet is quoted in the real $THREE mint');
	process.exit(1);
}

const RPC =
	network === 'devnet'
		? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC, 'confirmed');
const client = new DynamicBondingCurveClient(connection, 'confirmed');
const curveConfig = buildCurveWithMarketCap(curveBuildParams());
const QUOTE_UNIT = 10 ** NATIVE_LANE.quoteDecimals;
console.log(`network:  ${network}`);
console.log(
	`curve:    graduates at ${(Number(curveConfig.migrationQuoteThreshold.toString()) / QUOTE_UNIT).toLocaleString('en-US')} ${NATIVE_LANE.quote} raised`,
);

async function sendAndConfirm(tx, signers) {
	tx.feePayer = signers[0].publicKey;
	tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
	tx.sign(...signers);
	const sig = await connection.sendRawTransaction(tx.serialize());
	for (let i = 0; i < 40; i++) {
		await new Promise((r) => setTimeout(r, 1500));
		const s = (await connection.getSignatureStatuses([sig])).value?.[0];
		if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)} (${sig})`);
		if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return sig;
	}
	throw new Error(`confirmation timed out, check the signature manually: ${sig}`);
}

// A Token-2022 mint shaped like $THREE: 6 decimals, metadata-pointer and token-metadata
// extensions, and no mint or freeze authority once the supply is out.
async function createStandInQuoteMint(payer) {
	const mint = Keypair.generate();
	const metadata = {
		mint: mint.publicKey,
		name: 'THREE (devnet stand-in)',
		symbol: 'THREE',
		uri: 'https://three.ws/three-token',
		additionalMetadata: [],
	};
	const mintLen = getMintLen([ExtensionType.MetadataPointer]);
	const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
	const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);
	const ata = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
	const supply = BigInt(1_000_000_000) * BigInt(QUOTE_UNIT);

	const tx = new Transaction().add(
		SystemProgram.createAccount({
			fromPubkey: payer.publicKey,
			newAccountPubkey: mint.publicKey,
			space: mintLen,
			lamports,
			programId: TOKEN_2022_PROGRAM_ID,
		}),
		createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
		createInitializeMintInstruction(mint.publicKey, NATIVE_LANE.quoteDecimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
		createInitializeInstruction({
			programId: TOKEN_2022_PROGRAM_ID,
			metadata: mint.publicKey,
			updateAuthority: payer.publicKey,
			mint: mint.publicKey,
			mintAuthority: payer.publicKey,
			name: metadata.name,
			symbol: metadata.symbol,
			uri: metadata.uri,
		}),
		createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
		createMintToInstruction(mint.publicKey, ata, payer.publicKey, supply, [], TOKEN_2022_PROGRAM_ID),
	);
	const sig = await sendAndConfirm(tx, [payer, mint]);
	console.log(`quote:    created stand-in ${mint.publicKey.toBase58()} (${sig})`);
	return mint.publicKey;
}

if (simulate) {
	const quoteMint = new PublicKey(quoteMintFor(network));
	// Simulation needs a fee payer that exists and holds SOL, never its signature.
	const payer = new PublicKey(args.includes('--payer') ? args[args.indexOf('--payer') + 1] : '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9');
	const config = Keypair.generate().publicKey;
	const tx = await client.partner.createConfigAndPool({
		...curveConfig,
		config,
		feeClaimer: payer,
		leftoverReceiver: payer,
		quoteMint,
		payer,
		preCreatePoolParam: {
			name: 'Simulated Launch',
			symbol: 'SIM',
			uri: 'https://three.ws/launchpad',
			poolCreator: payer,
			baseMint: Keypair.generate().publicKey,
		},
	});
	const quoteTokenProgram = (await connection.getAccountInfo(quoteMint)).owner;
	const message = new TransactionMessage({
		payerKey: payer,
		recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
		instructions: await withQuoteTokenProgram(tx.instructions, quoteTokenProgram),
	}).compileToV0Message();
	const sim = await connection.simulateTransaction(new VersionedTransaction(message), {
		sigVerify: false,
		replaceRecentBlockhash: true,
	});
	console.log(`quote:    ${quoteMint.toBase58()}`);
	if (sim.value.err) {
		console.error('simulation FAILED:', JSON.stringify(sim.value.err));
		console.error((sim.value.logs || []).slice(-6).join('\n'));
		process.exit(1);
	}
	console.log(
		`simulation OK: config + a ${NATIVE_LANE.quote}-quoted pool created by the live DBC program (${sim.value.unitsConsumed} compute units)`,
	);
	process.exit(0);
}

const secret = process.env.NATIVE_LAUNCH_PARTNER_SECRET_BASE58 || process.env.X402_TREASURY_SECRET_BASE58;
if (!secret) {
	console.error('set NATIVE_LAUNCH_PARTNER_SECRET_BASE58 (or X402_TREASURY_SECRET_BASE58)');
	process.exit(1);
}
const partner = Keypair.fromSecretKey(bs58.decode(secret));
const feeClaimer = process.env.NATIVE_LAUNCH_FEE_WALLET
	? new PublicKey(process.env.NATIVE_LAUNCH_FEE_WALLET)
	: partner.publicKey;

if (doAirdrop && network === 'devnet') {
	console.log(`airdropping 2 SOL to ${partner.publicKey.toBase58()} …`);
	try {
		const sig = await connection.requestAirdrop(partner.publicKey, 2e9);
		await connection.confirmTransaction(sig, 'confirmed');
	} catch (e) {
		console.warn(`airdrop failed (${e.message}), continuing with existing balance`);
	}
}

const balance = await connection.getBalance(partner.publicKey);
console.log(`partner:  ${partner.publicKey.toBase58()} (${(balance / 1e9).toFixed(4)} SOL)`);
console.log(`claimer:  ${feeClaimer.toBase58()}`);
if (balance < 0.05e9) {
	console.error('partner wallet needs at least 0.05 SOL for rent + fees');
	process.exit(1);
}

const quoteMint = createQuoteMint ? await createStandInQuoteMint(partner) : new PublicKey(quoteMintFor(network) || PublicKey.default);
if (quoteMint.equals(PublicKey.default)) {
	console.error('no quote mint on devnet: pass --create-quote-mint, or set NATIVE_LAUNCH_QUOTE_MINT_DEVNET');
	process.exit(1);
}
console.log(`quote:    ${quoteMint.toBase58()}`);

const configKeypair = Keypair.generate();
const tx = await client.partner.createConfig({
	...curveConfig,
	config: configKeypair.publicKey,
	feeClaimer,
	leftoverReceiver: feeClaimer,
	quoteMint,
	payer: partner.publicKey,
});
const sig = await sendAndConfirm(tx, [partner, configKeypair]);

console.log('');
console.log(`config created: ${configKeypair.publicKey.toBase58()}`);
console.log(`tx:             https://solscan.io/tx/${sig}${network === 'devnet' ? '?cluster=devnet' : ''}`);
console.log('');
console.log('pin it:');
console.log(`  ${network === 'devnet' ? 'NATIVE_LAUNCH_CONFIG_KEY_DEVNET' : 'NATIVE_LAUNCH_CONFIG_KEY'}=${configKeypair.publicKey.toBase58()}`);
if (network === 'devnet') console.log(`  NATIVE_LAUNCH_QUOTE_MINT_DEVNET=${quoteMint.toBase58()}`);
