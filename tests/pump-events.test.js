import { describe, it, expect } from 'vitest';
import { decodeTransactionEvents, parseTransactionDistributions, parseSocialFeeClaim } from '../api/_lib/pump-events.js';
import {
	createEventLogs,
	tradeEventLogs,
	completeEventLogs,
	collectCreatorFeeEventLogs,
	socialClaimWithDistributionsLogs,
	buildTransactionLogs,
	encodeTradeEvent,
	SYNTH,
} from './_helpers/pump-log-fixtures.js';
import { PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } from '../api/_lib/solana/programs.js';

describe('decodeTransactionEvents: create', () => {
	it('decodes a launch into a typed create event', () => {
		const logs = createEventLogs({
			name: '$THREE',
			symbol: 'THREE',
			uri: 'https://three.ws/metadata/three.json',
			mint: SYNTH.MINT_A,
			bondingCurve: SYNTH.BONDING_CURVE_A,
			user: SYNTH.USER_A,
			creator: SYNTH.CREATOR_A,
			virtualTokenReserves: 1_073_000_000_000_000n,
			virtualSolReserves: 30_000_000_000n,
			realTokenReserves: 793_100_000_000_000n,
			tokenTotalSupply: 1_000_000_000_000_000n,
			tokenProgram: SYNTH.TOKEN_PROGRAM,
		});

		const events = decodeTransactionEvents(logs);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe('create');
		expect(events[0].programId).toBe(PUMP_PROGRAM_ID);
		expect(events[0].data.mint).toBe(SYNTH.MINT_A);
		expect(events[0].data.name).toBe('$THREE');
		expect(events[0].data.symbol).toBe('THREE');
		expect(events[0].data.creator).toBe(SYNTH.CREATOR_A);
		expect(events[0].data.realTokenReserves).toBe('793100000000000');
		expect(events[0].data.isMayhemMode).toBe(false);
	});
});

describe('decodeTransactionEvents: trade', () => {
	it('decodes a buy with side, SOL/token deltas, and post-trade virtual reserves', () => {
		const logs = tradeEventLogs({
			mint: SYNTH.MINT_A,
			solAmount: 5_000_000_000n,
			tokenAmount: 120_000_000_000n,
			isBuy: true,
			user: SYNTH.USER_A,
			virtualSolReserves: 35_000_000_000n,
			virtualTokenReserves: 953_000_000_000_000n,
			realSolReserves: 5_000_000_000n,
			realTokenReserves: 673_100_000_000_000n,
			feeRecipient: SYNTH.FEE_RECIPIENT,
			creator: SYNTH.CREATOR_A,
		});

		const [event] = decodeTransactionEvents(logs);
		expect(event.type).toBe('trade');
		expect(event.data.isBuy).toBe(true);
		expect(event.data.solAmount).toBe('5000000000');
		expect(event.data.tokenAmount).toBe('120000000000');
		expect(event.data.virtualSolReserves).toBe('35000000000');
		expect(event.data.virtualTokenReserves).toBe('953000000000000');
		expect(event.data.user).toBe(SYNTH.USER_A);
	});

	it('decodes a sell the same way, side flipped', () => {
		const logs = tradeEventLogs({
			mint: SYNTH.MINT_A,
			solAmount: 1_000_000_000n,
			tokenAmount: 20_000_000_000n,
			isBuy: false,
			user: SYNTH.USER_B,
			virtualSolReserves: 34_000_000_000n,
			virtualTokenReserves: 973_000_000_000_000n,
			realSolReserves: 4_000_000_000n,
			realTokenReserves: 693_100_000_000_000n,
			feeRecipient: SYNTH.FEE_RECIPIENT,
			creator: SYNTH.CREATOR_A,
		});

		const [event] = decodeTransactionEvents(logs);
		expect(event.type).toBe('trade');
		expect(event.data.isBuy).toBe(false);
		expect(event.data.ixName).toBe('sell');
	});
});

describe('decodeTransactionEvents: complete', () => {
	it('decodes a graduating trade as [trade, complete] in order', () => {
		const logs = completeEventLogs(
			{
				mint: SYNTH.MINT_A,
				solAmount: 85_000_000_000n,
				tokenAmount: 793_100_000_000_000n,
				isBuy: true,
				user: SYNTH.USER_A,
				virtualSolReserves: 115_000_000_000n,
				virtualTokenReserves: 280_000_000_000_000n,
				realSolReserves: 85_000_000_000n,
				realTokenReserves: 0n,
				feeRecipient: SYNTH.FEE_RECIPIENT,
				creator: SYNTH.CREATOR_A,
			},
			{ user: SYNTH.USER_A, mint: SYNTH.MINT_A, bondingCurve: SYNTH.BONDING_CURVE_A },
		);

		const events = decodeTransactionEvents(logs);
		expect(events.map((e) => e.type)).toEqual(['trade', 'complete']);
		expect(events[0].data.realTokenReserves).toBe('0');
		expect(events[1].data.mint).toBe(SYNTH.MINT_A);
		expect(events[1].data.bondingCurve).toBe(SYNTH.BONDING_CURVE_A);
	});
});

describe('decodeTransactionEvents: collect and distribute', () => {
	it('decodes a creator fee collection', () => {
		const logs = collectCreatorFeeEventLogs({ creator: SYNTH.CREATOR_A, creatorFee: 2_500_000_000n });
		const [event] = decodeTransactionEvents(logs);
		expect(event.type).toBe('collectCreatorFee');
		expect(event.programId).toBe(PUMP_PROGRAM_ID);
		expect(event.data.creator).toBe(SYNTH.CREATOR_A);
		expect(event.data.creatorFee).toBe('2500000000');
	});

	it('decodes a same-tx distribution alongside a GitHub social-fee claim', () => {
		const logs = socialClaimWithDistributionsLogs(
			{
				userId: '12345',
				platform: 2,
				socialFeePda: SYNTH.PDA_A,
				recipient: SYNTH.RECIPIENT,
				socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
				amountClaimed: 7_000_000n,
				lifetimeClaimed: 7_000_000n,
			},
			[
				{
					mint: SYNTH.MINT_A,
					bondingCurve: SYNTH.BONDING_CURVE_A,
					sharingConfig: SYNTH.SHARING_CONFIG_A,
					admin: SYNTH.ADMIN,
					shareholders: [{ address: SYNTH.PDA_A, shareBps: 10_000 }],
					distributed: 7_000_000n,
				},
			],
		);

		const events = decodeTransactionEvents(logs);
		expect(events.map((e) => e.type)).toEqual(['distributeCreatorFees', 'socialFeePdaClaimed']);
		expect(events[0].programId).toBe(PUMP_PROGRAM_ID);
		expect(events[1].programId).toBe(PUMP_FEE_PROGRAM_ID);

		// The existing typed helpers still read the same decoded shape.
		expect(parseTransactionDistributions(logs)).toHaveLength(1);
		expect(parseSocialFeeClaim(logs)?.githubUserId).toBe('12345');
	});
});

describe('decodeTransactionEvents: unrecognized events never get dropped', () => {
	it('keeps a frame whose discriminator is not in the installed SDK IDLs', () => {
		const futureEventPayload = Buffer.concat([Buffer.from('ffffffffffffffff', 'hex'), Buffer.from('new-field-bytes')]);
		const logs = buildTransactionLogs([
			{ programId: PUMP_PROGRAM_ID, instruction: null, dataPayloads: [futureEventPayload] },
		]);

		const events = decodeTransactionEvents(logs);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: 'unrecognized',
			programId: PUMP_PROGRAM_ID,
			discriminator: 'ffffffffffffffff',
		});
		expect(events[0].dataBase64).toBe(futureEventPayload.toString('base64'));
	});

	it('ignores program data emitted outside a known Pump program invocation', () => {
		const logs = [
			'Program 11111111111111111111111111111111 invoke [1]',
			`Program data: ${encodeTradeEvent({
				mint: SYNTH.MINT_A,
				solAmount: 1n,
				tokenAmount: 1n,
				isBuy: true,
				user: SYNTH.USER_A,
				virtualSolReserves: 1n,
				virtualTokenReserves: 1n,
				realSolReserves: 1n,
				realTokenReserves: 1n,
				feeRecipient: SYNTH.FEE_RECIPIENT,
				creator: SYNTH.CREATOR_A,
			}).toString('base64')}`,
			'Program 11111111111111111111111111111111 success',
		];
		expect(decodeTransactionEvents(logs)).toEqual([]);
	});
});

describe('decodeTransactionEvents: never throws', () => {
	it('returns an empty array for non-array input', () => {
		expect(decodeTransactionEvents(null)).toEqual([]);
		expect(decodeTransactionEvents(undefined)).toEqual([]);
		expect(decodeTransactionEvents([])).toEqual([]);
	});

	it('skips an unparseable base64 "Program data:" line instead of throwing', () => {
		const logs = [
			`Program ${PUMP_PROGRAM_ID} invoke [1]`,
			'Program data: not-valid-base64!!!',
			`Program ${PUMP_PROGRAM_ID} success`,
		];
		expect(() => decodeTransactionEvents(logs)).not.toThrow();
	});
});
