import { describe, it, expect } from 'vitest';

// The five hosted remote MCP servers. Each catalog is the exact tools/list
// payload: the shared dispatcher (api/_lib/mcp-dispatch.js) returns it
// verbatim, and the main /api/mcp dispatcher spreads each entry before adding
// pricing — so asserting on TOOL_CATALOG asserts on the wire response.
import { TOOL_CATALOG as mainCatalog } from '../api/_mcp/catalog.js';
import { TOOL_CATALOG as studioCatalog } from '../api/_mcp3d/catalog.js';
import { TOOL_CATALOG as agentCatalog } from '../api/_mcpagent/catalog.js';
import { TOOL_CATALOG as ibmCatalog } from '../api/_mcpibm/catalog.js';
import { TOOL_CATALOG as bazaarCatalog } from '../api/_mcpbazaar/catalog.js';

const CATALOGS = [
	['three.ws main (/api/mcp)', mainCatalog],
	['3D Studio (/api/mcp-3d)', studioCatalog],
	['Agent (/api/agent-mcp)', agentCatalog],
	['IBM Granite (/api/ibm-mcp)', ibmCatalog],
	['x402 Bazaar (/api/bazaar-mcp)', bazaarCatalog],
];

// The ONLY tools across all five hosted servers allowed to advertise
// destructiveHint: true. Everything else must set it explicitly to false:
// the MCP spec defaults destructiveHint to TRUE when omitted, so an absent
// hint silently marks a tool destructive.
//
// The rule is the one scripts/audit-mcp-safety.mjs enforces from the handler
// side: a tool is destructive when it moves funds (an irreversible transfer
// is the definition of destructive), deletes something that cannot be
// regenerated, or reaches a physical actuator. Every money-moving tool here is
// also gated on a confirm flag plus a fresh preview_id, which is the
// confirmation table an MCP client must show before a yes.
//
// Deletes something that cannot be regenerated:
//   delete_avatar       - permanently removes a user's avatar
//   forget              - deletes a stored agent memory
//   delete_custom_skill - permanently removes a skill an owner may have written
//                         by hand; gated on confirm_delete
//   agent_card_reveal   - returns a card secret once and deletes the stored
//                         encrypted copy
//   agent_card_cancel   - cancels a card; a paid card may not come back
//
// Spends or moves funds (irreversible transfer):
//   pay_and_call        - spends the user's USDC
//   persona_tip         - spends a persona's own USDC
//   persona_send        - spends a persona's own USDC
//   agent_card_create   - buys a gift or prepaid card from the agent wallet
//   agent_card_withdraw - drains a prepaid card balance back to the wallet
//   predictions_open    - spends agent-wallet USDC on a prediction position
//   predictions_close   - sells a prediction position at market
//   predictions_redeem  - settles a resolved position on chain
//
// Commits or transfers a whole agent (marketplace, escrowed on Solana):
//   create_marketplace_listing - a buy-now or an accepted bid then sells the
//                         agent without asking again, and include_history:
//                         false deletes its memories before the handover
//   delist_marketplace_listing - takes the listing down and refunds every
//                         open bid out of escrow
//   place_bid           - locks the bidder's USDC in the listing's escrow
//   buy_now             - pays the buy-now price; custody rotates to the buyer
//   accept_marketplace_bid - final: escrow pays out, the other bids refund,
//                         custody rotates to the buyer
//   withdraw_marketplace_bid - cancels a bid and moves its escrow back
//
// Reaches a physical actuator:
//   home_activate       - runs a scene or script in a real house, which moves
//                         locks, covers and alarms in the physical world
//   home_call           - calls an arbitrary Home Assistant service, so it can
//                         unlock a door or open a garage
//
// The two home tools are the reason this list is not just about money. Marking
// them non-destructive would tell every MCP client that opening someone's front
// door is a safe, reversible call, which is exactly the claim Home Assistant's
// own intent__HassTurnOff makes and exactly why this platform gates it. If a
// future home tool is genuinely read-only it belongs outside this set; anything
// that reaches an actuator belongs inside it. The previews and quotes that sit
// in front of each financial tool (agent_card_quote, preview_marketplace_action,
// predictions_*_preview) move nothing, so they stay outside it.
const DESTRUCTIVE_TOOLS = new Set([
	'delete_avatar', 'forget', 'delete_custom_skill', 'agent_card_reveal', 'agent_card_cancel',
	'pay_and_call', 'persona_tip', 'persona_send',
	'agent_card_create', 'agent_card_withdraw',
	'predictions_open', 'predictions_close', 'predictions_redeem',
	'create_marketplace_listing', 'delist_marketplace_listing', 'place_bid', 'buy_now',
	'accept_marketplace_bid', 'withdraw_marketplace_bid',
	'home_activate', 'home_call',
]);

// Internal/spec-only fields that must never leak into the tools/list wire
// payload.
const FORBIDDEN_WIRE_FIELDS = ['handler', 'scope', 'example', 'output'];

describe.each(CATALOGS)('%s — tools/list catalog', (label, catalog) => {
	it('is a non-empty array', () => {
		expect(Array.isArray(catalog)).toBe(true);
		expect(catalog.length).toBeGreaterThan(0);
	});

	it('tool names are unique', () => {
		const names = catalog.map((t) => t.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('every tool has a name, a human title, and a description', () => {
		for (const tool of catalog) {
			expect(typeof tool.name, `${label}: name`).toBe('string');
			expect(tool.name.length).toBeGreaterThan(0);
			expect(typeof tool.title, `${tool.name}: title`).toBe('string');
			expect(tool.title.length, `${tool.name}: title`).toBeGreaterThan(0);
			expect(typeof tool.description, `${tool.name}: description`).toBe('string');
		}
	});

	it('every tool carries complete, explicit boolean annotations', () => {
		for (const tool of catalog) {
			const a = tool.annotations;
			expect(a, `${tool.name}: annotations`).toBeTypeOf('object');
			for (const hint of [
				'readOnlyHint',
				'destructiveHint',
				'idempotentHint',
				'openWorldHint',
			]) {
				expect(typeof a[hint], `${tool.name}: ${hint}`).toBe('boolean');
			}
		}
	});

	it('only the pinned destructive tools advertise destructiveHint: true', () => {
		for (const tool of catalog) {
			const a = tool.annotations;
			if (DESTRUCTIVE_TOOLS.has(tool.name)) {
				expect(a.destructiveHint, `${tool.name}: destructiveHint`).toBe(true);
				expect(a.readOnlyHint, `${tool.name}: readOnlyHint`).toBe(false);
			} else {
				expect(a.destructiveHint, `${tool.name}: destructiveHint`).toBe(false);
			}
			// A read-only tool can never be destructive.
			if (a.readOnlyHint) {
				expect(a.destructiveHint, `${tool.name}: read-only yet destructive`).toBe(false);
			}
		}
	});

	it('never leaks internal fields onto the wire', () => {
		for (const tool of catalog) {
			for (const field of FORBIDDEN_WIRE_FIELDS) {
				expect(tool[field], `${tool.name}: ${field}`).toBeUndefined();
			}
		}
	});
});

describe('destructive set across all five servers', () => {
	it('is exactly the pinned set: deletes, fund movements and physical actuators', () => {
		const destructive = new Set();
		for (const [, catalog] of CATALOGS) {
			for (const tool of catalog) {
				if (tool.annotations?.destructiveHint === true) destructive.add(tool.name);
			}
		}
		expect([...destructive].sort()).toEqual([...DESTRUCTIVE_TOOLS].sort());
	});
});

describe('free getting-started entry points', () => {
	const EXPECTED = {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	};

	it.each([
		['three.ws main', mainCatalog, 'getting_started'],
		['3D Studio', studioCatalog, 'getting_started'],
		['Agent', agentCatalog, 'getting_started'],
		['x402 Bazaar', bazaarCatalog, 'getting_started'],
		['IBM Granite', ibmCatalog, 'ibm_granite_getting_started'],
	])('%s lists a read-only, idempotent, closed-world overview tool', (label, catalog, name) => {
		const tool = catalog.find((t) => t.name === name);
		expect(tool, `${label}: ${name}`).toBeDefined();
		expect(tool.annotations).toEqual(EXPECTED);
	});
});

describe('IBM Granite catalog mirrors packages/ibm-x402-mcp annotations', () => {
	// Generative inference: read-only, open-world, NOT idempotent (same input
	// can yield different output). Embeddings are deterministic for a model.
	const GENERATIVE = {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	};
	const DETERMINISTIC = { ...GENERATIVE, idempotentHint: true };

	it.each([
		['ibm_granite_chat', GENERATIVE],
		['ibm_granite_code', GENERATIVE],
		['ibm_granite_analyze', GENERATIVE],
		['ibm_granite_forecast', GENERATIVE],
		['ibm_granite_embed', DETERMINISTIC],
	])('%s matches the npm package semantics', (name, expected) => {
		const tool = ibmCatalog.find((t) => t.name === name);
		expect(tool).toBeDefined();
		expect(tool.annotations).toEqual(expected);
	});
});
