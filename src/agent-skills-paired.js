/**
 * Paired-coin skills: the agent launches a coin on Robinhood Chain that trades
 * against up to five assets at once (tokenized stocks, WETH, stablecoins, chain
 * coins), signed by its own custodial EVM wallet, and collects the swap fees it
 * earns as the creator.
 *
 * Quote first, always. Without `confirm: true` the launch skill only prices it
 * (launch fee, gas, opening buy, USD total, each pool's opening value) and
 * lists anything blocking it, such as an unfunded wallet, so the agent can show
 * its owner the cost before any money moves. Sending the same arguments again
 * with `confirm: true` launches.
 *
 * The server checks ownership, the signer mode, the real-funds agreement and
 * the agent's spend policy; this file holds no keys. See docs/paired-coins.md.
 */

const ENDPOINT = (id, leaf) => `/api/agents/${encodeURIComponent(id)}/paired/${leaf}`;

async function call(url, body) {
	const res = await fetch(url, {
		method: body === undefined ? 'GET' : 'POST',
		credentials: 'include',
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
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

function list(value) {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	return String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

/** The request body quote and launch both take, from skill args and the agent's identity. */
export function pairedLaunchBody(args, identity) {
	const name = String(args.name || identity?.name || '').trim();
	const weights = list(args.weights).map(Number);
	const body = {
		name,
		symbol: String(args.symbol || tickerFrom(name)).replace(/^\$/, ''),
		description: args.description || identity?.description || undefined,
		image_url: args.image_url || undefined,
		socials: args.socials || undefined,
		markets: list(args.markets),
		weights: weights.length ? weights : undefined,
	};
	if (args.buy_amount != null && Number(args.buy_amount) > 0) {
		body.dev_buy = { market: args.buy_market || undefined, amount: String(args.buy_amount) };
	}
	return body;
}

const usd = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** One-line human summary of a quote, for the agent to say before launching. */
export function describePairedQuote(q) {
	const pairs = q.pairs.map((p) => `${p.symbol} ${p.weight_pct}%`).join(', ');
	const cost = `${q.cost.total_eth} ETH${q.cost.total_usd != null ? ` (about $${q.cost.total_usd})` : ''}`;
	const buy = q.opening_buy
		? ` plus a ${q.opening_buy.amount} ${q.opening_buy.market} opening buy for ${Number(q.opening_buy.tokens).toLocaleString('en-US', { maximumFractionDigits: 0 })} $${q.coin.symbol} (${q.opening_buy.pct_of_supply}% of supply)`
		: '';
	const opening = q.pairs.every((p) => p.opening_value_usd != null)
		? ` It opens at about ${usd(q.pairs.reduce((s, p) => s + p.opening_value_usd, 0))} across its pools.`
		: '';
	const head = `Launching $${q.coin.symbol} on Robinhood Chain paired with ${pairs} costs ${cost}${buy}.${opening}`;
	return q.ready ? `${head} Confirm to launch.` : `${head} Not ready yet: ${q.blockers.join(' ')}`;
}

/**
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerPairedSkills(skills) {
	skills.register({
		name: 'paired-launch',
		description:
			"Launch a coin on Robinhood Chain paired with up to five assets at once (stocks like NVDA, WETH, stablecoins, chain coins), signed by the agent's own EVM wallet. Quotes first; pass confirm: true to launch.",
		instruction:
			'Call without confirm to get the cost, pools and blockers, tell the owner, then call again with the same arguments and confirm: true. Never invent markets: list them with paired-markets first if unsure.',
		animationHint: 'celebrate',
		voicePattern: 'Launching {{symbol}} on Robinhood Chain…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			required: ['markets'],
			properties: {
				markets: {
					type: 'array',
					items: { type: 'string' },
					minItems: 1,
					maxItems: 5,
					description: 'What the coin pairs with: tickers like NVDA, WETH, USDG, or 0x quote addresses.',
				},
				weights: {
					type: 'array',
					items: { type: 'number' },
					description: 'Percent of supply per market, same order, totalling 100. Omit for an even split.',
				},
				name: { type: 'string', maxLength: 32, description: "Coin name. Defaults to the agent's name." },
				symbol: { type: 'string', maxLength: 10, description: 'Ticker, letters and digits.' },
				description: { type: 'string', maxLength: 480 },
				image_url: { type: 'string', description: "https:// logo. Defaults to the agent's public avatar." },
				socials: {
					type: 'object',
					properties: { website: { type: 'string' }, twitter: { type: 'string' }, telegram: { type: 'string' } },
				},
				buy_amount: { type: 'string', description: 'Optional opening buy, in units of buy_market, settled in the launch transaction.' },
				buy_market: { type: 'string', description: 'Which of the markets the opening buy spends. Defaults to the first.' },
				confirm: { type: 'boolean', description: 'true launches; omitted or false only quotes.' },
			},
		},
		handler: async (args, ctx) => {
			const id = ctx?.identity?.id;
			if (!id) throw new Error('No agent identity in context.');
			const body = pairedLaunchBody(args, ctx.identity);
			if (args.confirm !== true) {
				const quote = await call(ENDPOINT(id, 'quote'), body);
				return { success: true, output: describePairedQuote(quote), sentiment: 0.3, data: { quote, confirmed: false } };
			}
			const launched = await call(ENDPOINT(id, 'launch'), body);
			return {
				success: true,
				output: `Launched $${launched.symbol} on Robinhood Chain, paired with ${launched.pairs.map((p) => p.symbol).join(', ')}. Token ${launched.token}.`,
				sentiment: 0.9,
				data: { ...launched, confirmed: true },
			};
		},
	});

	skills.register({
		name: 'paired-markets',
		description: 'List every asset a paired coin on Robinhood Chain can trade against, with its class, USD price and opening value.',
		instruction: 'Use before paired-launch when the owner has not named exact markets.',
		mcpExposed: true,
		inputSchema: { type: 'object', properties: {} },
		handler: async () => {
			const data = await call('/api/v1/robinhood/paired-markets');
			const byClass = {};
			for (const m of data.markets) (byClass[m.classLabel] ||= []).push(m.symbol);
			const summary = Object.entries(byClass).map(([k, v]) => `${k}: ${v.join(', ')}`).join('. ');
			return { success: true, output: `${data.markets.length} markets. ${summary}.`, sentiment: 0.2, data };
		},
	});

	skills.register({
		name: 'paired-fees',
		description: 'Show, and with claim: true collect, the swap fees the agent has earned from paired coins it launched.',
		instruction: 'Without claim this only reads. Claiming moves fees into the agent wallet and costs a little ETH gas.',
		mcpExposed: true,
		inputSchema: { type: 'object', properties: { claim: { type: 'boolean' } } },
		handler: async (args, ctx) => {
			const id = ctx?.identity?.id;
			if (!id) throw new Error('No agent identity in context.');
			if (args.claim === true) {
				const done = await call(ENDPOINT(id, 'claim'), {});
				return {
					success: true,
					output: `Claimed ${done.claimed.map((c) => `${c.amount} ${c.symbol}`).join(', ')}.`,
					sentiment: 0.8,
					data: done,
				};
			}
			const fees = await call(ENDPOINT(id, 'fees'));
			const text = fees.claimable.length
				? `Claimable: ${fees.claimable.map((c) => `${c.amount} ${c.symbol}`).join(', ')}.`
				: 'No paired-coin fees to claim yet.';
			return { success: true, output: text, sentiment: 0.3, data: fees };
		},
	});
}
