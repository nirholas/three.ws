/**
 * /api/agents/:id                 — agent CRUD
 * /api/agents/:id/wallet          — link / update EVM wallet
 * /api/agents/:id/solana          — agent's Solana wallet (address + balance, provision)
 * /api/agents/:id/pumpfun/launch  — create a pump.fun token from this agent
 * /api/agents/:id/pumpfun/buy     — bonding-curve buy
 * /api/agents/:id/pumpfun/sell    — bonding-curve sell
 * /api/agents/:id/pumpfun/portfolio — aggregated positions + live PnL
 * /api/agents/:id/pumpfun/swap    — swap via @pump-fun/pump-swap-sdk
 * /api/agents/:id/pumpfun/pay     — agent payment via @pump-fun/agent-payments-sdk
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
		return mod.default(req, res, id);
	}

	if (sub === 'pumpfun') {
		if (action === 'launch') return (await import('./pumpfun/launch.js')).default(req, res, id);
		if (action === 'buy') return (await import('./pumpfun/buy.js')).default(req, res, id);
		if (action === 'sell') return (await import('./pumpfun/sell.js')).default(req, res, id);
		if (action === 'portfolio') return (await import('./pumpfun/portfolio.js')).default(req, res, id);
		if (action === 'swap') return (await import('./pumpfun/swap.js')).default(req, res, id);
		if (action === 'pay') return (await import('./pumpfun/pay.js')).default(req, res, id);
		if (cors(req, res)) return;
		return error(res, 404, 'not_found', 'unknown pumpfun action');
	}

	return handleGetOne(req, res, id);
});
