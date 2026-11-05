import { describe, it, expect, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, concat, toFunctionSelector } from 'viem';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

import {
	FLAP_DEPLOYMENTS,
	buildFlapParams,
	encodeFlapLaunch,
	findVanitySalt,
	flapCoinUrl,
	flapTokenCreatedEvent,
	predictFlapToken,
	proxyInitCodeHash,
} from '../api/_lib/evm-leg/flap-config.js';
import { fourMemeCoinUrl, fourMemeValueWei, isFourMemeLoginMessage, toHexBytes, tokenCreateEvent, TOKEN_MANAGER2 } from '../api/_lib/evm-leg/four-meme-config.js';
import { readCreation, resolveVenue, venueCoinUrl, walletOwnershipMessage } from '../api/_lib/evm-leg/venue-launch.js';
import { newSubjectId, titleFor } from '../api/_lib/launch-subjects.js';

const CREATOR = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222227777';

function flapLog(address, { token = TOKEN, creator = CREATOR } = {}) {
	return {
		address,
		topics: encodeEventTopics({ abi: [flapTokenCreatedEvent], eventName: 'TokenCreated' }),
		data: encodeAbiParameters(
			[{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'string' }, { type: 'string' }, { type: 'string' }],
			[1n, creator, 0n, token, 'Bean Dance', 'BEAN', 'bafymeta'],
		),
	};
}

function fourMemeLog(address) {
	return {
		address,
		topics: encodeEventTopics({ abi: [tokenCreateEvent], eventName: 'TokenCreate' }),
		data: encodeAbiParameters(
			[{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'string' }, { type: 'string' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
			[CREATOR, TOKEN, 9n, 'Bean Dance', 'BEAN', 10n ** 27n, 0n, 0n],
		),
	};
}

describe('flap.sh CREATE2 prediction', () => {
	const { portal, taxImpl } = FLAP_DEPLOYMENTS.bsc;

	it('predicts the address the standard CREATE2 formula gives', () => {
		const salt = `0x${'ab'.repeat(32)}`;
		const digest = keccak256(concat(['0xff', portal, salt, proxyInitCodeHash(taxImpl)]));
		expect(predictFlapToken({ portal, impl: taxImpl, salt })).toBe(getAddress(`0x${digest.slice(-40)}`));
	});

	it('grinds a salt whose token address ends in 7777 and matches the prediction', () => {
		const found = findVanitySalt({ portal, impl: taxImpl, seed: '0x01' });
		expect(found.token.toLowerCase().endsWith('7777')).toBe(true);
		expect(predictFlapToken({ portal, impl: taxImpl, salt: found.salt })).toBe(found.token);
		expect(findVanitySalt({ portal, impl: taxImpl, seed: '0x01' })).toEqual(found);
	});

	it('gives up after the iteration bound instead of spinning', () => {
		expect(() => findVanitySalt({ portal, impl: taxImpl, suffix: 'ffffffff', seed: '0x02', maxIterations: 10 })).toThrow(/no ffffffff salt/);
	});
});

describe('flap.sh launch params', () => {
	const base = { name: 'Bean Dance', symbol: 'BEAN', meta: 'bafymeta', salt: `0x${'00'.repeat(32)}`, beneficiary: CREATOR };

	it('refuses a tax rate flap does not offer', () => {
		expect(() => buildFlapParams({ ...base, taxBps: 250 })).toThrow(/tax must be one of/);
	});

	it('pays the tax and commission to the creator and encodes newTokenV6', () => {
		const p = buildFlapParams({ ...base, taxBps: 100 });
		expect(p.buyTaxRate).toBe(100);
		expect(p.sellTaxRate).toBe(100);
		expect(p.commissionReceiver).toBe(CREATOR);
		const data = encodeFlapLaunch(p);
		const fn = data.slice(0, 10);
		expect(fn).toBe(toFunctionSelector('newTokenV6((string,string,string,uint8,bytes32,uint8,address,uint256,address,bytes,bytes32,bytes,uint8,uint8,uint16,uint16,uint64,uint64,uint16,uint16,uint16,uint16,uint256,address,address,uint8))'));
	});

	it('links each chain to its flap.sh coin page', () => {
		expect(flapCoinUrl('bsc', TOKEN)).toBe(`https://flap.sh/bnb/${TOKEN}`);
		expect(flapCoinUrl('base', TOKEN)).toBe(`https://flap.sh/base/${TOKEN}`);
		expect(flapCoinUrl('robinhood', TOKEN)).toBe(`https://flap.sh/robinhood/${TOKEN}`);
		expect(flapCoinUrl('solana', TOKEN)).toBeNull();
	});
});

describe('four.meme helpers', () => {
	it('signs only four.meme login text', () => {
		expect(isFourMemeLoginMessage('You are sign in Meme 123456')).toBe(true);
		for (const bad of ['You are sign in Meme ', 'Transfer all funds', 'You are sign in Meme 1\nand approve', 42, null]) {
			expect(isFourMemeLoginMessage(bad)).toBe(false);
		}
	});

	it('adds the launch fee, the pre-buy and the fee on the pre-buy', () => {
		expect(fourMemeValueWei({ launchFeeWei: 0n, presaleWei: 0n, tradingFeeRateBps: 100 })).toBe(0n);
		expect(fourMemeValueWei({ launchFeeWei: 5n, presaleWei: 10_000n, tradingFeeRateBps: 100 })).toBe(5n + 10_000n + 100n);
	});

	it('normalizes hex and base64 bytes and rejects junk', () => {
		expect(toHexBytes('0xABCD')).toBe('0xabcd');
		expect(toHexBytes('abcd')).toBe('0xabcd');
		expect(toHexBytes('q80=')).toBe('0xabcd');
		expect(toHexBytes('not bytes!')).toBeNull();
		expect(toHexBytes('')).toBeNull();
	});

	it('links the coin on four.meme', () => {
		expect(fourMemeCoinUrl(TOKEN)).toBe(`https://four.meme/token/${TOKEN}`);
		expect(venueCoinUrl('four_meme', 'bsc', TOKEN)).toBe(`https://four.meme/token/${TOKEN}`);
		expect(venueCoinUrl('flap', 'base', TOKEN)).toBe(`https://flap.sh/base/${TOKEN}`);
	});
});

describe('venue routing', () => {
	it('allows flap.sh on BNB Chain, Base and Robinhood Chain', () => {
		for (const slug of ['bsc', 'base', 'robinhood']) expect(resolveVenue('flap', slug).chain.slug).toBe(slug);
	});

	it('keeps four.meme on BNB Chain only', () => {
		expect(resolveVenue('four_meme', 'bsc').chain.slug).toBe('bsc');
		expect(() => resolveVenue('four_meme', 'base')).toThrow(/launches on BNB Smart Chain only/);
		expect(() => resolveVenue('nope', 'bsc')).toThrow(/venue must be one of/);
	});
});

describe('readCreation', () => {
	const portal = FLAP_DEPLOYMENTS.bsc.portal;

	it('reads the flap.sh token from the portal log', () => {
		const out = readCreation({ venueId: 'flap', contract: portal, receipt: { logs: [flapLog(portal)] } });
		expect(out).toMatchObject({ token: getAddress(TOKEN), creator: getAddress(CREATOR), symbol: 'BEAN', meta: 'bafymeta' });
	});

	it('ignores an identical event emitted by another contract', () => {
		const fake = '0x9999999999999999999999999999999999999999';
		expect(readCreation({ venueId: 'flap', contract: portal, receipt: { logs: [flapLog(fake)] } })).toBeNull();
		expect(readCreation({ venueId: 'four_meme', contract: TOKEN_MANAGER2, receipt: { logs: [fourMemeLog(fake)] } })).toBeNull();
	});

	it('reads the four.meme token from TokenManager2', () => {
		const out = readCreation({ venueId: 'four_meme', contract: TOKEN_MANAGER2, receipt: { logs: [fourMemeLog(TOKEN_MANAGER2)] } });
		expect(out).toMatchObject({ token: getAddress(TOKEN), creator: getAddress(CREATOR), name: 'Bean Dance', meta: null });
	});
});

describe('wallet ownership message', () => {
	it('names the launch, the checksummed wallet and the chain', () => {
		const addr = '0x52908400098527886e0f7030069857d2e4169ee7';
		expect(walletOwnershipMessage({ subjectId: 'abc234defg', address: addr, chain: 'bsc' })).toBe(`three.ws launch abc234defg\nWallet: ${getAddress(addr)}\nChain: bsc`);
	});
});

describe('launch subjects', () => {
	it('makes 10-char ids from an unambiguous alphabet', () => {
		const id = newSubjectId();
		expect(id).toMatch(/^[a-km-z2-9]{10}$/);
		expect(id).not.toMatch(/[lo01]/);
		expect(newSubjectId(Uint8Array.from([0, 1, 2]))).toBe('abc');
	});

	it('titles each kind of subject', () => {
		const agent = { name: 'CZ' };
		const avatar = { name: 'CZ avatar' };
		const clip = { label: 'Bean dance' };
		expect(titleFor({ kind: 'animation', avatar, clip })).toBe('CZ avatar: Bean dance');
		expect(titleFor({ kind: 'bundle', agent, avatar, clip })).toBe('CZ: Bean dance');
		expect(titleFor({ kind: 'agent', agent })).toBe('CZ');
		expect(titleFor({ kind: 'avatar', avatar })).toBe('CZ avatar');
		expect(titleFor({ kind: 'avatar' })).toBe('three.ws');
	});
});
