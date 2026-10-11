// Live executor. The unsigned transaction comes from three.ws's buy-prep and
// sell-prep routes (bearer-authenticated), is signed here with the agent's
// keychain key, and is broadcast straight to a Solana RPC from this machine.
// The key never leaves the keystore. A successful trade is then reported to
// buy-confirm / sell-confirm so the cloud account's ledger matches.
//
// This path only runs after the approval gate (or an explicitly 'auto'
// strategy) has passed in runtime.js. It needs the cloud for the unsigned
// transaction and a Solana RPC to send it; paper mode needs neither.

import { Connection } from '@solana/web3.js';

const DEFAULT_RPC = { mainnet: 'https://api.mainnet-beta.solana.com', devnet: 'https://api.devnet.solana.com' };

export function createLiveExecutor({ keystore, apiBase = 'https://three.ws', token, rpc = DEFAULT_RPC, fetchImpl = fetch, makeConnection = (url) => new Connection(url, 'confirmed') }) {
	async function call(path, body) {
		const bearer = token();
		if (!bearer) throw Object.assign(new Error('Sign in to three.ws to trade live.'), { code: 'not_signed_in', status: 401 });
		const r = await fetchImpl(`${apiBase}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
		const json = await r.json().catch(() => ({}));
		if (!r.ok) throw Object.assign(new Error(json.error_description || json.message || `three.ws answered ${r.status}`), { code: json.error || 'cloud_error', status: r.status });
		return json.data || json;
	}

	async function signAndSend(agent, txBase64, network) {
		const signed = keystore.signTransaction(agent.id, txBase64);
		const conn = makeConnection(rpc[network]);
		const sig = await conn.sendRawTransaction(Buffer.from(signed, 'base64'), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
		await conn.confirmTransaction(sig, 'confirmed');
		return sig;
	}

	return {
		async buy({ agent, payload }) {
			const prep = await call('/api/pump/buy-prep', { mint: payload.mint, network: agent.network, sol: payload.amount_sol, slippage_bps: payload.slippage_bps, wallet_address: agent.address });
			const sig = await signAndSend(agent, prep.tx_base64, agent.network);
			await call('/api/pump/buy-confirm', { mint: payload.mint, network: agent.network, tx_signature: sig, wallet_address: agent.address, sol: payload.amount_sol, route: prep.route, slippage_bps: payload.slippage_bps }).catch(() => null);
			return sig;
		},
		async sell({ agent, payload, position }) {
			const prep = await call('/api/pump/sell-prep', { mint: position.mint, network: agent.network, tokens: String(position.tokens), slippage_bps: agent.strategy.sizing.max_slippage_bps, wallet_address: agent.address });
			const sig = await signAndSend(agent, prep.tx_base64, agent.network);
			await call('/api/pump/sell-confirm', { mint: position.mint, network: agent.network, tx_signature: sig, wallet_address: agent.address, tokens: String(position.tokens), route: prep.route, slippage_bps: agent.strategy.sizing.max_slippage_bps }).catch(() => null);
			return sig;
		},
	};
}
