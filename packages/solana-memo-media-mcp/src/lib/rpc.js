const DEFAULT_RPC_URLS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com', 'https://rpc.ankr.com/solana'];

export function getRpcUrls() {
	const supplied = [...(process.env.SOLANA_RPC_URLS || '').split(','), process.env.SOLANA_RPC_URL || ''].map((url) => url.trim()).filter(Boolean);
	return [...new Set([...supplied, ...DEFAULT_RPC_URLS])];
}

export async function rpc(method, params) {
	let lastError;
	for (const url of getRpcUrls()) {
		try {
			const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
			if (!response.ok) throw new Error(`Solana RPC ${response.status} from ${new URL(url).host}`);
			const body = await response.json();
			if (body.error) throw new Error(body.error.message || 'Solana RPC returned an error');
			return body.result;
		} catch (error) { lastError = error; }
	}
	throw lastError || new Error('All Solana RPC endpoints failed.');
}

export function assertBase58(value, label) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(text)) {
		const error = new Error(`${label} must be a base58 Solana identifier.`);
		error.code = 'invalid_solana_identifier';
		throw error;
	}
	return text;
}

export async function getParsedTransaction(signature) {
	return rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
}
