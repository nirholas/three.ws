// flap.sh launch configuration for the EVM leg: BNB Chain, Base and Robinhood
// Chain.
//
// flap's Portal deploys every coin as a CREATE2 minimal proxy of a token
// implementation, sells it on a bonding curve priced in the chain's gas coin,
// and migrates liquidity to a V2-style DEX pool when the curve fills. The
// Portal refuses an address that does not end in the vanity suffix for its
// token type, so the launcher grinds a salt before signing (findVanitySalt).
//
// Only one parameter set is used, and it was verified on all three chains by
// simulating newTokenV6 against the live Portals (eth_call from a funded state
// override):
//   - tokenVersion TOKEN_TAXED_V3. The standard token (TOKEN_V2_PERMIT)
//     reverts with FeatureDisabled() on BNB Chain and Robinhood Chain, and Base
//     has no standard implementation deployed. TOKEN_V3_PERMIT through
//     newTokenV7 is rule-gated on BNB Chain.
//   - migratorType V2_MIGRATOR: a tax token must use a V2 migrator.
//   - dexThresh FOUR_FIFTHS: the only graduation threshold the Portals accept.
//   - a buy/sell tax between 1% and 10% (the V3 token requires a non-zero
//     rate), for effectively forever (taxDuration ~100 years), routed 100% to
//     the creator's wallet as the "marketing" share. Every other share is zero.
//
// Sources: docs.flap.sh, "Launch token through Portal" and "Deployed contract
// addresses".

import { concat, encodeFunctionData, getAddress, keccak256, parseAbi, toBytes, toHex } from 'viem';
import { randomBytes } from 'node:crypto';

import { EVM_LEG_CHAINS } from './chains.js';

export const FLAP_VENUE = 'flap';

/** Portal and Tax Token V3 implementation per chain of the leg. */
export const FLAP_DEPLOYMENTS = Object.freeze({
	bsc: Object.freeze({
		portal: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
		taxImpl: '0x024f18294970B5c76c0691b87f138A0317156422',
		path: 'bnb',
	}),
	base: Object.freeze({
		portal: '0x0000BC1c4fD15Dd79029AF8F5d77D68ae4490000',
		taxImpl: '0x777782e7EbB89802E2379E5fFcF7336538f43333',
		path: 'base',
	}),
	robinhood: Object.freeze({
		portal: '0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09',
		taxImpl: '0x7777C8743C88B3aff3cf262135beF2c8b2e83333',
		path: 'robinhood',
	}),
});

export const FLAP_CHAIN_SLUGS = Object.freeze(Object.keys(FLAP_DEPLOYMENTS));

// Enum values from IPortalTypes / IPortalCommonTypes.
export const TOKEN_TAXED_V3 = 6;
export const V2_MIGRATOR = 1;
export const FOUR_FIFTHS = 1;
export const TAX_SUFFIX = '7777';

/** Tax options offered to creators, in basis points. The Portal accepts 100-1000. */
export const FLAP_TAX_OPTIONS_BPS = Object.freeze([100, 200, 300, 500, 1000]);
export const DEFAULT_FLAP_TAX_BPS = 100;
// The V3 token requires a non-zero duration; this is effectively permanent.
export const FLAP_TAX_DURATION_SECONDS = 3_153_600_000n;
export const FLAP_TOTAL_SUPPLY_WHOLE = 1_000_000_000n;
export const FLAP_GRADUATION_LABEL = '80% of supply sold on the curve';

export const flapPortalAbi = parseAbi([
	'struct NewTokenV6Params { string name; string symbol; string meta; uint8 dexThresh; bytes32 salt; uint8 migratorType; address quoteToken; uint256 quoteAmt; address beneficiary; bytes permitData; bytes32 extensionID; bytes extensionData; uint8 dexId; uint8 lpFeeProfile; uint16 buyTaxRate; uint16 sellTaxRate; uint64 taxDuration; uint64 antiFarmerDuration; uint16 mktBps; uint16 deflationBps; uint16 dividendBps; uint16 lpBps; uint256 minimumShareBalance; address dividendToken; address commissionReceiver; uint8 tokenVersion; }',
	'function newTokenV6(NewTokenV6Params params) payable returns (address token)',
	'event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)',
]);

export const flapTokenCreatedEvent = flapPortalAbi.find((x) => x.type === 'event' && x.name === 'TokenCreated');

const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO32 = `0x${'0'.repeat(64)}`;

export function flapDeployment(slug) {
	const d = FLAP_DEPLOYMENTS[slug];
	return d ? { ...d, chain: EVM_LEG_CHAINS[slug] } : null;
}

/** The keccak of the minimal-proxy init code the Portal deploys for `impl`. */
export function proxyInitCodeHash(impl) {
	const code = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${impl.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
	return keccak256(code);
}

/** CREATE2 address the Portal deploys a token at for `salt`. */
export function predictFlapToken({ portal, impl, salt, initCodeHash = proxyInitCodeHash(impl) }) {
	const digest = keccak256(concat(['0xff', portal, salt, initCodeHash]));
	return getAddress(`0x${digest.slice(-40)}`);
}

/**
 * Grind a salt whose CREATE2 address ends in `suffix`, the way flap's docs do
 * it: hash a random seed, then rehash until the address matches. About 65k
 * tries on average for four hex digits; bounded so a bad input cannot spin.
 */
export function findVanitySalt({ portal, impl, suffix = TAX_SUFFIX, seed = null, maxIterations = 2_000_000 }) {
	const initHash = toBytes(proxyInitCodeHash(impl));
	const prefix = concat(['0xff', portal]);
	const buf = new Uint8Array(1 + 20 + 32 + 32);
	buf.set(toBytes(prefix), 0);
	buf.set(initHash, 53);
	const want = suffix.toLowerCase();
	let salt = keccak256(seed ? toBytes(seed) : randomBytes(32), 'bytes');
	for (let i = 0; i < maxIterations; i++) {
		buf.set(salt, 21);
		const hex = keccak256(buf);
		if (hex.endsWith(want)) {
			return { salt: toHex(salt), token: getAddress(`0x${hex.slice(-40)}`), iterations: i + 1 };
		}
		salt = keccak256(salt, 'bytes');
	}
	throw new Error(`no ${suffix} salt found in ${maxIterations} iterations`);
}

/**
 * newTokenV6 arguments for the verified tax-token launch. `beneficiary` is the
 * creator (the agent wallet or the user's wallet); it receives the tax and the
 * commission. `quoteAmt` is an optional opening buy in wei, paid as msg.value.
 */
export function buildFlapParams({ name, symbol, meta, salt, beneficiary, taxBps, quoteAmt = 0n }) {
	if (!FLAP_TAX_OPTIONS_BPS.includes(taxBps)) throw new Error(`tax must be one of ${FLAP_TAX_OPTIONS_BPS.join(', ')} bps`);
	return {
		name,
		symbol,
		meta,
		dexThresh: FOUR_FIFTHS,
		salt,
		migratorType: V2_MIGRATOR,
		quoteToken: ZERO,
		quoteAmt,
		beneficiary,
		permitData: '0x',
		extensionID: ZERO32,
		extensionData: '0x',
		dexId: 0,
		lpFeeProfile: 0,
		buyTaxRate: taxBps,
		sellTaxRate: taxBps,
		taxDuration: FLAP_TAX_DURATION_SECONDS,
		antiFarmerDuration: 0n,
		mktBps: 10_000,
		deflationBps: 0,
		dividendBps: 0,
		lpBps: 0,
		minimumShareBalance: 0n,
		dividendToken: ZERO,
		commissionReceiver: beneficiary,
		tokenVersion: TOKEN_TAXED_V3,
	};
}

export function encodeFlapLaunch(params) {
	return encodeFunctionData({ abi: flapPortalAbi, functionName: 'newTokenV6', args: [params] });
}

/** The coin's page on flap.sh. */
export function flapCoinUrl(slug, token) {
	const d = FLAP_DEPLOYMENTS[slug];
	return d ? `https://flap.sh/${d.path}/${token}` : null;
}

const FLAP_UPLOAD_URL = 'https://funcs.flap.sh/api/upload';
const UPLOAD_MUTATION = 'mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }';

/**
 * Pin the coin's image and metadata on flap's IPFS gateway and return the CID
 * the Portal records as `meta`. flap's indexer only reads metadata pinned
 * through this endpoint. GraphQL multipart request, per the Portal docs.
 */
export async function uploadFlapMetadata({ image, contentType, filename, website, twitter, telegram, description, fetchImpl = fetch }) {
	const operations = {
		query: UPLOAD_MUTATION,
		variables: {
			file: null,
			meta: {
				website: website || null,
				twitter: twitter || null,
				telegram: telegram || null,
				description: description || '',
				creator: ZERO,
				buy: null,
				sell: null,
			},
		},
	};
	const form = new FormData();
	form.append('operations', JSON.stringify(operations));
	form.append('map', JSON.stringify({ 0: ['variables.file'] }));
	form.append('0', new Blob([image], { type: contentType }), filename);
	const res = await fetchImpl(FLAP_UPLOAD_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
	const text = await res.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	const cid = body?.data?.create;
	if (!res.ok || typeof cid !== 'string' || !cid) {
		const reason = body?.errors?.[0]?.message || text.slice(0, 200) || `HTTP ${res.status}`;
		throw Object.assign(new Error(`flap metadata upload failed: ${reason}`), { code: 'flap_upload_failed', status: 502 });
	}
	return cid;
}
