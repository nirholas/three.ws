// Agent cards MCP tools: search, quote, buy, check and reveal gift cards and
// prepaid cards paid for from an agent's own wallet.
//
// Every tool calls the same service the REST API uses (api/_lib/cards/service.js),
// so limits, the audit trail and secret handling are identical on both surfaces.
//
// Policy fields (group / tier / confirmFlag / previewTool) follow the shared
// MCP tool policy: `financial` tools refuse without their confirm flag and the
// id their preview tool returned (quote_id for a purchase, preview_id for a
// reveal). The catalog strips these fields from tools/list and republishes them
// under `_meta`.

import * as cards from '../../_lib/cards/service.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const AGENT_ID = { type: 'string', format: 'uuid', description: 'Agent UUID (from list_my_agents).' };
const CARD_ID = { type: 'string', format: 'uuid', description: 'Card UUID (from agent_card_list or agent_card_create).' };

function ok(structured) {
	return {
		content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
		structuredContent: structured,
	};
}

function fail(e) {
	if (e instanceof cards.CardError) {
		const structured = { error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
		return { content: [{ type: 'text', text: `Error (${e.code}): ${e.message}` }], structuredContent: structured, isError: true };
	}
	throw e;
}

const principalOf = (auth) => ({ userId: auth?.userId ?? null, source: 'mcp', ip: null });

function tool(def, run) {
	return {
		group: 'cards',
		...def,
		async handler(args, auth) {
			if (!auth?.userId) {
				return fail(new cards.CardError(401, 'unauthorized', 'Connect a three.ws account (OAuth or API key) to use agent cards.'));
			}
			try {
				return ok(await run(args || {}, principalOf(auth)));
			} catch (e) {
				return fail(e);
			}
		},
	};
}

export const toolDefs = [
	tool({
		name: 'agent_card_search_merchants',
		title: 'Search card merchants',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description:
			'Search merchants an agent can buy a gift card or prepaid card from (for example a game store, a marketplace, food delivery, or a prepaid Visa). Returns merchant names with the countries and categories they sell in. Pass sandbox: true to list the provider\'s free test products, which run the whole purchase flow without moving funds.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				q: { type: 'string', maxLength: 100, description: 'Merchant or brand name to search for.' },
				country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: 'ISO country code, e.g. US.' },
				kind: { type: 'string', enum: ['gift_card', 'prepaid_card'], description: 'Only gift cards or only prepaid cards.' },
				sandbox: { type: 'boolean', default: false },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 24 },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
	}, async (a, p) => {
		await cards.loadOwnedAgent(a.agent_id, p);
		return cards.searchMerchants({ q: a.q, country: a.country, kind: a.kind, sandbox: a.sandbox, limit: a.limit });
	}),

	tool({
		name: 'agent_card_search_gift_cards',
		title: 'Search gift and prepaid card products',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description:
			'Search card products with their denominations: fixed packages and/or an allowed range, currency, country and stock. Use a product id and one allowed amount with agent_card_quote.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				q: { type: 'string', maxLength: 100 },
				country: { type: 'string', pattern: '^[A-Za-z]{2}$' },
				merchant: { type: 'string', maxLength: 120, description: 'Exact merchant name from agent_card_search_merchants.' },
				kind: { type: 'string', enum: ['gift_card', 'prepaid_card'] },
				sandbox: { type: 'boolean', default: false },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 24 },
				start: { type: 'integer', minimum: 0, default: 0 },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
	}, async (a, p) => {
		await cards.loadOwnedAgent(a.agent_id, p);
		return cards.searchProducts({
			q: a.q, country: a.country, merchant: a.merchant, kind: a.kind, sandbox: a.sandbox, limit: a.limit, start: a.start,
		});
	}),

	tool({
		name: 'agent_card_quote',
		title: 'Quote a card purchase',
		tier: 'write',
		scope: 'wallet:write',
		annotations: WRITE,
		description:
			'Lock a price for one card: returns the total in USDC including fees, the Solana address it would be paid to, a quote_id valid for ten minutes, and a confirm table (recipient, amount, token, chain). Moves no funds. Show the confirm table to the owner before calling agent_card_create.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				product_id: { type: 'string', minLength: 1, maxLength: 200 },
				amount: { type: 'number', exclusiveMinimum: 0, description: 'Face value in the product currency; must be a package value or inside the range.' },
			},
			required: ['agent_id', 'product_id', 'amount'],
			additionalProperties: false,
		},
	}, (a, p) => cards.quoteCard({ agentId: a.agent_id, principal: p, productId: a.product_id, amount: a.amount })),

	tool({
		name: 'agent_card_create',
		title: 'Buy a card from the agent wallet',
		tier: 'financial',
		confirmFlag: 'confirm_spend',
		previewTool: 'agent_card_quote',
		scope: 'wallet:write',
		annotations: MONEY,
		description:
			'Buy the card a quote describes, paying the quoted USDC from the agent wallet on Solana under the agent\'s spend limits and anomaly freeze. Requires a quote_id from agent_card_quote that is under ten minutes old and confirm_spend: true, which you may only send after the owner explicitly approved the quote\'s confirm table. Returns the card with its status and the payment signature.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				quote_id: { type: 'string', format: 'uuid' },
				confirm_spend: { type: 'boolean', description: 'Must be true, and only after the owner said yes to the quote.' },
			},
			required: ['agent_id', 'quote_id', 'confirm_spend'],
			additionalProperties: false,
		},
	}, (a, p) => cards.createCard({ agentId: a.agent_id, principal: p, quoteId: a.quote_id, confirmSpend: a.confirm_spend })),

	tool({
		name: 'agent_card_list',
		title: 'List agent cards',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description: 'List the agent\'s cards, newest first, with masked numbers, status and what each cost. In-flight cards are refreshed from the provider.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				status: { type: 'string', enum: ['quoted', 'paying', 'processing', 'delivered', 'failed', 'refunded', 'cancelled', 'expired', 'needs_verification'] },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				cursor: { type: 'string', maxLength: 40 },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
	}, (a, p) => cards.listCards({ agentId: a.agent_id, principal: p, status: a.status, limit: a.limit, cursor: a.cursor })),

	tool({
		name: 'agent_card_get',
		title: 'Get one agent card',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description: 'One card with its audit trail (quotes, payment, status changes, reveals with who and when). Never includes the secret.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID, card_id: CARD_ID }, required: ['agent_id', 'card_id'], additionalProperties: false },
	}, (a, p) => cards.getCard({ agentId: a.agent_id, principal: p, cardId: a.card_id })),

	tool({
		name: 'agent_card_status',
		title: 'Refresh a card from the provider',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description: 'Ask the provider for the card\'s current status (processing, delivered, failed, refunded) and update the record.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID, card_id: CARD_ID }, required: ['agent_id', 'card_id'], additionalProperties: false },
	}, (a, p) => cards.refreshCard({ agentId: a.agent_id, principal: p, cardId: a.card_id })),

	tool({
		name: 'agent_card_balance',
		title: 'Card balance',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description: 'The card\'s remaining balance. When the provider does not report balances the answer is the face value of a delivered card, and says so.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID, card_id: CARD_ID }, required: ['agent_id', 'card_id'], additionalProperties: false },
	}, (a, p) => cards.cardBalance({ agentId: a.agent_id, principal: p, cardId: a.card_id })),

	tool({
		name: 'agent_card_data',
		title: 'Card data and reveal preview',
		tier: 'write',
		scope: 'wallet:write',
		annotations: WRITE,
		description:
			'The masked card number, which secret fields exist (code, PIN, link) and redemption instructions, plus a single-use preview_id valid for five minutes. Required before agent_card_reveal. Does not expose the secret.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID, card_id: CARD_ID }, required: ['agent_id', 'card_id'], additionalProperties: false },
	}, (a, p) => cards.cardData({ agentId: a.agent_id, principal: p, cardId: a.card_id })),

	tool({
		name: 'agent_card_reveal',
		title: 'Reveal a card secret once',
		tier: 'financial',
		confirmFlag: 'confirm_reveal',
		previewTool: 'agent_card_data',
		scope: 'wallet:write',
		annotations: MONEY,
		description:
			'Return the card number, PIN or redemption code. Requires the preview_id from agent_card_data and confirm_reveal: true after the owner agreed. The preview id works once; the stored encrypted copy is deleted by this call, and the reveal is logged with the actor and time. Treat the result as a secret: give it to the owner only, never post it anywhere.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				card_id: CARD_ID,
				preview_id: { type: 'string', minLength: 16, maxLength: 128 },
				confirm_reveal: { type: 'boolean' },
			},
			required: ['agent_id', 'card_id', 'preview_id', 'confirm_reveal'],
			additionalProperties: false,
		},
	}, (a, p) => cards.revealCard({ agentId: a.agent_id, principal: p, cardId: a.card_id, previewId: a.preview_id, confirmReveal: a.confirm_reveal })),

	tool({
		name: 'agent_card_cancel',
		title: 'Cancel a card',
		tier: 'financial',
		confirmFlag: 'confirm_cancel',
		previewTool: 'agent_card_get',
		scope: 'wallet:write',
		annotations: MONEY,
		description: 'Cancel a card. Unpaid quotes can always be cancelled; whether a paid card can be depends on the provider, and the error says so when it cannot. Requires confirm_cancel: true.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: AGENT_ID, card_id: CARD_ID, confirm_cancel: { type: 'boolean' } },
			required: ['agent_id', 'card_id', 'confirm_cancel'],
			additionalProperties: false,
		},
	}, (a, p) => cards.cancelCard({ agentId: a.agent_id, principal: p, cardId: a.card_id, confirmCancel: a.confirm_cancel })),

	tool({
		name: 'agent_card_withdraw',
		title: 'Withdraw a prepaid balance to USDC',
		tier: 'financial',
		confirmFlag: 'confirm_withdraw',
		previewTool: 'agent_card_balance',
		scope: 'wallet:write',
		annotations: MONEY,
		description: 'Move a prepaid card balance back to the agent wallet as USDC, where the provider supports it. Check agent_card_balance first and pass confirm_withdraw: true after the owner agreed.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID, card_id: CARD_ID,
				amount: { type: 'number', exclusiveMinimum: 0 },
				confirm_withdraw: { type: 'boolean' },
			},
			required: ['agent_id', 'card_id', 'amount', 'confirm_withdraw'],
			additionalProperties: false,
		},
	}, (a, p) => cards.withdrawCard({ agentId: a.agent_id, principal: p, cardId: a.card_id, amount: a.amount, confirmWithdraw: a.confirm_withdraw })),

	tool({
		name: 'agent_card_connect',
		title: 'Card provider verification status',
		tier: 'read',
		scope: 'wallet:read',
		annotations: READ,
		description: 'Whether the card provider needs the account holder to complete identity steps before cards can be bought.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
	}, (a, p) => cards.connectStatus({ agentId: a.agent_id, principal: p })),

	tool({
		name: 'agent_card_connect_link',
		title: 'Card provider verification link',
		tier: 'write',
		scope: 'wallet:write',
		annotations: WRITE,
		description: 'A browser link where the account holder completes the provider\'s identity steps. Give it to the owner; do not open it yourself.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
	}, (a, p) => cards.connectLink({ agentId: a.agent_id, principal: p })),
];
