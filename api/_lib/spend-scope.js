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

function grants(scope, required) {
	return String(scope || '').split(/\s+/).filter(Boolean).includes(required);
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
		new Error(`this credential lacks the ${SPEND_SCOPE} scope required to move funds`),
		{ status: 403, code: 'insufficient_scope', expose: true },
	);
}
