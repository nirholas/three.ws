// What a person is shown before they approve a tool call. A financial call
// always lists recipient, amount, token and chain first, read from the call's
// own arguments, so nobody approves a payment by reading raw JSON. A field the
// call does not state is shown as such rather than guessed.

const FIELDS = [
	['Recipient', ['recipient', 'to', 'destination', 'toAddress', 'to_address', 'payee', 'address', 'wallet', 'receiver', 'url', 'endpoint']],
	['Amount', ['amount', 'amountUsd', 'amount_usd', 'usd', 'value', 'lamports', 'sol', 'quantity', 'price', 'maxUsd', 'max_usd', 'budget']],
	['Token', ['token', 'mint', 'currency', 'asset', 'symbol', 'tokenMint', 'token_mint', 'inputMint', 'input_mint']],
	['Chain', ['chain', 'network', 'chainId', 'chain_id', 'cluster']],
];

const NOT_STATED = 'not stated in the call';

function find(args, keys, depth = 0) {
	if (!args || typeof args !== 'object' || depth > 2) return undefined;
	for (const k of keys) {
		const v = args[k];
		if (v != null && v !== '' && typeof v !== 'object') return String(v);
	}
	for (const v of Object.values(args)) {
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			const hit = find(v, keys, depth + 1);
			if (hit !== undefined) return hit;
		}
	}
	return undefined;
}

/** [[label, value], ...] for recipient, amount, token and chain. */
export function financialFacts(args) {
	return FIELDS.map(([label, keys]) => [label, find(args, keys) ?? NOT_STATED]);
}

/** One-line summary of a call's arguments for a prompt or a tool row. */
export function summarizeArgs(args, max = 160) {
	const text = JSON.stringify(args ?? {});
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
