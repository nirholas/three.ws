import { Interface } from 'ethers';
import { env } from '../_lib/env.js';
import { wrap, cors, error, json, readJson, method } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const ERC20_TRANSFER_TOPIC =
	'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const erc20Iface = new Interface([
	'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export default wrap(async (req, res) => {
	if (cors(req, res)) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = await readJson(req);
	} catch (err) {
		return error(res, err.status ?? 400, 'bad_request', err.message);
	}

	const chain = String(body.chain || '').toLowerCase();
	const sig = String(body.sig || '').trim();

	if (!['solana', 'evm'].includes(chain)) {
		return error(res, 400, 'bad_request', 'chain must be solana or evm');
	}
	if (!sig) return error(res, 400, 'bad_request', 'sig required');

	let txData;

	if (chain === 'solana') {
		const resp = await fetch(
			`https://api.helius.xyz/v0/transactions/?api-key=${env.HELIUS_API_KEY}`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ transactions: [sig] }),
			},
		);
		if (!resp.ok) {
			const txt = await resp.text();
			return error(res, 502, 'upstream_error', `Helius error ${resp.status}: ${txt}`);
		}
		const data = await resp.json();
		if (!Array.isArray(data) || data.length === 0) {
			return error(res, 404, 'not_found', 'Transaction not found');
		}
		const tx = data[0];
		txData = {
			tokenTransfers: tx.tokenTransfers || [],
			nativeTransfers: tx.nativeTransfers || [],
			description: tx.description || '',
			type: tx.type || '',
			feePayer: tx.feePayer || '',
		};
	} else {
		const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
		const rpc = (id, methodName, params) =>
			fetch(rpcUrl, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id, method: methodName, params }),
			});

		const [txResp, receiptResp] = await Promise.all([
			rpc(1, 'eth_getTransactionByHash', [sig]),
			rpc(2, 'eth_getTransactionReceipt', [sig]),
		]);

		if (!txResp.ok || !receiptResp.ok) {
			return error(res, 502, 'upstream_error', 'Alchemy RPC request failed');
		}

		const [txJson, receiptJson] = await Promise.all([txResp.json(), receiptResp.json()]);

		if (txJson.error) {
			return error(res, 502, 'upstream_error', txJson.error.message || 'RPC error');
		}
		if (!txJson.result) {
			return error(res, 404, 'not_found', 'Transaction not found');
		}

		const tx = txJson.result;
		const receipt = receiptJson.result;
		const logs = [];
		for (const log of receipt?.logs || []) {
			if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;
			try {
				const parsed = erc20Iface.parseLog({ topics: log.topics, data: log.data });
				logs.push({
					token: log.address,
					from: parsed.args[0],
					to: parsed.args[1],
					amount: parsed.args[2].toString(),
				});
			} catch {
				// skip logs that don't conform
			}
		}

		txData = {
			from: tx.from,
			to: tx.to,
			value: tx.value,
			logs,
		};
	}

	// Optional plain-English summary via OpenRouter
	const openRouterKey = env.OPENROUTER_API_KEY;
	if (openRouterKey) {
		try {
			const summaryResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${openRouterKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://three.ws',
					'X-Title': 'three.ws tx explainer',
				},
				body: JSON.stringify({
					model: 'meta-llama/llama-3.1-8b-instruct:free',
					max_tokens: 200,
					messages: [
						{
							role: 'user',
							content: `Summarize this on-chain ${chain} transaction in one plain-English paragraph. Be concise. Data: ${JSON.stringify(txData)}`,
						},
					],
				}),
			});
			if (summaryResp.ok) {
				const summaryJson = await summaryResp.json();
				const text = summaryJson.choices?.[0]?.message?.content;
				if (text) txData.summary = text.trim();
			}
		} catch {
			// summary is optional — silently skip
		}
	}

	return json(res, 200, txData);
});
