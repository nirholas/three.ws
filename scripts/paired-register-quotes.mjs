#!/usr/bin/env node
// Register new quote assets on the paired launchpad, so coins can pair with them.
//
//   npm run paired:quotes -- --assets WETH,USDG,0x...            # plan only, sends nothing
//   npm run paired:quotes -- --assets WETH --target-usd 6000      # override the opening value
//   PAIRED_OWNER_KEY=0x... npm run paired:quotes -- --assets WETH,USDG --apply
//   PAIRED_OWNER_KEY=0x... npm run paired:quotes -- --assets 0x... --disable --apply
//
// What it does, per asset:
//   1. Resolves it against the Robinhood Chain universe by contract address, so
//      a symbol always means the canonical token and never one of the contracts
//      squatting on its ticker. Unlisted or impersonating contracts are refused.
//   2. Checks it is liquid enough to be a sane quote (default floor $100k), has a
//      live USD price, and that its on-chain decimals match the universe.
//   3. Calibrates `virtualQuote`, the curve's opening reserve, so a coin with
//      100% of its supply in this pool opens at the same dollar market cap as the
//      markets already on the launchpad (their live median, unless --target-usd).
//      The value is in the asset's own decimals: 6000 USD of USDG is 6000e6, of
//      WETH is ~2.3e18.
//   4. Prints the exact setQuoteConfig calldata. Nothing is signed without
//      --apply AND an owner key whose address the contract reports as owner().
//
// Registering a quote is a permanent on-chain action by the launchpad owner. The
// curve accounts in amounts it asked to move, so only plain ERC-20s qualify: no
// fee-on-transfer, no rebasing. Every asset the universe classifies is a plain
// Uniswap-traded ERC-20 or a Robinhood Stock Token.

import { createWalletClient, encodeFunctionData, formatUnits, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { launchpadAbi, launchpadAddress, quoteRegistry } from '../api/_lib/paired-launchpad.js';
import { dexFallback, pairedMarkets } from '../api/_lib/paired-markets.js';
import { liveUniverse } from '../api/_lib/hood-portfolios.js';
import { HOOD_MAINNET, erc20Metadata, publicClient, rpcUrls } from '../api/_lib/robinhood.js';

const UINT128_MAX = (1n << 128n) - 1n;

function parseArgs(argv) {
	const args = { assets: [], targetUsd: null, minLiquidity: 100_000, disable: false, apply: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === '--assets') args.assets = String(next() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--target-usd') args.targetUsd = Number(next());
		else if (a === '--min-liquidity') args.minLiquidity = Number(next());
		else if (a === '--disable') args.disable = true;
		else if (a === '--apply') args.apply = true;
		else if (a === '--help' || a === '-h') args.help = true;
		else throw new Error(`unknown argument ${a}`);
	}
	return args;
}

const usd = (n) => (n == null ? 'n/a' : `$${Math.round(n).toLocaleString('en-US')}`);

function median(values) {
	const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (!v.length) return null;
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Four significant figures, so the on-chain reserve reads as a deliberate number. */
function roundSig(x, digits = 4) {
	if (!(x > 0)) return 0;
	const p = 10 ** (digits - 1 - Math.floor(Math.log10(x)));
	return Math.round(x * p) / p;
}

function resolveAsset(universe, raw) {
	const text = raw.replace(/^\$/, '');
	if (/^0x[0-9a-fA-F]{40}$/.test(text)) {
		return universe.tokens.find((t) => t.address.toLowerCase() === text.toLowerCase()) ?? { unlisted: text };
	}
	const canonical = universe.tokens.filter((t) => t.symbol.toUpperCase() === text.toUpperCase() && t.canonical);
	if (canonical.length === 1) return canonical[0];
	if (canonical.length > 1) return { ambiguous: text, candidates: canonical.map((t) => t.address) };
	return { unknown: text };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.assets.length) {
		console.log('usage: npm run paired:quotes -- --assets SYM|0x...[,..] [--target-usd N] [--min-liquidity N] [--disable] [--apply]');
		process.exit(args.help ? 0 : 1);
	}

	const lp = launchpadAddress();
	const client = publicClient(false);
	const [owner, registry, markets, universe] = await Promise.all([
		client.readContract({ address: lp, abi: launchpadAbi, functionName: 'owner' }),
		quoteRegistry(),
		pairedMarkets(),
		liveUniverse(),
	]);
	const registered = new Map(registry.map((q) => [q.address.toLowerCase(), q]));
	const target = args.targetUsd ?? median(markets.map((m) => m.openingValueUsd));
	if (!args.disable && !(target > 0)) throw new Error('could not price the existing markets; pass --target-usd');

	console.log(`launchpad ${lp} on chain ${HOOD_MAINNET.id}, owner ${owner}`);
	console.log(`${markets.length} enabled markets today; ${args.disable ? 'disabling' : `opening value target ${usd(target)} per full-weight pool`}\n`);

	const plan = [];
	const refused = [];
	const resolved = args.assets.map((raw) => ({ raw, token: resolveAsset(universe, raw) }));
	const meta = await erc20Metadata(resolved.map((r) => r.token.address).filter(Boolean));

	for (const { raw, token } of resolved) {
		if (token.unknown) { refused.push(`${raw}: no canonical token with that symbol on Robinhood Chain`); continue; }
		if (token.ambiguous) { refused.push(`${raw}: ambiguous, pass one of ${token.candidates.join(', ')}`); continue; }
		if (token.unlisted) { refused.push(`${raw}: not in the Robinhood Chain universe, so its class, price and canonicity are unknown`); continue; }
		const existing = registered.get(token.address.toLowerCase());

		if (args.disable) {
			if (!existing) { refused.push(`${token.symbol}: not registered, nothing to disable`); continue; }
			if (!existing.enabled) { refused.push(`${token.symbol}: already disabled`); continue; }
			plan.push({ token, virtualQuote: BigInt(existing.virtualQuoteRaw), enabled: false, note: 'disable (existing coins keep trading)' });
			continue;
		}

		if (!token.canonical) { refused.push(`${token.symbol} ${token.address}: impersonates the canonical ${token.symbol}`); continue; }
		const onchain = meta[token.address.toLowerCase()];
		if (onchain?.decimals == null) { refused.push(`${token.symbol}: decimals() did not answer on chain`); continue; }
		if (onchain.decimals !== token.decimals) { refused.push(`${token.symbol}: on-chain decimals ${onchain.decimals} disagree with the universe (${token.decimals})`); continue; }
		const fallback = token.priceUsd > 0 && token.liquidityUsd > 0 ? null : await dexFallback(token.address, token.assetClass);
		const priceUsd = token.priceUsd > 0 ? token.priceUsd : fallback?.priceUsd;
		const liquidityUsd = Math.max(token.liquidityUsd ?? 0, fallback?.liquidityUsd ?? 0);
		if (!(priceUsd > 0)) { refused.push(`${token.symbol}: no live USD price`); continue; }
		if (liquidityUsd < args.minLiquidity) { refused.push(`${token.symbol}: ${usd(liquidityUsd)} liquidity is under the ${usd(args.minLiquidity)} floor`); continue; }
		if (existing?.enabled) { refused.push(`${token.symbol}: already enabled (opening reserve ${existing.virtualQuote} ${existing.symbol})`); continue; }

		const units = roundSig(target / priceUsd);
		const virtualQuote = parseUnits(String(units), token.decimals);
		if (virtualQuote === 0n || virtualQuote > UINT128_MAX) { refused.push(`${token.symbol}: calibrated reserve ${units} does not fit uint128`); continue; }
		plan.push({ token, virtualQuote, enabled: true, note: `priced ${priceUsd < 1 ? priceUsd.toPrecision(4) : priceUsd.toFixed(2)} USD, opens at ${usd(units * priceUsd)}` });
	}

	for (const r of refused) console.log(`  refused  ${r}`);
	if (refused.length) console.log('');

	const txs = plan.map((p) => ({
		...p,
		data: encodeFunctionData({ abi: launchpadAbi, functionName: 'setQuoteConfig', args: [p.token.address, p.virtualQuote, p.enabled] }),
	}));
	for (const t of txs) {
		console.log(`  ${t.enabled ? 'enable ' : 'disable'}  ${t.token.symbol.padEnd(8)} ${t.token.assetClass.padEnd(13)} ${t.token.address}`);
		console.log(`           virtualQuote ${formatUnits(t.virtualQuote, t.token.decimals)} ${t.token.symbol} (${t.virtualQuote} base units), ${t.note}`);
		console.log(`           to ${lp}  data ${t.data}`);
	}
	if (!txs.length) { console.log('nothing to send'); process.exit(refused.length ? 1 : 0); }

	if (!args.apply) {
		console.log(`\nplan only: ${txs.length} setQuoteConfig transaction(s), each signed by the owner ${owner}. Re-run with PAIRED_OWNER_KEY and --apply to send.`);
		return;
	}

	const key = String(process.env.PAIRED_OWNER_KEY || '').trim();
	if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('--apply needs PAIRED_OWNER_KEY (the launchpad owner private key)');
	const account = privateKeyToAccount(key);
	if (account.address.toLowerCase() !== owner.toLowerCase()) {
		throw new Error(`PAIRED_OWNER_KEY is ${account.address}, but the launchpad owner is ${owner}`);
	}
	const wallet = createWalletClient({ account, chain: HOOD_MAINNET, transport: http(rpcUrls(false)[0]) });

	for (const t of txs) {
		const hash = await wallet.sendTransaction({ to: lp, data: t.data });
		const receipt = await client.waitForTransactionReceipt({ hash });
		if (receipt.status !== 'success') throw new Error(`${t.token.symbol}: transaction ${hash} reverted`);
		const [vq, enabled] = await client.readContract({ address: lp, abi: launchpadAbi, functionName: 'quoteConfig', args: [t.token.address] });
		console.log(`  sent     ${t.token.symbol}: ${hash} (now ${enabled ? 'enabled' : 'disabled'}, reserve ${formatUnits(vq, t.token.decimals)})`);
	}
}

main().then(
	() => process.exit(0),
	(err) => {
		console.error(`paired:quotes: ${err.message}`);
		process.exit(1);
	},
);
