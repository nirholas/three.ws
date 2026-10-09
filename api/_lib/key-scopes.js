// Coarse API key scopes and the connector preset.
//
// A key for an unattended agent (Grok Bot, a schedule, CI) must be able to read,
// generate and edit agent data and must never move funds. Three coarse scopes
// express that on top of the fine-grained set in api-keys.js:
//
//   read          read avatars, memory, agents and wallet balances
//   generate      create 3D models and avatars
//   agents:write  create and edit agents and their memory (a fine scope too)
//   spend         move funds: pay x402, trade, launch, withdraw, publish paid services
//
// The coarse scopes expand into the fine scopes every existing route already
// checks, at authentication time, so no route needed to learn a new name. A key
// minted with the "connector" preset is additionally stripped of every
// spend-capable scope no matter what its scope string says, so the guarantee
// lives in the credential's kind and survives any later edit of its scopes.
//
// Kept free of imports: route tests mock api/_lib/auth.js wholesale.

export const CONNECTOR_PRESET = 'connector';

// What a connector key is issued. Fixed: the dashboard and the API both mint it
// from this list and refuse any caller-supplied scope outside it.
export const CONNECTOR_SCOPES = Object.freeze(['read', 'generate', 'agents:write']);

// Fine scopes that let a credential move value (REST gate: wallet:write, see
// spend-scope.js; services:write publishes paid endpoints earning to a wallet).
export const SPEND_GRANTS = Object.freeze(['spend', 'wallet:write', 'services:write']);

const EXPANSION = Object.freeze({
	read: ['avatars:read', 'memory:read', 'agents:read', 'wallet:read'],
	generate: ['avatars:write'],
	'agents:write': ['agents:write', 'memory:write'],
	spend: ['wallet:write', 'services:write'],
});

function tokens(scope) {
	return String(scope || '').split(/\s+/).filter(Boolean);
}

/** A scope string with every coarse scope expanded into the fine scopes it implies. */
export function expandKeyScopes(scope) {
	const out = new Set();
	for (const t of tokens(scope)) {
		out.add(t);
		for (const fine of EXPANSION[t] || []) out.add(fine);
	}
	return [...out];
}

/**
 * The scope string a key authenticates with. A connector key loses every
 * spend-capable scope, whatever its stored scope string says.
 * @param {{ scope?: string, preset?: string|null }} row
 * @returns {{ scope: string, connector: boolean }}
 */
export function effectiveKeyScope(row) {
	const connector = row?.preset === CONNECTOR_PRESET;
	let scopes = expandKeyScopes(row?.scope);
	if (connector) scopes = scopes.filter((s) => !SPEND_GRANTS.includes(s));
	return { scope: scopes.join(' '), connector };
}

/** True when a scope list names anything a connector key may never hold. */
export function connectorViolations(scopes) {
	return scopes.filter((s) => !CONNECTOR_SCOPES.includes(s));
}

// Where a refused connector is sent. The wording is read by a model, so it names
// the exact remedy.
export const BROWSER_SESSION_URL = 'https://three.ws/dashboard';

export function connectorSpendMessage(tool) {
	return (
		`${tool} moves funds and needs a browser session on three.ws. ` +
		`This key was issued for an AI agent and can never spend. ` +
		`Ask the account owner to do it at ${BROWSER_SESSION_URL}.`
	);
}
