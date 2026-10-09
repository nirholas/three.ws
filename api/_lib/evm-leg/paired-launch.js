// Launch a paired coin on Robinhood Chain from an agent's custodial EVM wallet.
//
// A paired coin trades against one to five quote assets at once (tokenized
// stocks, WETH, stablecoins, chain coins), each in its own bonding curve on the
// paired launchpad (api/_lib/paired-launchpad.js, contracts/paired-launchpad/).
// The launch costs only the flat ETH fee plus gas: every curve starts from a
// virtual reserve, so the agent never needs to hold the assets it pairs with.
// An optional opening buy spends one of those assets in the same transaction.
//
// The gates match every other custodial spend on the EVM leg (see
// pons-launch.js), in order: the agent belongs to the caller, the agent is in
// platform-signing mode, the launch is priced in USD and checked against the
// agent's spend policy on Robinhood Chain, the wallet covers fee, buy and gas,
// and the transaction simulates. Only then is the key decrypted (with an audit
// row). The spend is written to the custody ledger as pending before the send
// and settled after the receipt.
//
// quote() and launch() share prepare(), and the coin's descriptor is stored
// content-addressed (its URL is derived from the keccak256 of its bytes, the
// same hash the contract commits on chain), so what the owner is quoted is
// byte for byte what the agent signs.

import { createHash } from 'node:crypto';
import { encodeFunctionData, formatEther, formatUnits, getAddress, keccak256, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { sql } from '../db.js';
import { headObject, publicUrl, putObject, thumbnailUrl } from '../r2.js';
import { fetchUpstreamPublic } from '../upstream-fetch.js';
import { getOrCreateAgentEvmWallet, recoverAgentKey } from '../agent-wallet.js';
import { assertPlatformSigningAllowed } from '../custody/signing.js';
import { recordCustodyEvent, updateCustodyEvent } from '../agent-trade-guards.js';
import { fetchCoinPriceUsd } from '../market-fallbacks.js';
import {
	BPS,
	TOTAL_SUPPLY,
	TOKEN_DECIMALS,
	NO_DEV_BUY,
	claimableFees,
	erc20Abi,
	launchedEvent,
	launchpadAbi,
	launchpadAddress,
	launchpadConfig,
	quoteRegistry,
} from '../paired-launchpad.js';
import { PairedMarketError, parseQuoteAmount, resolveAllocations } from '../paired-markets.js';
import { pairedCoinUrl } from '../paired-directory.js';
import { EVM_LEG_CHAINS, EvmLegError, evmLegPublicClient, evmLegWalletClient, explorerAddress, explorerTx, nativePriceId } from './chains.js';
import { enforceEvmSpend, getDailyEvmSpendUsd, getEvmSpendLimits, checkEvmSpend } from './guards.js';

const CHAIN = EVM_LEG_CHAINS.robinhood;
const LEDGER_CHAIN = { key: CHAIN.slug, name: CHAIN.name };
export const PAIRED_VENUE = 'paired';

// Gas the launchpad's launch() consumed on mainnet: 0.94M (2 markets) to 1.30M
// (5 markets) across the first launches on 0x6a54...fa15. Used only when the
// wallet cannot run eth_estimateGas (empty, or the opening buy is not yet
// approved), so a quote can still say how much to fund.
const MEASURED_LAUNCH_GAS = 1_450_000n;
const MEASURED_APPROVE_GAS = 60_000n;
const GAS_HEADROOM_BPS = 13_000n;
// The launch carries a deadline so a transaction stuck in a mempool cannot
// land long after the owner approved it.
const DEADLINE_SECONDS = 600;

export const LIMITS = Object.freeze({ name: 32, symbol: 10, description: 480, link: 200, image: 512 });

const DESCRIPTOR_PREFIX = 'paired/meta';
const IMAGE_PREFIX = 'paired/images';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

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

export function sanitizeSymbol(raw) {
	return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LIMITS.symbol);
}

export function sanitizeName(raw) {
	return String(raw ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
}

function httpsOrNull(value, label) {
	const text = String(value ?? '').trim();
	if (!text) return null;
	let url;
	try {
		url = new URL(text);
	} catch {
		throw new PairedMarketError(`${label} is not a valid URL.`);
	}
	if (url.protocol !== 'https:') throw new PairedMarketError(`${label} must use https.`);
	return url.toString();
}

/** The agent's avatar thumbnail, when public, as a default coin logo. */
function defaultLogo(agent) {
	if (agent.visibility !== 'public' && agent.visibility !== 'unlisted') return null;
	const url = agent.thumbnail_key ? thumbnailUrl(agent.thumbnail_key) : null;
	return url && url.startsWith('https://') ? url : null;
}

/**
 * Copy a logo onto our own storage under the sha256 of its bytes, so the
 * artwork a coin commits to can never change or disappear, and so the same
 * image always yields the same URL (which keeps the descriptor hash stable
 * between quote and launch).
 */
async function hostImage(url) {
	// The logo link is user-supplied and the bytes are republished from our
	// bucket, so every redirect hop is SSRF-checked.
	const resp = await fetchUpstreamPublic(url, {}, { name: 'paired:logo', timeoutMs: 15_000, attempts: 2, okWhen: (r) => r.ok });
	const type = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	const ext = IMAGE_TYPES[type];
	if (!ext) throw new PairedMarketError('The logo must be a PNG, JPEG, WebP or GIF image.');
	const bytes = Buffer.from(await resp.arrayBuffer());
	if (bytes.byteLength > MAX_IMAGE_BYTES) throw new PairedMarketError('The logo must be under 4 MB.');
	const key = `${IMAGE_PREFIX}/${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
	if (!(await headObject(key).catch(() => null))) await putObject({ key, body: bytes, contentType: type });
	return publicUrl(key);
}

/**
 * The coin's descriptor, as the exact bytes the launchpad commits to. No
 * timestamps and a fixed key order, so identical inputs give identical bytes.
 * `origin` binds the coin to the agent that launched it; the creator address
 * the contract records is that agent's wallet, which is what makes it checkable.
 */
function buildDescriptor({ name, symbol, description, image, links, agent, wallet, allocations }) {
	const descriptor = {
		schemaVersion: '1.0.0',
		name,
		symbol,
		description: description || undefined,
		image: image || undefined,
		links: {
			website: links.website || undefined,
			twitter: links.twitter || undefined,
			telegram: links.telegram || undefined,
		},
		pairs: allocations.map((a) => ({ quoteToken: a.quoteToken, symbol: a.symbol, weightBps: a.weightBps })),
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

async function storeDescriptor(d) {
	if (await headObject(d.key).catch(() => null)) return;
	await putObject({ key: d.key, body: d.bytes, contentType: 'application/json' });
}

/**
 * Tokens an opening buy receives from a fresh pool: the contract's own math,
 * fee first, then constant product with the remaining reserve rounded UP so the
 * amount out rounds down, exactly as PairedLaunchpad._tokensOut does.
 */
export function openingBuyTokens({ virtualQuote, virtualToken, quoteIn, swapFeeBps }) {
	const fee = (quoteIn * BigInt(swapFeeBps)) / BigInt(BPS);
	const k = virtualQuote * virtualToken;
	const newQuote = virtualQuote + quoteIn - fee;
	return virtualToken - (k === 0n ? 0n : (k - 1n) / newQuote + 1n);
}

/**
 * The allocation the last market receives absorbs the division dust, exactly as
 * the contract assigns it, so the opening-buy math sees the real pool size.
 */
function poolSize(allocations, index) {
	if (index < allocations.length - 1) return (TOTAL_SUPPLY * BigInt(allocations[index].weightBps)) / BigInt(BPS);
	const assigned = allocations.slice(0, -1).reduce((sum, a) => sum + (TOTAL_SUPPLY * BigInt(a.weightBps)) / BigInt(BPS), 0n);
	return TOTAL_SUPPLY - assigned;
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

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Everything a launch needs except the signature. Shared by quote and launch
 * so the owner is shown exactly what is sent.
 */
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

	const [allocations, config, registry] = await Promise.all([
		resolveAllocations(input.markets, input.weights),
		launchpadConfig(),
		quoteRegistry(),
	]);
	const launchFeeWei = BigInt(config.launchFeeWei);
	const address = getAddress(agent.wallet_address);
	const lp = launchpadAddress();
	const client = evmLegPublicClient(CHAIN);

	// Optional opening buy, in one of the coin's own markets.
	let devBuy = null;
	if (input.dev_buy && input.dev_buy.amount != null && String(input.dev_buy.amount).trim() !== '' && Number(input.dev_buy.amount) !== 0) {
		const want = String(input.dev_buy.market ?? allocations[0].symbol).trim().replace(/^\$/, '').toLowerCase();
		const index = allocations.findIndex((a) => a.symbol.toLowerCase() === want || a.quoteToken.toLowerCase() === want);
		if (index === -1) throw new PairedMarketError('The opening buy must be in one of the markets the coin pairs with.');
		const market = allocations[index];
		const quoteIn = parseQuoteAmount(input.dev_buy.amount, market.decimals);
		const full = registry.find((q) => q.address.toLowerCase() === market.quoteToken.toLowerCase());
		const tokensOut = openingBuyTokens({
			virtualQuote: (BigInt(full.virtualQuoteRaw) * BigInt(market.weightBps)) / BigInt(BPS),
			virtualToken: poolSize(allocations, index),
			quoteIn,
			swapFeeBps: config.swapFeeBps,
		});
		const [balance, allowance] = await Promise.all([
			client.readContract({ address: market.quoteToken, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
			client.readContract({ address: market.quoteToken, abi: erc20Abi, functionName: 'allowance', args: [address, lp] }),
		]);
		devBuy = { index, market, quoteIn, tokensOut, balance, needsApproval: allowance < quoteIn };
	}

	const image = input.image_url ? await hostImage(httpsOrNull(input.image_url, 'The logo link')) : defaultLogo(agent);
	const descriptor = buildDescriptor({ name, symbol, description, image, links, agent, wallet: address, allocations });

	const params = {
		name,
		symbol,
		metadataURI: descriptor.url,
		metadataHash: descriptor.hash,
		allocations: allocations.map((a) => ({ quoteToken: a.quoteToken, weightBps: a.weightBps })),
		creatorFeeRecipient: address,
		devBuyMarket: devBuy ? devBuy.index : NO_DEV_BUY,
		devBuyQuoteIn: devBuy ? devBuy.quoteIn : 0n,
		// Atomic with the launch, so no one can trade the curve first: the
		// exact fill is pinned, and a registry change between quote and send
		// reverts the launch instead of silently filling worse.
		devBuyMinTokensOut: devBuy ? devBuy.tokensOut : 0n,
		deadline: BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS),
	};
	const data = encodeFunctionData({ abi: launchpadAbi, functionName: 'launch', args: [params] });

	const [balanceWei, gasPrice] = await Promise.all([client.getBalance({ address }), client.getGasPrice()]);
	let gas = MEASURED_LAUNCH_GAS;
	let estimated = false;
	const canSimulate = balanceWei >= launchFeeWei && (!devBuy || (!devBuy.needsApproval && devBuy.balance >= devBuy.quoteIn));
	if (canSimulate) {
		try {
			gas = await client.estimateGas({ account: address, to: lp, data, value: launchFeeWei });
			estimated = true;
		} catch (err) {
			throw new PairedMarketError(`The launchpad would reject this launch: ${err.shortMessage || err.message}`, 422);
		}
	}
	const gasLimit = (gas * GAS_HEADROOM_BPS) / 10_000n;
	const approveGas = devBuy?.needsApproval ? (MEASURED_APPROVE_GAS * GAS_HEADROOM_BPS) / 10_000n : 0n;
	const gasWei = (gasLimit + approveGas) * gasPrice;
	const totalWei = launchFeeWei + gasWei;

	const blockers = [];
	if (balanceWei < totalWei) {
		blockers.push(`Fund ${address} with at least ${formatEther(totalWei - balanceWei)} more ETH on Robinhood Chain.`);
	}
	if (devBuy && devBuy.balance < devBuy.quoteIn) {
		blockers.push(
			`The opening buy needs ${formatUnits(devBuy.quoteIn - devBuy.balance, devBuy.market.decimals)} more ${devBuy.market.symbol} in ${address}.`,
		);
	}
	return {
		name, symbol, description, image, links, allocations, config, address, descriptor, params, data,
		launchFeeWei, devBuy, balanceWei, gasLimit, approveGas, gasPrice, gasWei, totalWei, estimated, blockers,
	};
}

/** USD that leaves the agent's control: the fee and the opening buy. Gas is network cost. */
function spendUsd(p, price) {
	if (price == null) return null;
	let usd = Number(formatEther(p.launchFeeWei)) * price;
	if (p.devBuy) {
		if (p.devBuy.market.priceUsd == null) return null;
		usd += Number(formatUnits(p.devBuy.quoteIn, p.devBuy.market.decimals)) * p.devBuy.market.priceUsd;
	}
	return round2(usd);
}

function describe(agent, p, price) {
	return {
		chain: CHAIN.slug,
		chain_id: CHAIN.chainId,
		venue: PAIRED_VENUE,
		launchpad: launchpadAddress(),
		agent: { id: agent.id, name: agent.name },
		wallet: { address: p.address, balance_eth: formatEther(p.balanceWei), explorer: explorerAddress(CHAIN, p.address) },
		coin: {
			name: p.name,
			symbol: p.symbol,
			description: p.description || null,
			image_url: p.image || null,
			socials: p.links,
			total_supply: formatUnits(TOTAL_SUPPLY, TOKEN_DECIMALS),
			metadata_uri: p.descriptor.url,
			metadata_hash: p.descriptor.hash,
		},
		pairs: p.allocations.map((a) => ({
			quote_token: a.quoteToken,
			symbol: a.symbol,
			asset_class: a.assetClass,
			canonical: a.canonical,
			weight_pct: a.weightBps / 100,
			supply: formatUnits((TOTAL_SUPPLY * BigInt(a.weightBps)) / BigInt(BPS), TOKEN_DECIMALS),
			opening_value_usd: a.openingValueUsd != null ? round2(a.openingValueUsd) : null,
		})),
		terms: {
			launch_fee_eth: p.config.launchFeeEth,
			swap_fee_bps: p.config.swapFeeBps,
			creator_share_bps: p.config.creatorShareBps,
		},
		opening_buy: p.devBuy
			? {
				market: p.devBuy.market.symbol,
				amount: formatUnits(p.devBuy.quoteIn, p.devBuy.market.decimals),
				tokens: formatUnits(p.devBuy.tokensOut, TOKEN_DECIMALS),
				pct_of_supply: Number((p.devBuy.tokensOut * 1_000_000n) / TOTAL_SUPPLY) / 10_000,
				needs_approval: p.devBuy.needsApproval,
			}
			: null,
		cost: {
			launch_fee_eth: formatEther(p.launchFeeWei),
			gas_eth: formatEther(p.gasWei),
			gas_estimated: p.estimated,
			total_eth: formatEther(p.totalWei),
			total_usd: spendUsd(p, price) != null && price != null ? round2(spendUsd(p, price) + Number(formatEther(p.gasWei)) * price) : null,
			eth_usd: price,
		},
		ready: p.blockers.length === 0,
		blockers: p.blockers,
	};
}

/** Price, policy and funding check for a paired launch, without signing anything. */
export async function quotePairedLaunch({ agentId, userId, input }) {
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

async function agentAccount(agent, userId, reason, meta) {
	const pk = await recoverAgentKey(agent.meta.encrypted_wallet_key, { agentId: agent.id, userId, reason, meta: { chain: CHAIN.slug, ...meta } });
	const account = privateKeyToAccount(pk);
	if (getAddress(account.address) !== getAddress(agent.wallet_address)) {
		throw new EvmLegError('wallet_mismatch', 'The stored key does not match this agent\'s wallet address.', 500);
	}
	return account;
}

/**
 * Sign and send a paired launch from the agent's custodial wallet. Returns the
 * new coin, its pairs, the transaction and the opening fill.
 */
export async function launchPaired({ agentId, userId, input, req = null }) {
	await assertPlatformSigningAllowed(agentId);
	const agent = await loadOwnedAgent(agentId, userId);
	const [p, price] = await Promise.all([prepare(agent, input), ethUsd()]);
	if (p.blockers.length) throw new EvmLegError('launch_blocked', p.blockers.join(' '), 409, { blockers: p.blockers });

	const usd = spendUsd(p, price);
	await enforceEvmSpend({ agentId, meta: agent.meta, chain: LEDGER_CHAIN, usdValue: usd, category: 'launch' });
	await storeDescriptor(p.descriptor);

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
		destination: launchpadAddress(),
		reason: 'paired.launch',
		status: 'pending',
		meta: {
			venue: PAIRED_VENUE,
			name: p.name,
			symbol: p.symbol,
			pairs: p.allocations.map((a) => `${a.symbol}:${a.weightBps}`),
			opening_buy: p.devBuy ? { market: p.devBuy.market.quoteToken, raw: p.devBuy.quoteIn.toString() } : null,
		},
	});

	let account;
	try {
		account = await agentAccount(agent, userId, 'paired.launch', { symbol: p.symbol });
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: err.code || 'key_recover_failed' } });
		throw err;
	}
	const wallet = evmLegWalletClient(CHAIN, account);
	const client = evmLegPublicClient(CHAIN);

	let hash;
	try {
		if (p.devBuy?.needsApproval) {
			// Exactly the opening buy, never an unlimited approval.
			const approveHash = await wallet.writeContract({
				address: p.devBuy.market.quoteToken,
				abi: erc20Abi,
				functionName: 'approve',
				args: [launchpadAddress(), p.devBuy.quoteIn],
				gas: p.approveGas,
			});
			const approval = await client.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 });
			if (approval.status !== 'success') throw new Error(`the ${p.devBuy.market.symbol} approval reverted`);
		}
		hash = await wallet.sendTransaction({ to: launchpadAddress(), data: p.data, value: p.launchFeeWei, gas: p.gasLimit });
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: String(err.shortMessage || err.message).slice(0, 300) } });
		throw new EvmLegError('send_failed', `The launch was not sent: ${err.shortMessage || err.message}`, 502);
	}

	const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
	if (receipt.status !== 'success') {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'reverted' } });
		throw new EvmLegError('launch_reverted', 'The launch transaction reverted on chain. Only gas was spent.', 502, {
			tx_hash: hash,
			explorer: explorerTx(CHAIN, hash),
		});
	}
	const [launched] = parseEventLogs({ abi: [launchedEvent], logs: receipt.logs, eventName: 'Launched' });
	if (!launched) {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'no_launch_event' } });
		throw new EvmLegError('launch_unreadable', 'The transaction landed but emitted no launch.', 502, { tx_hash: hash });
	}
	const token = getAddress(launched.args.token);
	await updateCustodyEvent(custodyId, { status: 'confirmed', signature: hash, meta: { token } });

	const coinPath = pairedCoinUrl(token);
	await sql`
		INSERT INTO fixed_supply_launches
			(agent_id, user_id, network, chain, venue, mint, name, symbol, image_url, description,
			 creator_address, token_allocation, signatures, venue_url)
		VALUES
			(${agentId}, ${userId}, 'mainnet', ${CHAIN.slug}, ${PAIRED_VENUE}, ${token},
			 ${p.name}, ${p.symbol}, ${p.image || null}, ${p.description || null},
			 ${p.address}, ${(TOTAL_SUPPLY / 10n ** 18n).toString()}, ${JSON.stringify([hash])}::jsonb,
			 ${`https://three.ws${coinPath}`})
		ON CONFLICT (mint, network) DO NOTHING
	`.catch((e) => console.error('[paired/launch] directory insert failed', e?.message));

	import('../audit.js')
		.then(({ logAudit }) => logAudit({ userId, action: 'agent.paired_launch', resourceId: agentId, meta: { token, tx: hash }, req }))
		.catch(() => {});

	return {
		chain: CHAIN.slug,
		chain_id: CHAIN.chainId,
		venue: PAIRED_VENUE,
		token,
		name: p.name,
		symbol: p.symbol,
		pairs: p.allocations.map((a) => ({ quote_token: a.quoteToken, symbol: a.symbol, weight_pct: a.weightBps / 100 })),
		tx_hash: hash,
		block: Number(receipt.blockNumber),
		gas_used: receipt.gasUsed.toString(),
		spent_eth: formatEther(p.launchFeeWei + receipt.gasUsed * receipt.effectiveGasPrice),
		spent_usd: usd,
		opening_buy: p.devBuy
			? { market: p.devBuy.market.symbol, amount: formatUnits(p.devBuy.quoteIn, p.devBuy.market.decimals), tokens: formatUnits(p.devBuy.tokensOut, TOKEN_DECIMALS) }
			: null,
		urls: { coin: coinPath, explorer: explorerTx(CHAIN, hash), metadata: p.descriptor.url },
	};
}

/** Swap fees this agent's wallet has earned as a paired-coin creator, per quote asset. */
export async function pairedFeesFor({ agentId, userId }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const address = getAddress(agent.wallet_address);
	return { wallet: address, claimable: await claimableFees(address) };
}

/**
 * Claim every quote asset the agent has earned in, in one transaction. Moves
 * funds INTO the agent's wallet, so no spend ceiling applies; the signature is
 * still custodial and audited.
 */
export async function claimPairedFees({ agentId, userId, req = null }) {
	await assertPlatformSigningAllowed(agentId);
	const agent = await loadOwnedAgent(agentId, userId);
	const address = getAddress(agent.wallet_address);
	const owed = await claimableFees(address);
	if (!owed.length) throw new EvmLegError('nothing_to_claim', 'This agent has no paired-coin fees to claim yet.', 409);

	const client = evmLegPublicClient(CHAIN);
	const data = encodeFunctionData({ abi: launchpadAbi, functionName: 'claimFees', args: [owed.map((o) => o.quoteToken)] });
	const [balanceWei, gasPrice, gas] = await Promise.all([
		client.getBalance({ address }),
		client.getGasPrice(),
		client.estimateGas({ account: address, to: launchpadAddress(), data }).catch((err) => {
			throw new EvmLegError('simulation_failed', `The claim would fail: ${err.shortMessage || err.message}`, 422);
		}),
	]);
	const gasLimit = (gas * GAS_HEADROOM_BPS) / 10_000n;
	if (balanceWei < gasLimit * gasPrice) {
		throw new EvmLegError('needs_gas', `Fund ${address} with at least ${formatEther(gasLimit * gasPrice - balanceWei)} ETH on Robinhood Chain to pay the claim's gas.`, 409);
	}

	const account = await agentAccount(agent, userId, 'paired.claim_fees', { assets: owed.length });
	const hash = await evmLegWalletClient(CHAIN, account).sendTransaction({ to: launchpadAddress(), data, gas: gasLimit });
	const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
	if (receipt.status !== 'success') {
		throw new EvmLegError('claim_reverted', 'The claim reverted on chain. Only gas was spent.', 502, { tx_hash: hash, explorer: explorerTx(CHAIN, hash) });
	}
	await recordCustodyEvent({
		agentId,
		userId,
		eventType: 'receive',
		category: 'fees',
		chain: CHAIN.slug,
		network: CHAIN.slug,
		signature: hash,
		reason: 'paired.claim_fees',
		status: 'confirmed',
		meta: { venue: PAIRED_VENUE, claimed: owed },
	}).catch((e) => console.error('[paired/claim] custody row failed', e?.message));
	import('../audit.js')
		.then(({ logAudit }) => logAudit({ userId, action: 'agent.paired_claim_fees', resourceId: agentId, meta: { tx: hash, assets: owed.length }, req }))
		.catch(() => {});

	return { wallet: address, claimed: owed, tx_hash: hash, explorer: explorerTx(CHAIN, hash) };
}
