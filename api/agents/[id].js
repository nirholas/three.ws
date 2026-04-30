/**
 * /api/agents/:id                 — agent CRUD
 * /api/agents/:id/wallet          — link / update EVM wallet
 * /api/agents/:id/solana          — agent's Solana wallet (address + balance, provision)
 * /api/agents/:id/solana/activity — recent on-chain signatures for the wallet
 * /api/agents/:id/solana/airdrop  — devnet airdrop (1 SOL)
 * /api/agents/:id/sns             — list owned .sol domains and attach one as the agent's SNS id
 * /api/agents/:id/actions         — paginated signed action log
 * /api/agents/:id/animations      — owner-only: replace meta.animations
 * /api/agents/:id/embed-policy    — read/write embed policy
 * /api/agents/:id/manifest        — public canonical manifest JSON
 * /api/agents/:id/sign            — owner-only: sign message with server wallet
 * /api/agents/:id/usage           — owner-only: LLM usage stats
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

	if (sub === 'actions') {
		const mod = await import('./_sub.js');
		return mod.handleActions(req, res, id);
	}

	if (sub === 'animations') {
		const mod = await import('./_sub.js');
		return mod.handleAnimations(req, res, id);
	}

	if (sub === 'embed-policy') {
		const mod = await import('./_sub.js');
		return mod.handleEmbedPolicy(req, res, id);
	}

	if (sub === 'manifest') {
		const mod = await import('./_sub.js');
		return mod.handleManifest(req, res, id);
	}

	if (sub === 'sign') {
		const mod = await import('./_sub.js');
		return mod.handleSign(req, res, id);
	}

	if (sub === 'usage') {
		const mod = await import('./_sub.js');
		return mod.handleUsage(req, res, id);
	}

	return handleGetOne(req, res, id);
});
