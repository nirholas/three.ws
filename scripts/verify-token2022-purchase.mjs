#!/usr/bin/env node
// Prove the $THREE (Token-2022) payment builders against real mainnet state at
// zero cost. Nothing here signs or sends: every transaction goes through
// simulateTransaction with sigVerify:false and replaceRecentBlockhash:true, so
// the cluster runs the exact instructions production builds against a real
// holder's real token account and reports what would have happened.
//
// Two transactions are simulated:
//   1. The gasless skill purchase (api/_lib/solana/gasless-tx.js): platform fee
//      payer, a Token-2022 ATA create for a seller that has never held $THREE,
//      the treasury fee leg, then the seller leg carrying the Solana Pay
//      reference last.
//   2. The Premium pass quote (api/_lib/premium.js): the buyer pays the
//      developer plan's live $THREE price into the treasury ATA.
//
// The buyer is a real $THREE holder found through getTokenLargestAccounts: the
// first account that is its owner's canonical Token-2022 ATA (pool vaults and
// other non-ATA accounts are skipped, because checkout always debits the ATA)
// and whose balances cover both amounts plus the fees and the rent of the two
// Token-2022 ATAs the transactions may open (a fee payer with no lamports makes
// the cluster answer AccountNotFound before any instruction runs).
//
// Usage:
//   node scripts/verify-token2022-purchase.mjs [--holder <pubkey>] [--payer <pubkey>] [--treasury <pubkey>] [--rpc <url>]
//
//   --holder    a $THREE holder wallet to simulate as. Default: discovered from
//               getTokenLargestAccounts. Public and keyless lanes often answer
//               that heavy method with 429 (seen 2026-11-13 on every keyless
//               endpoint); --holder skips it and needs only cheap reads. The
//               other way through is a keyed lane, loaded into the shell only:
//               eval "$(node scripts/read-service-env.mjs '^(HELIUS_API_KEY|ALCHEMY_API_KEY)$')"
//   --payer     gasless fee payer. Default: the public key of
//               MARKETPLACE_PAYER_KEYPAIR when set locally (derived, never used
//               to sign), else the holder itself, which is stated in the output.
//   --treasury  the treasury wallet for the fee leg and the Premium payment.
//               Default: THREE_TREASURY_WALLET, then X402_PAY_TO_SOLANA, else a
//               freshly generated address (its ATA does not exist, so the
//               simulation also exercises the Token-2022 ATA create).
//   --rpc       mainnet RPC. Default: the same endpoint list production uses.
//
// Exits 0 only when both simulations return err: null.

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

import { solanaConnection } from '../api/_lib/solana/connection.js';
import { ataFor, tokenProgramForMint } from '../api/_lib/solana-token-program.js';
import { buildGaslessPurchaseInstructions } from '../api/_lib/solana/gasless-tx.js';
import { buildPassPaymentInstructions, planById, priceAsset } from '../api/_lib/premium.js';
import { decodeSecretKey } from '../api/_lib/solana-signers.js';

const THREE_MINT = process.env.THREE_TOKEN_MINT || 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
// A skill priced at 10 $THREE with the documented 5% platform fee
// (MARKETPLACE_PLATFORM_FEE_BPS=500, api/_lib/marketplace-platform-fee.js):
// the split api/marketplace/purchase.js hands buildGaslessPurchaseTx.
const SKILL_PRICE_TOKENS = 10;
const PLATFORM_FEE_BPS = 500;
// Two Token-2022 ATA rents (~0.0021 SOL each) plus fees, with headroom.
const MIN_PAYER_LAMPORTS = 10_000_000;

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : null;
}

async function resolvePayer(holderOwner) {
	const flag = arg('payer');
	if (flag) return { key: new PublicKey(flag), source: '--payer' };
	const secret = process.env.MARKETPLACE_PAYER_KEYPAIR || process.env.PLATFORM_TREASURY_KEYPAIR || '';
	if (secret) {
		const bytes = await decodeSecretKey(secret);
		if (bytes) return { key: Keypair.fromSecretKey(bytes).publicKey, source: 'MARKETPLACE_PAYER_KEYPAIR (public key only)' };
	}
	return { key: holderOwner, source: 'holder (no marketplace payer configured locally)' };
}

function resolveTreasury() {
	const flag = arg('treasury') || process.env.THREE_TREASURY_WALLET || process.env.X402_PAY_TO_SOLANA;
	if (flag) return { key: new PublicKey(flag), source: arg('treasury') ? '--treasury' : 'env' };
	return { key: Keypair.generate().publicKey, source: 'fresh address (no treasury configured locally)' };
}

async function checkHolder(connection, mint, tokenProgram, minAtomics, ownerKey) {
	const ata = ataFor(mint, ownerKey, tokenProgram);
	const { value: balance } = await connection.getTokenAccountBalance(ata, 'confirmed');
	const atomics = BigInt(balance.amount);
	const lamports = await connection.getBalance(ownerKey, 'confirmed');
	if (atomics < minAtomics || lamports < MIN_PAYER_LAMPORTS) {
		throw new Error(
			`--holder ${ownerKey.toBase58()} has ${atomics} atomics and ${lamports} lamports; the simulation needs >= ${minAtomics} atomics and >= ${MIN_PAYER_LAMPORTS} lamports`,
		);
	}
	return { owner: ownerKey, ata, atomics, lamports };
}

async function findHolder(connection, mint, tokenProgram, minAtomics) {
	const holderFlag = arg('holder');
	if (holderFlag) return checkHolder(connection, mint, tokenProgram, minAtomics, new PublicKey(holderFlag));
	let largest;
	try {
		({ value: largest } = await connection.getTokenLargestAccounts(mint, 'confirmed'));
	} catch (err) {
		throw new Error(
			`getTokenLargestAccounts failed on every endpoint (${err?.message || err}). Public and keyless lanes rate-limit this method: ` +
				`pass --holder <pubkey> of a known $THREE holder, or load a keyed lane with ` +
				`eval "$(node scripts/read-service-env.mjs '^(HELIUS_API_KEY|ALCHEMY_API_KEY)$')" and rerun`,
		);
	}
	// A provider error on one candidate's read skips that candidate rather than
	// ending the search: public lanes intermittently refuse single reads.
	let lastReadError = null;
	for (const acct of largest) {
		if (BigInt(acct.amount) < minAtomics) continue;
		try {
			const info = await connection.getParsedAccountInfo(acct.address, 'confirmed');
			const owner = info.value?.data?.parsed?.info?.owner;
			if (!owner) continue;
			const ownerKey = new PublicKey(owner);
			if (!PublicKey.isOnCurve(ownerKey.toBytes())) continue;
			if (!ataFor(mint, ownerKey, tokenProgram).equals(acct.address)) continue;
			const lamports = await connection.getBalance(ownerKey, 'confirmed');
			if (lamports < MIN_PAYER_LAMPORTS) continue;
			return { owner: ownerKey, ata: acct.address, atomics: BigInt(acct.amount), lamports };
		} catch (err) {
			lastReadError = err;
			console.warn(`skipping ${acct.address.toBase58()}: ${err?.message || err}`);
		}
	}
	throw new Error(
		`no on-curve holder of ${mint.toBase58()} among the largest accounts has a canonical ATA holding >= ${minAtomics} atomics and >= ${MIN_PAYER_LAMPORTS} lamports` +
			(lastReadError ? ` (last read error: ${lastReadError?.message || lastReadError}; retry with --rpc <url>)` : ''),
	);
}

async function simulate(connection, label, payerKey, instructions) {
	const message = new TransactionMessage({
		payerKey,
		// replaceRecentBlockhash swaps this for a live one inside the simulation.
		recentBlockhash: PublicKey.default.toBase58(),
		instructions,
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);
	const { value } = await connection.simulateTransaction(tx, {
		sigVerify: false,
		replaceRecentBlockhash: true,
		commitment: 'confirmed',
	});
	console.log(`\n== ${label}`);
	console.log(`programs: ${[...new Set(message.compiledInstructions.map((ix) => message.staticAccountKeys[ix.programIdIndex].toBase58()))].join(', ')}`);
	console.log(`err: ${JSON.stringify(value.err)}`);
	console.log(`units: ${value.unitsConsumed ?? 'n/a'}`);
	console.log('logs:');
	for (const line of value.logs || []) console.log(`  ${line}`);
	return value.err;
}

async function main() {
	const rpc = arg('rpc');
	const connection = rpc ? solanaConnection({ url: rpc }) : solanaConnection({ network: 'mainnet' });
	const mint = new PublicKey(THREE_MINT);

	const tokenProgram = await tokenProgramForMint(connection, mint);
	console.log(`mint: ${mint.toBase58()}`);
	console.log(`token program: ${tokenProgram.toBase58()}${tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? ' (Token-2022)' : ''}`);
	if (!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
		throw new Error('the $THREE mint is not owned by Token-2022; this script proves the Token-2022 path only');
	}

	const decimals = Number(process.env.THREE_TOKEN_DECIMALS) || 6;
	const skillAtomics = BigInt(SKILL_PRICE_TOKENS) * 10n ** BigInt(decimals);
	const feeAtomics = (skillAtomics * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
	const creatorAtomics = skillAtomics - feeAtomics;

	const plan = planById('developer');
	const priced = await priceAsset('THREE', plan);
	console.log(`premium ${plan.id} plan: $${priced.usd} at $${priced.assetUsd} per $THREE (${priced.priceSource}) = ${priced.atomics} atomics`);

	const holder = await findHolder(connection, mint, tokenProgram, skillAtomics + priced.atomics);
	const payer = await resolvePayer(holder.owner);
	const treasury = resolveTreasury();
	const seller = Keypair.generate().publicKey;
	const reference = Keypair.generate().publicKey;
	console.log(`holder: ${holder.owner.toBase58()} (ATA ${holder.ata.toBase58()}, ${holder.atomics} atomics, ${holder.lamports} lamports)`);
	console.log(`gasless fee payer: ${payer.key.toBase58()} [${payer.source}]`);
	console.log(`treasury: ${treasury.key.toBase58()} [${treasury.source}]`);
	console.log(`seller: ${seller.toBase58()} [fresh address, so its Token-2022 ATA is created in the transaction]`);

	const gasless = await buildGaslessPurchaseInstructions({
		connection,
		payer: payer.key,
		buyerPublicKey: holder.owner.toBase58(),
		recipient: seller.toBase58(),
		mint: mint.toBase58(),
		creatorAtomics,
		reference: reference.toBase58(),
		decimals,
		platformFeeAtomics: feeAtomics,
		platformFeeWallet: treasury.key.toBase58(),
	});
	const gaslessErr = await simulate(
		connection,
		`gasless purchase: ${creatorAtomics} to seller + ${feeAtomics} fee to treasury`,
		payer.key,
		gasless.instructions,
	);

	const pass = buildPassPaymentInstructions({
		buyer: holder.owner.toBase58(),
		payTo: treasury.key.toBase58(),
		asset: 'THREE',
		atomics: priced.atomics,
		mint: mint.toBase58(),
		decimals,
		tokenProgram,
	});
	const passErr = await simulate(connection, `premium quote: ${priced.atomics} to treasury`, holder.owner, pass);

	console.log(`\nresult: gasless ${gaslessErr ? 'FAILED' : 'ok'}, premium ${passErr ? 'FAILED' : 'ok'} (simulated only, nothing signed or sent)`);
	process.exit(gaslessErr || passErr ? 1 : 0);
}

main().catch((err) => {
	console.error(`verify-token2022-purchase: ${err?.message || err}`);
	process.exit(1);
});
