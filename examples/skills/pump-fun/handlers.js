// pump-fun skill — proxies tool calls to the pump-fun-workers MCP server.
// https://github.com/nirholas/pump-fun-workers

const ENDPOINT = 'https://pump-fun-sdk.modelcontextprotocol.name/mcp';

let _rpcId = 0;

async function callMcp(name, args, ctx) {
	const fetchImpl = ctx?.fetch ?? globalThis.fetch;
	const res = await fetchImpl(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++_rpcId,
			method: 'tools/call',
			params: { name, arguments: args ?? {} },
		}),
	});

	if (!res.ok) return { ok: false, error: `pump-fun MCP HTTP ${res.status}` };
	const body = await res.json();
	if (body.error) return { ok: false, error: body.error.message ?? 'pump-fun MCP error' };

	const content = body.result?.content ?? [];
	const text = content.find((c) => c.type === 'text')?.text;
	let data = body.result;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}
	return { ok: true, data };
}

function makeHandler(toolName) {
	return async (args, ctx) => {
		const result = await callMcp(toolName, args, ctx);
		if (result.ok) ctx?.memory?.note?.(`pump-fun:${toolName}`, { args });
		return result;
	};
}

export const searchTokens = makeHandler('searchTokens');
export const getTokenDetails = makeHandler('getTokenDetails');
export const getBondingCurve = makeHandler('getBondingCurve');
export const getTokenTrades = makeHandler('getTokenTrades');
export const getTrendingTokens = makeHandler('getTrendingTokens');
export const getNewTokens = makeHandler('getNewTokens');
export const getGraduatedTokens = makeHandler('getGraduatedTokens');
export const getKingOfTheHill = makeHandler('getKingOfTheHill');
export const getCreatorProfile = makeHandler('getCreatorProfile');
export const getTokenHolders = makeHandler('getTokenHolders');
