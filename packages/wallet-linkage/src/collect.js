// Solana activity collector: walks one address's recent transaction history
// through an injected RPC client (the caller's own failover-chain Connection,
// never a hardcoded endpoint) and reduces it to the shapes the signals need:
// inbound/outbound transfers, the set of fee payers seen on its transactions,
// and its first inbound transfer (the funding root).
//
// Bounded by both a signature-count cap and a wall-clock budget: deep wallet
// history on a slow RPC lane must degrade to a partial, honest answer
// (`complete: false`) rather than hang a request (see the work order's
// "signals need deep history and RPC is slow" never-blocked row).

import { PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAMS = new Set([
	'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
	'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

export const DEFAULT_SIGNATURE_LIMIT = 40;
export const DEFAULT_BUDGET_MS = 8_000;

function toPubkey(address) {
	return address instanceof PublicKey ? address : new PublicKey(address);
}

function tokenOwnerAt(tx, accountAddress) {
	const keys = tx?.transaction?.message?.accountKeys ?? [];
	const idx = keys.findIndex((k) => (k?.pubkey ?? k) === accountAddress);
	if (idx < 0) return null;
	const pre = (tx?.meta?.preTokenBalances ?? []).find((b) => b.accountIndex === idx);
	const post = (tx?.meta?.postTokenBalances ?? []).find((b) => b.accountIndex === idx);
	return (post ?? pre)?.owner ?? null;
}

/**
 * Reduce one `jsonParsed` transaction to its fee payer and the wallet-level
 * transfers it carried. Native SOL instructions already name wallets; SPL
 * instructions name token accounts, so the destination is resolved to its
 * owning wallet via the transaction's pre/post token balances.
 *
 * @param {object} tx parsed transaction
 * @param {string} signature
 * @returns {{ feePayer: string|null, transfers: Array<object> }}
 */
export function extractTransfers(tx, signature) {
	const message = tx?.transaction?.message;
	const feePayerKey = message?.accountKeys?.[0]?.pubkey ?? message?.accountKeys?.[0] ?? null;
	const feePayer = feePayerKey?.toBase58?.() ?? (typeof feePayerKey === 'string' ? feePayerKey : null);
	const blockTime = tx?.blockTime ?? null;
	const instructions = message?.instructions ?? [];
	const transfers = [];

	for (const ix of instructions) {
		const parsed = ix?.parsed;
		if (!parsed || typeof parsed !== 'object') continue;
		const type = parsed.type;
		const info = parsed.info ?? {};

		if (ix.program === 'system' && type === 'transfer') {
			const amount = Number(info.lamports ?? 0) / 1e9;
			if (info.source && info.destination && amount > 0) {
				transfers.push({ from: info.source, to: info.destination, amount, asset: 'SOL', kind: 'native', signature, blockTime });
			}
			continue;
		}
		if (ix.program === 'system' && type === 'createAccount') {
			const amount = Number(info.lamports ?? 0) / 1e9;
			if (info.source && info.newAccount) {
				transfers.push({ from: info.source, to: info.newAccount, amount, asset: 'SOL', kind: 'create', signature, blockTime });
			}
			continue;
		}
		if ((type === 'transfer' || type === 'transferChecked') && TOKEN_PROGRAMS.has(ix.programId)) {
			const amount = Number(info.tokenAmount?.uiAmount ?? info.amount ?? 0);
			const from = info.authority ?? null;
			const to = info.destination ? tokenOwnerAt(tx, info.destination) : null;
			if (from && to && amount > 0) {
				transfers.push({ from, to, amount, asset: info.mint ?? 'SPL', kind: 'token', signature, blockTime });
			}
		}
	}

	return { feePayer, transfers };
}

/**
 * Collect one address's recent activity into the shape every linkage signal
 * reads: `transfers` (chronological), `payers` (fee payers across its own
 * transactions), and `firstInbound` (the earliest transfer that funded it).
 *
 * @param {object} connection injected RPC client: `getSignaturesForAddress`,
 *   `getParsedTransaction`: a `@solana/web3.js` Connection, or anything
 *   shaped like one.
 * @param {string} address
 * @param {{ signatureLimit?: number, budgetMs?: number, commitment?: string }} [opts]
 */
export async function collectActivity(connection, address, opts = {}) {
	const { signatureLimit = DEFAULT_SIGNATURE_LIMIT, budgetMs = DEFAULT_BUDGET_MS, commitment = 'confirmed' } = opts;
	const startedAt = Date.now();
	const deadline = startedAt + budgetMs;
	const warnings = [];

	let signatures = [];
	try {
		signatures = await connection.getSignaturesForAddress(toPubkey(address), { limit: signatureLimit });
	} catch (err) {
		return {
			address,
			transfers: [],
			payers: new Set(),
			firstInbound: null,
			complete: false,
			fetchMs: Date.now() - startedAt,
			warnings: [`signatures: ${err?.message || err}`],
		};
	}

	const transfers = [];
	const payers = new Set();
	let truncated = false;

	for (const sig of signatures) {
		if (Date.now() >= deadline) {
			truncated = true;
			break;
		}
		if (sig.err) continue;
		let tx;
		try {
			tx = await connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0, commitment });
		} catch (err) {
			warnings.push(`tx ${String(sig.signature).slice(0, 8)}: ${err?.message || err}`);
			continue;
		}
		if (!tx) continue;
		const { feePayer, transfers: txTransfers } = extractTransfers(tx, sig.signature);
		if (feePayer) payers.add(feePayer);
		for (const t of txTransfers) transfers.push({ ...t, blockTime: t.blockTime ?? sig.blockTime ?? null });
	}

	transfers.sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
	const firstInbound = transfers.find((t) => t.to === address && t.from !== address) ?? null;

	return {
		address,
		transfers,
		payers,
		firstInbound,
		complete: !truncated,
		fetchMs: Date.now() - startedAt,
		warnings,
	};
}

/**
 * Best-effort account facts beyond transfer history: whether `address` is
 * itself an SPL token account, and who owns it. Feeds `solana-account-control`.
 * A lookup failure is never fatal: it just means this signal has nothing to
 * add for this address.
 *
 * @param {object} connection injected RPC client exposing `getAccountInfo`.
 * @param {string} address
 */
export async function fetchAccountFacts(connection, address) {
	try {
		const info = await connection.getAccountInfo(toPubkey(address), { encoding: 'jsonParsed' });
		const parsed = info?.value?.data?.parsed ?? info?.data?.parsed;
		if (parsed?.type === 'account' && parsed?.info?.owner) {
			return { tokenOwner: parsed.info.owner, isTokenAccount: true };
		}
	} catch {
		// Best-effort: see docstring above.
	}
	return { tokenOwner: null, isTokenAccount: false };
}
