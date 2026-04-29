// GET /api/pump/balances?mint=<pubkey>&currency=<mint>&network=...
//
// Three vault balances for an agent that has been bound to pump-agent-payments:
//   paymentVault   — incoming counterparty payments
//   buybackVault   — share routed to buyback (deflationary)
//   withdrawVault  — share the agent owner can sweep
// All denominated in `currency` (USDC by default).

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getPumpAgent, solanaPubkey } from '../_lib/pump.js';
import { SOLANA_USDC_MINT, SOLANA_USDC_MINT_DEVNET } from '../payments/_config.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const mintStr = url.searchParams.get('mint');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const currencyArg = url.searchParams.get('currency');

	const mint = solanaPubkey(mintStr);
	if (!mint) return error(res, 400, 'validation_error', 'invalid mint');

	const currencyStr =
		currencyArg || (network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT);
	const currency = solanaPubkey(currencyStr);
	if (!currency) return error(res, 400, 'validation_error', 'invalid currency');

	try {
		const { agent, agentPda } = await getPumpAgent({ network, mint });
		const balances = await agent.getBalances(currency);
		const fmt = (v) =>
			v && {
				address: v.address?.toString?.() ?? String(v.address),
				balance: v.balance?.toString?.() ?? String(v.balance ?? 0),
			};
		return json(res, 200, {
			mint: mintStr,
			network,
			currency: currencyStr,
			agent_pda: agentPda?.toString?.() ?? null,
			balances: {
				payment: fmt(balances.paymentVault),
				buyback: fmt(balances.buybackVault),
				withdraw: fmt(balances.withdrawVault),
			},
		});
	} catch (err) {
		// Most common: agent not yet bound to mint → PDA missing.
		return error(res, 502, 'pump_agent_error', err.message || 'pump-agent SDK error');
	}
});
