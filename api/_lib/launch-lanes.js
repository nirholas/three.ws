// The launch lanes, described from live config.
//
// One place says what each lane costs, who earns what, what happens when the
// curve fills and which chain it lives on. The launch wizard's lane picker
// (GET /api/launches/lanes) and the generated table in docs/launch-lanes.md
// (npm run docs:launch-lanes) both read it, so neither can drift from the
// numbers a launch really uses. Every on-chain number comes from the contract
// or the lane's own config module; nothing here restates a fee.
//
// A lane's `fees` is the COMPLETE list of what a launch and its trading cost.
// Solana is the default lane.

import { formatEther } from 'viem';
import { launchpadConfig, launchpadAddress, PAIRED_CHAIN_ID } from './paired-launchpad.js';
import { NATIVE_LANE } from './native-launch/config.js';
import { pumpLaunchFeeBps } from './pump-platform-fee.js';
import { EVM_LEG_CHAINS } from './evm-leg/chains.js';
import { uniswapLaneConfig } from './evm-leg/uniswap-config.js';

const bps = (value) => ({ kind: 'bps', value });
const eth = (value) => ({ kind: 'eth', value });
const text = (value) => ({ kind: 'text', value });

const pct = (b) => `${Number((b / 100).toFixed(2))}%`;

function pumpLane() {
	const platformBps = pumpLaunchFeeBps();
	return {
		id: 'pumpfun',
		label: 'pump.fun',
		family: 'solana',
		default: true,
		available: true,
		chain: { slug: 'solana', name: 'Solana', chain_id: null },
		signer: 'Your wallet, or your agent\'s wallet',
		supply: '1,000,000,000',
		fees: [
			{ id: 'platform_launch', label: 'three.ws launch fee', when: 'launch', payer: 'creator', amount: bps(platformBps), note: 'Charged on the opening buy only. A launch with no opening buy pays nothing.' },
			{ id: 'protocol', label: 'pump.fun protocol fees', when: 'launch and trade', payer: 'creator and traders', amount: text('Set by pump.fun'), note: 'Account rent, creation cost and trade fees are pump.fun\'s and shown in the wallet prompt.' },
			{ id: 'network', label: 'Network fee', when: 'launch', payer: 'creator', amount: text('SOL, a fraction of a cent'), note: 'Paid to Solana validators.' },
		],
		creator_share: { label: 'Creator rewards on every trade, claimable on three.ws', bps: null, paid_in: 'SOL or the quote asset' },
		graduation: 'Trades on a bonding curve until it fills, then moves to an open AMM pool on Solana.',
		liquidity: { custody: 'Held by pump.fun\'s program', lock_options: [] },
		cta: { href: '/launch', label: 'Launch on Solana' },
	};
}

function nativeLane() {
	return {
		id: 'native',
		label: NATIVE_LANE.label,
		family: 'solana',
		default: false,
		available: true,
		chain: { slug: 'solana', name: 'Solana', chain_id: null },
		signer: 'Your wallet',
		supply: NATIVE_LANE.totalSupply.toLocaleString('en-US'),
		fees: [
			{ id: 'trade', label: 'Trading fee', when: 'trade', payer: 'traders', amount: bps(NATIVE_LANE.tradeFeeBps), note: `Paid in ${NATIVE_LANE.quote}.` },
			{ id: 'migration', label: 'Migration fee', when: 'graduation', payer: 'raised liquidity', amount: bps(NATIVE_LANE.migrationFeePercent * 100), note: 'Taken from the quote raised when the coin graduates.' },
			{ id: 'network', label: 'Network fee', when: 'launch', payer: 'creator', amount: text('SOL, a fraction of a cent'), note: 'Paid to Solana validators.' },
		],
		creator_share: { label: 'Share of every trading fee and of the migration fee', bps: NATIVE_LANE.creatorTradeFeePercent * 100, paid_in: NATIVE_LANE.quote },
		graduation: `Starts at a ${NATIVE_LANE.initialMarketCapThree.toLocaleString('en-US')} ${NATIVE_LANE.quote} market cap and graduates at ${NATIVE_LANE.migrationMarketCapThree.toLocaleString('en-US')} ${NATIVE_LANE.quote} into a pool with ${NATIVE_LANE.lpLockedPercent}% of liquidity permanently locked.`,
		liquidity: { custody: 'Permanently locked at graduation, half creator and half platform', lock_options: [{ id: 'permanent', label: 'Permanent lock' }] },
		cta: { href: '/three-launchpad', label: 'Launch with three.ws' },
	};
}

async function pairedLane() {
	const chain = EVM_LEG_CHAINS.robinhood;
	let config = null;
	let unavailable = null;
	try {
		config = await launchpadConfig();
	} catch (err) {
		unavailable = `The launchpad could not be read: ${String(err?.message || err).slice(0, 120)}`;
	}
	return {
		id: 'paired',
		label: 'Paired coin',
		family: 'evm',
		default: false,
		available: Boolean(config),
		unavailable_reason: unavailable,
		chain: { slug: chain.slug, name: chain.name, chain_id: PAIRED_CHAIN_ID },
		contract: launchpadAddress(),
		signer: 'Your agent\'s wallet',
		supply: config ? Number(config.totalSupply).toLocaleString('en-US') : '1,000,000,000',
		fees: config
			? [
					{ id: 'launch', label: 'Launch fee', when: 'launch', payer: 'creator', amount: eth(config.launchFeeEth), note: 'Flat, paid in ETH.' },
					{ id: 'swap', label: 'Swap fee', when: 'trade', payer: 'traders', amount: bps(config.swapFeeBps), note: 'Charged in each pool\'s quote asset.' },
					{ id: 'gas', label: 'Gas', when: 'launch', payer: 'creator', amount: text('Estimated in the quote'), note: 'Paid to the chain, in ETH.' },
				]
			: [],
		creator_share: config ? { label: 'Share of every swap fee, in every pool', bps: config.creatorShareBps, paid_in: 'Each pool\'s quote asset' } : null,
		graduation: 'There is no graduation. The coin trades on its bonding curves for good, up to five at once, and liquidity never migrates.',
		liquidity: { custody: 'Held by the launchpad contract. Nobody can withdraw it.', lock_options: [{ id: 'permanent', label: 'Permanent (built in)' }] },
		idempotent: true,
		cta: { href: '/launch/paired', label: 'Launch a paired coin' },
	};
}

async function uniswapLane() {
	const chain = EVM_LEG_CHAINS.base;
	const config = await uniswapLaneConfig();
	const fees = [];
	if (config.available) {
		fees.push({ id: 'launch', label: 'Launch fee', when: 'launch', payer: 'creator', amount: eth(formatEther(BigInt(config.launchFeeWei))), note: config.launchFeeWei === '0' ? 'There is no platform launch fee.' : 'Flat, paid in ETH.' });
		fees.push({
			id: 'pool',
			label: 'Pool trading fee',
			when: 'trade',
			payer: 'traders',
			amount: text(config.feeTiers.map((t) => pct(t.bps)).join(', ')),
			note: 'You pick the tier at launch. It goes to the liquidity position, not to the platform.',
		});
		fees.push({
			id: 'platform_share',
			label: 'Platform share of pool fees',
			when: 'trade',
			payer: 'taken from the position\'s fees',
			amount: bps(config.platformShareBps),
			note: config.platformShareBps === 0 ? 'None. The creator receives all of the pool fees.' : 'Taken when fees are collected from a locked position.',
		});
		fees.push({ id: 'gas', label: 'Gas', when: 'launch', payer: 'creator', amount: text('Estimated in the quote'), note: 'Paid to the chain, in ETH.' });
	}
	return {
		id: 'uniswap',
		label: 'Uniswap V3 pool',
		family: 'evm',
		default: false,
		available: config.available,
		unavailable_reason: config.unavailable_reason,
		chain: { slug: chain.slug, name: chain.name, chain_id: chain.chainId },
		contract: config.launcher,
		signer: 'Your agent\'s wallet',
		supply: config.totalSupply,
		fees,
		creator_share: config.available
			? { label: 'Share of the pool\'s trading fees on the liquidity position', bps: 10_000 - config.platformShareBps, paid_in: 'WETH and the coin' }
			: null,
		graduation: 'There is no graduation. The whole supply goes into one Uniswap V3 pool from the first block and trades openly against WETH.',
		liquidity: {
			custody: 'One position holds the whole supply, single-sided',
			lock_options: config.lockModes,
		},
		fee_tiers: config.feeTiers,
		idempotent: true,
		cta: { href: '/launch/uniswap', label: 'Launch a Uniswap pool' },
	};
}

/** Every lane, Solana first, from live config. */
export async function launchLanes() {
	const [paired, uniswap] = await Promise.all([pairedLane(), uniswapLane()]);
	return [pumpLane(), nativeLane(), uniswap, paired];
}

export function formatAmount(amount) {
	if (amount.kind === 'bps') return pct(amount.value);
	if (amount.kind === 'eth') return `${amount.value} ETH`;
	return amount.value;
}

/** Markdown for docs/launch-lanes.md, built only from the lane list. */
export function lanesMarkdown(lanes) {
	const rows = [['Lane', 'Chain', 'Signs with', 'Supply', 'Creator share', 'Graduation', 'Liquidity']];
	for (const l of lanes) {
		rows.push([
			`**${l.label}**${l.default ? ' (default)' : ''}`,
			l.chain.chain_id ? `${l.chain.name} (${l.chain.chain_id})` : l.chain.name,
			l.signer,
			l.supply,
			l.creator_share ? `${l.creator_share.bps != null ? `${pct(l.creator_share.bps)}: ` : ''}${l.creator_share.label}` : 'n/a',
			l.graduation,
			l.liquidity.lock_options.length ? `${l.liquidity.custody}. Lock: ${l.liquidity.lock_options.map((o) => o.label).join(', ')}` : l.liquidity.custody,
		]);
	}
	const table = (r) => [`| ${r[0].join(' | ')} |`, `| ${r[0].map(() => '---').join(' | ')} |`, ...r.slice(1).map((x) => `| ${x.join(' | ')} |`)].join('\n');
	const out = ['### Lane comparison', '', table(rows)];
	for (const l of lanes) {
		out.push('', `### ${l.label}: every fee`, '');
		if (!l.available) {
			out.push(`Not available right now: ${l.unavailable_reason}`);
			continue;
		}
		const feeRows = [['Fee', 'When', 'Paid by', 'Amount', 'Note']];
		for (const f of l.fees) feeRows.push([f.label, f.when, f.payer, formatAmount(f.amount), f.note || '']);
		out.push(table(feeRows));
		if (l.contract) out.push('', `Contract: \`${l.contract}\``);
	}
	return out.join('\n');
}
