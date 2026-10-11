// Launch a coin on Pons (Robinhood Chain) from an agent's custodial EVM wallet.
//
// The agent's one EVM address (agent_identities.wallet_address) is the same on
// every EVM chain, so the wallet that already holds the agent's Base balance is
// the deployer here. It needs native ETH on Robinhood Chain for the Pons launch
// fee, the optional opening buy, and gas; quote() reports exactly how much, so
// an owner or a bot knows what to fund before anything is signed.
//
// launch() runs the same gates as every other custodial spend, in order: the
// agent belongs to the caller, the agent is still in platform-signing mode, the
// launch is priced in USD and checked against the agent's spend policy on this
// chain, the wallet can cover it, and the transaction simulates cleanly. Only
// then is the key decrypted (with an audit row) and the transaction sent. The
// spend is written to the custody ledger as pending before the send, so a
// concurrent launch counts it against the daily ceiling, and settled after the
// receipt. A landed coin is recorded in fixed_supply_launches (chain
// 'robinhood', venue 'pons'), which is what /launches and agent profiles read.

import { randomBytes } from 'node:crypto';
import { formatEther, getAddress, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { sql } from '../db.js';
import { thumbnailUrl } from '../r2.js';
import { getOrCreateAgentEvmWallet, recoverAgentKey } from '../agent-wallet.js';
import { assertPlatformSigningAllowed } from '../custody/signing.js';
import { recordCustodyEvent, updateCustodyEvent } from '../agent-trade-guards.js';
import { fetchCoinPriceUsd } from '../market-fallbacks.js';
import { EVM_LEG_CHAINS, EvmLegError, evmLegPublicClient, evmLegWalletClient, explorerTx, nativePriceId } from './chains.js';
import { enforceEvmSpend, getDailyEvmSpendUsd, getEvmSpendLimits, checkEvmSpend } from './guards.js';
import {
	PONS_ABI,
	PONS_V2_FACTORY,
	PonsError,
	buildLaunchTx,
	buildTokenParams,
	parseLaunchReceipt,
	ponsCoinUrl,
	quoteOpeningBuy,
	readLaunchTerms,
} from '../pons.js';

const CHAIN = EVM_LEG_CHAINS.robinhood;
const LEDGER_CHAIN = { key: CHAIN.slug, name: CHAIN.name };

// Gas a Pons V2 launchAndBuy actually consumed on mainnet: 3.55M (bare launch)
// to 3.87M (launch plus opening buy) across the launches in
// tests/fixtures/pons-v2-launches.json. Used only when the wallet is too empty
// for eth_estimateGas to run, so the quote can still say how much to fund.
const MEASURED_LAUNCH_GAS = 3_900_000n;
// Headroom on an estimate: gas price can tick up between quote and send.
const GAS_HEADROOM_BPS = 13_000n;

/** Opening-buy ceiling. The curve graduates at 4.2 ETH, so more than that buys nothing extra. */
export const MAX_OPENING_BUY_ETH = 4;

async function loadOwnedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT ai.id, ai.user_id, ai.name, ai.wallet_address, ai.meta, a.thumbnail_key, a.visibility
		FROM agent_identities ai
		LEFT JOIN avatars a ON a.id = ai.avatar_id AND a.deleted_at IS NULL
		WHERE ai.id = ${agentId} AND ai.deleted_at IS NULL
		LIMIT 1
	`;
	if (!row) throw new EvmLegError('not_found', 'agent not found', 404);
	if (row.user_id !== userId) throw new EvmLegError('forbidden', 'not your agent', 403);
	if (!row.wallet_address || !row.meta?.encrypted_wallet_key) {
		// Older agents predate the EVM leg; provision it now so the quote can
		// name the address to fund instead of refusing.
		const { address } = await getOrCreateAgentEvmWallet(agentId);
		const [fresh] = await sql`SELECT meta FROM agent_identities WHERE id = ${agentId}`;
		return { ...row, wallet_address: address, meta: fresh?.meta || row.meta };
	}
	return row;
}

/** The agent's avatar thumbnail, when public, as a default coin logo. */
function defaultLogo(agent) {
	if (agent.visibility !== 'public' && agent.visibility !== 'unlisted') return '';
	const url = agent.thumbnail_key ? thumbnailUrl(agent.thumbnail_key) : null;
	return url && url.startsWith('https://') && url.length <= 512 ? url : '';
}

function toWei(eth) {
	const n = Number(eth || 0);
	if (!Number.isFinite(n) || n < 0) throw new PonsError('buy_invalid', 'Opening buy must be a non-negative ETH amount.');
	if (n > MAX_OPENING_BUY_ETH) {
		throw new PonsError('buy_too_large', `Opening buy is capped at ${MAX_OPENING_BUY_ETH} ETH; the curve graduates at 4.2 ETH.`);
	}
	return parseEther(String(n));
}

async function ethUsd() {
	const id = nativePriceId(CHAIN);
	if (!id) return null;
	try {
		return await fetchCoinPriceUsd(id);
	} catch {
		return null;
	}
}

function usdOf(wei, price) {
	return price == null ? null : Math.round(Number(formatEther(wei)) * price * 100) / 100;
}

/**
 * Everything a launch needs except the signature: the validated token
 * params, the transaction, and its full cost. Shared by quote and launch so
 * what the owner is shown is exactly what gets sent.
 */
async function prepare(agent, input) {
	const terms = await readLaunchTerms();
	const address = getAddress(agent.wallet_address);
	const buyWei = toWei(input.buy_eth);
	const params = buildTokenParams({
		name: input.name,
		symbol: input.symbol,
		logo: input.image_url || defaultLogo(agent),
		description: input.description || '',
		socials: input.socials || {},
		creatorFeeRecipient: address,
		creatorTaxBps: input.creator_tax_bps ?? 0,
		buybackEnabled: Boolean(input.buyback),
		// Pin the terms the owner was quoted: an owner-side re-peg between
		// quote and send reverts the launch instead of silently repricing it.
		expectedEconomics: terms.expectedEconomics,
		salt: `0x${randomBytes(32).toString('hex')}`,
	});
	const tx = buildLaunchTx({ params, terms, quoteIn: buyWei, recipient: address });
	const client = evmLegPublicClient(CHAIN);
	const [balanceWei, gasPrice, canLaunch] = await Promise.all([
		client.getBalance({ address }),
		client.getGasPrice(),
		client.readContract({ address: PONS_V2_FACTORY, abi: PONS_ABI, functionName: 'canLaunch', args: [address] }),
	]);
	let gas = MEASURED_LAUNCH_GAS;
	let estimated = false;
	if (balanceWei >= tx.value) {
		try {
			gas = await client.estimateGas({ account: address, to: tx.to, data: tx.data, value: tx.value });
			estimated = true;
		} catch (err) {
			throw new PonsError('simulation_failed', `Pons would reject this launch: ${err.shortMessage || err.message}`, 422);
		}
	}
	const gasLimit = (gas * GAS_HEADROOM_BPS) / 10_000n;
	const gasWei = gasLimit * gasPrice;
	const totalWei = tx.value + gasWei;
	const blockers = [];
	if (!terms.launchEnabled && !canLaunch) blockers.push('Pons has paused public launches.');
	if (!terms.config.enabled) blockers.push('The Pons launch config is disabled.');
	if (balanceWei < totalWei) {
		blockers.push(
			`Fund ${address} with at least ${formatEther(totalWei - balanceWei)} more ETH on Robinhood Chain.`,
		);
	}
	return { terms, params, tx, address, buyWei, balanceWei, gasLimit, gasPrice, gasWei, totalWei, estimated, blockers };
}

function describe(agent, p, price) {
	const tokensOut = p.buyWei > 0n
		? quoteOpeningBuy({ quoteIn: p.buyWei, config: p.terms.config, creatorTaxBps: p.params.creatorTaxBps })
		: 0n;
	const supply = p.terms.config.supply;
	return {
		chain: CHAIN.slug,
		chain_id: CHAIN.chainId,
		venue: 'pons',
		agent: { id: agent.id, name: agent.name },
		wallet: { address: p.address, balance_eth: formatEther(p.balanceWei) },
		coin: {
			name: p.params.name,
			symbol: p.params.symbol,
			image_url: p.params.logo || null,
			description: p.params.description,
			socials: p.params.socials,
			creator_tax_bps: p.params.creatorTaxBps,
			buyback: p.params.buybackEnabled,
		},
		terms: {
			launch_fee_eth: formatEther(p.terms.launchFee),
			curve_fee_bps: Number(p.terms.config.curveFeeBps),
			max_creator_tax_bps: Number(p.terms.maxCreatorTaxBps),
			graduation_threshold_eth: formatEther(p.terms.config.graduationThreshold),
			total_supply: formatEther(supply),
		},
		cost: {
			launch_fee_eth: formatEther(p.terms.launchFee),
			opening_buy_eth: formatEther(p.buyWei),
			gas_eth: formatEther(p.gasWei),
			gas_estimated: p.estimated,
			total_eth: formatEther(p.totalWei),
			total_usd: usdOf(p.totalWei, price),
			eth_usd: price,
		},
		opening_buy: {
			tokens: formatEther(tokensOut),
			pct_of_supply: supply > 0n ? Number((tokensOut * 1_000_000n) / supply) / 10_000 : 0,
		},
		ready: p.blockers.length === 0,
		blockers: p.blockers,
	};
}

/** Price, policy and funding check for a launch, without signing anything. */
export async function quotePonsLaunch({ agentId, userId, input }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const [p, price] = await Promise.all([prepare(agent, input), ethUsd()]);
	const out = describe(agent, p, price);
	const limits = getEvmSpendLimits(agent.meta);
	const spentTodayUsd = await getDailyEvmSpendUsd(agentId, LEDGER_CHAIN.key);
	const blocked = checkEvmSpend({
		limits,
		usdValue: usdOf(p.tx.value, price),
		spentTodayUsd,
		category: 'launch',
		chainName: CHAIN.name,
	});
	if (blocked) {
		out.blockers.push(blocked.message);
		out.ready = false;
	}
	out.policy = { per_tx_usd: limits.per_tx_usd, daily_usd: limits.daily_usd, spent_today_usd: spentTodayUsd };
	return out;
}

/**
 * Sign and send a Pons launch from the agent's custodial wallet. Returns the
 * new token, its curve, the transaction and the opening fill.
 */
export async function launchOnPons({ agentId, userId, input, req = null }) {
	await assertPlatformSigningAllowed(agentId);
	const agent = await loadOwnedAgent(agentId, userId);
	const [p, price] = await Promise.all([prepare(agent, input), ethUsd()]);
	if (p.blockers.length) throw new EvmLegError('launch_blocked', p.blockers.join(' '), 409, { blockers: p.blockers });

	// The gas leg is network cost, not a spend the policy meters; the launch fee
	// and opening buy are what leave the agent's control.
	const usd = usdOf(p.tx.value, price);
	await enforceEvmSpend({ agentId, meta: agent.meta, chain: LEDGER_CHAIN, usdValue: usd, category: 'launch' });

	const custodyId = await recordCustodyEvent({
		agentId,
		userId,
		eventType: 'spend',
		category: 'launch',
		network: CHAIN.slug,
		asset: 'ETH',
		amountRaw: p.tx.value.toString(),
		usd,
		destination: p.tx.to,
		reason: 'pons.launch',
		status: 'pending',
		meta: { venue: 'pons', name: p.params.name, symbol: p.params.symbol, buy_wei: p.buyWei.toString() },
	});

	const pk = await recoverAgentKey(agent.meta.encrypted_wallet_key, {
		agentId,
		userId,
		reason: 'pons.launch',
		meta: { chain: CHAIN.slug, symbol: p.params.symbol },
	});
	const account = privateKeyToAccount(pk);
	if (getAddress(account.address) !== p.address) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: 'key_address_mismatch' } });
		throw new EvmLegError('wallet_mismatch', 'The stored key does not match this agent\'s wallet address.', 500);
	}

	let hash;
	try {
		hash = await evmLegWalletClient(CHAIN, account).sendTransaction({
			to: p.tx.to,
			data: p.tx.data,
			value: p.tx.value,
			gas: p.gasLimit,
		});
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: String(err.shortMessage || err.message).slice(0, 300) } });
		throw new EvmLegError('send_failed', `The launch was not sent: ${err.shortMessage || err.message}`, 502);
	}

	const receipt = await evmLegPublicClient(CHAIN).waitForTransactionReceipt({ hash, timeout: 60_000 });
	if (receipt.status !== 'success') {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'reverted' } });
		throw new EvmLegError('launch_reverted', 'The launch transaction reverted on chain. Only gas was spent.', 502, {
			tx_hash: hash,
			explorer: explorerTx(CHAIN, hash),
		});
	}
	const launched = parseLaunchReceipt(receipt);
	if (!launched) {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'no_launch_event' } });
		throw new EvmLegError('launch_unreadable', 'The transaction landed but emitted no Pons launch.', 502, { tx_hash: hash });
	}
	await updateCustodyEvent(custodyId, { status: 'confirmed', signature: hash, meta: { token: launched.token, curve: launched.curve } });

	const venueUrl = ponsCoinUrl(launched.token);
	await sql`
		INSERT INTO fixed_supply_launches
			(agent_id, user_id, network, chain, venue, mint, genesis_account, name, symbol, image_url, description,
			 creator_address, token_allocation, signatures, venue_url)
		VALUES
			(${agentId}, ${userId}, 'mainnet', ${CHAIN.slug}, 'pons', ${launched.token}, ${launched.curve},
			 ${p.params.name}, ${p.params.symbol}, ${p.params.logo || null}, ${p.params.description || null},
			 ${p.address}, ${(p.terms.config.supply / 10n ** 18n).toString()}, ${JSON.stringify([hash])}::jsonb, ${venueUrl})
		ON CONFLICT (mint, network) DO NOTHING
	`.catch((e) => console.error('[pons/launch] directory insert failed', e?.message));

	import('../audit.js')
		.then(({ logAudit }) =>
			logAudit({ userId, action: 'agent.pons_launch', resourceId: agentId, meta: { token: launched.token, tx: hash }, req }),
		)
		.catch(() => {});

	return {
		chain: CHAIN.slug,
		chain_id: CHAIN.chainId,
		venue: 'pons',
		token: launched.token,
		curve: launched.curve,
		name: p.params.name,
		symbol: p.params.symbol,
		tx_hash: hash,
		block: Number(receipt.blockNumber),
		gas_used: receipt.gasUsed.toString(),
		spent_eth: formatEther(p.tx.value + receipt.gasUsed * receipt.effectiveGasPrice),
		spent_usd: usd,
		opening_buy: launched.openingBuy
			? { eth: formatEther(launched.openingBuy.quoteIn), tokens: formatEther(launched.openingBuy.tokensOut) }
			: null,
		urls: {
			pons: venueUrl,
			explorer: explorerTx(CHAIN, hash),
			coin: `/markets/robinhood/coin/${launched.token}`,
		},
	};
}
