export async function fetchRemoteTools(config) {
	const result = await callRemote(
		{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
		config,
	);
	if (result?.error) {
		throw new Error(`tools/list failed: ${result.error.message}`);
	}
	return result?.result?.tools ?? [];
}

export async function callRemoteTool(name, args, config) {
	const result = await callRemote(
		{ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } },
		config,
	);
	if (result?.error) {
		const err = new Error(result.error.message || 'remote tool error');
		err.code = result.error.code;
		err.data = result.error.data;
		throw err;
	}
	return result?.result ?? null;
}

async function callRemote(body, config) {
	const headers = {
		'content-type': 'application/json',
		'accept': 'application/json',
		'mcp-protocol-version': '2025-06-18',
	};
	if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`;

	const res = await fetch(`${config.remote}/api/mcp`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(60_000),
	});

	// 402 means no API key or payment required — give an actionable message
	if (res.status === 402) {
		throw new Error(
			'Payment required. Set an API key via `three-ws-mcp init` or THREE_WS_API_KEY env var (get one at https://three.ws/dashboard).',
		);
	}

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`remote ${res.status}: ${text.slice(0, 200)}`);
	}

	return res.json();
}
