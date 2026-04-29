import { describe, it, expect, vi, beforeEach } from 'vitest';
import bs58 from 'bs58';
import { CarbonGraduationSource } from '../services/pump-graduations/carbon-source.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const COMPLETE_EVENT_DISCRIMINATOR = Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]);

// Build a minimal valid CompleteEvent log entry.
// Layout: discriminator(8) user(32) mint(32) bondingCurve(32) timestamp(i64)
function makeGraduationEntry(mint32Bytes, ts, sig = 'testsig123') {
	const buf = Buffer.alloc(112);
	COMPLETE_EVENT_DISCRIMINATOR.copy(buf, 0);
	// user: bytes 8–39 (zeros — any pubkey)
	mint32Bytes.copy(buf, 40);
	// bondingCurve: bytes 72–103 (zeros)
	buf.writeBigInt64LE(BigInt(ts), 104);
	return {
		signature: sig,
		err: null,
		logs: [`Program data: ${buf.toString('base64')}`],
	};
}

// A well-known 32-byte Solana pubkey used as a mock mint
const MOCK_MINT_BYTES = Buffer.from(bs58.decode('So11111111111111111111111111111111111111112'));
const MOCK_MINT = 'So11111111111111111111111111111111111111112';
const MOCK_SIG = 'testSig1111111111111111111111111111111111111111111111111111111111';
const MOCK_TS = 1_700_000_000;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CarbonGraduationSource', () => {
	let capturedHandler;
	let mockSubscriber;

	beforeEach(() => {
		capturedHandler = null;
		mockSubscriber = vi.fn((programId, handler) => {
			capturedHandler = handler;
			return 42; // subscription id
		});
	});

	it('calls logSubscriber with the pump program id on start', () => {
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(vi.fn());
		expect(mockSubscriber).toHaveBeenCalledOnce();
		const [programId] = mockSubscriber.mock.calls[0];
		expect(programId.toBase58()).toBe('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
	});

	it('emits graduation event with correct shape on valid log entry', () => {
		const onGraduation = vi.fn();
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(onGraduation);

		capturedHandler(makeGraduationEntry(MOCK_MINT_BYTES, MOCK_TS, MOCK_SIG));

		expect(onGraduation).toHaveBeenCalledOnce();
		expect(onGraduation.mock.calls[0][0]).toEqual({
			mint: MOCK_MINT,
			signature: MOCK_SIG,
			ts: MOCK_TS,
			marketCapUsd: null,
		});
	});

	it('emitted event shape matches legacy source fields: mint, signature, ts, marketCapUsd', () => {
		const onGraduation = vi.fn();
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(onGraduation);
		capturedHandler(makeGraduationEntry(MOCK_MINT_BYTES, MOCK_TS, MOCK_SIG));

		const ev = onGraduation.mock.calls[0][0];
		expect(ev).toHaveProperty('mint');
		expect(ev).toHaveProperty('signature');
		expect(ev).toHaveProperty('ts');
		expect(ev).toHaveProperty('marketCapUsd');
		expect(typeof ev.mint).toBe('string');
		expect(typeof ev.signature).toBe('string');
		expect(typeof ev.ts).toBe('number');
	});

	it('ignores entries with err set', () => {
		const onGraduation = vi.fn();
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(onGraduation);

		const entry = makeGraduationEntry(MOCK_MINT_BYTES, MOCK_TS, MOCK_SIG);
		entry.err = { InstructionError: [0, 'Custom'] };
		capturedHandler(entry);

		expect(onGraduation).not.toHaveBeenCalled();
	});

	it('ignores entries without Program data log lines', () => {
		const onGraduation = vi.fn();
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(onGraduation);

		capturedHandler({ signature: MOCK_SIG, err: null, logs: ['Program log: some other log'] });

		expect(onGraduation).not.toHaveBeenCalled();
	});

	it('ignores duplicate signatures', () => {
		const onGraduation = vi.fn();
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(onGraduation);

		const entry = makeGraduationEntry(MOCK_MINT_BYTES, MOCK_TS, MOCK_SIG);
		capturedHandler(entry);
		capturedHandler(entry);

		expect(onGraduation).toHaveBeenCalledOnce();
	});

	it('ignores Program data with wrong discriminator', () => {
		const onGraduation = vi.fn();
		const src = new CarbonGraduationSource({ logSubscriber: mockSubscriber });
		src.start(onGraduation);

		const buf = Buffer.alloc(112);
		// discriminator bytes intentionally wrong
		buf[0] = 0xff;
		capturedHandler({
			signature: MOCK_SIG,
			err: null,
			logs: [`Program data: ${buf.toString('base64')}`],
		});

		expect(onGraduation).not.toHaveBeenCalled();
	});
});
