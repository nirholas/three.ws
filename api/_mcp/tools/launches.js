// Launch-lane MCP tools: the Uniswap lane on Base, launch status for both EVM
// lanes, and the live lane comparison.
//
// uniswap_launch_quote is the preview: the policy layer stamps a quote_id on its
// result, and uniswap_launch refuses without that id, confirm_launch: true, and
// the same launch arguments the quote priced. Both EVM lanes (this one and
// paired_launch) take an optional idempotency_key and record every attempt;
// launch_status reads the record back, so a client that timed out can tell
// whether the coin exists. See docs/launch-lanes.md.

import { currentSignatureFor, agreementRequirement } from '../../_lib/real-funds-agreement.js';
import { EvmLegError } from '../../_lib/evm-leg/chains.js';
import { PairedMarketError } from '../../_lib/paired-markets.js';
import { getLaunchRecord, publicRecord, runLaunch, settleLaunch, OPEN_STATUSES } from '../../_lib/evm-launch-records.js';
import { settlers } from '../../_lib/evm-launch-settlers.js';
import { launchLanes } from '../../_lib/launch-lanes.js';
import { LIMITS, launchUniswap, quoteUniswapLaunch } from '../../_lib/evm-leg/uniswap-launch.js';
import { MAX_LOCK_DAYS, MAX_START_MARKET_CAP_ETH, MIN_LOCK_DAYS, MIN_START_MARKET_CAP_ETH, UNISWAP_CHAIN } from '../../_lib/evm-leg/uniswap-config.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const AGENT_ID = { type: 'string', format: 'uuid', description: 'Agent UUID (from list_my_agents).' };

export const IDEMPOTENCY_KEY = {
	type: 'string',
	minLength: 8,
	maxLength: 128,
	pattern: '^[\\x21-\\x7e]+$',
	description: 'Your own unique id for this attempt. Retrying with the same key returns the same launch instead of launching twice; a different coin needs a new key.',
};

// The launch arguments, shared by the quote and the launch so the policy layer
// can bind every one of them between the two calls.
const LAUNCH_PROPS = {
	agent_id: AGENT_ID,
	name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
	symbol: { type: 'string', minLength: 1, maxLength: LIMITS.symbol, description: 'Ticker, letters and digits.' },
	description: { type: 'string', maxLength: LIMITS.description },
	image_url: { type: 'string', maxLength: LIMITS.image, description: "https:// logo, copied onto three.ws storage. Defaults to the agent's public avatar." },
	socials: {
		type: 'object',
		properties: { website: { type: 'string' }, twitter: { type: 'string' }, telegram: { type: 'string' } },
		additionalProperties: false,
	},
	fee_tier: { type: 'integer', enum: [100, 500, 3000, 10000], description: 'Pool trading fee in hundredths of a basis point: 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%. Default 10000.' },
	start_market_cap_eth: {
		type: 'number',
		minimum: MIN_START_MARKET_CAP_ETH,
		maximum: MAX_START_MARKET_CAP_ETH,
		description: 'Market cap in ETH at the first block (price times the whole supply). Default 4.',
	},
	lock: {
		type: 'object',
		properties: {
			mode: { type: 'string', enum: ['none', 'timelock', 'permanent'] },
			unlock_days: { type: 'number', minimum: MIN_LOCK_DAYS, maximum: MAX_LOCK_DAYS, description: 'Required for timelock.' },
		},
		required: ['mode'],
		additionalProperties: false,
	},
	fee_recipient: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: "Where collected pool fees go. Defaults to the agent's wallet; a third-party address must be on the agent's EVM allowlist and needs a lock." },
};
export const LAUNCH_ARGS = Object.keys(LAUNCH_PROPS);

function ok(structured, text) {
	return { content: [{ type: 'text', text: text || JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function failure(e) {
	if (e instanceof PairedMarketError || e instanceof EvmLegError || (e?.status && e.status < 500 && e?.code)) {
		const structured = { error: e.code || 'bad_request', message: e.message, ...(e.detail ? { detail: e.detail } : {}), ...(e.launchId ? { launch_id: e.launchId } : {}) };
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
		fee_tier: a.fee_tier,
		start_market_cap_eth: a.start_market_cap_eth,
		lock: a.lock,
		fee_recipient: a.fee_recipient,
	};
}

export const toolDefs = [
	{
		name: 'launch_lanes',
		title: 'Compare launch lanes',
		group: 'launch',
		annotations: READ,
		description:
			'Every way to launch a coin on three.ws, from live config: pump.fun and the three.ws launchpad on Solana (the default), the Uniswap V3 lane on Base and paired coins on Robinhood Chain. Each lane lists its chain, every fee with who pays it, the creator share, what happens at graduation and the liquidity lock options, and whether it is available right now. Use this first when someone wants to launch a coin and has not picked a chain or venue; Solana is the default lane.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler() {
			return ok({ lanes: await launchLanes() });
		},
	},
	{
		name: 'uniswap_launch_quote',
		title: 'Quote a Uniswap-lane launch',
		group: 'launch',
		tier: 'write',
		scope: 'wallet:read',
		annotations: WRITE,
		description:
			"Price a fixed-supply coin launch with a Uniswap V3 pool on Base from an agent's own EVM wallet without signing anything: the pool's fee tier and opening market cap, the lock, the launch fee, gas, the USD total, every fee a trader or the creator will pay, and anything blocking it (an unfunded wallet, the agent's spend ceiling). Use this before uniswap_launch and show the result to the owner; uniswap_launch needs the quote_id this returns.",
		inputSchema: { type: 'object', properties: LAUNCH_PROPS, required: ['agent_id', 'name', 'symbol'], additionalProperties: false },
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			try {
				return ok(await quoteUniswapLaunch({ agentId: args.agent_id, userId: auth.userId, input: launchInput(args) }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'uniswap_launch',
		title: 'Launch a coin with a Uniswap pool',
		group: 'launch',
		tier: 'financial',
		confirmFlag: 'confirm_launch',
		previewTool: 'uniswap_launch_quote',
		scope: 'wallet:write',
		annotations: MONEY,
		description:
			"Launch the coin uniswap_launch_quote priced, signed by the agent's custodial EVM wallet on Base under its spend ceilings. Requires the quote_id from uniswap_launch_quote, the same launch arguments, and confirm_launch: true, which you may only send after the owner explicitly approved the quote. Send an idempotency_key so a retry returns the same launch; follow it with launch_status. Use this after the owner approved a uniswap_launch_quote, to actually create the coin on Base.",
		inputSchema: {
			type: 'object',
			properties: {
				...LAUNCH_PROPS,
				idempotency_key: IDEMPOTENCY_KEY,
				quote_id: { type: 'string', description: 'From uniswap_launch_quote.' },
				confirm_launch: { type: 'boolean', description: 'Must be true, and only after the owner said yes to the quote.' },
			},
			required: ['agent_id', 'name', 'symbol', 'quote_id', 'confirm_launch'],
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
			const input = launchInput(args);
			try {
				const { record, replayed } = await runLaunch({
					lane: 'uniswap',
					chain: UNISWAP_CHAIN.slug,
					userId: auth.userId,
					agentId: args.agent_id,
					key: args.idempotency_key || null,
					body: input,
					execute: ({ stage }) => launchUniswap({ agentId: args.agent_id, userId: auth.userId, input, stage }),
				});
				const launch = publicRecord(record);
				return ok({ ...(record.result || {}), launch_id: record.id, status: record.status, replayed, launch });
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'launch_status',
		title: 'Read a launch',
		group: 'launch',
		scope: 'wallet:read',
		annotations: READ,
		description:
			'The record of one EVM-lane launch (Uniswap lane or paired coin): its status, the stages it has passed, the transaction and, once finalized, the coin. Use it after a timeout to learn whether the launch happened; a launch whose transaction landed after the request ended is settled when you read it.',
		inputSchema: {
			type: 'object',
			properties: { launch_id: { type: 'string', format: 'uuid', description: 'The launch_id a launch call returned.' } },
			required: ['launch_id'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			let row = await getLaunchRecord(args.launch_id, auth.userId);
			if (!row) return failure(new EvmLegError('not_found', 'No launch with that id belongs to this account.', 404));
			if (OPEN_STATUSES.has(row.status)) row = await settleLaunch(row, settlers);
			return ok(publicRecord(row));
		},
	},
];
