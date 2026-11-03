// threews-agent MCP: the account holder's own wallet and a one-call overview.
//
//   read  get_private_wallet_balance, get_wallet_summaries
//
// Read only. The private wallet is the primary Solana wallet linked to the
// account (the owner's own signer, never platform custody); the summaries add
// every agent wallet's latest hourly snapshot. Neither tool signs or moves funds.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { readPrivateWallet, readWalletSummaries } from '../_lib/custody/private-wallet.js';

const LIVE_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const SNAPSHOT_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const usd = (n) => (n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const networkProp = { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Solana cluster.' };

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function guard(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
	if (!auth.userId) return refusal('Sign in to three.ws to read your wallets.', 'auth_required', { signed_in: false });
	if (!hasScope(auth.scope, 'wallet:read') && !hasScope(auth.scope, 'wallet:write')) {
		return refusal('Reading wallets needs the wallet:read scope. Re-authorize with it granted.', 'insufficient_scope', { required: 'wallet:read' });
	}
	return null;
}

function clientRefusal(err) {
	if (err?.status >= 400 && err.status < 500 && err.code) return refusal(err.message, err.code);
	throw err;
}

export const privateWalletToolDefs = [
	{
		name: 'get_private_wallet_balance',
		title: "Read the owner's own wallet balance",
		group: 'wallet',
		tier: 'read',
		annotations: LIVE_READ,
		description: "Live SOL and USDC balance of the account's own primary linked Solana wallet (the wallet the owner signs with, not an agent's platform wallet), with USD value. Use this when the user asks what is in their own wallet, or whether they can cover a transfer from it. Says plainly when no Solana wallet is linked.",
		inputSchema: { type: 'object', properties: { network: networkProp }, additionalProperties: false },
		handler: async (args, auth) => {
			const blocked = await guard(auth);
			if (blocked) return blocked;
			try {
				const w = await readPrivateWallet(auth.userId, args.network || 'mainnet');
				if (!w.linked) {
					return { content: [{ type: 'text', text: 'No Solana wallet is linked to this account yet. Link one from the wallet page to see its balance here.' }], structuredContent: { ok: true, ...w } };
				}
				const text = `Your wallet ${w.address} on ${w.network}: ${w.sol.toFixed(4)} SOL and ${w.usdc.toFixed(2)} USDC, worth ${usd(w.usd_total)}.`;
				return { content: [{ type: 'text', text }], structuredContent: { ok: true, ...w } };
			} catch (err) {
				return clientRefusal(err);
			}
		},
	},
	{
		name: 'get_wallet_summaries',
		title: 'Summarize every wallet on the account',
		group: 'wallet',
		tier: 'read',
		annotations: SNAPSHOT_READ,
		description: "One overview of the account's money: the owner's own wallet (live) plus every agent wallet with its latest hourly SOL and USDC snapshot and the combined USD total. Use this for questions like 'how much do I have across all my agents'. For one agent's detail call get_portfolio.",
		inputSchema: { type: 'object', properties: { network: networkProp }, additionalProperties: false },
		handler: async (args, auth) => {
			const blocked = await guard(auth);
			if (blocked) return blocked;
			try {
				const s = await readWalletSummaries(auth.userId, args.network || 'mainnet');
				const lines = [
					`Across ${s.agents.length} agent wallet${s.agents.length === 1 ? '' : 's'}${s.private_wallet.linked ? ' and your own wallet' : ''} on ${s.network}: ${usd(s.total_usd)}.`,
					s.private_wallet.linked ? `Your wallet: ${s.private_wallet.sol.toFixed(4)} SOL, ${s.private_wallet.usdc.toFixed(2)} USDC (${usd(s.private_wallet.usd_total)}).` : 'No own Solana wallet is linked.',
					...s.agents.slice(0, 20).map((a) => `- ${a.name}: ${a.usd_total == null ? 'no snapshot yet (the first appears within an hour)' : `${a.sol.toFixed(4)} SOL, ${a.usdc.toFixed(2)} USDC (${usd(a.usd_total)})`}`),
				];
				return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { ok: true, ...s } };
			} catch (err) {
				return clientRefusal(err);
			}
		},
	},
];
