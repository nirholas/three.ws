import { describe, it, expect } from 'vitest';
import { Keypair, SystemProgram } from '@solana/web3.js';
import {
	LEGACY_TRANSACTION_LIMIT,
	V1_TRANSACTION_LIMIT,
	buildPartiallySignedV1Transaction,
	decodeV1ConfigMask,
	diffTransactionVersions,
	findDuplicateAccounts,
	inspectWireTransaction,
	planTransactionSize,
} from '../api/_lib/solana/transaction-v1.js';
import { getTransactionDecoder } from '@solana/kit';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function transferInstructionInput(fromPubkey, toPubkey) {
	const instruction = SystemProgram.transfer({ fromPubkey, toPubkey, lamports: 1_000 });
	return {
		programId: instruction.programId.toBase58(),
		keys: instruction.keys.map((key) => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })),
		data: instruction.data,
	};
}

describe('findDuplicateAccounts', () => {
	it('reports no duplicates for a unique account list', () => {
		expect(findDuplicateAccounts([THREE_MINT, SystemProgram.programId.toBase58()])).toEqual([]);
	});

	it('counts a repeated address exactly once with its occurrence count', () => {
		const dup = findDuplicateAccounts([THREE_MINT, SystemProgram.programId.toBase58(), THREE_MINT, THREE_MINT]);
		expect(dup).toEqual([{ address: THREE_MINT, count: 3 }]);
	});

	it('treats an empty or missing list as having no duplicates', () => {
		expect(findDuplicateAccounts([])).toEqual([]);
		expect(findDuplicateAccounts(undefined)).toEqual([]);
	});
});

describe('decodeV1ConfigMask', () => {
	it('decodes the exact bits and fixed-width values a real V1 transaction carries', async () => {
		const owner = Keypair.generate();
		const asset = Keypair.generate();
		const wire = await buildPartiallySignedV1Transaction({
			feePayer: owner.publicKey.toBase58(),
			lifetime: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1n },
			instructions: [transferInstructionInput(owner.publicKey, asset.publicKey)],
			signers: [],
			clientSigners: [owner.publicKey.toBase58()],
		});
		const decoded = getTransactionDecoder().decode(wire);
		const mask = decodeV1ConfigMask(decoded.messageBytes);

		expect(mask.maskUint32).toBe(0b1111);
		expect(mask.popcount).toBe(4);
		expect(mask.reservedBitsSet).toBe(false);

		const byField = Object.fromEntries(mask.fields.map((f) => [f.field, f]));
		expect(byField.priorityFeeLamports.present).toBe(true);
		expect(byField.priorityFeeLamports.value).toBe(5_000);
		expect(byField.computeUnitLimit.present).toBe(true);
		expect(byField.computeUnitLimit.value).toBe(500_000);
		expect(byField.loadedAccountsDataSizeLimit.present).toBe(true);
		expect(byField.loadedAccountsDataSizeLimit.value).toBe(8 * 1024 * 1024);
		expect(byField.heapSize.present).toBe(false);
		expect(byField.heapSize.invalidPartial).toBe(false);

		expect(mask.configValuesByteLength).toBe(8 + 4 + 4);
		expect(decoded.messageBytes[0]).toBe(0x81);
	});

	it('rejects a message that is not a V1 envelope', () => {
		expect(() => decodeV1ConfigMask(new Uint8Array(50))).toThrow(/not a V1 transaction message/);
	});

	it('agrees with inspectWireTransaction on the same wire bytes', async () => {
		const owner = Keypair.generate();
		const asset = Keypair.generate();
		const wire = await buildPartiallySignedV1Transaction({
			feePayer: owner.publicKey.toBase58(),
			lifetime: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1n },
			instructions: [transferInstructionInput(owner.publicKey, asset.publicKey)],
			signers: [],
			clientSigners: [owner.publicKey.toBase58()],
		});
		const inspected = inspectWireTransaction(Buffer.from(wire).toString('base64'));
		expect(inspected.configMask.maskHex).toBe(`0x${(0b1111).toString(16).padStart(8, '0')}`);
	});
});

describe('planTransactionSize', () => {
	it('compiles a real transfer instruction to its exact V1 wire size with no duplicate accounts', () => {
		const owner = Keypair.generate();
		const asset = Keypair.generate();
		const plan = planTransactionSize({
			feePayer: owner.publicKey.toBase58(),
			version: 1,
			instructions: [transferInstructionInput(owner.publicKey, asset.publicKey)],
		});

		expect(plan.version).toBe(1);
		expect(plan.versionLabel).toBe('V1');
		expect(plan.limitBytes).toBe(V1_TRANSACTION_LIMIT);
		expect(plan.headroomBytes).toBe(V1_TRANSACTION_LIMIT - plan.bytes);
		expect(plan.overLimitBy).toBe(0);
		expect(plan.fitsV1).toBe(true);
		expect(plan.fitsLegacy).toBe(true);
		expect(plan.duplicateAccounts).toEqual([]);
		expect(plan.staticAccountCount).toBe(plan.accountReuse.dedupedCount);
		expect(plan.instructionCount).toBe(1);
		expect(plan.signerCount).toBeGreaterThanOrEqual(1);
	});

	it('resolves an explicit priority fee to the exact ceiling-divided lamport total', () => {
		const owner = Keypair.generate();
		const asset = Keypair.generate();
		const plan = planTransactionSize({
			feePayer: owner.publicKey.toBase58(),
			version: 1,
			instructions: [transferInstructionInput(owner.publicKey, asset.publicKey)],
			budgetConfig: { computeUnitLimit: 200_000, priorityFeeMicroLamportsPerCu: 10 },
		});

		expect(plan.resourceBudget.computeUnitLimit).toBe(200_000);
		expect(plan.resourceBudget.priorityFeeLamports).toBe(2);
	});

	it('flags a plan that does not fit the legacy/v0 ceiling but does fit V1', () => {
		const owner = Keypair.generate();
		const instructions = Array.from({ length: 30 }, () => transferInstructionInput(owner.publicKey, Keypair.generate().publicKey));
		const legacyPlan = planTransactionSize({ feePayer: owner.publicKey.toBase58(), version: 'legacy', instructions });

		expect(legacyPlan.bytes).toBeGreaterThan(LEGACY_TRANSACTION_LIMIT);
		expect(legacyPlan.fitsLegacy).toBe(false);
		expect(legacyPlan.overLimitBy).toBe(legacyPlan.bytes - LEGACY_TRANSACTION_LIMIT);

		const v1Plan = planTransactionSize({ feePayer: owner.publicKey.toBase58(), version: 1, instructions });
		expect(v1Plan.fitsV1).toBe(true);
	});

	it('rejects a missing fee payer, an invalid version, and too many instructions', () => {
		const owner = Keypair.generate();
		const instruction = transferInstructionInput(owner.publicKey, Keypair.generate().publicKey);
		expect(() => planTransactionSize({ version: 1, instructions: [instruction] })).toThrow(/feePayer is required/);
		expect(() => planTransactionSize({ feePayer: owner.publicKey.toBase58(), version: 2, instructions: [instruction] })).toThrow(/version must be/);
		const tooMany = Array.from({ length: 65 }, () => instruction);
		expect(() => planTransactionSize({ feePayer: owner.publicKey.toBase58(), version: 1, instructions: tooMany })).toThrow(/cannot hold more than/);
	});
});

describe('diffTransactionVersions', () => {
	it('compiles the same instruction set legacy, v0, and v1 and reports the real byte deltas', () => {
		const owner = Keypair.generate();
		const asset = Keypair.generate();
		const diff = diffTransactionVersions({
			feePayer: owner.publicKey.toBase58(),
			instructions: [transferInstructionInput(owner.publicKey, asset.publicKey)],
		});

		expect(diff.legacy.version).toBe('legacy');
		expect(diff.v0.version).toBe(0);
		expect(diff.v1.version).toBe(1);
		expect(diff.bytesSavedVsLegacy).toBe(diff.legacy.bytes - diff.v1.bytes);
		expect(diff.bytesSavedVsV0).toBe(diff.v0.bytes - diff.v1.bytes);
		// V1 carries its config mask and fixed-width values inline, so a tiny
		// single-instruction transfer is not guaranteed to be the smaller
		// encoding; only the arithmetic relationship is asserted here.
		expect(diff.v1.bytes).toBeGreaterThan(0);
	});
});
