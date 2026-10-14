// Builds a single axios instance wrapped with the @x402 client.
//
// Registers, in order of priority:
//   - eip155:* → BatchSettlementEvmScheme  (cheaper per-call, channel-backed)
//   - eip155:* → ExactEvmScheme            (used when a server doesn't advertise
//                                           batch-settlement for the network)
//   - solana:* and the v1 Solana network strings (`solana`, `solana-devnet`,
//     `solana-testnet`) → ExactSvmScheme / ExactSvmSchemeV1, both registered in
//     one call by registerExactSvmScheme(). Most of the open x402 bazaar and
//     the owner's x402-suite still speak v1; the core client prefers the v2
//     `PAYMENT-REQUIRED` header over a v1 body whenever a seller offers both.
//
// The @x402 core client picks scheme-per-network based on what the 402
// response advertises in `accepts[].scheme`, so registering both EVM schemes
// against the same wildcard is correct: the scheme whose name matches the
// server's selected accept wins.
//
// Spend controls: `onBeforePaymentCreation` aborts payload creation when any
// of these is violated:
//   - per-call:  selected accept's `amount` (v2) or `maxAmountRequired` (v1)
//                exceeds MCP_BRIDGE_MAX_PRICE_PER_CALL_ATOMIC (default
//                100_000 = $0.10)
//   - session:   cumulative atomic spent this process would exceed
//                MCP_BRIDGE_MAX_TOTAL_ATOMIC (default 1_000_000 = $1.00)
//   - payee:     selected `payTo` not in MCP_BRIDGE_ALLOWED_PAYTO (when set)
// The session accumulator only increments when a payment is actually created.
//
// Channel storage: `FileClientChannelStorage` persists voucher + cumulative
// amount per channel under `~/.x402-mcp-bridge/channels/client/`. Restart-safe.

import axios from 'axios';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { BatchSettlementEvmScheme } from '@x402/evm/batch-settlement/client';
// @x402/evm >= 2.14 moved the Node file-backed storage to its own subpath so
// the main client entry stays runtime-agnostic.
import { FileClientChannelStorage } from '@x402/evm/batch-settlement/client/file-storage';
import { registerExactSvmScheme } from '@x402/svm/exact/client';

import { getEvmSigner, getSvmSigner } from './signers.js';
import { getChannelsDirectory } from './storage.js';
import { maxPriceAtomic } from './url-guard.js';

const DEFAULT_DEPOSIT_MULTIPLIER = 5;
const DEFAULT_MAX_DEPOSIT_ATOMIC = 5_000_000n; // $5.00 USDC cap on a single deposit
const DEFAULT_MAX_TOTAL_ATOMIC = 1_000_000n; // $1.00 USDC cumulative session ceiling

function maxTotalAtomic() {
	const raw = process.env.MCP_BRIDGE_MAX_TOTAL_ATOMIC;
	if (!raw) return DEFAULT_MAX_TOTAL_ATOMIC;
	const v = BigInt(raw);
	if (v < 0n) throw new Error('MCP_BRIDGE_MAX_TOTAL_ATOMIC must be non-negative');
	return v;
}

function allowedPayTo() {
	const raw = process.env.MCP_BRIDGE_ALLOWED_PAYTO;
	if (!raw || !raw.trim()) return null;
	return new Set(
		raw
			.split(',')
			.map((a) => a.trim().toLowerCase())
			.filter(Boolean),
	);
}

// Cumulative atomic spend across all payments created in this process. Reset
// only on restart. The session ceiling guards against a compromised/looping
// LLM draining the signer one sub-cap call at a time.
let sessionSpentAtomic = 0n;

function maxDepositAtomic() {
	const raw = process.env.MCP_BRIDGE_MAX_DEPOSIT_ATOMIC;
	if (!raw) return DEFAULT_MAX_DEPOSIT_ATOMIC;
	return BigInt(raw);
}

function depositMultiplier() {
	const raw = process.env.MCP_BRIDGE_BATCH_DEPOSIT_MULTIPLIER;
	if (!raw) return DEFAULT_DEPOSIT_MULTIPLIER;
	const v = Number(raw);
	if (!Number.isFinite(v) || v < 1) {
		throw new Error('MCP_BRIDGE_BATCH_DEPOSIT_MULTIPLIER must be a number >= 1');
	}
	return v;
}

// Exported for direct testing: the hook is pure decision logic over env-derived
// caps plus the module-level session accumulator.
export function buildSpendingCapHook() {
	const perCallCap = maxPriceAtomic();
	const totalCap = maxTotalAtomic();
	const payToAllow = allowedPayTo();
	return async ({ selectedRequirements }) => {
		// v2 requirements name the price `amount`; v1 requirements (still spoken
		// by most of the open x402 bazaar and the owner's x402-suite) name it
		// `maxAmountRequired`. Fall back so a v1 payment is capped too, instead
		// of silently reading as 0 and bypassing both the per-call and session
		// ceilings.
		const amount = BigInt(selectedRequirements?.amount ?? selectedRequirements?.maxAmountRequired ?? '0');
		const network = selectedRequirements?.network;
		const asset = selectedRequirements?.asset;
		const payTo = selectedRequirements?.payTo;

		// 1. Per-call amount cap.
		if (amount > perCallCap) {
			return {
				abort: true,
				reason: `payment refused: selected accept amount ${amount} exceeds per-call cap ${perCallCap} (set MCP_BRIDGE_MAX_PRICE_PER_CALL_ATOMIC to override) — network=${network}, asset=${asset}`,
			};
		}

		// 2. Payee allowlist — reject any payTo not explicitly trusted.
		if (payToAllow) {
			const normalized = String(payTo ?? '').toLowerCase();
			if (!normalized || !payToAllow.has(normalized)) {
				return {
					abort: true,
					reason: `payment refused: payee "${payTo}" is not in MCP_BRIDGE_ALLOWED_PAYTO allowlist — network=${network}`,
				};
			}
		}

		// 3. Cumulative session ceiling. Pre-reserve before any await so two
		// concurrent calls can't both pass the check and jointly overshoot the cap
		// (JavaScript is single-threaded but the check+increment isn't atomic across
		// an await boundary — pre-reserving makes it atomic).
		sessionSpentAtomic += amount;
		if (sessionSpentAtomic > totalCap) {
			sessionSpentAtomic -= amount;  // rollback the reservation
			return {
				abort: true,
				reason: `payment refused: would exceed session spend cap (would reach ${sessionSpentAtomic + amount} > ${totalCap}; already spent ${sessionSpentAtomic}). Set MCP_BRIDGE_MAX_TOTAL_ATOMIC to raise it.`,
			};
		}
		return undefined;
	};
}

function buildDepositStrategy() {
	const cap = maxDepositAtomic();
	return ({ depositAmount }) => {
		const amt = BigInt(depositAmount);
		if (amt > cap) return cap.toString();
		return undefined;
	};
}

let cachedAxios;

export async function buildBuyerAxios() {
	if (cachedAxios) return cachedAxios;

	const client = new x402Client();
	client.onBeforePaymentCreation(buildSpendingCapHook());

	const evmSigner = getEvmSigner();
	if (evmSigner) {
		// Register batch-settlement first so it wins when a server advertises
		// scheme="batch-settlement". For scheme="exact" the core client picks
		// ExactEvmScheme — both are registered under the same wildcard.
		const batchScheme = new BatchSettlementEvmScheme(evmSigner, {
			storage: new FileClientChannelStorage({ directory: getChannelsDirectory() }),
			depositPolicy: { depositMultiplier: depositMultiplier() },
			depositStrategy: buildDepositStrategy(),
		});
		client.register('eip155:*', batchScheme);
		client.register('eip155:*', new ExactEvmScheme(evmSigner));
	}

	const svmSigner = await getSvmSigner();
	if (svmSigner) {
		registerExactSvmScheme(client, { signer: svmSigner });
	}

	if (!evmSigner && !svmSigner) {
		throw new Error(
			'No payment signers configured. Set MCP_BRIDGE_EVM_PRIVATE_KEY and/or MCP_BRIDGE_SVM_PRIVATE_KEY before starting the bridge.',
		);
	}

	const httpClient = new x402HTTPClient(client);
	const api = wrapAxiosWithPayment(
		axios.create({
			timeout: 60_000,
			// Surface 4xx/5xx as rejections so the bridge returns errors to the LLM
			// instead of silently producing a "success" tool result with an error body.
			validateStatus: (s) => s >= 200 && s < 300,
			// SSRF: never follow redirects. assertPayableUrl validates the request
			// URL, but a public host can 3xx-redirect to an internal target
			// (169.254.169.254, localhost, RFC1918) that bypasses that check. With
			// maxRedirects:0 a 3xx surfaces as an error instead of being chased.
			maxRedirects: 0,
		}),
		client,
	);

	cachedAxios = { api, client, httpClient };
	return cachedAxios;
}

export function extractReceipt(httpClient, response) {
	if (!response || !response.headers) return undefined;
	const getHeader = (name) => response.headers[name] ?? response.headers[name.toLowerCase()];
	try {
		return httpClient.getPaymentSettleResponse(getHeader);
	} catch {
		return undefined;
	}
}
