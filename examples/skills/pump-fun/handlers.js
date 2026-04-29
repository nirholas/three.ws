// pump-fun skill — proxies tool calls to the pump-fun-workers MCP server.
// https://github.com/nirholas/pump-fun-workers
//
// Some handlers return a `sentiment` (-1..1) so the Empathy Layer reacts
// (rug flags → concern, near-graduation → celebration). _onSkillDone in
// agent-avatar.js consumes result.sentiment automatically.

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

// Sentiment scorers — used to drive the avatar's Empathy Layer on skill-done.

function _bondingCurveSentiment(data) {
	const pct = Number(
		data?.graduationPercent ?? data?.graduation_percent ?? data?.progress ?? NaN,
	);
	if (!Number.isFinite(pct)) return 0;
	if (pct >= 80) return 0.7;
	if (pct >= 50) return 0.35;
	if (pct < 5) return -0.2;
	return 0.1;
}

function _creatorProfileSentiment(data) {
	const flags = data?.rugFlags ?? data?.risk_flags ?? data?.flags ?? [];
	const rugged = data?.rugCount ?? data?.rug_count ?? 0;
	if (rugged > 0 || (Array.isArray(flags) && flags.length >= 2)) return -0.8;
	if (Array.isArray(flags) && flags.length === 1) return -0.4;
	return 0.2;
}

function _holderSentiment(data) {
	const top = Number(data?.topHolderPercent ?? data?.top_holder_pct ?? NaN);
	if (!Number.isFinite(top)) return 0;
	if (top >= 50) return -0.6; // single whale dominates
	if (top >= 25) return -0.2;
	return 0.1;
}

const SCORERS = {
	getBondingCurve: _bondingCurveSentiment,
	getCreatorProfile: _creatorProfileSentiment,
	getTokenHolders: _holderSentiment,
	getKingOfTheHill: () => 0.4,
};

function makeHandler(toolName) {
	const score = SCORERS[toolName];
	return async (args, ctx) => {
		const result = await callMcp(toolName, args, ctx);
		if (!result.ok) return result;
		ctx?.memory?.note?.(`pump-fun:${toolName}`, { args });
		if (score) {
			const sentiment = score(result.data);
			if (sentiment !== 0) result.sentiment = sentiment;
		}
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
