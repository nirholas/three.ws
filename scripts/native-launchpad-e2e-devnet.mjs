// Devnet end-to-end for the native launchpad lane, driving the SAME modules
// the API endpoints use: buildCreatePoolTx -> sign -> send -> getPoolState ->
// quoteBuy -> real swap buy -> state again.
import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { buildCreatePoolTx, buildSwapTx, getPoolState, quoteBuy } from '../api/_lib/native-launch/dbc.js';

const conn = new Connection(process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com', 'confirmed');
const secret = process.env.NATIVE_LAUNCH_PARTNER_SECRET_BASE58 || process.env.X402_TREASURY_SECRET_BASE58;
if (!secret || !process.env.NATIVE_LAUNCH_CONFIG_KEY_DEVNET || !process.env.NATIVE_LAUNCH_QUOTE_MINT_DEVNET) {
	console.error(
		'needs a devnet signer plus NATIVE_LAUNCH_CONFIG_KEY_DEVNET and NATIVE_LAUNCH_QUOTE_MINT_DEVNET:\n' +
			'  node scripts/native-launchpad-create-config.mjs --network devnet --create-quote-mint --airdrop',
	);
	process.exit(1);
}
// The signer that ran --create-quote-mint holds the whole stand-in $THREE supply.
const wallet = Keypair.fromSecretKey(bs58.decode(secret));
const mintKp = Keypair.generate();
const mint = mintKp.publicKey.toBase58();

async function signAndLand(txBase64, signers) {
	const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
	tx.sign(signers);
	const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	for (let i = 0; i < 40; i++) {
		await new Promise((r) => setTimeout(r, 1500));
		const s = (await conn.getSignatureStatuses([sig])).value?.[0];
		if (s?.err) throw new Error(`tx failed: ${JSON.stringify(s.err)} (${sig})`);
		if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return sig;
	}
	throw new Error(`confirm timeout: ${sig}`);
}

function assert(cond, message) {
	if (!cond) throw new Error(`assertion failed: ${message}`);
}

console.log('wallet:', wallet.publicKey.toBase58());
console.log('mint:  ', mint);

const built = await buildCreatePoolTx({
	network: 'devnet',
	payer: wallet.publicKey.toBase58(),
	creator: wallet.publicKey.toBase58(),
	baseMint: mint,
	name: 'Native Lane Test',
	symbol: 'NLT',
	uri: 'https://three.ws/launchpad',
	threeBuyIn: 50_000,
});
console.log('pool:  ', built.pool);
const createSig = await signAndLand(built.txBase64, [wallet, mintKp]);
console.log('create + first buy landed:', createSig);

const afterCreate = await getPoolState({ network: 'devnet', mint });
console.log('state after create + first buy:', JSON.stringify(afterCreate, null, 1));
assert(afterCreate.quote_reserve_three > 0, 'the first buy put $THREE into the curve');

const quote = await quoteBuy({ network: 'devnet', mint, threeIn: 250_000 });
console.log(`quote 250,000 $THREE -> ${quote.tokens_out} tokens, fee ${quote.trading_fee_three} $THREE`);

const buy = await buildSwapTx({ network: 'devnet', mint, trader: wallet.publicKey.toBase58(), side: 'buy', amountIn: 250_000 });
console.log('buy landed: ', await signAndLand(buy.txBase64, [wallet]));
const afterBuy = await getPoolState({ network: 'devnet', mint });
assert(afterBuy.curve_progress > afterCreate.curve_progress, 'a buy moves the curve forward');

const sell = await buildSwapTx({
	network: 'devnet',
	mint,
	trader: wallet.publicKey.toBase58(),
	side: 'sell',
	amountIn: Math.floor(buy.expected_out / 2),
});
console.log('sell landed:', await signAndLand(sell.txBase64, [wallet]));
const afterSell = await getPoolState({ network: 'devnet', mint });
assert(afterSell.quote_reserve_three < afterBuy.quote_reserve_three, 'a sell pays $THREE back out of the curve');

console.log('progress:        ', afterCreate.curve_progress, '->', afterBuy.curve_progress, '->', afterSell.curve_progress);
console.log('$THREE in curve: ', afterCreate.quote_reserve_three, '->', afterBuy.quote_reserve_three, '->', afterSell.quote_reserve_three);
console.log('');
console.log('E2E OK');
console.log(`explorer: https://solscan.io/tx/${createSig}?cluster=devnet`);
