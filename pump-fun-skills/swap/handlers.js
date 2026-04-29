const API = 'https://fun-block.pump.fun/agents';

export async function pumpfun_swap(args, ctx) {
	const res = await ctx.fetch(`${API}/swap`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...args, encoding: 'base64' }),
	});
	if (!res.ok) throw new Error(`pump.fun swap ${res.status}: ${await res.text()}`);
	return res.json();
}
