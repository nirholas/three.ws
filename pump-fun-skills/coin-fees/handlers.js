const API = 'https://fun-block.pump.fun/agents';

export async function pumpfun_collect_fees(args, ctx) {
	const res = await ctx.fetch(`${API}/collect-fees`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...args, encoding: 'base64' }),
	});
	if (!res.ok) throw new Error(`pump.fun collect-fees ${res.status}: ${await res.text()}`);
	return res.json();
}

export async function pumpfun_sharing_config(args, ctx) {
	const res = await ctx.fetch(`${API}/sharing-config`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...args, encoding: 'base64' }),
	});
	if (!res.ok) throw new Error(`pump.fun sharing-config ${res.status}: ${await res.text()}`);
	return res.json();
}
