// Destination whitelist MCP tools: read an agent wallet's allowlist, propose a
// new destination, remove one.
//
// An agent (or any API credential) can only PROPOSE an address. A proposal is
// inert: it cannot receive funds until the owner approves it in the app with a
// step-up (password, wallet signature or emailed code) and then waits out the
// cooldown. Removing an address takes effect at once. Every tool calls the same
// library the REST endpoint uses (api/_lib/destination-whitelist.js), so the
// rules are identical on both surfaces. Doc: docs/destination-whitelist.md.

import { WhitelistError, getWhitelist, addEntry, removeEntry, normalizeDestination } from '../../_lib/destination-whitelist.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Removing only narrows who can be paid, so it is not destructive in the MCP sense.
const REMOVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const AGENT_ID = { type: 'string', format: 'uuid', description: 'Agent UUID (from list_my_agents).' };

function ok(structured) {
	return {
		content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
		structuredContent: structured,
	};
}

function fail(e) {
	if (e instanceof WhitelistError) {
		const structured = { error: e.code, message: e.message, ...(e.extra && Object.keys(e.extra).length ? { details: e.extra } : {}) };
		return { content: [{ type: 'text', text: `Error (${e.code}): ${e.message}` }], structuredContent: structured, isError: true };
	}
	throw e;
}

// An MCP caller is never the owner's browser session: it has no session id, so
// it can never hold a step-up grant and addEntry can only create a proposal.
const actorOf = (auth) => ({ kind: 'agent', userId: auth.userId, sessionId: null });

function tool(def, run) {
	return {
		group: 'wallet',
		...def,
		async handler(args, auth) {
			if (!auth?.userId) {
				return fail(new WhitelistError(401, 'unauthorized', 'Connect a three.ws account (OAuth or API key) to manage a wallet allowlist.'));
			}
			try {
				return ok(await run(args || {}, actorOf(auth)));
			} catch (e) {
				return fail(e);
			}
		},
	};
}

export const toolDefs = [
	tool({
		name: 'get_whitelist',
		title: 'Get wallet allowlist',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description:
			'List the destinations an agent wallet may send funds to: each entry has its label, chain, per-destination caps and status (proposed, pending with seconds until it activates, or active), plus the cooldown and whether the allowlist is enforced. Pass history: true to include cancelled and removed entries. Use this before proposing or removing an address, or to check why a send was refused as not whitelisted.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				history: { type: 'boolean', default: false, description: 'Include cancelled and removed entries.' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
	}, (a, actor) => getWhitelist(a.agent_id, actor.userId, { history: a.history === true })),

	tool({
		name: 'add_to_whitelist',
		title: 'Propose a wallet allowlist destination',
		tier: 'write',
		scope: 'wallet:write',
		annotations: WRITE,
		description:
			'Propose an address for an agent wallet\'s allowlist, with an optional label and per-transaction and daily USD caps. This only creates a PROPOSAL: the address cannot receive any funds until the owner approves it in the three.ws app with a step-up, and it then serves a cooldown (24 hours by default, never under 1 hour) during which the owner is alerted and can cancel it. Accepts a Solana or an EVM address; the chain is detected from the address. Use this when the agent needs a new payout destination and the owner must decide whether to trust it.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				address: { type: 'string', maxLength: 64, description: 'Solana (base58) or EVM (0x...) address. Case matters for Solana.' },
				chain: { type: 'string', enum: ['solana', 'evm'], description: 'Optional. If set, the address must belong to this chain.' },
				label: { type: 'string', maxLength: 60, description: 'Human-readable name for the destination, e.g. "Cold wallet".' },
				per_tx_cap_usd: { type: 'number', exclusiveMinimum: 0, description: 'Largest single send allowed to this destination, in USD.' },
				daily_cap_usd: { type: 'number', exclusiveMinimum: 0, description: 'Most that may be sent to this destination in 24 hours, in USD.' },
			},
			required: ['agent_id', 'address'],
			additionalProperties: false,
		},
	}, async (a, actor) => {
		const norm = normalizeDestination(a.address);
		if (!norm) throw new WhitelistError(400, 'invalid_address', 'That is not a valid Solana or EVM address.');
		if (a.chain && a.chain !== norm.chain) throw new WhitelistError(400, 'chain_mismatch', `That address is a ${norm.chain} address, not ${a.chain}.`);
		const out = await addEntry({
			agentId: a.agent_id,
			actor,
			body: { address: a.address, label: a.label, per_tx_cap_usd: a.per_tx_cap_usd, daily_cap_usd: a.daily_cap_usd },
		});
		return {
			...out,
			next_step: 'The owner has been notified on every connected channel. This address cannot receive funds until they approve it with a step-up in the app and its cooldown ends.',
		};
	}),

	tool({
		name: 'remove_from_whitelist',
		title: 'Remove a wallet allowlist destination',
		tier: 'write',
		scope: 'wallet:write',
		annotations: REMOVE,
		description:
			'Remove a destination from an agent wallet\'s allowlist (or withdraw a pending proposal). Takes effect immediately: the address can no longer receive funds. Use this when an address is no longer trusted or a proposal was a mistake; take the entry id from get_whitelist.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				entry_id: { type: 'string', format: 'uuid', description: 'Entry id from get_whitelist.' },
			},
			required: ['agent_id', 'entry_id'],
			additionalProperties: false,
		},
	}, (a, actor) => removeEntry({ agentId: a.agent_id, entryId: a.entry_id, actor })),
];
