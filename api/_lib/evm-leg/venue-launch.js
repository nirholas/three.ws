// Launch a bonding-curve coin on flap.sh (BNB Chain, Base, Robinhood Chain) or
// four.meme (BNB Chain), from an agent's custodial EVM wallet or from the
// creator's own wallet, for the multichain launchpad.
//
// Custodial launches follow the gate order every other EVM-leg spend uses (see
// uniswap-launch.js): the agent belongs to the caller and is in
// platform-signing mode, the spend passes the agent's policy for that chain,
// the wallet covers value and gas, the transaction simulates, and only then is
// the key decrypted (with an audit row). The spend is written to the custody
// ledger as pending before the send and settled after the receipt; the launch
// record (api/_lib/evm-launch-records.js) lets a client that timed out learn
// the outcome, and settleVenueLaunch finishes it later.
//
// Wallet launches are signed in the creator's browser. The server prepares the
// flap transaction (metadata pinned, vanity salt ground) and, for both venues,
// only records a coin after reading the mined receipt: the transaction must be
// to the venue contract, from the wallet the creator proved they control (a
// signed three.ws message), and the venue's own creation event must name that
// wallet as creator.
//
// The spend a launch makes is its value: an optional opening buy plus, on
// four.meme, the platform fee. Gas is network cost and is quoted separately.

import { encodeFunctionData, formatEther, getAddress, parseEther, parseEventLogs } from 'viem';
import { randomBytes } from 'node:crypto';

import { sql } from '../db.js';
import { fetchUpstreamPublic } from '../upstream-fetch.js';
import { fetchCoinPriceUsd } from '../market-fallbacks.js';
import { assertPlatformSigningAllowed } from '../custody/signing.js';
import { recordCustodyEvent, updateCustodyEvent } from '../agent-trade-guards.js';
import { PairedMarketError } from '../paired-markets.js';
import {
	EVM_LEG_CHAINS, EvmLegError, evmLegPublicClient, evmLegWalletClient, explorerAddress, explorerTx, nativeCurrency, nativePriceId,
} from './chains.js';
import { checkEvmSpend, enforceEvmSpend, getDailyEvmSpendUsd, getEvmSpendLimits, normalizeEvmAddress } from './guards.js';
import { GAS_HEADROOM_BPS, LIMITS, agentAccount, defaultLogo, httpsOrNull, loadOwnedAgent, round2, sanitizeName, sanitizeSymbol } from './paired-launch.js';
import {
	DEFAULT_FLAP_TAX_BPS, FLAP_CHAIN_SLUGS, FLAP_GRADUATION_LABEL, FLAP_TAX_OPTIONS_BPS, FLAP_TOTAL_SUPPLY_WHOLE, FLAP_VENUE, TAX_SUFFIX,
	buildFlapParams, encodeFlapLaunch, findVanitySalt, flapCoinUrl, flapDeployment, flapTokenCreatedEvent, uploadFlapMetadata,
} from './flap-config.js';
import {
	FOUR_MEME_CHAIN, FOUR_MEME_GRADUATION_LABEL, FOUR_MEME_LABELS, FOUR_MEME_TOTAL_SUPPLY_WHOLE, FOUR_MEME_VENUE, MAX_FOUR_MEME_PRESALE_BNB,
	MEASURED_FOUR_MEME_GAS, TOKEN_MANAGER2, fourMemeCoinUrl, isFourMemeLoginMessage, fourMemeValueWei, readFourMemeFees, toHexBytes, tokenCreateEvent, tokenManager2Abi,
} from './four-meme-config.js';
import { markSubjectFailed, markSubjectLive, markSubjectSubmitted, subjectImage, subjectUrl } from '../launch-subjects.js';

export const VENUES = Object.freeze({
	[FLAP_VENUE]: Object.freeze({ id: FLAP_VENUE, label: 'flap.sh', chains: FLAP_CHAIN_SLUGS }),
	[FOUR_MEME_VENUE]: Object.freeze({ id: FOUR_MEME_VENUE, label: 'four.meme', chains: [FOUR_MEME_CHAIN.slug] }),
});

// Measured by simulating newTokenV6 against the live Portals: 4.8M (Base) to
// 5.5M (BNB Chain). Used only when the wallet is too empty to estimate.
const MEASURED_FLAP_GAS = 6_000_000n;
// Opening-buy ceilings per gas coin, so a typo cannot drain a wallet. The
// agent's spend policy still applies under these.
const MAX_OPENING_BUY = Object.freeze({ BNB: 5, ETH: 1 });
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const RECEIPT_TIMEOUT_MS = 60_000;

const noStage = async () => {};

/** The chain and venue a request names, or a refusal naming what is supported. */
export function resolveVenue(venueId, chainSlug) {
	const venue = VENUES[venueId];
	if (!venue) throw new PairedMarketError(`venue must be one of ${Object.keys(VENUES).join(', ')}.`);
	const slug = String(chainSlug || venue.chains[0]).toLowerCase();
	if (!venue.chains.includes(slug)) throw new PairedMarketError(`${venue.label} launches on ${venue.chains.map((c) => EVM_LEG_CHAINS[c].name).join(', ')} only.`);
	return { venue, chain: EVM_LEG_CHAINS[slug] };
}

export async function nativeUsd(chain) {
	const id = nativePriceId(chain);
	if (!id) return null;
	try {
		return await fetchCoinPriceUsd(id);
	} catch {
		return null;
	}
}

function parseOpeningBuy(raw, chain) {
	const text = String(raw ?? '').trim();
	if (!text || Number(text) === 0) return 0n;
	if (!/^\d+(\.\d{1,18})?$/.test(text)) throw new PairedMarketError('The opening buy must be a plain number.');
	const symbol = nativeCurrency(chain).symbol;
	const cap = symbol === 'BNB' ? MAX_FOUR_MEME_PRESALE_BNB : MAX_OPENING_BUY[symbol] ?? 1;
	if (Number(text) > cap) throw new PairedMarketError(`The opening buy is capped at ${cap} ${symbol}.`);
	return parseEther(text);
}

function parseTax(raw) {
	const bps = raw == null || raw === '' ? DEFAULT_FLAP_TAX_BPS : Number(raw);
	if (!FLAP_TAX_OPTIONS_BPS.includes(bps)) throw new PairedMarketError(`The flap trading tax must be one of ${FLAP_TAX_OPTIONS_BPS.map((b) => `${b / 100}%`).join(', ')}.`);
	return bps;
}

/**
 * The coin's display fields. The website defaults to the coin's three.ws
 * showcase page, so the coin always links back to its agent, avatar or dance.
 */
async function coinFields(input, { subject, agent }) {
	const name = sanitizeName(input.name);
	const symbol = sanitizeSymbol(input.symbol);
	if (!name) throw new PairedMarketError('The coin needs a name.');
	if (symbol.length < 2) throw new PairedMarketError('The ticker needs at least two letters or digits.');
	const description = String(input.description ?? '').trim();
	if (description.length > LIMITS.description) throw new PairedMarketError(`The description must be ${LIMITS.description} characters or fewer.`);
	const links = {
		website: httpsOrNull(input.socials?.website, 'The website link') || (subject ? subjectUrl(subject.id) : agent ? `https://three.ws/agents/${agent.id}` : null),
		twitter: httpsOrNull(input.socials?.twitter, 'The X link'),
		telegram: httpsOrNull(input.socials?.telegram, 'The Telegram link'),
	};
	let image = httpsOrNull(input.image_url, 'The logo link');
	if (!image && subject) image = await subjectImage(subject);
	if (!image && agent) image = defaultLogo(agent);
	return { name, symbol, description, links, image };
}

/** Fetch logo bytes for a venue that hosts its own copy (SSRF-checked on every hop). */
export async function loadImageBytes(url) {
	if (!url) throw new PairedMarketError('The coin needs a logo. Add an image link or pick an avatar with a thumbnail.');
	const resp = await fetchUpstreamPublic(url, {}, { name: 'venue-launch:logo', timeoutMs: 15_000, attempts: 2, okWhen: (r) => r.ok });
	const type = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	const ext = IMAGE_TYPES[type];
	if (!ext) throw new PairedMarketError('The logo must be a PNG, JPEG, WebP or GIF image.');
	const bytes = Buffer.from(await resp.arrayBuffer());
	if (bytes.byteLength > MAX_IMAGE_BYTES) throw new PairedMarketError('The logo must be under 4 MB.');
	return { bytes, contentType: type, filename: `logo.${ext}` };
}

// A quote simulates the launch with a real vanity salt but placeholder
// metadata, so it proves the Portal would accept these parameters without
// pinning anything. One salt per chain per process is enough: quotes never
// send, and a launch always grinds its own.
const quoteSalts = new Map();
function quoteSalt(slug) {
	if (!quoteSalts.has(slug)) {
		const d = flapDeployment(slug);
		quoteSalts.set(slug, findVanitySalt({ portal: d.portal, impl: d.taxImpl }).salt);
	}
	return quoteSalts.get(slug);
}

function placeholderMeta() {
	// Same length as a CIDv1 so calldata, and so gas, matches a real launch.
	return `bafkrei${randomBytes(26).toString('hex')}`.slice(0, 59);
}

async function fundingAndGas({ chain, from, to, data, value, measuredGas, simulate }) {
	const client = evmLegPublicClient(chain);
	const [balanceWei, gasPrice] = await Promise.all([client.getBalance({ address: from }), client.getGasPrice()]);
	let gas = measuredGas;
	let estimated = false;
	if (simulate && balanceWei >= value) {
		try {
			gas = await client.estimateGas({ account: from, to, data, value });
			estimated = true;
		} catch (err) {
			throw new PairedMarketError(`The venue would reject this launch: ${err.shortMessage || err.message}`, 422);
		}
	}
	const gasLimit = (gas * GAS_HEADROOM_BPS) / 10_000n;
	const gasWei = gasLimit * gasPrice;
	return { balanceWei, gasPrice, gasLimit, gasWei, estimated };
}

/**
 * Everything a launch needs except the signature. `final` pins the metadata
 * and grinds a fresh salt (launch and wallet prepare); a quote does neither.
 */
async function prepare({ venueId, chainSlug, input, creator, subject = null, agent = null, final = false }) {
	const { venue, chain } = resolveVenue(venueId, chainSlug);
	const coin = await coinFields(input, { subject, agent });
	const valueIn = parseOpeningBuy(input.opening_buy, chain);
	const symbol = nativeCurrency(chain).symbol;
	const blockers = [];

	if (venue.id === FLAP_VENUE) {
		const d = flapDeployment(chain.slug);
		const taxBps = parseTax(input.tax_bps);
		let meta = placeholderMeta();
		let salt;
		let predicted = null;
		if (final) {
			const img = await loadImageBytes(coin.image);
			meta = await uploadFlapMetadata({ image: img.bytes, contentType: img.contentType, filename: img.filename, description: coin.description, ...coin.links });
			const ground = findVanitySalt({ portal: d.portal, impl: d.taxImpl, suffix: TAX_SUFFIX });
			salt = ground.salt;
			predicted = ground.token;
		} else {
			salt = quoteSalt(chain.slug);
		}
		const params = buildFlapParams({ name: coin.name, symbol: coin.symbol, meta, salt, beneficiary: creator, taxBps, quoteAmt: valueIn });
		const data = encodeFlapLaunch(params);
		const g = await fundingAndGas({ chain, from: creator, to: d.portal, data, value: valueIn, measuredGas: MEASURED_FLAP_GAS, simulate: true });
		const totalWei = valueIn + g.gasWei;
		if (g.balanceWei < totalWei) blockers.push(`Fund ${creator} with at least ${formatEther(totalWei - g.balanceWei)} more ${symbol} on ${chain.name}.`);
		return { venue, chain, coin, creator, to: d.portal, data, value: valueIn, openingBuyWei: valueIn, platformFeeWei: 0n, taxBps, meta, salt, predicted, ...g, totalWei, blockers };
	}

	// four.meme
	const client = evmLegPublicClient(chain);
	const fees = await readFourMemeFees(client);
	const value = fourMemeValueWei({ launchFeeWei: fees.launchFeeWei, presaleWei: valueIn, tradingFeeRateBps: fees.tradingFeeRateBps });
	const label = FOUR_MEME_LABELS.includes(input.label) ? input.label : 'AI';
	const createArg = input.four_meme?.create_arg ? toHexBytes(input.four_meme.create_arg) : null;
	const platformSig = input.four_meme?.signature ? toHexBytes(input.four_meme.signature) : null;
	if (final && (!createArg || !platformSig)) {
		throw new PairedMarketError('four.meme did not return a signed launch. Sign in to four.meme again and retry.');
	}
	const data = createArg && platformSig ? encodeFunctionData({ abi: tokenManager2Abi, functionName: 'createToken', args: [createArg, platformSig] }) : null;
	const g = await fundingAndGas({ chain, from: creator, to: TOKEN_MANAGER2, data, value, measuredGas: MEASURED_FOUR_MEME_GAS, simulate: Boolean(data) });
	const totalWei = value + g.gasWei;
	if (g.balanceWei < totalWei) blockers.push(`Fund ${creator} with at least ${formatEther(totalWei - g.balanceWei)} more ${symbol} on ${chain.name}.`);
	const tradingFeeWei = valueIn > 0n ? (valueIn * BigInt(fees.tradingFeeRateBps)) / 10_000n : 0n;
	return {
		venue, chain, coin, creator, to: TOKEN_MANAGER2, data, value, openingBuyWei: valueIn, platformFeeWei: fees.launchFeeWei, tradingFeeWei,
		tradingFeeRateBps: fees.tradingFeeRateBps, label, ...g, totalWei, blockers,
	};
}

function spendUsd(p, price) {
	if (p.value === 0n) return 0;
	return price == null ? null : round2(Number(formatEther(p.value)) * price);
}

function describe(p, price, { signer, agent = null }) {
	const symbol = nativeCurrency(p.chain).symbol;
	const usd = (wei) => (price == null ? null : round2(Number(formatEther(wei)) * price));
	const flap = p.venue.id === FLAP_VENUE;
	const fees = [
		{ id: 'opening_buy', label: 'Opening buy', paid_by: 'creator', native: formatEther(p.openingBuyWei), usd: usd(p.openingBuyWei), note: 'Optional. Buys the first coins off the curve into the creator wallet.' },
	];
	if (!flap) {
		fees.push({ id: 'launch', label: 'four.meme launch fee', paid_by: 'creator', native: formatEther(p.platformFeeWei), usd: usd(p.platformFeeWei) });
		fees.push({ id: 'trading_fee', label: 'four.meme trading fee on the opening buy', paid_by: 'creator', bps: p.tradingFeeRateBps, native: formatEther(p.tradingFeeWei), usd: usd(p.tradingFeeWei) });
	} else {
		fees.push({ id: 'tax', label: 'Buy and sell tax on the coin', paid_by: 'traders', bps: p.taxBps, note: 'Paid to the creator wallet on every trade, for the life of the coin.' });
	}
	fees.push({ id: 'gas', label: 'Gas', paid_by: 'creator', native: formatEther(p.gasWei), usd: usd(p.gasWei), estimated: p.estimated });
	return {
		lane: p.venue.id,
		venue: p.venue.id,
		venue_label: p.venue.label,
		chain: p.chain.slug,
		chain_name: p.chain.name,
		chain_id: p.chain.chainId,
		contract: p.to,
		signer,
		agent: agent ? { id: agent.id, name: agent.name } : null,
		wallet: { address: p.creator, balance: formatEther(p.balanceWei), symbol, explorer: explorerAddress(p.chain, p.creator) },
		coin: {
			name: p.coin.name,
			symbol: p.coin.symbol,
			description: p.coin.description || null,
			image_url: p.coin.image || null,
			socials: p.coin.links,
			total_supply: (flap ? FLAP_TOTAL_SUPPLY_WHOLE : FOUR_MEME_TOTAL_SUPPLY_WHOLE).toString(),
			...(flap ? { tax_bps: p.taxBps } : { label: p.label }),
		},
		curve: { quote_asset: symbol, graduation: flap ? FLAP_GRADUATION_LABEL : FOUR_MEME_GRADUATION_LABEL },
		fees,
		cost: {
			value: formatEther(p.value),
			gas: formatEther(p.gasWei),
			gas_estimated: p.estimated,
			total: formatEther(p.totalWei),
			symbol,
			native_usd: price,
			total_usd: usd(p.totalWei),
		},
		ready: p.blockers.length === 0,
		blockers: p.blockers,
	};
}

/** Price, policy and funding check for an agent-signed venue launch. Signs nothing. */
export async function quoteVenueLaunch({ agentId, userId, input, subject = null }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const creator = getAddress(agent.wallet_address);
	const { chain } = resolveVenue(input.venue, input.chain);
	const [p, price] = await Promise.all([prepare({ venueId: input.venue, chainSlug: chain.slug, input, creator, subject, agent }), nativeUsd(chain)]);
	const out = describe(p, price, { signer: 'agent', agent });
	const limits = getEvmSpendLimits(agent.meta);
	const spentTodayUsd = await getDailyEvmSpendUsd(agentId, chain.slug);
	const blocked = checkEvmSpend({ limits, usdValue: spendUsd(p, price), spentTodayUsd, category: 'launch', chainName: chain.name });
	if (blocked) {
		out.blockers.push(blocked.message);
		out.ready = false;
	}
	out.policy = { per_tx_usd: limits.per_tx_usd, daily_usd: limits.daily_usd, spent_today_usd: spentTodayUsd };
	return out;
}

/** Price and funding check for a launch the creator signs with their own wallet. */
export async function quoteWalletVenueLaunch({ input, wallet, subject = null }) {
	const creator = normalizeEvmAddress(wallet);
	if (!creator) throw new PairedMarketError('Connect an EVM wallet first.');
	const { chain } = resolveVenue(input.venue, input.chain);
	const [p, price] = await Promise.all([prepare({ venueId: input.venue, chainSlug: chain.slug, input, creator: getAddress(creator), subject }), nativeUsd(chain)]);
	return describe(p, price, { signer: 'wallet' });
}

/**
 * Sign and send a venue launch from the agent's custodial wallet. `stage`
 * reports progress to the launch record.
 */
export async function launchVenueCustodial({ agentId, userId, input, subject = null, req = null, stage = noStage }) {
	await assertPlatformSigningAllowed(agentId);
	const agent = await loadOwnedAgent(agentId, userId);
	const creator = getAddress(agent.wallet_address);
	const { chain } = resolveVenue(input.venue, input.chain);
	const ledgerChain = { key: chain.slug, name: chain.name };
	const price = await nativeUsd(chain);

	// Policy is checked before anything is pinned or ground: a refused launch
	// leaves nothing behind.
	const quoted = await prepare({ venueId: input.venue, chainSlug: chain.slug, input, creator, subject, agent });
	if (quoted.blockers.length) throw new EvmLegError('launch_blocked', quoted.blockers.join(' '), 409, { blockers: quoted.blockers });
	const usd = spendUsd(quoted, price);
	await enforceEvmSpend({ agentId, meta: agent.meta, chain: ledgerChain, usdValue: usd, category: 'launch' });
	await stage('policy_checked', { detail: { spend_usd: usd } });

	const p = quoted.venue.id === FLAP_VENUE ? await prepare({ venueId: input.venue, chainSlug: chain.slug, input, creator, subject, agent, final: true }) : quoted;
	if (p.blockers.length) throw new EvmLegError('launch_blocked', p.blockers.join(' '), 409, { blockers: p.blockers });
	if (!p.data) throw new EvmLegError('launch_blocked', 'four.meme did not return a signed launch.', 409);

	const symbol = nativeCurrency(chain).symbol;
	const custodyId = await recordCustodyEvent({
		agentId,
		userId,
		eventType: 'spend',
		category: 'launch',
		chain: chain.slug,
		network: chain.slug,
		asset: symbol,
		amountRaw: p.value.toString(),
		usd,
		destination: p.to,
		reason: `${p.venue.id}.launch`,
		status: 'pending',
		meta: { venue: p.venue.id, name: p.coin.name, symbol: p.coin.symbol, subject_id: subject?.id || null },
	});
	const context = {
		custody_id: custodyId,
		agent_id: agentId,
		user_id: userId,
		subject_id: subject?.id || null,
		venue: p.venue.id,
		chain: chain.slug,
		contract: p.to,
		name: p.coin.name,
		symbol: p.coin.symbol,
		image: p.coin.image || null,
		description: p.coin.description || null,
		wallet: creator,
		meta: p.meta || null,
		predicted: p.predicted || null,
		tax_bps: p.taxBps ?? null,
		value_wei: p.value.toString(),
		spend_usd: usd,
	};
	await stage('reserved', { context });

	let account;
	try {
		account = await agentAccount(agent, userId, `${p.venue.id}.launch`, { symbol: p.coin.symbol, chain: chain.slug });
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: err.code || 'key_recover_failed' } });
		throw err;
	}
	let hash;
	try {
		hash = await evmLegWalletClient(chain, account).sendTransaction({ to: p.to, data: p.data, value: p.value, gas: p.gasLimit });
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: String(err.shortMessage || err.message).slice(0, 300) } });
		throw new EvmLegError('send_failed', `The launch was not sent: ${err.shortMessage || err.message}`, 502);
	}
	await stage('submitted', { status: 'submitted', txHash: hash, detail: { explorer: explorerTx(chain, hash) } });
	if (subject) await markSubjectSubmitted(subject.id, { txHash: hash }).catch(() => {});

	const receipt = await evmLegPublicClient(chain).waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
	return finishVenue({ context, hash, receipt, stage, req });
}

/** The venue's creation event in a receipt, emitted by the venue contract itself. */
export function readCreation({ venueId, contract, receipt }) {
	const own = receipt.logs.filter((l) => l.address && l.address.toLowerCase() === contract.toLowerCase());
	if (venueId === FLAP_VENUE) {
		const [ev] = parseEventLogs({ abi: [flapTokenCreatedEvent], logs: own, eventName: 'TokenCreated' });
		return ev ? { token: getAddress(ev.args.token), creator: getAddress(ev.args.creator), name: ev.args.name, symbol: ev.args.symbol, meta: ev.args.meta } : null;
	}
	const [ev] = parseEventLogs({ abi: [tokenCreateEvent], logs: own, eventName: 'TokenCreate' });
	return ev ? { token: getAddress(ev.args.token), creator: getAddress(ev.args.creator), name: ev.args.name, symbol: ev.args.symbol, meta: null } : null;
}

export function venueCoinUrl(venueId, chainSlug, token) {
	return venueId === FLAP_VENUE ? flapCoinUrl(chainSlug, token) : fourMemeCoinUrl(token);
}

async function listCoin({ agentId, userId, chain, venueId, token, context, hash }) {
	await sql`
		INSERT INTO fixed_supply_launches
			(agent_id, user_id, network, chain, venue, mint, name, symbol, image_url, description,
			 creator_address, token_allocation, signatures, venue_url)
		VALUES
			(${agentId}, ${userId}, 'mainnet', ${chain.slug}, ${venueId}, ${token},
			 ${context.name}, ${context.symbol}, ${context.image}, ${context.description},
			 ${context.wallet}, ${(venueId === FLAP_VENUE ? FLAP_TOTAL_SUPPLY_WHOLE : FOUR_MEME_TOTAL_SUPPLY_WHOLE).toString()},
			 ${JSON.stringify([hash])}::jsonb, ${venueCoinUrl(venueId, chain.slug, token)})
		ON CONFLICT (mint, network) DO NOTHING
	`.catch((e) => console.error('[venue-launch] directory insert failed', e?.message));
}

function resultOf({ context, chain, token, hash, receipt }) {
	return {
		lane: context.venue,
		venue: context.venue,
		chain: chain.slug,
		chain_id: chain.chainId,
		token,
		name: context.name,
		symbol: context.symbol,
		subject_id: context.subject_id || null,
		tx_hash: hash,
		block: Number(receipt.blockNumber),
		gas_used: receipt.gasUsed.toString(),
		spent: formatEther(BigInt(context.value_wei || '0') + receipt.gasUsed * receipt.effectiveGasPrice),
		spent_usd: context.spend_usd ?? null,
		urls: {
			venue: venueCoinUrl(context.venue, chain.slug, token),
			token: explorerAddress(chain, token),
			explorer: explorerTx(chain, hash),
			showcase: context.subject_id ? subjectUrl(context.subject_id) : null,
		},
	};
}

/** Read the coin off a mined custodial launch, settle the ledger and list it. */
async function finishVenue({ context, hash, receipt, stage = noStage, req = null }) {
	const chain = EVM_LEG_CHAINS[context.chain];
	const { custody_id: custodyId, agent_id: agentId, user_id: userId } = context;
	if (receipt.status !== 'success') {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'reverted' } });
		if (context.subject_id) await markSubjectFailed(context.subject_id).catch(() => {});
		throw new EvmLegError('launch_reverted', 'The launch transaction reverted on chain. Only gas was spent.', 502, { tx_hash: hash, explorer: explorerTx(chain, hash) });
	}
	const created = readCreation({ venueId: context.venue, contract: context.contract, receipt });
	if (!created || created.creator !== getAddress(context.wallet)) {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: hash, meta: { error: 'no_launch_event' } });
		if (context.subject_id) await markSubjectFailed(context.subject_id).catch(() => {});
		throw new EvmLegError('launch_unreadable', 'The transaction landed but the venue recorded no launch by this wallet.', 502, { tx_hash: hash });
	}
	const { token } = created;
	await updateCustodyEvent(custodyId, { status: 'confirmed', signature: hash, meta: { token } });
	await stage('confirmed', { status: 'confirmed', token, detail: { block: Number(receipt.blockNumber) } });
	await listCoin({ agentId, userId, chain, venueId: context.venue, token, context, hash });
	if (context.subject_id) await markSubjectLive(context.subject_id, { token, txHash: hash, creatorAddress: context.wallet }).catch((e) => console.error('[venue-launch] subject update failed', e?.message));

	import('../audit.js')
		.then(({ logAudit }) => logAudit({ userId, action: `agent.${context.venue}_launch`, resourceId: agentId, meta: { token, tx: hash, chain: chain.slug }, req }))
		.catch(() => {});
	return resultOf({ context, chain, token, hash, receipt });
}

/** Lane settler for evm_launch_records rows of the flap and four.meme lanes. */
export async function settleVenueLaunch(row) {
	const chain = EVM_LEG_CHAINS[row.context?.chain || row.chain];
	if (!chain) return null;
	const receipt = await evmLegPublicClient(chain).getTransactionReceipt({ hash: row.tx_hash }).catch(() => null);
	if (!receipt) return null;
	try {
		return { result: await finishVenue({ context: row.context, hash: row.tx_hash, receipt }) };
	} catch (err) {
		return { error: { code: err.code || 'launch_failed', message: err.message, ...(err.detail ? { detail: err.detail } : {}) } };
	}
}

// ── wallet-signed launches ──────────────────────────────────────────────────

/** The message a creator signs to prove the wallet they launch from is theirs. */
export function walletOwnershipMessage({ subjectId, address, chain }) {
	return `three.ws launch ${subjectId}\nWallet: ${getAddress(address)}\nChain: ${chain}`;
}

export async function verifyWalletOwnership({ subjectId, address, chain, signature }) {
	const c = EVM_LEG_CHAINS[chain];
	if (!c || typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) return false;
	try {
		return await evmLegPublicClient(c).verifyMessage({ address: getAddress(address), message: walletOwnershipMessage({ subjectId, address, chain }), signature });
	} catch {
		return false;
	}
}

/**
 * Build the transaction a creator's wallet signs. flap: metadata pinned and
 * salt ground here, returned as a ready transaction. four.meme: the creator's
 * browser gets createArg from four.meme, so this returns the value to send.
 */
export async function prepareWalletVenueLaunch({ input, wallet, subject }) {
	const creator = getAddress(wallet);
	const { venue, chain } = resolveVenue(input.venue, input.chain);
	const p = await prepare({ venueId: venue.id, chainSlug: chain.slug, input, creator, subject, final: venue.id === FLAP_VENUE });
	const price = await nativeUsd(chain);
	const out = describe(p, price, { signer: 'wallet' });
	out.tx = p.data
		? { chain_id: chain.chainId, to: p.to, data: p.data, value: `0x${p.value.toString(16)}`, gas: `0x${p.gasLimit.toString(16)}` }
		: { chain_id: chain.chainId, to: p.to, value: `0x${p.value.toString(16)}`, gas: `0x${p.gasLimit.toString(16)}` };
	out.prepared = { meta: p.meta || null, predicted: p.predicted || null, tax_bps: p.taxBps ?? null, value_wei: p.value.toString(), label: p.label || null };
	return out;
}

/**
 * Verify a wallet-signed launch from its receipt and list it. The checks bind
 * the transaction to this subject: sent to the venue contract, from the wallet
 * the creator proved, emitting the venue's creation event for that wallet, and
 * (flap) carrying the metadata this subject pinned, or (four.meme) the name
 * and ticker it staged.
 */
export async function confirmWalletVenueLaunch({ subject, txHash, userId }) {
	if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash || ''))) throw new PairedMarketError('tx_hash must be a 32-byte hex transaction hash.');
	if (subject.status === 'live') return { already: true, token: subject.token, tx_hash: subject.tx_hash };
	const chain = EVM_LEG_CHAINS[subject.chain];
	if (!chain || !VENUES[subject.venue] || subject.signer !== 'wallet' || !subject.creator_address) {
		throw new PairedMarketError('This launch was not prepared for a wallet signature.', 409);
	}
	const contract = subject.venue === FLAP_VENUE ? flapDeployment(chain.slug).portal : TOKEN_MANAGER2;
	const client = evmLegPublicClient(chain);
	const [tx, receipt] = await Promise.all([
		client.getTransaction({ hash: txHash }).catch(() => null),
		client.getTransactionReceipt({ hash: txHash }).catch(() => null),
	]);
	if (!tx || !receipt) throw Object.assign(new PairedMarketError('That transaction is not mined yet. Try again in a few seconds.', 404), { code: 'tx_not_found' });
	if (!tx.to || tx.to.toLowerCase() !== contract.toLowerCase()) throw new PairedMarketError(`That transaction was not sent to the ${VENUES[subject.venue].label} contract.`, 422);
	if (getAddress(tx.from) !== getAddress(subject.creator_address)) throw new PairedMarketError('That transaction was sent from a different wallet than this launch was prepared for.', 422);
	if (receipt.status !== 'success') {
		await markSubjectFailed(subject.id);
		throw new EvmLegError('launch_reverted', 'The launch transaction reverted on chain. Only gas was spent.', 422, { tx_hash: txHash, explorer: explorerTx(chain, txHash) });
	}
	const created = readCreation({ venueId: subject.venue, contract, receipt });
	if (!created || created.creator !== getAddress(subject.creator_address)) throw new PairedMarketError('The transaction landed but the venue recorded no launch by this wallet.', 422);
	if (subject.venue === FLAP_VENUE && subject.prepared?.meta && created.meta !== subject.prepared.meta) {
		throw new PairedMarketError('That flap launch carries different metadata than the one prepared here.', 422);
	}
	if (subject.venue === FOUR_MEME_VENUE && (created.symbol !== subject.symbol || sanitizeName(created.name) !== subject.name)) {
		throw new PairedMarketError('That four.meme launch has a different name or ticker than the one prepared here.', 422);
	}
	const context = { venue: subject.venue, name: subject.name, symbol: subject.symbol, image: subject.image_url, description: subject.description, wallet: getAddress(subject.creator_address), subject_id: subject.id, value_wei: tx.value.toString(), spend_usd: null };
	// A coin is attributed to the subject's agent only when the creator owns it;
	// subject agents are always owned (launch-subjects.js), so this is direct.
	await listCoin({ agentId: subject.agent_id || null, userId, chain, venueId: subject.venue, token: created.token, context, hash: txHash });
	await markSubjectLive(subject.id, { token: created.token, txHash, creatorAddress: context.wallet });
	import('../audit.js')
		.then(({ logAudit }) => logAudit({ userId, action: `wallet.${subject.venue}_launch`, resourceId: subject.id, meta: { token: created.token, tx: txHash, chain: chain.slug } }))
		.catch(() => {});
	return resultOf({ context, chain, token: created.token, hash: txHash, receipt });
}

/**
 * Sign four.meme's login message with an agent's key, so the creator's browser
 * can get four.meme's signed createArg for a coin that agent will launch. The
 * message text is pinned (isFourMemeLoginMessage): this is never a general
 * signing oracle. A login signature moves no funds.
 */
export async function signFourMemeLogin({ agentId, userId, message }) {
	if (!isFourMemeLoginMessage(message)) throw new PairedMarketError('Only the four.meme sign-in message can be signed with an agent key.', 422);
	await assertPlatformSigningAllowed(agentId);
	const agent = await loadOwnedAgent(agentId, userId);
	const account = await agentAccount(agent, userId, 'four_meme.login', { chain: FOUR_MEME_CHAIN.slug });
	const signature = await account.signMessage({ message });
	return { address: getAddress(agent.wallet_address), signature };
}
