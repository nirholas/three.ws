function _apiBase() {
	if (typeof globalThis !== 'undefined' && globalThis.location?.origin) {
		return `${globalThis.location.origin}/api/agents/payments`;
	}
	return '/api/agents/payments';
}

export async function pumpfun_build_payment(args, ctx) {
	const res = await ctx.fetch(`${_apiBase()}/pay-prep`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			agent_id: args.agent_id,
			currency_mint: args.currency_mint,
			amount: String(args.amount),
			wallet_address: args.wallet_address,
			memo: args.memo ? String(args.memo) : undefined,
			cluster: args.cluster || 'mainnet',
		}),
	});
	if (!res.ok) throw new Error(`pay-prep ${res.status}: ${await res.text()}`);
	return res.json();
}

export async function pumpfun_verify_payment(args, ctx) {
	const res = await ctx.fetch(`${_apiBase()}/pay-confirm`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			intent_id: args.intent_id,
			tx_signature: args.tx_signature,
			wallet_address: args.wallet_address,
		}),
	});
	if (!res.ok) throw new Error(`pay-confirm ${res.status}: ${await res.text()}`);
	return res.json();
}
