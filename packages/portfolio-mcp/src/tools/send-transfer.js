// `send_transfer` — sign and broadcast a real Solana transfer (SOL or any SPL
// token) from the agent's own wallet. THE ONLY WRITE TOOL. Funds-moving,
// irreversible.
//
// Signs LOCALLY with SOLANA_SECRET_KEY (or a per-call `secret`). The mint is
// runtime input — pass `$THREE` or any SPL mint you hold; nothing is hardcoded.

import { z } from 'zod';

import { sendTransfer } from '../lib/solana.js';
import { assertRecipientAllowed, confirmationGate } from '../lib/spend-policy.js';

export const def = {
	name: 'send_transfer',
	title: 'Send SOL or an SPL token on Solana mainnet',
	// MCP ToolAnnotations — EXECUTION: broadcasts a real, irreversible Solana
	// mainnet transaction that moves funds out of the signing wallet.
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'BROADCASTS A REAL, IRREVERSIBLE SOLANA MAINNET TRANSACTION that moves funds out of the agent’s own wallet. ' +
		'Sends native SOL (omit `mint`, or set mint:"native") or any SPL token (pass its base58 `mint` — supplied ' +
		'at call time, e.g. the $THREE mint or any token you hold). Signs locally with the per-call `secret` ' +
		'(base58) or SOLANA_SECRET_KEY on the server; for a token it auto-creates the recipient’s associated token ' +
		'account when missing. Returns the confirmed signature, the moved amount, and a Solscan link. EXECUTION ' +
		'ACTION — pass confirm:true to proceed. Native sends are capped by MAX_SOL_PER_TX; the recipient must be ' +
		'in RECIPIENT_ALLOWLIST when one is configured. Use this after preview_transfer, and only on the person\'s explicit ' +
		'yes to that recipient and amount.',
	inputSchema: {
		recipient: z.string().min(32).max(44).describe('Destination Solana pubkey (base58).'),
		amount: z
			.string()
			.regex(/^(\d+(\.\d*)?|\.\d+)$/, 'amount must be a positive decimal string, e.g. "1.5"')
			.describe('Amount to send, in human units as a decimal string (e.g. "1.5" SOL or "100" tokens).'),
		mint: z
			.string()
			.optional()
			.describe('SPL token mint (base58) to send. Omit or set "native" to send SOL. Runtime input — any mint you hold.'),
		secret: z
			.string()
			.optional()
			.describe('Base58 secret of the sending wallet. Falls back to SOLANA_SECRET_KEY on the server.'),
		priorityMicroLamports: z
			.number()
			.int()
			.min(0)
			.max(50_000_000)
			.optional()
			.describe('Compute-unit price in micro-lamports (default 100000).'),
		confirm: z
			.boolean()
			.optional()
			.describe('Must be true to execute this irreversible transfer (when REQUIRE_CONFIRM is on).'),
	},
	async handler(args) {
		const gate = confirmationGate(args?.confirm, 'send_transfer');
		if (gate) return gate;
		try {
			assertRecipientAllowed(args.recipient, 'send_transfer recipient');
			const out = await sendTransfer({
				secret: args.secret,
				to: args.recipient,
				amount: args.amount,
				mint: args.mint,
				priorityMicroLamports: args.priorityMicroLamports,
			});
			return { ok: true, ...out };
		} catch (err) {
			return {
				ok: false,
				error: err.code || 'transfer_failed',
				message: err.message,
				signature: err.signature || null,
				...(err.status ? { status: err.status } : {}),
			};
		}
	},
};
