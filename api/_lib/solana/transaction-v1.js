/**
 * Solana transaction-v1 builder bridge.
 *
 * Metaplex Umi exposes the instructions and signers needed to create a Core
 * asset, but its transaction factory currently emits v0. This module converts
 * those Umi-shaped instructions to @solana/kit and compiles the v1 envelope.
 * The server-owned asset/collection keys sign here; the owner's wallet slot is
 * intentionally left empty for Wallet Standard to sign in the browser.
 */

import {
	COMPUTE_BUDGET_PROGRAM_ADDRESS,
	ComputeBudgetInstruction,
	getRequestHeapFrameInstructionDataDecoder,
	getSetComputeUnitLimitInstructionDataDecoder,
	getSetComputeUnitPriceInstructionDataDecoder,
	getSetLoadedAccountsDataSizeLimitInstructionDataDecoder,
	identifyComputeBudgetInstruction,
	MAX_COMPUTE_UNIT_LIMIT,
} from '@solana-program/compute-budget';
import {
	AccountRole,
	address,
	appendTransactionMessageInstructions,
	assertIsTransactionWithinSizeLimit,
	blockhash,
	compileTransaction,
	createTransactionMessage,
	decompileTransactionMessage,
	getBase64Encoder,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	getTransactionEncoder,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

export const TX_V1_FEATURE_ADDRESS = 'txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL';
export const LEGACY_TRANSACTION_LIMIT = 1_232;
export const V1_TRANSACTION_LIMIT = 4_096;
export const SOLANA_TRANSACTION_V1 = 1;
const DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION = 200_000;

// V1 has no implicit compute/data limits. These conservative limits cover a
// Metaplex Core create while bounding the resources a prepared tx may consume.
export const AGENT_DEPLOY_V1_CONFIG = Object.freeze({
	computeUnitLimit: 500_000,
	loadedAccountsDataSizeLimit: 8 * 1024 * 1024,
	priorityFeeLamports: 5_000n,
});

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';

function accountRole(meta) {
	if (meta.isSigner) {
		return meta.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
	}
	return meta.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

export function toKitInstruction(instruction) {
	if (String(instruction.programId) === COMPUTE_BUDGET_PROGRAM) {
		throw new Error('v1 resource limits must use transactionConfig, not ComputeBudget instructions');
	}
	return {
		programAddress: address(String(instruction.programId)),
		accounts: instruction.keys.map((meta) => ({
			address: address(String(meta.pubkey)),
			role: accountRole(meta),
		})),
		data: instruction.data,
	};
}

/**
 * Build a partially signed v1 transaction from Umi instructions/signers.
 * @param {object} input
 * @param {Array<object>} input.instructions Umi-shaped instructions.
 * @param {Array<{publicKey: string, signMessage(bytes: Uint8Array): Promise<Uint8Array>}>} input.signers
 * @param {string} input.feePayer Owner wallet; deliberately not server-signed.
 * @param {{blockhash: string, lastValidBlockHeight: number|bigint}} input.lifetime
 * @param {object} [input.config]
 */
export async function buildPartiallySignedV1Transaction({
	instructions,
	signers = [],
	feePayer,
	lifetime,
	config = AGENT_DEPLOY_V1_CONFIG,
}) {
	const message = pipe(
		createTransactionMessage({ version: SOLANA_TRANSACTION_V1 }),
		(m) => setTransactionMessageFeePayer(address(feePayer), m),
		(m) =>
			setTransactionMessageLifetimeUsingBlockhash(
				{
					blockhash: blockhash(lifetime.blockhash),
					lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight),
				},
				m,
			),
		(m) => appendTransactionMessageInstructions(instructions.map(toKitInstruction), m),
		(m) => setTransactionMessageConfig(config, m),
	);

	const transaction = compileTransaction(message);
	const signatures = { ...transaction.signatures };
	for (const signer of signers) {
		const signerAddress = String(signer.publicKey);
		// The wallet fee payer is represented by Umi's noop signer. Keep its
		// signature null so the browser wallet can fill it.
		if (signerAddress === feePayer || signatures[signerAddress] === undefined) continue;
		signatures[signerAddress] = await signer.signMessage(transaction.messageBytes);
	}

	const partiallySigned = Object.freeze({
		...transaction,
		signatures: Object.freeze(signatures),
	});
	assertIsTransactionWithinSizeLimit(partiallySigned);
	return getTransactionEncoder().encode(partiallySigned);
}

function asSafeNumber(value) {
	if (value === undefined || value === null) return null;
	const n = Number(value);
	return Number.isSafeInteger(n) ? n : String(value);
}

function defaultComputeUnitLimit(instructionCount) {
	return Math.min(DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION * instructionCount, MAX_COMPUTE_UNIT_LIMIT);
}

function budgetFromLegacyMessage(compiled) {
	const instructions = compiled.instructions || [];
	const budget = {};
	let priceMicroLamportsPerCu;

	for (const instruction of instructions) {
		const program = compiled.staticAccounts?.[instruction.programAddressIndex];
		if (program !== COMPUTE_BUDGET_PROGRAM_ADDRESS || !instruction.data) continue;

		switch (identifyComputeBudgetInstruction(instruction.data)) {
			case ComputeBudgetInstruction.RequestHeapFrame:
				budget.heapSize = getRequestHeapFrameInstructionDataDecoder().decode(instruction.data).bytes;
				break;
			case ComputeBudgetInstruction.SetComputeUnitLimit:
				budget.computeUnitLimit = getSetComputeUnitLimitInstructionDataDecoder().decode(instruction.data).units;
				break;
			case ComputeBudgetInstruction.SetComputeUnitPrice:
				priceMicroLamportsPerCu = getSetComputeUnitPriceInstructionDataDecoder().decode(instruction.data).microLamports;
				break;
			case ComputeBudgetInstruction.SetLoadedAccountsDataSizeLimit:
				budget.loadedAccountsDataSizeLimit =
					getSetLoadedAccountsDataSizeLimitInstructionDataDecoder().decode(instruction.data).accountDataSizeLimit;
				break;
			default:
				break;
		}
	}

	const implicitComputeLimit = defaultComputeUnitLimit(instructions.length);
	if (priceMicroLamportsPerCu !== undefined) {
		const computeLimit = BigInt(budget.computeUnitLimit ?? implicitComputeLimit);
		budget.priorityFeeLamports = (computeLimit * priceMicroLamportsPerCu + 999_999n) / 1_000_000n;
	}

	return {
		...budget,
		computeUnitLimit: budget.computeUnitLimit ?? implicitComputeLimit,
		source: 'compute-budget-instructions',
		explicit: {
			computeUnitLimit: budget.computeUnitLimit !== undefined,
			loadedAccountsDataSizeLimit: budget.loadedAccountsDataSizeLimit !== undefined,
			heapSize: budget.heapSize !== undefined,
			priorityFee: priceMicroLamportsPerCu !== undefined,
		},
	};
}

function budgetFromV1Message(compiled) {
	const config = decompileTransactionMessage(compiled).config || {};
	return {
		...config,
		source: 'transaction-config',
		explicit: {
			computeUnitLimit: config.computeUnitLimit !== undefined,
			loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit !== undefined,
			heapSize: config.heapSize !== undefined,
			priorityFee: config.priorityFeeLamports !== undefined,
		},
	};
}

function serializableBudget(budget) {
	return {
		source: budget.source,
		computeUnitLimit: asSafeNumber(budget.computeUnitLimit),
		loadedAccountsDataSizeLimit: asSafeNumber(budget.loadedAccountsDataSizeLimit),
		heapSize: asSafeNumber(budget.heapSize),
		priorityFeeLamports: asSafeNumber(budget.priorityFeeLamports),
		explicit: budget.explicit,
	};
}

function instructionCount(compiled) {
	return compiled.version === 1
		? compiled.numInstructions ?? compiled.instructionHeaders?.length ?? 0
		: compiled.instructions?.length ?? 0;
}

function sponsorAssessment(version, budget) {
	if (version !== 1) {
		return {
			verdict: 'legacy-rules',
			safeToCosign: null,
			notes: ['Resource limits are carried by Compute Budget program instructions.'],
		};
	}

	const notes = ['Read caps from transactionConfig. Compute Budget instruction scans do not bind V1 transactions.'];
	if (!budget.computeUnitLimit) notes.push('Compute unit limit is zero or missing, so this V1 transaction cannot execute.');
	if (!budget.loadedAccountsDataSizeLimit) {
		notes.push('Loaded accounts data size limit is zero or missing, so this V1 transaction cannot load account data.');
	}
	if (!budget.priorityFeeLamports) notes.push('No priority fee is set. The transaction is valid but may land slowly.');

	const safeToCosign = Boolean(budget.computeUnitLimit && budget.loadedAccountsDataSizeLimit);
	return { verdict: safeToCosign ? 'caps-explicit' : 'limits-missing', safeToCosign, notes };
}

/** Decode a signed Solana wire transaction into one JSON-safe shape. */
export function inspectWireTransaction(base64Transaction) {
	const value = String(base64Transaction || '').trim();
	if (!value || value.length > 12_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
		throw new TypeError('transaction must be a base64-encoded signed Solana transaction');
	}

	let wire;
	let transaction;
	let compiled;
	try {
		wire = getBase64Encoder().encode(value);
		transaction = getTransactionDecoder().decode(wire);
		compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
	} catch {
		throw new TypeError('transaction is not a valid signed Solana wire transaction');
	}

	const version = compiled.version;
	if (version !== 'legacy' && version !== 0 && version !== 1) {
		throw new TypeError(`unsupported Solana transaction version: ${String(version)}`);
	}

	const limit = version === 1 ? V1_TRANSACTION_LIMIT : LEGACY_TRANSACTION_LIMIT;
	const rawBudget = version === 1 ? budgetFromV1Message(compiled) : budgetFromLegacyMessage(compiled);
	const budget = serializableBudget(rawBudget);
	const signatures = Object.keys(transaction.signatures || {});
	const bytes = wire.length;

	return {
		version,
		versionLabel: version === 'legacy' ? 'Legacy' : `V${version}`,
		wireDiscriminator: version === 1 ? '0x81' : null,
		bytes,
		limitBytes: limit,
		headroomBytes: limit - bytes,
		utilizationPct: Math.round((bytes / limit) * 1_000) / 10,
		largerThanLegacyLimit: bytes > LEGACY_TRANSACTION_LIMIT,
		signatureCount: signatures.length,
		requiredSignatureCount: compiled.header?.numSignerAccounts ?? signatures.length,
		feePayer: signatures[0] || compiled.staticAccounts?.[0] || null,
		staticAccountCount: compiled.numStaticAccounts ?? compiled.staticAccounts?.length ?? 0,
		instructionCount: instructionCount(compiled),
		budget,
		sponsor: sponsorAssessment(version, budget),
	};
}

/** Decode the 9-byte Solana feature account: Option<u64> activation slot. */
export function decodeFeatureActivationSlot(data) {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
	if (bytes.length < 9 || bytes[0] !== 1) return null;
	const slot = new DataView(bytes.buffer, bytes.byteOffset + 1, 8).getBigUint64(0, true);
	return asSafeNumber(slot);
}
