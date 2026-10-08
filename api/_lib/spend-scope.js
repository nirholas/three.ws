// The bearer-scope gate for routes that move money.
//
// A cookie session is the account holder, present, and carries every scope. A
// bearer principal (API key or OAuth access token) holds only what it was
// granted. The MCP tools behind withdraw, trade, pay, hire and launch already
// demanded `wallet:write`, but their REST routes accepted ANY bearer, so an
// `inference`-only key or an OAuth client the user approved for "Read your
// avatars" could withdraw an agent wallet to its own address.
//
// Kept free of imports on purpose: route tests mock api/_lib/auth.js wholesale,
// and a gate that lived only there would vanish under those mocks.

// The scope a bearer principal must hold to move, commit, or redirect funds.
export const SPEND_SCOPE = 'wallet:write';

// Where a person goes to do in a browser what a key was refused.
export const SPEND_BROWSER_URL = 'https://three.ws/dashboard';
export const SCOPES_DOCS_URL = 'https://three.ws/docs/mcp#api-key-scopes';

// Connector keys: the API key preset for an AI agent that holds the key
// unattended (Grok Bot as a Bot secret, a schedule, CI). It reads, generates,
// and edits agent data, and can never spend. The marker token rides in the
// key's stored scope string, and capConnectorScope() is applied every time
// the key authenticates, so the cap holds even if the stored string is ever
// edited to name a spend scope: there is no path from a connector key to
// wallet:write short of minting a different key in a browser.
export const CONNECTOR_MARKER = 'connector';
export const CONNECTOR_KEY_SCOPES = Object.freeze([
	'avatars:read',
	'avatars:write',
	'agents:read',
	'agents:write',
	'memory:read',
	'memory:write',
]);
const CONNECTOR_ALLOWED = new Set(CONNECTOR_KEY_SCOPES);

function tokens(scope) {
	return String(scope || '').split(/\s+/).filter(Boolean);
}

function grants(scope, required) {
	return tokens(scope).includes(required);
}

/** True when a stored or effective scope string belongs to a connector key. */
export function isConnectorScope(scope) {
	return grants(scope, CONNECTOR_MARKER);
}

/**
 * The effective scope of a stored API key scope string. A standard key keeps
 * exactly what it was granted. A connector key keeps only the connector set
 * (plus its marker), whatever the stored string says.
 */
export function capConnectorScope(scope) {
	const list = tokens(scope);
	if (!list.includes(CONNECTOR_MARKER)) return String(scope || '');
	return [...new Set(list.filter((s) => CONNECTOR_ALLOWED.has(s))), CONNECTOR_MARKER].join(' ');
}

/**
 * The sentence a refused bearer reads: what it cannot do, why, and where a
 * person does it instead. Shared by the HTTP routes and every MCP server.
 */
export function spendRefusalMessage(scope, { action = 'This action', required = SPEND_SCOPE } = {}) {
	if (isConnectorScope(scope)) {
		return `${action} moves or routes funds, so it needs a browser session on three.ws. Connector keys read, generate and edit agent data and can never spend. Sign in at ${SPEND_BROWSER_URL} to do it yourself.`;
	}
	return `${action} moves or routes funds and this credential lacks the ${required} scope. Do it from a browser session at ${SPEND_BROWSER_URL}, or use a key or app grant that carries ${required}.`;
}

// Gate for a route that spends from a custodial wallet (withdraw, trade, pay,
// hire, launch, arm an autonomous spender) or changes where its money goes.
// Pass the bearer only; a session never reaches here. Safe methods pass so a
// `wallet:read` key still reads balances and history. Returns the bearer, or
// throws a 403 `insufficient_scope` that wrap() renders as-is.
export function assertBearerMaySpend(bearer, req) {
	if (!bearer) return bearer;
	const verb = String(req?.method || 'POST').toUpperCase();
	if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return bearer;
	if (grants(bearer.scope, SPEND_SCOPE)) return bearer;
	throw Object.assign(
		new Error(spendRefusalMessage(bearer.scope)),
		{ status: 403, code: 'insufficient_scope', expose: true },
	);
}
