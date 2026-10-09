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
import { POLICY } from '../packages/mcp-policy/src/table.js';

// [label, catalog, @three-ws/mcp-policy server id]
const CATALOGS = [
	['three.ws main (/api/mcp)', mainCatalog, 'three.ws'],
	['3D Studio (/api/mcp-3d)', studioCatalog, 'threews-3d-studio'],
	['Agent (/api/agent-mcp)', agentCatalog, 'threews-agent'],
	['IBM Granite (/api/ibm-mcp)', ibmCatalog, 'ibm-x402-mcp-remote'],
	['x402 Bazaar (/api/bazaar-mcp)', bazaarCatalog, 'threews-x402-bazaar'],
];

// The ONLY tools across all five hosted servers allowed to advertise
// destructiveHint: true. Everything else must set it explicitly to false;
// the MCP spec defaults destructiveHint to TRUE when omitted, so an absent
// hint silently marks a tool destructive.
//
// Deleting what cannot be regenerated:
//   delete_avatar       permanently removes a user's avatar
//   forget              deletes a stored agent memory
//   delete_custom_skill permanently removes a skill an owner may have written
//                       by hand; gated on confirm_delete
// Moving money (an irreversible transfer or an on-chain transaction):
//   pay_and_call        spends the user's USDC on an x402 endpoint
//   persona_tip, persona_send   spend a persona's own USDC
//   agent_card_create   buys a card or gift card with the agent's funds
//   agent_card_reveal   exposes a card's secret number or code, once
//   agent_card_cancel, agent_card_withdraw   close a card or pull its funds
//   paired_launch       launches a coin and its opening buy on Robinhood Chain
//   paired_claim_fees   signs and broadcasts the fee-collection transaction on
//                       Robinhood Chain (marked destructive on 2026-10-09)
//   create_marketplace_listing, delist_marketplace_listing, place_bid,
//   buy_now, accept_marketplace_bid, withdraw_marketplace_bid
//                       commit an agent or move USDC through marketplace escrow
//   predictions_open, predictions_close, predictions_redeem
//                       trade or settle prediction-market positions in USDC
// Acting on the physical world:
//   home_activate       runs a scene or script in a real house, which moves
//                       locks, covers and alarms
//   home_call           calls an arbitrary Home Assistant service, so it can
//                       unlock a door or open a garage
//
// The two home tools are the reason this list is not just about money. Marking
// them non-destructive would tell every MCP client that opening someone's front
// door is a safe, reversible call, which is exactly the claim Home Assistant's
// own intent__HassTurnOff makes and exactly why this platform gates it. If a
// future home tool is genuinely read-only it belongs outside this set; anything
// that reaches an actuator belongs inside it.
const DESTRUCTIVE_TOOLS = new Set([
	'delete_avatar', 'forget', 'delete_custom_skill',
	'pay_and_call', 'persona_tip', 'persona_send',
	'agent_card_create', 'agent_card_reveal', 'agent_card_cancel', 'agent_card_withdraw',
	'paired_launch', 'paired_claim_fees',
	'create_marketplace_listing', 'delist_marketplace_listing', 'place_bid', 'buy_now',
	'accept_marketplace_bid', 'withdraw_marketplace_bid',
	'predictions_open', 'predictions_close', 'predictions_redeem',
	'home_activate', 'home_call',
]);

// Destructive tools the policy deliberately leaves in the write tier (on by
// default, no confirm flag). paired_claim_fees collects fees into the agent's
// own wallet, so nothing leaves the owner's control. Every other destructive
// tool must be financial tier: off until the session enables it, and refused
// without its confirm flag.
const DESTRUCTIVE_WRITE_TIER = new Set(['paired_claim_fees']);

// Internal/spec-only fields that must never leak into the tools/list wire
// payload.
const FORBIDDEN_WIRE_FIELDS = ['handler', 'scope', 'example', 'output'];

describe.each(CATALOGS)('%s: tools/list catalog', (label, catalog, serverId) => {
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

	it('gates every destructive tool behind the financial policy tier', () => {
		const rows = POLICY[serverId];
		for (const tool of catalog) {
			if (tool.annotations?.destructiveHint !== true || DESTRUCTIVE_WRITE_TIER.has(tool.name)) continue;
			const row = rows[tool.name];
			expect(row?.tier, `${tool.name}: policy tier`).toBe('financial');
			expect(row?.confirmFlag, `${tool.name}: confirm flag`).toMatch(/^confirm_/);
		}
	});

	it('serves the preview tool every financial tool is gated on', () => {
		// The policy refuses a financial tool without a fresh id from its preview
		// tool, so a preview this server does not serve leaves the tool
		// uncallable (pay_and_call once named a pay_quote nobody registered).
		const names = new Set(catalog.map((t) => t.name));
		for (const [name, row] of Object.entries(POLICY[serverId])) {
			if (!names.has(name) || !row.previewTool) continue;
			expect(names.has(row.previewTool), `${name} needs ${row.previewTool}`).toBe(true);
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
	it('is exactly the pinned DESTRUCTIVE_TOOLS set', () => {
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
