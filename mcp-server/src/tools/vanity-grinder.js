// `vanity_grinder` — paid MCP tool that brute-forces a Solana keypair whose
// base58 public key starts with a chosen prefix (and optionally ends with a
// chosen suffix).
//
// Pricing: flat `exact` price in USDC on Solana (default $0.05, override with
// MCP_VANITY_PRICE_USD). Metered/`upto` billing is not available on Solana —
// @x402/svm ships no `upto` scheme — so this tool charges a single flat fee
// regardless of attempt count.
//
// Output (over the same MCP channel — clients should treat as secret):
//   - address (base58)
//   - privateKey64 (base58, full 64-byte secret key as @solana/web3.js expects)
//   - iterations + durationMs
//
// The grinder is the same async-yielding routine in api/_lib/pump-vanity.js
// (BASE58_ALPHABET, 6-char max pattern, lowercase ignoreCase support). It
// runs in-process — there is no external service.

import { z } from 'zod';

import { paid } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { grindMintKeypair, estimateAttempts, BASE58_ALPHABET } from '../lib/pump-vanity.js';
import { grindMnemonicKeypair, MAX_MNEMONIC_PATTERN_LENGTH } from '../lib/mnemonic-vanity.js';
import bs58 from 'bs58';

const TOOL_NAME = 'vanity_grinder';

// Flat price charged per successful grind, in USDC on Solana.
const PRICE_USD = process.env.MCP_VANITY_PRICE_USD?.trim() || '$0.05';

// Hard upper bound on grinder iterations. Each iteration is a synchronous
// ed25519 keypair generation; the loop yields periodically but still pins the
// single-threaded event loop while running. Cap it so a single paid call
// cannot monopolize the process. 1.5M attempts is enough to reliably find a
// 4-char prefix (~58^4 ≈ 11.3M expected, but most 1-3 char requests land far
// sooner); anything longer is rejected up front by the difficulty guard below.
const MAX_ITERATIONS_CAP = 1_500_000;
const DEFAULT_MAX_ITERATIONS = 1_500_000;

// Reject requests whose expected attempts dwarf the iteration cap rather than
// grinding to the cap and timing out. We allow a generous multiple of the cap
// (vanity grinding is probabilistic, so a request with expected ~= cap can
// still succeed), but a prefix that is, say, 10x harder than the cap will
// almost always time out and waste the caller's time and payment.
const DIFFICULTY_REJECT_MULTIPLE = 4;

const TOOL_DESCRIPTION =
	`Generate a Solana wallet whose base58 address starts with a chosen prefix (and optionally ends with a chosen suffix). ` +
	`Set \`mnemonic: true\` to receive a BIP-39 SEED PHRASE (12 or 24 words) whose derived key at m/44'/501'/0'/0' lands on the ` +
	`vanity address — importable as a recovery phrase into Phantom/Solflare/the Solana CLI (combined pattern capped at ` +
	`${MAX_MNEMONIC_PATTERN_LENGTH} chars, ~100× slower to grind). Otherwise a raw 64-byte private key is returned. ` +
	`SECURITY: the returned \`privateKey64\`/\`mnemonic\` is a REAL, fully-funded-capable secret. It transits the MCP channel in plaintext, ` +
	`so the MCP host (Claude Desktop, Cursor, any proxy) MAY LOG the entire response. Treat the whole tool result as a secret, ` +
	`import it into a wallet immediately, and never reuse a secret that may have been logged. ` +
	`Use this to grind a fresh address with a short pattern (about 3 characters is the practical reach); for longer brandable addresses already in stock, call vanity_premium instead. ` +
	`Billed via x402 \`exact\` (flat ${PRICE_USD} USDC on Solana).`;

// Single source of truth: Zod shape carries descriptions + bounds; JSON Schema
// derived. Previously the JSON Schema and Zod both capped prefix/suffix at 6
// chars and maxIterations at MAX_ITERATIONS_CAP — kept identical here.
const inputZodShape = {
	prefix: z
		.string()
		.min(1)
		.max(6)
		.describe(
			`Base58 prefix the address must start with. Allowed chars: ${BASE58_ALPHABET}. 1-6 chars (longer prefixes are exponentially harder and are rejected).`,
		),
	suffix: z
		.string()
		.min(1)
		.max(6)
		.describe('Optional base58 suffix the address must end with. 1-6 chars.')
		.optional(),
	ignoreCase: z.boolean().describe('Case-insensitive match (folds upper+lower base58 chars).').optional(),
	mnemonic: z
		.boolean()
		.describe(
			`Return a BIP-39 seed phrase (importable as a recovery phrase) instead of a raw private key. ` +
				`~100× slower; combined prefix+suffix capped at ${MAX_MNEMONIC_PATTERN_LENGTH} chars in this mode.`,
		)
		.optional(),
	strength: z
		.union([z.literal(128), z.literal(256)])
		.describe('Mnemonic mode only: entropy bits — 128 → 12 words (default), 256 → 24 words.')
		.optional(),
	maxIterations: z
		.number()
		.int()
		.min(1)
		.max(MAX_ITERATIONS_CAP)
		.describe(`Hard cap on grinder iterations. Default ${DEFAULT_MAX_ITERATIONS}, clamped to ${MAX_ITERATIONS_CAP}.`)
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

// Up-front difficulty guard. Returns null if the request is feasible within the
// iteration cap, or a helpful Error (status 400) if the requested prefix/suffix
// is so hard it would grind to the cap and time out. Exported for tests.
export function assertGrindFeasible({ prefix, suffix, ignoreCase = false, maxIterations = DEFAULT_MAX_ITERATIONS } = {}) {
	const cap = Math.min(Math.max(1, Math.floor(maxIterations)), MAX_ITERATIONS_CAP);
	const expected = estimateAttempts({ prefix, suffix, ignoreCase });
	if (expected > cap * DIFFICULTY_REJECT_MULTIPLE) {
		const pattern = [prefix ? `prefix '${prefix}'` : null, suffix ? `suffix '${suffix}'` : null]
			.filter(Boolean)
			.join(' + ');
		return Object.assign(
			new Error(
				`Pattern too hard: ${pattern} needs ~${Math.round(expected).toLocaleString()} expected attempts, ` +
					`but the grinder caps at ${cap.toLocaleString()} iterations. ` +
					`Use a shorter prefix/suffix (each extra base58 char is ~${ignoreCase ? 33 : 58}x harder)` +
					`${ignoreCase ? '' : ', or enable ignoreCase to roughly halve the difficulty per char'}.`,
			),
			{ status: 400, code: 'vanity_too_hard' },
		);
	}
	return null;
}

export async function buildVanityGrinderTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			priceUsd: PRICE_USD,
			inputSchema: inputJsonSchema,
			example: { prefix: 'pump' },
			outputExample: {
				address: 'pumpXYZ...',
				privateKey64: '5x...base58...',
				iterations: 12345,
				durationMs: 230,
				priceUsd: PRICE_USD,
			},
		},
		async ({ prefix, suffix, ignoreCase = false, mnemonic = false, strength = 128, maxIterations = DEFAULT_MAX_ITERATIONS }) => {
			// Mnemonic mode: grind a BIP-39 seed phrase whose derived key lands on
			// the vanity address. The grinder enforces its own (lower) pattern cap
			// and iteration budget and throws on exhaustion so the caller isn't
			// charged. Returns the phrase plus the derived 64-byte secret key.
			if (mnemonic) {
				const grind = await grindMnemonicKeypair({ prefix, suffix, ignoreCase, strength });
				const address = grind.keypair.publicKey.toBase58();
				const privateKey64 = bs58.encode(Buffer.from(grind.keypair.secretKey));
				return {
					address,
					mnemonic: grind.mnemonic,
					wordCount: grind.wordCount,
					derivationPath: grind.derivationPath,
					privateKey64,
					iterations: grind.iterations,
					estimatedIterations: Math.round(estimateAttempts({ prefix, suffix, ignoreCase })),
					durationMs: grind.durationMs,
					prefix,
					suffix: suffix || null,
					ignoreCase,
					format: 'mnemonic',
					priceUsd: PRICE_USD,
					_secretWarning:
						'mnemonic and privateKey64 are a REAL Solana seed phrase and key. They just transited the MCP channel ' +
						'in plaintext, so the MCP host (Claude Desktop / Cursor / any proxy) MAY have logged this entire response. ' +
						'Import the phrase into a wallet now, treat the whole result as a secret, and do not reuse a secret you suspect was logged.',
				};
			}

			// Clamp the caller-supplied cap into the safe range so a single paid
			// call can never schedule millions of synchronous keypair generations.
			const cap = Math.min(Math.max(1, Math.floor(maxIterations)), MAX_ITERATIONS_CAP);

			// Reject impossible-to-satisfy patterns up front instead of grinding
			// to the cap and timing out (event-loop DoS / wasted payment).
			const infeasible = assertGrindFeasible({ prefix, suffix, ignoreCase, maxIterations: cap });
			if (infeasible) throw infeasible;

			const expected = estimateAttempts({ prefix, suffix, ignoreCase });
			const grind = await grindMintKeypair({
				prefix,
				suffix,
				ignoreCase,
				maxIterations: cap,
			});
			const address = grind.keypair.publicKey.toBase58();
			// @solana/web3.js Keypair.secretKey is the full 64-byte ed25519 secret
			// (32-byte seed || 32-byte pubkey). Wallets like Phantom import this
			// directly as base58. The client is responsible for storing it.
			//
			// NOTE: privateKey64 is intentionally NEVER passed to console.log/error
			// anywhere in this path — the only sink is the structured tool result.
			const privateKey64 = bs58.encode(Buffer.from(grind.keypair.secretKey));
			return {
				address,
				privateKey64,
				iterations: grind.iterations,
				estimatedIterations: Math.round(expected),
				durationMs: grind.durationMs,
				prefix,
				suffix: suffix || null,
				ignoreCase,
				format: 'keypair',
				priceUsd: PRICE_USD,
				_secretWarning:
					'privateKey64 is a REAL Solana private key. It just transited the MCP channel in plaintext, ' +
					'so the MCP host (Claude Desktop / Cursor / any proxy) MAY have logged this entire response. ' +
					'Import it into a wallet now, treat the whole result as a secret, and do not reuse a key you suspect was logged.',
			};
		},
	);
	return {
		name: TOOL_NAME,
		title: `Solana vanity grinder (${PRICE_USD})`,
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Pure local compute with no external interaction, but output is a
		// freshly-random keypair every call — never idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
		handler,
	};
}
