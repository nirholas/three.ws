// `agent_reputation` — paid MCP tool that reads ERC-8004 reputation for an
// agent (by agentId, EVM wallet, or "eip155:<chain>:<wallet>" CAIP-10 ID).
//
// Pricing: $0.01 USDC, settled `exact` in USDC on Solana mainnet.
//
// All reads are made directly against the canonical ERC-8004 reference
// deployments via ethers JsonRpcProvider — no third-party indexers, no
// cached snapshots, no fallback values. By default we query Base; the
// caller can override with `chain: "ethereum"|"base"|"arbitrum"|"optimism"|"polygon"|"bsc"`
// or pass a numeric chainId.
//
// The result includes:
//   - aggregate reputation (average + count) via getReputation. The contract
//     returns (int256 avgX100, uint256 count): the average ALREADY ×100, signed
//     so reputation can be negative. We divide by 100 — never by count — and
//     preserve the sign.
//   - total ETH staked on the agent's vouches via getTotalStake
//   - recent FeedbackSubmitted + ReputationStaked events (latest 25)
//   - the agent's URI + wallet (Identity Registry) when resolvable
//
// All numeric responses are returned both as decimal strings (for safe
// integer transport) and as parsed Number where the value fits in float64.

import { Contract, isAddress, ZeroAddress } from 'ethers';
import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { makeEvmProvider, getEvmRpcUrls } from '../lib/evm-rpc.js';
import {
	IDENTITY_REGISTRY_ABI,
	IDENTITY_REGISTRY_MAINNET,
	REPUTATION_REGISTRY_ABI,
	REPUTATION_REGISTRY_MAINNET,
	readReputationAggregate,
	resolveAgentId,
	resolveChain,
} from '../lib/erc8004.js';

const TOOL_NAME = 'agent_reputation';
const TOOL_DESCRIPTION =
	'ERC-8004 on-chain reputation for an agent: aggregate score + count + average from the canonical ReputationRegistry, total ETH staked on vouches, and the latest ReputationSubmitted/ReputationStaked events. Resolves agentId from a wallet via IdentityRegistry when needed. Reads default to Base; switch chains via "chain". Use this to vet an agent\'s on-chain track record before hiring or paying it; agent_hire_discover already folds this score into its ranking. Paid: $0.01 USDC.';

// Parse the agent identifier. Accepts: numeric ID, EVM wallet, or CAIP-10
// "eip155:<chainId>:<address>" (which can also override the chain selection).
function parseAgentInput(raw, defaultChain) {
	const value = String(raw || '').trim();
	if (!value) throw new Error('agent identifier is required');
	if (/^\d+$/.test(value)) {
		return { kind: 'agentId', agentId: BigInt(value), chain: defaultChain };
	}
	if (value.startsWith('eip155:')) {
		const parts = value.split(':');
		if (parts.length !== 3) throw new Error(`invalid CAIP-10 ID "${value}"`);
		const chain = resolveChain(parts[1]);
		const addr = parts[2];
		if (!isAddress(addr)) throw new Error(`invalid wallet in CAIP-10 ID "${value}"`);
		return { kind: 'wallet', wallet: addr, chain };
	}
	if (isAddress(value)) {
		return { kind: 'wallet', wallet: value, chain: defaultChain };
	}
	throw new Error(
		`could not parse agent identifier "${value}" — expected uint, EVM wallet, or eip155:<chain>:<addr>`,
	);
}

async function readIdentity(provider, agentId) {
	const id = new Contract(IDENTITY_REGISTRY_MAINNET, IDENTITY_REGISTRY_ABI, provider);
	const [owner, agentWallet, uri] = await Promise.allSettled([
		id.ownerOf(agentId),
		id.getAgentWallet(agentId),
		id.tokenURI(agentId),
	]);
	return {
		owner: owner.status === 'fulfilled' ? owner.value : null,
		agentWallet: agentWallet.status === 'fulfilled' ? agentWallet.value : null,
		uri: uri.status === 'fulfilled' ? uri.value : null,
		errors: [owner, agentWallet, uri]
			.filter((r) => r.status === 'rejected')
			.map((r) => r.reason?.message || String(r.reason)),
	};
}

// Walk the last LOG_WINDOW_BLOCKS blocks (configurable) for recent vouches.
// On chains where the registry has been quiet, this can return an empty
// array — that's the truth, not a failure.
const LOG_WINDOW_BLOCKS = Number(process.env.MCP_AGENT_REP_LOG_WINDOW || 200_000);

async function readRecentEvents(provider, agentId) {
	const rep = new Contract(REPUTATION_REGISTRY_MAINNET, REPUTATION_REGISTRY_ABI, provider);
	const latest = await provider.getBlockNumber();
	const from = Math.max(0, latest - LOG_WINDOW_BLOCKS);
	const [submitted, staked] = await Promise.all([
		rep.queryFilter(rep.filters.FeedbackSubmitted(agentId), from, latest),
		rep.queryFilter(rep.filters.ReputationStaked(agentId), from, latest),
	]);
	const submittedDecoded = submitted.map((e) => ({
		kind: 'submitted',
		blockNumber: e.blockNumber,
		txHash: e.transactionHash,
		submitter: e.args?.from,
		score: Number(e.args?.score),
		comment: e.args?.uri || '',
	}));
	const stakedDecoded = staked.map((e) => ({
		kind: 'staked',
		blockNumber: e.blockNumber,
		txHash: e.transactionHash,
		staker: e.args?.staker,
		score: Number(e.args?.score),
		valueWei: e.args?.value?.toString?.() || '0',
	}));
	return {
		windowBlocks: LOG_WINDOW_BLOCKS,
		fromBlock: from,
		toBlock: latest,
		events: [...submittedDecoded, ...stakedDecoded]
			.sort((a, b) => b.blockNumber - a.blockNumber)
			.slice(0, 25),
	};
}

// Single source of truth: Zod shape with descriptions; JSON Schema derived.
const inputZodShape = {
	address: z
		.string()
		.min(1)
		.describe(
			'ERC-8004 agentId (uint), EVM wallet address (0x...), or CAIP-10 "eip155:<chainId>:<wallet>".',
		),
	chain: z
		.string()
		.describe(
			'Chain to query (default: base). Accepts name or numeric chainId. Overridden by CAIP-10 input.',
		)
		.optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildAgentReputationTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.01',
			inputSchema: inputJsonSchema,
			example: { address: '1', chain: 'base' },
			outputExample: {
				chain: 'base',
				agentId: '1',
				identity: { owner: '0x...', agentWallet: '0x...', uri: 'ipfs://...' },
				reputation: { averageX100: '420', average: 4.2, count: '6', totalStakeWei: '0' },
				events: [{ kind: 'submitted', score: 5, submitter: '0x...', comment: '' }],
			},
		},
		async ({ address, chain }) => {
			const defaultChain = resolveChain(chain);
			const parsed = parseAgentInput(address, defaultChain);
			// Endpoint failover: an operator override (MCP_AGENT_REP_RPC_<id>) is
			// tried first, then the chain's built-in redundant public endpoints,
			// each with a bounded request timeout. A single RPC outage no longer
			// fails the lookup or hangs the paid call.
			const overrides = [process.env[`MCP_AGENT_REP_RPC_${parsed.chain.id}`]].filter(Boolean);
			const provider = makeEvmProvider(parsed.chain.id, { overrides, timeoutMs: 12_000 });

			let agentId = parsed.kind === 'agentId' ? parsed.agentId : null;
			let walletResolved = parsed.kind === 'wallet' ? parsed.wallet : null;
			if (!agentId) {
				agentId = await resolveAgentId(provider, walletResolved);
				if (!agentId) {
					return toolError(
						'no_agent_registered_for_wallet',
						`no ERC-8004 agent is registered for ${walletResolved} on ${parsed.chain.name}`,
						{
							chain: parsed.chain.name,
							chainId: parsed.chain.id,
							input: address,
							resolvedWallet: walletResolved,
							identityRegistry: IDENTITY_REGISTRY_MAINNET,
							reputationRegistry: REPUTATION_REGISTRY_MAINNET,
						},
					);
				}
			}

			const [identity, reputation, events] = await Promise.all([
				readIdentity(provider, agentId),
				readReputationAggregate(provider, agentId),
				readRecentEvents(provider, agentId),
			]);

			const isZero = identity.owner === ZeroAddress;
			return {
				chain: parsed.chain.name,
				chainId: parsed.chain.id,
				agentId: agentId.toString(),
				agentRegistry: `eip155:${parsed.chain.id}:${IDENTITY_REGISTRY_MAINNET}`,
				reputationRegistry: REPUTATION_REGISTRY_MAINNET,
				identity: isZero ? null : identity,
				reputation,
				events,
				rpc: getEvmRpcUrls(parsed.chain.id, overrides),
				fetchedAt: new Date().toISOString(),
			};
		},
	);
	return {
		name: TOOL_NAME,
		title: 'Agent reputation ($0.01)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only on-chain lookup — reputation events accrue between calls,
		// so not idempotent.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
