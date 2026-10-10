// Launch a fixed-supply coin with a Uniswap V3 pool on Base from an agent's
// custodial EVM wallet.
//
// One transaction to the launcher contract (contracts/src/ThreeWsUniswapLauncher.sol)
// deploys the token, creates its WETH pool, puts the whole supply into a single
// one-sided position and, depending on the lock the creator chose, keeps the
// position in the launcher (timelock, permanent) or hands it to the creator.
// The creator never needs to hold WETH or the coin: the launch costs the
// launcher's flat ETH fee (zero by default) plus gas.
//
// Gate order matches every other custodial spend on the EVM leg (see
// paired-launch.js): the agent belongs to the caller, the agent is in
// platform-signing mode, the spend is checked against the agent's policy on
// Base, the wallet covers fee and gas, the transaction simulates, and only then
// is the key decrypted (with an audit row). The spend is written to the custody
// ledger as pending before the send and settled after the receipt.
//
// quote() and launch() share prepare() so the owner is quoted exactly what is
// signed. The one exception is the deadline, which is a ten minute window
// counted from the moment the transaction is built.

import { encodeFunctionData, formatEther, getAddress, keccak256, parseEventLogs } from 'viem';

import { sql } from '../db.js';
import { publicUrl } from '../r2.js';
import { assertPlatformSigningAllowed } from '../custody/signing.js';
import { recordCustodyEvent, updateCustodyEvent } from '../agent-trade-guards.js';
import { EvmLegError, evmLegPublicClient, evmLegWalletClient, explorerAddress, explorerTx } from './chains.js';
import { checkEvmSpend, enforceEvmSpend, getDailyEvmSpendUsd, getEvmSpendLimits, normalizeEvmAddress } from './guards.js';
import {
	GAS_HEADROOM_BPS, LIMITS, agentAccount, defaultLogo, ethUsd, hostImage, httpsOrNull, loadOwnedAgent, round2, sanitizeName,
	sanitizeSymbol, storeDescriptor,
} from './paired-launch.js';
import { PairedMarketError } from '../paired-markets.js';
import {
	DEFAULT_FEE_TIER, DEFAULT_START_MARKET_CAP_ETH, FEE_TIERS, LOCK_MODES, MAX_LOCK_DAYS, MAX_START_MARKET_CAP_ETH, MIN_LOCK_DAYS,
	MIN_START_MARKET_CAP_ETH, TOTAL_SUPPLY_WHOLE, UNISWAP_CHAIN as CHAIN, UNISWAP_VENUE, launchedEvent, launcherAbi, marketCapEthAt,
	startTickFor, uniswapLaneConfig,
} from './uniswap-config.js';

export { UNISWAP_VENUE };
const LEDGER_CHAIN = { key: CHAIN.slug, name: CHAIN.name };

// Gas a launch costs is dominated by deploying the pool and the token. Used
// only when the wallet cannot run eth_estimateGas (it is empty), so a quote can
// still say how much to fund. Measured on a Base fork at about 5.8M gas with
// either lock mode; this carries headroom over that.
const MEASURED_LAUNCH_GAS = 6_500_000n;
// The launch carries a deadline so a transaction stuck in a mempool cannot land
// long after the owner approved it.
const DEADLINE_SECONDS = 600;
const DESCRIPTOR_PREFIX = 'uniswap/meta';
const DAY_SECONDS = 86_400;

export { LIMITS };

function buildDescriptor({ name, symbol, description, image, links, agent, wallet, fee, lock, startTick }) {
	const descriptor = {
		schemaVersion: '1.0.0',
		name,
		symbol,
		description: description || undefined,
		image: image || undefined,
		links: { website: links.website || undefined, twitter: links.twitter || undefined, telegram: links.telegram || undefined },
		pool: { venue: UNISWAP_VENUE, chainId: CHAIN.chainId, feeTier: fee, startTick, lock: lock.id },
		origin: {
			platform: 'three.ws',
			channel: 'agent',
			agent: { id: agent.id, name: agent.name, url: `https://three.ws/agents/${agent.id}` },
			wallet,
		},
	};
	const bytes = Buffer.from(JSON.stringify(descriptor));
	const hash = keccak256(bytes);
	const key = `${DESCRIPTOR_PREFIX}/${hash.slice(2)}.json`;
	return { descriptor, bytes, hash, key, url: publicUrl(key) };
}

function resolveTier(input) {
	const wanted = input.fee_tier == null ? DEFAULT_FEE_TIER : Number(input.fee_tier);
	const tier = FEE_TIERS.find((t) => t.fee === wanted);
	if (!tier) throw new PairedMarketError(`The pool fee tier must be one of ${FEE_TIERS.map((t) => `${t.bps / 100}%`).join(', ')}.`);
	return tier;
}

function resolveLock(input) {
	const mode = LOCK_MODES.find((m) => m.id === (input.lock?.mode ?? 'none'));
	if (!mode) throw new PairedMarketError(`The lock must be one of ${LOCK_MODES.map((m) => m.id).join(', ')}.`);
	let unlockAt = 0n;
	if (mode.id === 'timelock') {
		const days = Number(input.lock?.unlock_days);
		if (!Number.isFinite(days) || days < MIN_LOCK_DAYS || days > MAX_LOCK_DAYS) {
			throw new PairedMarketError(`A timelock needs unlock_days between ${MIN_LOCK_DAYS} and ${MAX_LOCK_DAYS}.`);
		}
		unlockAt = BigInt(Math.floor(Date.now() / 1000) + Math.round(days * DAY_SECONDS));
	}
	return { ...mode, unlockAt };
}

/**
 * Fee income can be routed to another address, but a third-party address must
 * already be on the agent's EVM allowlist, exactly like a withdrawal. Without
 * it a stolen session could redirect a coin's fees forever.
 */
function resolveFeeRecipient(input, agent, wallet) {
	if (input.fee_recipient == null || String(input.fee_recipient).trim() === '') return wallet;
	const recipient = normalizeEvmAddress(input.fee_recipient);
	if (!recipient) throw new PairedMarketError('The fee recipient is not a valid EVM address.');
	if (recipient === wallet) return wallet;
	const allowed = getEvmSpendLimits(agent.meta).allowlist.some((a) => a.toLowerCase() === recipient.toLowerCase());
	if (!allowed) {
		throw new EvmLegError('recipient_not_allowlisted', `Add ${recipient} to this agent's EVM allowlist before routing fees to it.`, 403);
	}
	return recipient;
}

async function prepare(agent, input) {
	const name = sanitizeName(input.name);
	const symbol = sanitizeSymbol(input.symbol);
	if (!name) throw new PairedMarketError('The coin needs a name.');
	if (symbol.length < 2) throw new PairedMarketError('The ticker needs at least two letters or digits.');
	const description = String(input.description ?? '').trim();
	if (description.length > LIMITS.description) throw new PairedMarketError(`The description must be ${LIMITS.description} characters or fewer.`);
	const links = {
		website: httpsOrNull(input.socials?.website, 'The website link'),
		twitter: httpsOrNull(input.socials?.twitter, 'The X link'),
		telegram: httpsOrNull(input.socials?.telegram, 'The Telegram link'),
	};

	const config = await uniswapLaneConfig();
	if (!config.available) throw new EvmLegError('lane_unavailable', config.unavailable_reason, 503);

	const tier = resolveTier(input);
	const lock = resolveLock(input);
	const marketCapEth = Number(input.start_market_cap_eth ?? DEFAULT_START_MARKET_CAP_ETH);
	if (!Number.isFinite(marketCapEth) || marketCapEth < MIN_START_MARKET_CAP_ETH || marketCapEth > MAX_START_MARKET_CAP_ETH) {
		throw new PairedMarketError(`The starting market cap must be between ${MIN_START_MARKET_CAP_ETH} and ${MAX_START_MARKET_CAP_ETH} ETH.`);
	}
	const startTick = startTickFor(marketCapEth, tier.tickSpacing);
	const address = getAddress(agent.wallet_address);
	const feeRecipient = resolveFeeRecipient(input, agent, address);
	const launchFeeWei = BigInt(config.launchFeeWei);
	const client = evmLegPublicClient(CHAIN);

	const image = input.image_url ? await hostImage(httpsOrNull(input.image_url, 'The logo link')) : defaultLogo(agent);
	const descriptor = buildDescriptor({ name, symbol, description, image, links, agent, wallet: address, fee: tier.fee, lock, startTick });

	const params = {
		name,
		symbol,
		fee: tier.fee,
		startTick,
		creator: address,
		feeRecipient: lock.id === 'none' ? address : feeRecipient,
		lockMode: lock.value,
		unlockAt: lock.unlockAt,
		metadataHash: descriptor.hash,
		metadataURI: descriptor.url,
		deadline: BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS),
	};
	const data = encodeFunctionData({ abi: launcherAbi, functionName: 'launch', args: [params] });

	const [balanceWei, gasPrice] = await Promise.all([client.getBalance({ address }), client.getGasPrice()]);
	let gas = MEASURED_LAUNCH_GAS;
	let estimated = false;
	if (balanceWei >= launchFeeWei) {
		try {
			gas = await client.estimateGas({ account: address, to: config.launcher, data, value: launchFeeWei });
			estimated = true;
		} catch (err) {
			throw new PairedMarketError(`The launcher would reject this launch: ${err.shortMessage || err.message}`, 422);
		}
	}
	const gasLimit = (gas * GAS_HEADROOM_BPS) / 10_000n;
	const gasWei = gasLimit * gasPrice;
	const totalWei = launchFeeWei + gasWei;
	const blockers = [];
	if (balanceWei < totalWei) blockers.push(`Fund ${address} with at least ${formatEther(totalWei - balanceWei)} more ETH on ${CHAIN.name}.`);
	if (lock.id === 'none' && input.fee_recipient && feeRecipient !== address) {
		blockers.push('Fee routing needs a lock. Without one, the liquidity position and its fees belong to the agent wallet.');
	}
	return {
		name, symbol, description, image, links, config, tier, lock, startTick, marketCapEth: marketCapEthAt(startTick), address, feeRecipient: params.feeRecipient,
		descriptor, params, data, launchFeeWei, balanceWei, gasLimit, gasPrice, gasWei, totalWei, estimated, blockers,
	};
}

/** USD that leaves the agent's control: the launch fee. Gas is network cost. */
function spendUsd(p, price) {
	if (p.launchFeeWei === 0n) return 0;
	return price == null ? null : round2(Number(formatEther(p.launchFeeWei)) * price);
}

function describe(agent, p, price) {
	const feeUsd = spendUsd(p, price);
	const gasUsd = price == null ? null : Number(formatEther(p.gasWei)) * price;
	return {
		lane: 'uniswap',
		chain: CHAIN.slug,
		chain_id: CHAIN.chainId,
		venue: UNISWAP_VENUE,
		launcher: p.config.launcher,
		agent: { id: agent.id, name: agent.name },
		wallet: { address: p.address, balance_eth: formatEther(p.balanceWei), explorer: explorerAddress(CHAIN, p.address) },
		coin: {
			name: p.name,
			symbol: p.symbol,
			description: p.description || null,
			image_url: p.image || null,
			socials: p.links,
			total_supply: TOTAL_SUPPLY_WHOLE.toString(),
			metadata_uri: p.descriptor.url,
			metadata_hash: p.descriptor.hash,
		},
		pool: {
			quote_asset: 'WETH',
			fee_tier_bps: p.tier.bps,
			start_tick: p.startTick,
			start_market_cap_eth: Number(p.marketCapEth.toPrecision(6)),
			supply_in_pool_pct: 100,
			opening_liquidity: 'The whole supply, one-sided. No ETH is needed to open the pool.',
		},
		lock: {
			mode: p.lock.id,
			label: p.lock.label,
			unlock_at: p.lock.unlockAt ? new Date(Number(p.lock.unlockAt) * 1000).toISOString() : null,
			fee_recipient: p.feeRecipient,
		},
		// Every fee, in the order the owner pays or earns it.
		fees: [
			{ id: 'launch', label: 'Launch fee', paid_by: 'creator', eth: formatEther(p.launchFeeWei), usd: feeUsd },
			{ id: 'gas', label: 'Gas', paid_by: 'creator', eth: formatEther(p.gasWei), usd: gasUsd == null ? null : round2(gasUsd), estimated: p.estimated },
			{ id: 'pool_fee', label: 'Pool trading fee', paid_by: 'traders', bps: p.tier.bps, note: 'Accrues to the liquidity position.' },
			{
				id: 'platform_share',
				label: 'Platform share of collected pool fees',
				paid_by: 'taken from the position\'s fees',
				bps: p.config.platformShareBps,
				note: p.lock.id === 'none' ? 'Not charged: an unlocked position is yours and its fees never pass through the launcher.' : 'Taken when fees are collected from the locked position.',
			},
		],
		creator_share_bps: p.lock.id === 'none' ? 10_000 : 10_000 - p.config.platformShareBps,
		cost: {
			launch_fee_eth: formatEther(p.launchFeeWei),
			gas_eth: formatEther(p.gasWei),
			gas_estimated: p.estimated,
			total_eth: formatEther(p.totalWei),
			total_usd: feeUsd != null && gasUsd != null ? round2(feeUsd + gasUsd) : null,
			eth_usd: price,
		},
		ready: p.blockers.length === 0,
		blockers: p.blockers,
	};
}

/** Price, policy and funding check for a Uniswap launch, without signing anything. */
export async function quoteUniswapLaunch({ agentId, userId, input }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const [p, price] = await Promise.all([prepare(agent, input), ethUsd()]);
	const out = describe(agent, p, price);
	const limits = getEvmSpendLimits(agent.meta);
	const spentTodayUsd = await getDailyEvmSpendUsd(agentId, LEDGER_CHAIN.key);
	const blocked = checkEvmSpend({ limits, usdValue: spendUsd(p, price), spentTodayUsd, category: 'launch', chainName: CHAIN.name });
	if (blocked) {
		out.blockers.push(blocked.message);
		out.ready = false;
	}
	out.policy = { per_tx_usd: limits.per_tx_usd, daily_usd: limits.daily_usd, spent_today_usd: spentTodayUsd };
	return out;
}

const noStage = async () => {};

/**
 * Sign and send a Uniswap launch from the agent's custodial wallet. `stage`
 * reports progress to the launch record (api/_lib/evm-launch-records.js).
 */
export async function launchUniswap({ agentId, userId, input, req = null, stage = noStage }) {
	await assertPlatformSigningAllowed(agentId);
	const agent = await loadOwnedAgent(agentId, userId);
	const [p, price] = await Promise.all([prepare(agent, input), ethUsd()]);
	if (p.blockers.length) throw new EvmLegError('launch_blocked', p.blockers.join(' '), 409, { blockers: p.blockers });

	const usd = spendUsd(p, price);
	await enforceEvmSpend({ agentId, meta: agent.meta, chain: LEDGER_CHAIN, usdValue: usd, category: 'launch' });
	await storeDescriptor(p.descriptor);
	await stage('policy_checked', { detail: { spend_usd: usd } });

	const custodyId = await recordCustodyEvent({
		agentId,
		userId,
		eventType: 'spend',
		category: 'launch',
		chain: CHAIN.slug,
		network: CHAIN.slug,
		asset: 'ETH',
		amountRaw: p.launchFeeWei.toString(),
		usd,
		destination: p.config.launcher,
		reason: 'uniswap.launch',
		status: 'pending',
		meta: { venue: UNISWAP_VENUE, name: p.name, symbol: p.symbol, fee_tier_bps: p.tier.bps, lock: p.lock.id },
	});
	const context = {
		custody_id: custodyId,
		agent_id: agentId,
		user_id: userId,
		name: p.name,
		symbol: p.symbol,
		image: p.image || null,
		description: p.description || null,
		wallet: p.address,
		launcher: p.config.launcher,
		fee_tier_bps: p.tier.bps,
		lock: p.lock.id,
		unlock_at: p.lock.unlockAt ? Number(p.lock.unlockAt) : null,
		fee_recipient: p.feeRecipient,
		start_market_cap_eth: Number(p.marketCapEth.toPrecision(6)),
		spend_usd: usd,
		launch_fee_wei: p.launchFeeWei.toString(),
		metadata_url: p.descriptor.url,
	};
	await stage('reserved', { context });

	let account;
	try {
		account = await agentAccount(agent, userId, 'uniswap.launch', { symbol: p.symbol, chain: CHAIN.slug });
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: err.code || 'key_recover_failed' } });
		throw err;
	}
	const client = evmLegPublicClient(CHAIN);
	let hash;
	try {
		hash = await evmLegWalletClient(CHAIN, account).sendTransaction({ to: p.config.launcher, data: p.data, value: p.launchFeeWei, gas: p.gasLimit });
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: String(err.shortMessage || err.message).slice(0, 300) } });
		throw new EvmLegError('send_failed', `The launch was not sent: ${err.shortMessage || err.message}`, 502);
	}
	await stage('submitted', { status: 'submitted', txHash: hash, detail: { explorer: explorerTx(CHAIN, hash) } });

	const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
	return finishUniswap({ context, hash, receipt, stage, req });
}

/** Read the new coin off a mined launch, settle the custody row and list the coin. */
async function finishUniswap({ context, hash, receipt, stage = noStage, req = null }) {
	const { custody_id: custodyId, agent_id: agentId, user_id: userId } = context;
	if (receipt.status !== 'success') {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'reverted' } });
		throw new EvmLegError('launch_reverted', 'The launch transaction reverted on chain. Only gas was spent.', 502, { tx_hash: hash, explorer: explorerTx(CHAIN, hash) });
	}
	const [launched] = parseEventLogs({ abi: [launchedEvent], logs: receipt.logs, eventName: 'Launched' });
	if (!launched) {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'no_launch_event' } });
		throw new EvmLegError('launch_unreadable', 'The transaction landed but emitted no launch.', 502, { tx_hash: hash });
	}
	const token = getAddress(launched.args.token);
	const pool = getAddress(launched.args.pool);
	const positionId = launched.args.tokenId.toString();
	await updateCustodyEvent(custodyId, { status: 'confirmed', signature: hash, meta: { token, pool } });
	await stage('confirmed', { status: 'confirmed', token, detail: { block: Number(receipt.blockNumber), pool, position_id: positionId } });

	await sql`
		INSERT INTO fixed_supply_launches
			(agent_id, user_id, network, chain, venue, mint, name, symbol, image_url, description,
			 creator_address, token_allocation, signatures, venue_url)
		VALUES
			(${agentId}, ${userId}, 'mainnet', ${CHAIN.slug}, ${UNISWAP_VENUE}, ${token},
			 ${context.name}, ${context.symbol}, ${context.image}, ${context.description},
			 ${context.wallet}, ${TOTAL_SUPPLY_WHOLE.toString()}, ${JSON.stringify([hash])}::jsonb,
			 ${explorerAddress(CHAIN, token)})
		ON CONFLICT (mint, network) DO NOTHING
	`.catch((e) => console.error('[uniswap/launch] directory insert failed', e?.message));

	import('../audit.js')
		.then(({ logAudit }) => logAudit({ userId, action: 'agent.uniswap_launch', resourceId: agentId, meta: { token, pool, tx: hash }, req }))
		.catch(() => {});

	return {
		lane: 'uniswap',
		chain: CHAIN.slug,
		chain_id: CHAIN.chainId,
		venue: UNISWAP_VENUE,
		token,
		pool,
		position_id: positionId,
		name: context.name,
		symbol: context.symbol,
		fee_tier_bps: context.fee_tier_bps,
		lock: context.lock,
		unlock_at: context.unlock_at ? new Date(context.unlock_at * 1000).toISOString() : null,
		fee_recipient: context.fee_recipient,
		tx_hash: hash,
		block: Number(receipt.blockNumber),
		gas_used: receipt.gasUsed.toString(),
		spent_eth: formatEther(BigInt(context.launch_fee_wei) + receipt.gasUsed * receipt.effectiveGasPrice),
		spent_usd: context.spend_usd,
		urls: { token: explorerAddress(CHAIN, token), pool: explorerAddress(CHAIN, pool), explorer: explorerTx(CHAIN, hash), metadata: context.metadata_url },
	};
}

/**
 * Finish a record whose transaction was sent but whose request never saw the
 * receipt. Returns null while the transaction is unmined, { result } when the
 * coin exists, or { error } when the launch reverted.
 */
export async function settleUniswapLaunch(row) {
	const receipt = await evmLegPublicClient(CHAIN).getTransactionReceipt({ hash: row.tx_hash }).catch(() => null);
	if (!receipt) return null;
	try {
		return { result: await finishUniswap({ context: row.context, hash: row.tx_hash, receipt }) };
	} catch (err) {
		return { error: { code: err.code || 'launch_failed', message: err.message, ...(err.detail ? { detail: err.detail } : {}) } };
	}
}
