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
	getRequestHeapFrameInstruction,
	getRequestHeapFrameInstructionDataDecoder,
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitLimitInstructionDataDecoder,
	getSetComputeUnitPriceInstruction,
	getSetComputeUnitPriceInstructionDataDecoder,
	getSetLoadedAccountsDataSizeLimitInstruction,
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
	compileTransactionMessage,
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

// Agave's cost model treats an unset loaded-accounts-data-size request as
// this ceiling on legacy/v0 (MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES); V1 instead
// defaults an unset request to 0 (SIMD-0385), so the planner reports headroom
// against this same ceiling either way: on legacy/v0 an unset request already
// sits at it, on V1 an unset request has the full ceiling in hand.
export const LOADED_ACCOUNTS_DATA_SIZE_DEFAULT_MAX = 64 * 1024 * 1024;

// A synthetic lifetime for size-only planning: the planner never broadcasts,
// so this only needs to decode to 32 bytes, never a real recent blockhash.
const SYNTHETIC_LIFETIME = 'So11111111111111111111111111111111111111112';

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
 * @param {string[]} [input.clientSigners] Signer addresses whose keys live in the
 *   browser (e.g. a vanity asset keypair). Their slots stay empty for the client.
 */
export async function buildPartiallySignedV1Transaction({
	instructions,
	signers = [],
	feePayer,
	lifetime,
	config = AGENT_DEPLOY_V1_CONFIG,
	clientSigners = [],
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
	const leaveEmpty = new Set([String(feePayer), ...clientSigners.map(String)]);
	for (const signer of signers) {
		const signerAddress = String(signer.publicKey);
		// The wallet fee payer and any browser-held key are represented by Umi
		// noop signers, whose signMessage echoes the message back. Keep those
		// slots null so the client fills them with real signatures.
		if (leaveEmpty.has(signerAddress) || signatures[signerAddress] === undefined) continue;
		const signature = await signer.signMessage(transaction.messageBytes);
		if (!(signature instanceof Uint8Array) || signature.length !== 64) {
			throw new Error(`signer ${signerAddress} did not return a 64-byte ed25519 signature`);
		}
		signatures[signerAddress] = signature;
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

/** Total lamports for a compute-unit price, rounded up to the nearest lamport (matches the runtime's own ceiling-division cost accounting). */
function priorityFeeLamportsFor(computeUnitLimit, microLamportsPerCu) {
	return (BigInt(computeUnitLimit) * BigInt(microLamportsPerCu) + 999_999n) / 1_000_000n;
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
		budget.priorityFeeLamports = priorityFeeLamportsFor(budget.computeUnitLimit ?? implicitComputeLimit, priceMicroLamportsPerCu);
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

/** The v1 sanitization rule (SIMD-0385, "Addresses"): the static account table must contain no duplicates. Works for any version; legacy/v0 fail the same way if an encoder lists one address twice. */
export function findDuplicateAccounts(addresses) {
	const counts = new Map();
	for (const raw of addresses || []) {
		const key = String(raw);
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return [...counts.entries()].filter(([, count]) => count > 1).map(([address, count]) => ({ address, count }));
}

function toHex(bytes) {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const CONFIG_MASK_FIELDS = [
	{ field: 'priorityFeeLamports', label: 'Priority fee', bits: [0, 1], byteWidth: 8, read: (view, offset) => view.getBigUint64(offset, true) },
	{ field: 'computeUnitLimit', label: 'Compute unit limit', bits: [2], byteWidth: 4, read: (view, offset) => view.getUint32(offset, true) },
	{ field: 'loadedAccountsDataSizeLimit', label: 'Loaded accounts data size limit', bits: [3], byteWidth: 4, read: (view, offset) => view.getUint32(offset, true) },
	{ field: 'heapSize', label: 'Requested heap size', bits: [4], byteWidth: 4, read: (view, offset) => view.getUint32(offset, true) },
];
const CONFIG_MASK_KNOWN_BITS = (1 << 5) - 1;

/**
 * Decode SIMD-0385's TransactionConfigMask and ConfigValues directly from a
 * V1 message's bytes, independent of @solana/kit's own higher-level config
 * decode: VersionByte, LegacyHeader(3), ConfigMask(u32 LE), LifetimeSpecifier
 * (32), NumInstructions, NumAddresses, Addresses, then ConfigValues in
 * ascending bit order (each bit = one 4-byte slot; priority fee spans two
 * bits for its 8-byte u64). Byte offsets confirmed against transactions this
 * module itself compiles (see tests/transaction-v1-lab.test.js).
 */
export function decodeV1ConfigMask(messageBytes) {
	const bytes = messageBytes instanceof Uint8Array ? messageBytes : new Uint8Array(messageBytes);
	if (bytes.length < 42 || bytes[0] !== 0x81) throw new TypeError('messageBytes is not a V1 transaction message');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	const mask = view.getUint32(4, true);
	const numInstructions = bytes[40];
	const numAddresses = bytes[41];
	const configValuesByteOffset = 42 + numAddresses * 32;
	let offset = configValuesByteOffset;

	const fields = CONFIG_MASK_FIELDS.map((spec) => {
		const bitValues = spec.bits.map((bit) => (mask >>> bit) & 1);
		const present = bitValues.every((value) => value === 1);
		const invalidPartial = !present && bitValues.some((value) => value === 1);
		const field = { field: spec.field, label: spec.label, bits: spec.bits, present, invalidPartial, byteWidth: spec.byteWidth, rawHex: null, value: null };
		if (present) {
			field.rawHex = toHex(bytes.slice(offset, offset + spec.byteWidth));
			const read = spec.read(view, offset);
			field.value = typeof read === 'bigint' ? asSafeNumber(read) : read;
			offset += spec.byteWidth;
		}
		return field;
	});

	const reservedBits = mask & ~CONFIG_MASK_KNOWN_BITS;
	return {
		maskUint32: mask,
		maskHex: `0x${mask.toString(16).padStart(8, '0')}`,
		maskBinary: mask.toString(2).padStart(32, '0'),
		popcount: mask.toString(2).split('').filter((bit) => bit === '1').length,
		fields,
		reservedBitsSet: reservedBits !== 0,
		reservedBitsHex: reservedBits ? `0x${reservedBits.toString(16)}` : null,
		header: {
			numRequiredSignatures: bytes[1],
			numReadonlySignedAccounts: bytes[2],
			numReadonlyUnsignedAccounts: bytes[3],
		},
		numInstructions,
		numAddresses,
		configValuesByteOffset,
		configValuesByteLength: offset - configValuesByteOffset,
	};
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
	const staticAccounts = (compiled.staticAccounts || []).map(String);

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
		duplicateAccounts: findDuplicateAccounts(staticAccounts),
		configMask: version === 1 ? decodeV1ConfigMask(transaction.messageBytes) : null,
	};
}

/** Decode the 9-byte Solana feature account: Option<u64> activation slot. */
export function decodeFeatureActivationSlot(data) {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
	if (bytes.length < 9 || bytes[0] !== 1) return null;
	const slot = new DataView(bytes.buffer, bytes.byteOffset + 1, 8).getBigUint64(0, true);
	return asSafeNumber(slot);
}

/** A synthetic lifetime that decodes to 32 bytes, for size-only planning that never broadcasts. */
export const SYNTHETIC_PLAN_BLOCKHASH = SYNTHETIC_LIFETIME;

const MAX_PLANNED_INSTRUCTIONS = 64;

/** Normalize pasted Umi/web3.js-shaped instructions into the {programId, keys, data} shape toKitInstruction expects, with clear errors for a hand-edited paste box. */
export function parseInstructionsInput(instructions) {
	if (!Array.isArray(instructions) || instructions.length === 0) {
		throw new TypeError('instructions must be a non-empty array');
	}
	if (instructions.length > MAX_PLANNED_INSTRUCTIONS) {
		throw new TypeError(`a transaction cannot hold more than ${MAX_PLANNED_INSTRUCTIONS} instructions`);
	}
	return instructions.map((raw, i) => {
		if (!raw || typeof raw.programId !== 'string') throw new TypeError(`instructions[${i}].programId must be a base58 program address`);
		if (!Array.isArray(raw.keys)) throw new TypeError(`instructions[${i}].keys must be an array`);
		let data;
		try {
			data = typeof raw.data === 'string' ? getBase64Encoder().encode(raw.data) : Uint8Array.from(raw.data || []);
		} catch {
			throw new TypeError(`instructions[${i}].data must be base64 or a byte array`);
		}
		return {
			programId: raw.programId,
			keys: raw.keys.map((key, k) => {
				if (!key || typeof key.pubkey !== 'string') throw new TypeError(`instructions[${i}].keys[${k}].pubkey must be a base58 address`);
				return { pubkey: key.pubkey, isSigner: Boolean(key.isSigner), isWritable: Boolean(key.isWritable) };
			}),
			data,
		};
	});
}

/** Legacy/v0 carry resource requests as ComputeBudget program instructions. */
function budgetInstructionsForLegacy(budgetConfig) {
	const instructions = [];
	if (budgetConfig.computeUnitLimit != null) instructions.push(getSetComputeUnitLimitInstruction({ units: budgetConfig.computeUnitLimit }));
	if (budgetConfig.priorityFeeMicroLamportsPerCu != null) {
		instructions.push(getSetComputeUnitPriceInstruction({ microLamports: BigInt(budgetConfig.priorityFeeMicroLamportsPerCu) }));
	}
	if (budgetConfig.loadedAccountsDataSizeLimit != null) {
		instructions.push(getSetLoadedAccountsDataSizeLimitInstruction({ accountDataSizeLimit: budgetConfig.loadedAccountsDataSizeLimit }));
	}
	if (budgetConfig.heapSize != null) instructions.push(getRequestHeapFrameInstruction({ bytes: budgetConfig.heapSize }));
	return instructions;
}

/** V1 carries the same requests in transactionConfig instead of instructions. */
function v1ConfigFrom(budgetConfig) {
	const config = {};
	if (budgetConfig.computeUnitLimit != null) config.computeUnitLimit = budgetConfig.computeUnitLimit;
	if (budgetConfig.loadedAccountsDataSizeLimit != null) config.loadedAccountsDataSizeLimit = budgetConfig.loadedAccountsDataSizeLimit;
	if (budgetConfig.heapSize != null) config.heapSize = budgetConfig.heapSize;
	if (budgetConfig.computeUnitLimit != null && budgetConfig.priorityFeeMicroLamportsPerCu != null) {
		config.priorityFeeLamports = priorityFeeLamportsFor(budgetConfig.computeUnitLimit, budgetConfig.priorityFeeMicroLamportsPerCu);
	}
	return config;
}

/**
 * Compile one instruction set for one transaction version and report exact
 * wire metrics: no estimate, no broadcast, no signing. @solana/kit reports a
 * transaction's true size before anyone has signed it (compileTransaction
 * leaves every required signer's slot `null`, and getTransactionEncoder still
 * encodes the full reserved 64-byte slot for it); buildPartiallySignedV1Transaction
 * above already relies on exactly this to size-check a transaction mid-flow.
 */
export function planTransactionSize({ instructions, feePayer, blockhash: blockhashInput = SYNTHETIC_LIFETIME, version, budgetConfig = {} }) {
	if (version !== 'legacy' && version !== 0 && version !== 1) throw new TypeError('version must be "legacy", 0, or 1');
	if (typeof feePayer !== 'string' || !feePayer) throw new TypeError('feePayer is required');

	const parsedInstructions = parseInstructionsInput(instructions);
	const naiveAccounts = new Set([feePayer]);
	for (const ix of parsedInstructions) {
		naiveAccounts.add(ix.programId);
		for (const key of ix.keys) naiveAccounts.add(key.pubkey);
	}
	const kitInstructions = parsedInstructions.map(toKitInstruction);
	const budgetInstructions = version === 1 ? [] : budgetInstructionsForLegacy(budgetConfig);

	let message = pipe(
		createTransactionMessage({ version }),
		(m) => setTransactionMessageFeePayer(address(feePayer), m),
		(m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(blockhashInput), lastValidBlockHeight: 0n }, m),
		(m) => appendTransactionMessageInstructions([...budgetInstructions, ...kitInstructions], m),
	);
	if (version === 1) message = setTransactionMessageConfig(v1ConfigFrom(budgetConfig), message);

	const compiledMessage = compileTransactionMessage(message);
	const compiled = compileTransaction(message);
	const encoded = getTransactionEncoder().encode(compiled);
	const limitBytes = version === 1 ? V1_TRANSACTION_LIMIT : LEGACY_TRANSACTION_LIMIT;
	const staticAccounts = (compiledMessage.staticAccounts || []).map(String);

	const implicitComputeLimit = defaultComputeUnitLimit(budgetInstructions.length + kitInstructions.length);
	const resolvedComputeUnitLimit = budgetConfig.computeUnitLimit ?? (version === 1 ? 0 : implicitComputeLimit);
	const requestedDataSizeLimit = budgetConfig.loadedAccountsDataSizeLimit ?? (version === 1 ? 0 : LOADED_ACCOUNTS_DATA_SIZE_DEFAULT_MAX);
	const priorityFeeLamports = budgetConfig.priorityFeeMicroLamportsPerCu != null
		? priorityFeeLamportsFor(resolvedComputeUnitLimit, budgetConfig.priorityFeeMicroLamportsPerCu)
		: 0n;

	return {
		version,
		versionLabel: version === 'legacy' ? 'Legacy' : `V${version}`,
		bytes: encoded.length,
		messageBytes: compiled.messageBytes.length,
		signatureBytes: encoded.length - compiled.messageBytes.length,
		limitBytes,
		headroomBytes: limitBytes - encoded.length,
		overLimitBy: Math.max(0, encoded.length - limitBytes),
		fitsLegacy: encoded.length <= LEGACY_TRANSACTION_LIMIT,
		fitsV1: encoded.length <= V1_TRANSACTION_LIMIT,
		staticAccountCount: staticAccounts.length,
		instructionCount: budgetInstructions.length + kitInstructions.length,
		signerCount: Object.keys(compiled.signatures || {}).length,
		duplicateAccounts: findDuplicateAccounts(staticAccounts),
		accountReuse: {
			referencedCount: naiveAccounts.size,
			dedupedCount: staticAccounts.length,
		},
		resourceBudget: {
			computeUnitLimit: resolvedComputeUnitLimit,
			loadedAccountsDataSizeLimit: requestedDataSizeLimit,
			loadedAccountsHeadroomBytes: LOADED_ACCOUNTS_DATA_SIZE_DEFAULT_MAX - requestedDataSizeLimit,
			priorityFeeLamports: asSafeNumber(priorityFeeLamports),
		},
	};
}

/** The same instruction set compiled legacy, v0, and v1: byte-exact totals for all three, side by side. */
export function diffTransactionVersions({ instructions, feePayer, blockhash: blockhashInput, budgetConfig = {} }) {
	const plan = (version) => planTransactionSize({ instructions, feePayer, blockhash: blockhashInput, version, budgetConfig });
	const legacy = plan('legacy');
	const v0 = plan(0);
	const v1 = plan(1);
	return {
		legacy,
		v0,
		v1,
		bytesSavedVsLegacy: legacy.bytes - v1.bytes,
		bytesSavedVsV0: v0.bytes - v1.bytes,
	};
}
