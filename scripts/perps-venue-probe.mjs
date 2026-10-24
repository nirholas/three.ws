// Live read-only probe of every perps venue: markets, a book, and a quote for a
// tiny order against an empty account. Also proves the Hyperliquid signing
// scheme against the TESTNET exchange with a fresh unfunded key: a correct
// signature recovers to the key, so the venue answers "does not exist" rather
// than a signature error. Nothing is signed for mainnet and no funds move.
//
//   node scripts/perps-venue-probe.mjs
import { Wallet } from 'ethers';
import { listVenueModules } from '../api/_lib/perps/index.js';
import { postExchange } from '../api/_lib/perps/hyperliquid-signing.js';
import * as hl from '../api/_lib/perps/hyperliquid.js';

const emptyAccount = (authority) => ({
	authority, registered: true, collateral_usd: 1000, equity_usd: 1000, withdrawable_usd: 1000, funding_available_usd: 1000,
	initial_margin_usd: 0, maintenance_margin_usd: 0, notional_usd: 0, positions: [], orders: [], conditionals: [],
});

for (const v of listVenueModules()) {
	console.log(`\n== ${v.id} (${v.chain}, ${v.execution})`);
	try {
		const ping = await v.ping();
		const markets = await v.listMarkets();
		console.log(`ping ${ping.latency_ms} ms, ${markets.length} markets`);
		for (const m of markets.slice(0, 3)) console.log(`  ${m.symbol} mark ${m.mark_price} max ${m.max_leverage}x taker ${m.taker_fee_rate}`);
		const sym = markets.find((m) => m.symbol === 'SOL')?.symbol || markets[0].symbol;
		const authority = v.chain === 'solana' ? '11111111111111111111111111111111' : '0x0000000000000000000000000000000000000001';
		const q = await v.quoteOrder({ symbol: sym, side: 'long', size: sym === 'BTC' ? 0.001 : 0.5, type: 'market', slippageBps: 100, leverage: 2, account: emptyAccount(authority) });
		console.log(`  quote ${sym} long: entry ${q.entry_price} fee ${q.fee_usd} liq ${q.liquidation_price} (${q.liquidation_distance_pct}% away)`);
	} catch (err) {
		console.log(`  FAILED: ${err.code || ''} ${err.message}`);
		process.exitCode = 1;
	}
}

console.log('\n== hyperliquid testnet signing');
const key = Wallet.createRandom();
const res = await postExchange({ privateKey: key.privateKey, isMainnet: false, action: hl.buildCancelAction({ assetIndex: 0, orderId: 1 }) });
console.log(JSON.stringify(res));
