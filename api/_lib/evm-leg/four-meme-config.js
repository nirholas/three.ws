// four.meme launch configuration (BNB Chain only).
//
// A four.meme launch has two halves:
//   1. four.meme's API (https://four.meme/meme-api) logs the creator in with a
//      signed nonce, hosts the image, and returns `createArg` plus a platform
//      signature for the coin. Only four.meme can produce that pair.
//   2. The creator's wallet sends TokenManager2.createToken(createArg, signature)
//      with msg.value = launch fee + optional pre-buy + the trading fee on it.
//
// four.meme serves its API from behind a regional block, so three.ws never
// proxies it: the API half runs in the launcher's own browser, the same way
// four.meme's own site runs it. For an agent-signed launch the only thing the
// server does for the API half is sign the login message with the agent's key
// (isFourMemeLoginMessage pins the exact text), and the only on-chain call it
// will send is createToken to TokenManager2 with a value it computes itself.
//
// Sources: github.com/four-meme-community/fourmeme-docs (create-guide.md,
// contract addresses) and four-meme.gitbook.io/four.meme.

import { parseAbi } from 'viem';

import { EVM_LEG_CHAINS } from './chains.js';

export const FOUR_MEME_VENUE = 'four_meme';
export const FOUR_MEME_CHAIN = EVM_LEG_CHAINS.bsc;
export const FOUR_MEME_API = 'https://four.meme/meme-api/v1';
export const TOKEN_MANAGER2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const FOUR_MEME_HELPER3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';

export const FOUR_MEME_LABELS = Object.freeze(['Meme', 'AI', 'Defi', 'Games', 'Infra', 'De-Sci', 'Social', 'Depin', 'Charity', 'Others']);
export const FOUR_MEME_TOTAL_SUPPLY_WHOLE = 1_000_000_000n;
// Platform-fixed: 24 BNB raised on the curve, 80% of supply sold, then PancakeSwap.
export const FOUR_MEME_GRADUATION_LABEL = '24 BNB raised on the curve (80% of supply), then PancakeSwap';
// Measured from live createToken receipts on BNB Chain (about 1.56M gas). Used
// only when a quote cannot simulate the call; a launch always estimates it.
export const MEASURED_FOUR_MEME_GAS = 1_800_000n;
// A creator pre-buy is capped so a typo cannot spend a wallet.
export const MAX_FOUR_MEME_PRESALE_BNB = 5;

export const tokenManager2Abi = parseAbi([
	'function createToken(bytes args, bytes signature) payable',
	'function _launchFee() view returns (uint256)',
	'function _tradingFeeRate() view returns (uint256)',
	'event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)',
]);

export const tokenCreateEvent = tokenManager2Abi.find((x) => x.type === 'event' && x.name === 'TokenCreate');

const LOGIN_RE = /^You are sign in Meme [A-Za-z0-9-]{1,128}$/;

/** True only for four.meme's login text: the one message an agent key will sign for it. */
export function isFourMemeLoginMessage(message) {
	return typeof message === 'string' && LOGIN_RE.test(message);
}

/**
 * msg.value createToken needs: the platform launch fee, the pre-buy, and the
 * trading fee charged on the pre-buy (rate in basis points), exactly as the
 * four.meme community tooling computes it.
 */
export function fourMemeValueWei({ launchFeeWei, presaleWei, tradingFeeRateBps }) {
	const presale = BigInt(presaleWei);
	const fee = presale > 0n ? (presale * BigInt(tradingFeeRateBps)) / 10_000n : 0n;
	return BigInt(launchFeeWei) + presale + fee;
}

/** createArg and signature arrive hex or base64; the contract takes bytes. */
export function toHexBytes(value) {
	const s = String(value ?? '').trim();
	if (/^0x[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0) return s.toLowerCase();
	if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return `0x${s.toLowerCase()}`;
	if (/^[A-Za-z0-9+/=_-]+$/.test(s)) {
		const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
		if (buf.length) return `0x${buf.toString('hex')}`;
	}
	return null;
}

/** Live platform fees read from TokenManager2. */
export async function readFourMemeFees(client) {
	const [launchFeeWei, tradingFeeRateBps] = await Promise.all([
		client.readContract({ address: TOKEN_MANAGER2, abi: tokenManager2Abi, functionName: '_launchFee' }),
		client.readContract({ address: TOKEN_MANAGER2, abi: tokenManager2Abi, functionName: '_tradingFeeRate' }),
	]);
	return { launchFeeWei, tradingFeeRateBps: Number(tradingFeeRateBps) };
}

export function fourMemeCoinUrl(token) {
	return `https://four.meme/token/${token}`;
}
