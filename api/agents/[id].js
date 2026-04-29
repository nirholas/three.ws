/**
 * /api/agents/:id                 — agent CRUD
 * /api/agents/:id/wallet          — link / update EVM wallet
 * /api/agents/:id/solana          — agent's Solana wallet (address + balance, provision)
 * /api/agents/:id/solana/activity — recent on-chain signatures for the wallet
 * /api/agents/:id/solana/airdrop  — devnet airdrop (1 SOL)
 * /api/agents/:id/sns             — list owned .sol domains and attach one as the agent's SNS id
 * /api/agents/:id/sns/register    — register a .sol; agent wallet pays USDC
 * /api/agents/:id/sns/register-prep    — build unsigned tx for user wallet to sign
 * /api/agents/:id/sns/register-confirm — confirm a user-wallet registration and attach
 *
 * /api/agents/:id/pumpfun/* is routed directly to api/agents/pumpfun/[action].js
 * by vercel.json — see the rewrite for that path family.
 */
import { handleGetOne, handleWallet } from '../agents.js';
import { cors, error, wrap } from '../_lib/http.js';

export default wrap(async function handler(req, res) {
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const id = parts[2];
	const sub = parts[3];
	const action = parts[4];

	if (!id) {
		if (cors(req, res)) return;
		return error(res, 400, 'bad_request', 'missing agent id');
	}

	if (sub === 'wallet') return handleWallet(req, res, id);

	if (sub === 'solana') {
		const mod = await import('./solana-wallet.js');
		return mod.default(req, res, id, action);
	}

	if (sub === 'sns') {
		const mod = await import('./sns.js');
		return mod.default(req, res, id, action);
	}

	return handleGetOne(req, res, id);
});
