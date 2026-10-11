// The consent screen's grant groups: what an MCP client is approved for, one
// tick box per kind of power rather than one per fine scope.
//
// A client that discovers its scopes the documented way (RFC 9728 metadata,
// then dynamic registration) asks for every registerable scope at once, so the
// person approving it was shown fourteen checkmarks and one Authorize button.
// This module folds those scopes into five groups a person can reason about:
//
//   read     see things. Always granted, because a connector that can see
//            nothing has nothing to offer.
//   manage   change account state that a later call can undo: avatars, memory,
//            agents, acting on a connected home.
//   trade    swap, bid, open and close positions. Value stays in the wallet.
//   spend    send, pay, withdraw, fund a card, publish paid services. Value
//            leaves the wallet. Includes trade and launch (wallet:write implies
//            wallet:trade and wallet:launch, key-scopes.js).
//   launch   launch a coin and claim its creator fees.
//
// Every group also lists which of its actions STILL ask the person before they
// run. That list is not written by hand: it is derived from the MCP tool
// policy (@three-ws/mcp-policy POLICY), where each financial tool names the
// confirm flag it requires, so a tool that gains or loses a confirmation shows
// up on the consent screen on the next deploy without anyone editing copy.
//
// api/oauth/[action].js renders the groups and folds the ticked ones back into
// a scope string; tests/api/oauth-grant-groups.test.js pins the mapping.

import { POLICY } from '@three-ws/mcp-policy';
import { REGISTERABLE_SCOPES } from './oauth-scopes.js';
import { IMPLIED_SCOPES } from './key-scopes.js';

// Plain-language label for every scope an MCP client may hold. Shared with the
// consent screen and the connected-apps settings card.
export const SCOPE_LABELS = Object.freeze({
	'avatars:read': 'Read your avatars',
	'avatars:write': 'Create and update avatars',
	'avatars:delete': 'Delete your avatars',
	profile: 'See your name and email',
	offline_access: 'Stay connected without signing in again',
	'memory:read': 'Recall your agents’ memories',
	'memory:write': 'Store and forget your agents’ memories',
	'agents:read': 'See your agents and their identities',
	'agents:write': 'Create, update and register your agents',
	'feedback:read': 'Read visitor feedback and its repro steps',
	'wallet:read': 'See your agent wallet balance and spending caps',
	'wallet:trade': 'Swap, bid and open or close positions from your agent wallet, within your caps',
	'wallet:write': 'Send and spend USDC from your agent wallet, within your caps',
	'wallet:launch': 'Launch coins from your agent wallet and claim their creator fees',
	'services:write': 'Publish paid services that earn USDC to your agent wallet',
	'home:read': 'See the state of your connected home',
	'home:act': 'Ask to act on your connected home',
});

// What each confirm flag in the policy table means to the person approving.
// Keyed by flag so a new flag in packages/mcp-policy/src/groups.js that is
// missing here is caught by the test instead of rendering as a raw identifier.
export const CONFIRM_PHRASES = Object.freeze({
	confirm_swap: 'swaps',
	confirm_transfer: 'transfers out of a wallet',
	confirm_launch: 'launching a coin',
	confirm_spend: 'spending USDC or credits',
	confirm_payment: 'payments',
	confirm_deposit: 'deposits',
	confirm_withdraw: 'withdrawals',
	confirm_delete: 'deleting anything',
	confirm_bid: 'placing a bid',
	confirm_send: 'sending funds or messages to someone',
	confirm_run: 'running code or acting on a connected home',
	confirm_listing: 'listing an agent for sale',
	confirm_delist: 'taking a listing down',
	confirm_accept: 'accepting an offer',
	confirm_trade: 'perps and prediction market orders',
	confirm_reveal: 'revealing card details',
	confirm_cancel: 'cancelling a card',
});

// The scope that keeps a client connected is not a power over the account,
// so it is shown as a note under the groups rather than as a group.
export const CONNECTION_SCOPES = Object.freeze(['offline_access']);

export const GRANT_GROUPS = Object.freeze([
	{
		id: 'read',
		label: 'Read',
		required: true,
		blurb: 'Look at your account. Nothing in this group changes anything.',
		scopes: ['avatars:read', 'profile', 'memory:read', 'agents:read', 'feedback:read', 'wallet:read', 'home:read'],
		policyGroups: [],
	},
	{
		id: 'manage',
		label: 'Manage',
		blurb: 'Change things a later call can undo: avatars, memories, agents, and asking a connected home to act.',
		scopes: ['avatars:write', 'avatars:delete', 'memory:write', 'agents:write', 'home:act'],
		policyGroups: ['agents', 'chat', 'runs', 'skills', 'assets', 'integrations', 'account', 'intelligence', 'gateway', 'sandbox', 'utility'],
	},
	{
		id: 'trade',
		label: 'Trade',
		blurb: 'Swap, bid, and open or close positions. Value stays inside your agent wallet and every trade is capped.',
		scopes: ['wallet:trade'],
		policyGroups: ['trading', 'orders', 'perps', 'lending', 'predictions', 'marketplace'],
	},
	{
		id: 'spend',
		label: 'Spend',
		blurb: 'Send USDC out of your agent wallet: pay services, withdraw, fund cards, publish paid endpoints. Includes everything in Trade and Launch.',
		scopes: ['wallet:write', 'services:write'],
		policyGroups: ['x402', 'wallet', 'cards', 'domains', 'mail', 'billing', 'allowlist'],
	},
	{
		id: 'launch',
		label: 'Launch',
		blurb: 'Launch a coin from your agent wallet and claim its creator fees.',
		scopes: ['wallet:launch'],
		policyGroups: ['launch'],
	},
]);

const GROUP_BY_ID = new Map(GRANT_GROUPS.map((g) => [g.id, g]));
const GROUP_BY_SCOPE = new Map();
for (const g of GRANT_GROUPS) for (const s of g.scopes) GROUP_BY_SCOPE.set(s, g.id);

function tokens(scope) {
	return Array.isArray(scope) ? scope.filter(Boolean) : String(scope || '').split(/\s+/).filter(Boolean);
}

/** Confirm flags the policy table requires, per policy group, across every server. */
function confirmFlagsByPolicyGroup() {
	const out = new Map();
	for (const table of Object.values(POLICY)) {
		for (const row of Object.values(table)) {
			if (!row || row.tier !== 'financial' || !row.confirmFlag) continue;
			if (!out.has(row.group)) out.set(row.group, new Set());
			out.get(row.group).add(row.confirmFlag);
		}
	}
	return out;
}

const FLAGS_BY_POLICY_GROUP = confirmFlagsByPolicyGroup();

/**
 * The actions in a grant group that still ask the person before they run,
 * as plain phrases in a stable order. Derived from the policy table.
 */
export function confirmationsFor(groupId) {
	const group = GROUP_BY_ID.get(groupId);
	if (!group) return [];
	const flags = new Set();
	for (const pg of group.policyGroups) for (const f of FLAGS_BY_POLICY_GROUP.get(pg) || []) flags.add(f);
	return Object.keys(CONFIRM_PHRASES).filter((f) => flags.has(f)).map((f) => CONFIRM_PHRASES[f]);
}

/**
 * The groups a consent screen shows for a scope string, in GRANT_GROUPS order.
 * A group appears when the scope string names any of its scopes, and the
 * trade and launch groups also appear when wallet:write is requested, because
 * that scope implies them and the person may want one without the other.
 * @returns {Array<{ id, label, required, blurb, scopes: string[], implied: boolean, confirms: string[] }>}
 */
export function groupsForScope(scope) {
	const requested = new Set(tokens(scope));
	const implied = new Set();
	for (const s of requested) for (const i of IMPLIED_SCOPES[s] || []) implied.add(i);
	return GRANT_GROUPS.flatMap((g) => {
		const direct = g.scopes.filter((s) => requested.has(s));
		const viaImplication = direct.length ? [] : g.scopes.filter((s) => implied.has(s));
		const scopes = direct.length ? direct : viaImplication;
		if (!scopes.length) return [];
		return [{
			id: g.id,
			label: g.label,
			required: Boolean(g.required),
			blurb: g.blurb,
			scopes,
			implied: !direct.length,
			confirms: confirmationsFor(g.id),
		}];
	});
}

/**
 * Fold the ticked groups back into the scope string the code will carry.
 * Read scopes and the connection scope are always kept; a scope belonging to
 * an unticked group is dropped; a scope that belongs to no group is kept as
 * requested. Ticking trade or launch under a wallet:write request grants the
 * narrower scope even when the client never asked for it by name, so the
 * person can approve trading without approving sending funds out.
 * @param {string|string[]} scope the scope the screen showed (already intersected with the client's)
 * @param {Iterable<string>} tickedGroupIds
 * @returns {string}
 */
export function grantedScopeFromGroups(scope, tickedGroupIds) {
	const requested = tokens(scope);
	const ticked = new Set(tickedGroupIds);
	for (const g of GRANT_GROUPS) if (g.required) ticked.add(g.id);
	const out = [];
	for (const s of requested) {
		const groupId = GROUP_BY_SCOPE.get(s);
		if (!groupId || CONNECTION_SCOPES.includes(s) || ticked.has(groupId)) out.push(s);
	}
	for (const shown of groupsForScope(requested)) {
		if (!shown.implied || !ticked.has(shown.id)) continue;
		// wallet:write was requested but its group was not ticked: grant the
		// implied scope on its own. When spend is ticked too wallet:write already
		// carries it, so nothing is added.
		if (!ticked.has('spend')) for (const s of shown.scopes) if (!out.includes(s)) out.push(s);
	}
	return [...new Set(out)].join(' ');
}

/** Which group id a fine scope belongs to, or null for a connection scope / unknown. */
export function groupOfScope(scope) {
	return GROUP_BY_SCOPE.get(scope) || null;
}

/** Every registerable scope is either in a group or a connection scope. */
export function unmappedRegisterableScopes() {
	return REGISTERABLE_SCOPES.filter((s) => !GROUP_BY_SCOPE.has(s) && !CONNECTION_SCOPES.includes(s));
}
