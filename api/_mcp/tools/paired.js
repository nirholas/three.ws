// Paired-coin MCP tools: browse what a coin on Robinhood Chain can pair with,
// read paired coins, and have an agent launch one from its own EVM wallet.
//
// A paired coin trades against one to five assets at once (tokenized stocks,
// WETH, stablecoins, chain coins), each in its own bonding curve. Every tool
// calls the same libraries as the REST API (api/agents/paired/[action].js and
// api/v1/robinhood/paired-*), so ownership, signer mode, spend ceilings and the
// audit trail are identical on both surfaces.
//
// paired_launch_quote is the preview: the policy layer stamps a preview_id on
// its result, and paired_launch refuses without that id, confirm_launch: true,
// and the same launch arguments the quote priced. See docs/paired-coins.md.

import { currentSignatureFor, agreementRequirement } from '../../_lib/real-funds-agreement.js';
import { EvmLegError } from '../../_lib/evm-leg/chains.js';
import { PairedMarketError } from '../../_lib/paired-markets.js';
import { MAX_MARKETS, launchpadConfig } from '../../_lib/paired-launchpad.js';
import { pairedMarkets } from '../../_lib/paired-markets.js';
import { pairedCoinDetail, pairedCoinList } from '../../_lib/paired-directory.js';
import { LIMITS, claimPairedFees, launchPaired, pairedFeesFor, quotePairedLaunch } from '../../_lib/evm-leg/paired-launch.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const AGENT_ID = { type: 'string', format: 'uuid', description: 'Agent UUID (from list_my_agents).' };
const ADDRESS = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' };

// The launch arguments, shared by the quote and the launch so the policy layer
// can bind every one of them between the two calls.
const LAUNCH_PROPS = {
	agent_id: AGENT_ID,
	markets: {
		type: 'array',
		items: { type: 'string', minLength: 1, maxLength: 64 },
		minItems: 1,
		maxItems: MAX_MARKETS,
		description: 'What the coin pairs with: tickers from paired_markets (NVDA, WETH, USDG, …) or 0x quote addresses.',
	},
	weights: {
		type: 'array',
		items: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
		maxItems: MAX_MARKETS,
		description: 'Percent of supply per market, same order as markets, totalling 100. Omit for an even split.',
	},
	name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
	symbol: { type: 'string', minLength: 1, maxLength: LIMITS.symbol, description: 'Ticker, letters and digits.' },
	description: { type: 'string', maxLength: LIMITS.description },
	image_url: { type: 'string', maxLength: LIMITS.image, description: "https:// logo, copied onto three.ws storage. Defaults to the agent's public avatar." },
	socials: {
		type: 'object',
		properties: { website: { type: 'string' }, twitter: { type: 'string' }, telegram: { type: 'string' } },
		additionalProperties: false,
	},
	dev_buy: {
		type: 'object',
		properties: {
			market: { type: 'string', description: 'Which of the markets the opening buy spends. Defaults to the first.' },
			amount: { type: 'string', description: 'Amount of that asset, like "0.5". Settled atomically in the launch transaction.' },
		},
		required: ['amount'],
		additionalProperties: false,
	},
};
export const LAUNCH_ARGS = Object.keys(LAUNCH_PROPS);

function ok(structured, text) {
	return { content: [{ type: 'text', text: text || JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function failure(e) {
	if (e instanceof PairedMarketError || e instanceof EvmLegError || (e?.status && e.status < 500 && e?.code)) {
		const structured = { error: e.code || 'bad_request', message: e.message, ...(e.detail ? { detail: e.detail } : {}) };
		return { content: [{ type: 'text', text: `Error (${structured.error}): ${e.message}` }], structuredContent: structured, isError: true };
	}
	throw e;
}

function needsAccount() {
	return {
		content: [{ type: 'text', text: 'Connect a three.ws account (OAuth or API key) to launch with an agent.' }],
		structuredContent: { error: 'unauthorized' },
		isError: true,
	};
}

function launchInput(a) {
	return {
		name: a.name,
		symbol: a.symbol,
		description: a.description,
		image_url: a.image_url,
		socials: a.socials,
		markets: a.markets,
		weights: a.weights,
		dev_buy: a.dev_buy,
	};
}

export const toolDefs = [
	{
		name: 'paired_markets',
		title: 'List paired-coin markets',
		group: 'launch',
		annotations: READ,
		description:
			'Every asset a paired coin on Robinhood Chain can trade against, read live from the launchpad: tokenized stocks (NVDA, TSLA, SPY…), WETH, stablecoins and chain coins, each with its class, live USD price and the dollar market cap a pool in it opens at. Also returns the launch fee, swap fee and the creator\'s share of fees.',
		inputSchema: {
			type: 'object',
			properties: { class: { type: 'string', enum: ['rwa-equity', 'stablecoin', 'crypto-major', 'crypto-native'] } },
			additionalProperties: false,
		},
		async handler(args) {
			const [config, all] = await Promise.all([launchpadConfig(), pairedMarkets()]);
			const markets = args?.class ? all.filter((m) => m.assetClass === args.class) : all;
			return ok({ config, markets, count: markets.length });
		},
	},
	{
		name: 'paired_coins',
		title: 'List paired coins',
		group: 'launch',
		annotations: READ,
		description:
			'Paired coins on Robinhood Chain, newest first, with every pool (quote asset, weight, price, dollar market cap, % sold), the verified descriptor and the three.ws agent that launched it. Pass agent_id for one agent\'s coins.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				limit: { type: 'integer', minimum: 1, maximum: 48, default: 12 },
				offset: { type: 'integer', minimum: 0, default: 0 },
			},
			additionalProperties: false,
		},
		async handler(args) {
			return ok(await pairedCoinList({ limit: args?.limit ?? 12, offset: args?.offset ?? 0, agentId: args?.agent_id ?? null }));
		},
	},
	{
		name: 'paired_coin',
		title: 'Read a paired coin',
		group: 'launch',
		annotations: READ,
		description: 'One paired coin in full: its pools priced in dollars, recent trades, per-pool candles, the verified descriptor and the launching agent.',
		inputSchema: {
			type: 'object',
			properties: { address: ADDRESS, interval: { type: 'string', enum: ['1m', '5m', '15m', '1h', '4h', '1d'], default: '1h' } },
			required: ['address'],
			additionalProperties: false,
		},
		async handler(args) {
			const coin = await pairedCoinDetail(args.address, { interval: args.interval });
			if (!coin) return failure(new PairedMarketError('That address is not a coin on the paired launchpad.', 404));
			return ok(coin);
		},
	},
	{
		name: 'paired_launch_quote',
		title: 'Quote a paired-coin launch',
		group: 'launch',
		tier: 'write',
		scope: 'wallet:read',
		annotations: WRITE,
		description:
			"Price a paired-coin launch from an agent's own EVM wallet on Robinhood Chain without signing anything: the pools and their dollar opening values, the launch fee, gas, the optional opening buy and its fill, the USD total, and anything blocking it (an unfunded wallet, the agent's spend ceiling). Show the result to the owner; paired_launch needs the preview_id this returns.",
		inputSchema: { type: 'object', properties: LAUNCH_PROPS, required: ['agent_id', 'markets', 'name', 'symbol'], additionalProperties: false },
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			try {
				return ok(await quotePairedLaunch({ agentId: args.agent_id, userId: auth.userId, input: launchInput(args) }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'paired_launch',
		title: 'Launch a paired coin from an agent wallet',
		group: 'launch',
		tier: 'financial',
		confirmFlag: 'confirm_launch',
		previewTool: 'paired_launch_quote',
		scope: 'wallet:write',
		annotations: MONEY,
		description:
			"Launch the coin paired_launch_quote priced, signed by the agent's custodial EVM wallet on Robinhood Chain under its spend ceilings. Requires the quote's preview_id, the same launch arguments, and confirm_launch: true, which you may only send after the owner explicitly approved the quote. Returns the coin address, transaction and coin page.",
		inputSchema: {
			type: 'object',
			properties: {
				...LAUNCH_PROPS,
				preview_id: { type: 'string', description: 'From paired_launch_quote.' },
				confirm_launch: { type: 'boolean', description: 'Must be true, and only after the owner said yes to the quote.' },
			},
			required: ['agent_id', 'markets', 'name', 'symbol', 'preview_id', 'confirm_launch'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			const signature = await currentSignatureFor(auth.userId);
			if (!signature) {
				const requirement = agreementRequirement();
				return {
					content: [{ type: 'text', text: `Sign the real-funds agreements before an agent can launch. Nothing was spent. Sign at ${requirement.sign_url}` }],
					structuredContent: { launched: false, reason: 'risk_ack_required', ...requirement },
					isError: true,
				};
			}
			try {
				return ok(await launchPaired({ agentId: args.agent_id, userId: auth.userId, input: launchInput(args) }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'paired_fees',
		title: 'Read paired-coin creator fees',
		group: 'launch',
		scope: 'wallet:read',
		annotations: READ,
		description: 'Swap fees an agent has earned as the creator of paired coins and can claim now, per quote asset.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			try {
				return ok(await pairedFeesFor({ agentId: args.agent_id, userId: auth.userId }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'paired_claim_fees',
		title: 'Claim paired-coin creator fees',
		group: 'launch',
		tier: 'write',
		scope: 'wallet:write',
		annotations: WRITE,
		description: "Collect every quote asset an agent has earned in paired-coin swap fees, in one transaction into the agent's own wallet. Costs a little ETH gas; moves nothing out of the agent's control.",
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			try {
				return ok(await claimPairedFees({ agentId: args.agent_id, userId: auth.userId }));
			} catch (e) {
				return failure(e);
			}
		},
	},
];
