/**
 * Pons launch skill: the agent launches a coin on Robinhood Chain from its own
 * custodial EVM wallet, through the Pons V2 launchpad (ponsfamily.com).
 *
 * Quote first, always. Without `confirm: true` the skill only prices the
 * launch (launch fee, opening buy, gas, USD total, the tokens the opening buy
 * receives) and lists anything blocking it, such as an unfunded wallet, so
 * the agent can show its owner the cost before any money moves. Sending the
 * same arguments again with `confirm: true` launches.
 *
 * The server checks ownership, the signer mode, the real-funds agreement and
 * the agent's spend policy; this file holds no keys. See docs/pons-launch.md.
 */

const ENDPOINT = (id, leaf) => `/api/agents/${encodeURIComponent(id)}/pons/${leaf}`;

async function postJson(url, body) {
	const res = await fetch(url, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body || {}),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data?.error_description || `${url} returned ${res.status}`);
		err.status = res.status;
		err.code = data?.error;
		throw err;
	}
	return data?.data || data;
}

function tickerFrom(name) {
	return String(name || 'AGENT').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'AGENT';
}

/** The request body both endpoints take, from skill args and the agent's identity. */
export function ponsLaunchBody(args, identity) {
	const name = String(args.name || identity?.name || '').trim();
	return {
		name,
		symbol: String(args.symbol || tickerFrom(name)).replace(/^\$/, ''),
		description: args.description || identity?.description || undefined,
		image_url: args.image_url || undefined,
		socials: args.socials || undefined,
		buy_eth: Number(args.buy_eth || 0),
		creator_tax_bps: Number(args.creator_tax_bps || 0),
		buyback: Boolean(args.buyback),
	};
}

/** One-line human summary of a quote, for the agent to say before launching. */
export function describePonsQuote(q) {
	const cost = `${q.cost.total_eth} ETH${q.cost.total_usd != null ? ` (about $${q.cost.total_usd})` : ''}`;
	const buy = Number(q.cost.opening_buy_eth) > 0
		? ` including a ${q.cost.opening_buy_eth} ETH opening buy for ${Number(q.opening_buy.tokens).toLocaleString('en-US', { maximumFractionDigits: 0 })} $${q.coin.symbol} (${q.opening_buy.pct_of_supply}% of supply)`
		: '';
	const head = `Launching $${q.coin.symbol} on Pons (Robinhood Chain) costs ${cost}${buy}.`;
	return q.ready ? `${head} Confirm to launch.` : `${head} Not ready yet: ${q.blockers.join(' ')}`;
}

/**
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerPonsSkills(skills) {
	skills.register({
		name: 'pons-launch',
		description:
			"Launch a coin on Robinhood Chain through the Pons launchpad, signed by the agent's own EVM wallet. Quotes first; pass confirm: true to launch.",
		instruction:
			'Call without confirm to get the cost and blockers, tell the owner, then call again with the same arguments and confirm: true.',
		animationHint: 'celebrate',
		voicePattern: 'Launching {{symbol}} on Robinhood Chain…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', maxLength: 64, description: "Coin name. Defaults to the agent's name." },
				symbol: { type: 'string', maxLength: 16, description: 'Ticker, letters and digits.' },
				description: { type: 'string', maxLength: 2048 },
				image_url: { type: 'string', description: "https:// or ipfs:// logo. Defaults to the agent's public avatar." },
				socials: {
					type: 'object',
					properties: {
						twitter: { type: 'string' },
						telegram: { type: 'string' },
						discord: { type: 'string' },
						website: { type: 'string' },
						farcaster: { type: 'string' },
					},
				},
				buy_eth: { type: 'number', minimum: 0, maximum: 4, description: 'Opening buy in ETH, settled in the launch transaction.' },
				creator_tax_bps: { type: 'integer', minimum: 0, maximum: 1000, description: 'Extra trade tax paid to the agent, in basis points.' },
				buyback: { type: 'boolean', description: 'Route the buyback share of fees into a five-year locked buyback.' },
				confirm: { type: 'boolean', description: 'true launches; omitted or false only quotes.' },
			},
		},
		handler: async (args, ctx) => {
			const id = ctx?.identity?.id;
			if (!id) throw new Error('No agent identity in context.');
			const body = ponsLaunchBody(args, ctx.identity);
			if (args.confirm !== true) {
				const quote = await postJson(ENDPOINT(id, 'quote'), body);
				return { success: true, output: describePonsQuote(quote), sentiment: 0.3, data: { quote, confirmed: false } };
			}
			const launched = await postJson(ENDPOINT(id, 'launch'), body);
			return {
				success: true,
				output: `Launched $${launched.symbol} on Robinhood Chain. Token ${launched.token}.`,
				sentiment: 0.9,
				data: { ...launched, confirmed: true },
			};
		},
	});
}
