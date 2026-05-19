// Inaugural USDC-paired pump.fun launch.
//
// Reads:
//   ~/.claude/pump-deploy/wallet.json          fee payer + creator + signer
//   ~/.claude/pump-deploy/mint-latest.json     vanity mint keypair (co-signer)
//
// Defaults match the brief: name="USDC", symbol="USDC",
// description="testing 3D AI Agents with USDC on PumpFun", initial buy=10 USDC.
// Override via env:
//   COIN_NAME, COIN_SYMBOL, COIN_DESCRIPTION, COIN_IMAGE_URL
//   USDC_BUY_IN_ATOMICS (default 10000000 = 10 USDC)
//   SOLANA_RPC_URL (default mainnet-beta public)
//   DRY_RUN=1 — simulate only, never submit
//
// Writes ~/.claude/pump-deploy/launch-result.json with the outcome (success
// or rejection details) so follow-up prompts (link-to-agent, retry) have a
// known state to read.

import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	PumpSdk,
	OnlinePumpSdk,
	isLegacyQuoteMint,
	getBuyTokenAmountFromSolAmount,
} from '@pump-fun/pump-sdk';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const USDC_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const COIN_NAME        = process.env.COIN_NAME        || 'USDC';
const COIN_SYMBOL      = process.env.COIN_SYMBOL      || 'USDC';
const COIN_DESCRIPTION = process.env.COIN_DESCRIPTION || 'testing 3D AI Agents with USDC on PumpFun';
const COIN_IMAGE_URL   = process.env.COIN_IMAGE_URL   || ''; // optional; falls back to a 1x1 png if blank
const USDC_BUY_IN_ATOMICS = BigInt(process.env.USDC_BUY_IN_ATOMICS || '10000000'); // 10 USDC default
const DRY_RUN = process.env.DRY_RUN === '1';

const DEPLOY_DIR = path.join(os.homedir(), '.claude', 'pump-deploy');

function loadKp(file) {
	const raw = fs.readFileSync(path.join(DEPLOY_DIR, file), 'utf8');
	return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function writeResult(obj) {
	const out = path.join(DEPLOY_DIR, 'launch-result.json');
	fs.writeFileSync(out, JSON.stringify({ ...obj, written_at: new Date().toISOString() }, null, 2));
	console.log(`\nResult written: ${out}`);
}

async function uploadMetadata() {
	// pump.fun needs a hosted JSON descriptor at a public URL. We host on R2 via
	// the existing /api/pump/build-metadata endpoint when available; for a
	// scripted deploy we use the public ipfs-pinning endpoint pump.fun's own
	// frontend uses so the descriptor is durable.
	const form = new FormData();
	const body = {
		name: COIN_NAME,
		symbol: COIN_SYMBOL,
		description: COIN_DESCRIPTION,
		twitter: '',
		telegram: '',
		website: 'https://three.ws',
	};
	if (COIN_IMAGE_URL) body.image = COIN_IMAGE_URL;
	// Pump.fun's "ipfs" endpoint expects multipart with a `file` (image) and
	// metadata fields. For a no-image launch we synthesise a 1×1 transparent PNG.
	const onePxPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
	form.append('file', new Blob([onePxPng], { type: 'image/png' }), 'token.png');
	for (const [k, v] of Object.entries(body)) form.append(k, v);
	form.append('showName', 'true');
	const r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: form });
	if (!r.ok) throw new Error(`metadata upload failed: ${r.status} ${await r.text().catch(()=>'')}`);
	const json = await r.json();
	return json.metadataUri || json.metadata_uri || json.uri;
}

async function main() {
	console.log('Pump.fun USDC-paired launch');
	console.log('  rpc:        ', RPC);
	console.log('  name:       ', COIN_NAME);
	console.log('  symbol:     ', COIN_SYMBOL);
	console.log('  description:', COIN_DESCRIPTION);
	console.log('  buy in:     ', `${Number(USDC_BUY_IN_ATOMICS) / 1e6} USDC`);
	console.log('  dry run:    ', DRY_RUN);
	console.log('');

	const wallet = loadKp('wallet.json');
	const mint   = loadKp('mint-latest.json');
	console.log('  wallet:     ', wallet.publicKey.toBase58());
	console.log('  mint:       ', mint.publicKey.toBase58());
	console.log('');

	const connection = new Connection(RPC, 'confirmed');

	// ── 1. Verify funding ──────────────────────────────────────────────────
	const solBal = await connection.getBalance(wallet.publicKey);
	const usdcAta = await getAssociatedTokenAddress(USDC_MAINNET, wallet.publicKey, false);
	let usdcBal = 0n;
	try {
		const acc = await getAccount(connection, usdcAta);
		usdcBal = acc.amount;
	} catch {}
	console.log(`  sol bal:    ${(solBal / 1e9).toFixed(6)} SOL`);
	console.log(`  usdc bal:   ${(Number(usdcBal) / 1e6).toFixed(6)} USDC`);

	const MIN_SOL = 0.03 * 1e9;
	if (solBal < MIN_SOL) {
		writeResult({ ok: false, reason: 'insufficient_sol', need_sol_atomics: MIN_SOL, have_sol_atomics: solBal });
		console.error(`Aborting: wallet needs >= ${MIN_SOL / 1e9} SOL, has ${(solBal / 1e9).toFixed(6)}.`);
		process.exit(1);
	}
	if (usdcBal < USDC_BUY_IN_ATOMICS) {
		writeResult({ ok: false, reason: 'insufficient_usdc', need_usdc_atomics: USDC_BUY_IN_ATOMICS.toString(), have_usdc_atomics: usdcBal.toString() });
		console.error(`Aborting: wallet needs >= ${Number(USDC_BUY_IN_ATOMICS) / 1e6} USDC, has ${(Number(usdcBal) / 1e6).toFixed(6)}.`);
		process.exit(1);
	}

	// ── 2. Whitelist precheck ──────────────────────────────────────────────
	const offline = new PumpSdk();
	const online  = new OnlinePumpSdk(connection);
	const global  = await online.fetchGlobal();
	const list = (global.whitelistedQuoteMints || []).map((k) => k.toBase58());
	const usdcWhitelisted = list.includes(USDC_MAINNET.toBase58());
	console.log(`  whitelist:  ${list.join(', ')}`);
	console.log(`  usdc gate:  ${usdcWhitelisted ? 'OPEN' : 'CLOSED (program will reject)'}`);
	if (!usdcWhitelisted) {
		console.log('\n  Proceeding anyway to capture the rejection error.');
	}
	console.log('');

	// ── 3. Upload metadata ─────────────────────────────────────────────────
	console.log('Uploading metadata to pump.fun IPFS…');
	const uri = await uploadMetadata();
	console.log(`  uri:        ${uri}`);
	console.log('');

	// ── 4. Build createV2 + buyV2 instructions ─────────────────────────────
	if (!isLegacyQuoteMint(USDC_MAINNET) !== true) {
		// sanity: USDC must register as non-legacy
		console.warn('  isLegacyQuoteMint(USDC) returned unexpected value');
	}
	const quoteAmount = new BN(USDC_BUY_IN_ATOMICS.toString());
	const tokenAmount = getBuyTokenAmountFromSolAmount({
		global,
		feeConfig: null,
		mintSupply: null,
		bondingCurve: null,
		amount: quoteAmount,
	});
	const ixs = await offline.createV2AndBuyV2Instructions({
		global,
		mint: mint.publicKey,
		name: COIN_NAME,
		symbol: COIN_SYMBOL,
		uri,
		creator: wallet.publicKey,
		user: wallet.publicKey,
		quoteAmount,
		amount: tokenAmount,
		mayhemMode: false,
		quoteMint: USDC_MAINNET,
	});
	console.log(`Built ${ixs.length} instruction${ixs.length === 1 ? '' : 's'}.`);

	// ── 5. Build + sign tx ─────────────────────────────────────────────────
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const msg = new TransactionMessage({
		payerKey: wallet.publicKey,
		recentBlockhash: blockhash,
		instructions: ixs,
	}).compileToV0Message();
	const vtx = new VersionedTransaction(msg);
	vtx.sign([wallet, mint]);

	// ── 6. Simulate ────────────────────────────────────────────────────────
	console.log('Simulating against mainnet…');
	const sim = await connection.simulateTransaction(vtx, { sigVerify: true });
	if (sim.value.err) {
		console.log(`  sim err:    ${JSON.stringify(sim.value.err)}`);
		const logs = sim.value.logs || [];
		const interesting = logs.filter((l) => /Error|fail|reject|invalid|whitelist|disabled/i.test(l));
		if (interesting.length) {
			console.log('  relevant logs:');
			for (const l of interesting.slice(0, 8)) console.log(`    ${l}`);
		}
		if (DRY_RUN || !usdcWhitelisted) {
			writeResult({
				ok: false,
				reason: usdcWhitelisted ? 'simulation_error' : 'usdc_gate_closed',
				err: sim.value.err,
				logs: interesting,
				mint: mint.publicKey.toBase58(),
				wallet: wallet.publicKey.toBase58(),
			});
			console.log('\nNot submitting.');
			process.exit(2);
		}
	} else {
		console.log('  sim:        OK');
	}
	console.log('');

	if (DRY_RUN) {
		writeResult({ ok: true, dry_run: true, sim_passed: !sim.value.err, mint: mint.publicKey.toBase58() });
		console.log('Dry run; not submitting.');
		return;
	}

	// ── 7. Submit ──────────────────────────────────────────────────────────
	console.log('Submitting…');
	const sig = await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: false, maxRetries: 3 });
	console.log(`  sig:        ${sig}`);
	console.log(`  solscan:    https://solscan.io/tx/${sig}`);

	console.log('Confirming…');
	const confirmation = await connection.confirmTransaction(
		{ signature: sig, blockhash, lastValidBlockHeight },
		'confirmed',
	);
	if (confirmation.value.err) {
		writeResult({
			ok: false,
			reason: 'tx_confirmed_with_error',
			err: confirmation.value.err,
			tx_signature: sig,
			mint: mint.publicKey.toBase58(),
			wallet: wallet.publicKey.toBase58(),
		});
		console.error(`Confirmed with error: ${JSON.stringify(confirmation.value.err)}`);
		process.exit(3);
	}

	writeResult({
		ok: true,
		mint: mint.publicKey.toBase58(),
		wallet: wallet.publicKey.toBase58(),
		tx_signature: sig,
		uri,
		coin_name: COIN_NAME,
		coin_symbol: COIN_SYMBOL,
		usdc_buy_in_atomics: USDC_BUY_IN_ATOMICS.toString(),
		pump_url: `https://pump.fun/coin/${mint.publicKey.toBase58()}`,
		solscan: `https://solscan.io/tx/${sig}`,
	});
	console.log(`\nLaunched.`);
	console.log(`  pump.fun:   https://pump.fun/coin/${mint.publicKey.toBase58()}`);
}

main().catch((err) => {
	writeResult({ ok: false, reason: 'exception', err: err?.message || String(err) });
	console.error(err);
	process.exit(1);
});
