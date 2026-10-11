// The bearer-scope gate for routes that move money.
//
// A cookie session is the account holder, present, and carries every scope. A
// bearer principal (API key or OAuth access token) holds only what it was
// granted. The MCP tools behind withdraw, trade, pay, hire and launch already
// demanded `wallet:write`, but their REST routes accepted ANY bearer, so an
// `inference`-only key or an OAuth client the user approved for "Read your
// avatars" could withdraw an agent wallet to its own address.
//
// Three kinds of value movement, each with its own scope, so an OAuth client
// approved on the consent screen for trading alone cannot send funds out:
//
//   spend    wallet:write    send, pay, withdraw, fund a card: value leaves the wallet
//   trade    wallet:trade    swap, bid, open or close a position: value stays in the wallet
//   launch   wallet:launch   launch a coin, claim its creator fees
//
// wallet:write implies the other two (key-scopes.js IMPLIED_SCOPES), so every
// token issued before the narrower scopes existed keeps working unchanged.
//
// Imports only key-scopes.js (itself import-free) on purpose: route tests mock
// api/_lib/auth.js wholesale, and a gate that lived only there would vanish
// under those mocks.

import { withImpliedScopes } from './key-scopes.js';

// The scope a bearer principal must hold to move, commit, or redirect funds.
export const SPEND_SCOPE = 'wallet:write';
export const TRADE_SCOPE = 'wallet:trade';
export const LAUNCH_SCOPE = 'wallet:launch';

export const SPEND_KINDS = Object.freeze({
	spend: SPEND_SCOPE,
	trade: TRADE_SCOPE,
	launch: LAUNCH_SCOPE,
});

function grants(scope, required) {
	return withImpliedScopes(scope).includes(required);
}

// Gate for a route that spends from a custodial wallet (withdraw, trade, pay,
// hire, launch, arm an autonomous spender) or changes where its money goes.
// Pass the bearer only; a session never reaches here. Safe methods pass so a
// `wallet:read` key still reads balances and history. `kind` names which grade
// of movement the route performs (default 'spend', the strictest). Returns the
// bearer, or throws a 403 `insufficient_scope` that wrap() renders as-is.
export function assertBearerMaySpend(bearer, req, { kind = 'spend' } = {}) {
	if (!bearer) return bearer;
	const verb = String(req?.method || 'POST').toUpperCase();
	if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return bearer;
	const required = SPEND_KINDS[kind] || SPEND_SCOPE;
	if (grants(bearer.scope, required)) return bearer;
	const what = kind === 'trade' ? 'trade' : kind === 'launch' ? 'launch a coin' : 'move funds';
	throw Object.assign(
		new Error(`this credential lacks the ${required} scope required to ${what}`),
		{ status: 403, code: 'insufficient_scope', expose: true },
	);
}
