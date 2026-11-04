// Free-auth alternatives per paid route, declared once.
//
// A route listed here accepts a Bearer access token carrying the declared OAuth
// scope, or a fresh CAIP-122 SIGN-IN-WITH-X proof, instead of an x402 payment.
// The paid-endpoint helper reads this to enable the bypass, and the discovery
// surfaces (GET /openapi.json as `x-auth-methods`, /.well-known/x402.json as
// `authMethods`) read it to advertise the free path WITHOUT adding amount-0
// entries to the 402 challenge, which external x402 directory validators
// reject. Set X402_AUTH_HINT_ACCEPTS=true only to also emit the legacy
// zero-amount accepts[] entries and the auth-hints extension.

const READ_REPUTATION_AUTH = Object.freeze({
	oauth2: Object.freeze({ requiredScope: 'read:agent-reputation', tokenType: 'Bearer' }),
	siwx: true,
});

export const ROUTE_AUTH_HINTS = Object.freeze({
	'/api/x402/agent-reputation': READ_REPUTATION_AUTH,
	'/api/x402/agent-bouncer': READ_REPUTATION_AUTH,
});

// The machine-readable list of auth methods a route accepts in place of
// payment, or null when the route has none.
export function authMethodsFor(path) {
	const hints = ROUTE_AUTH_HINTS[path];
	if (!hints) return null;
	const methods = [];
	if (hints.oauth2) {
		methods.push({
			type: 'oauth2',
			scheme: 'bearer',
			header: 'Authorization',
			scope: hints.oauth2.requiredScope,
			description:
				'Send a three.ws OAuth access token as "Authorization: Bearer <token>". The call is served with no payment.',
		});
	}
	if (hints.siwx) {
		methods.push({
			type: 'sign-in-with-x',
			header: 'SIGN-IN-WITH-X',
			description:
				'Send a base64 CAIP-122 Sign-In-With-X proof for this resource. The call is served with no payment.',
		});
	}
	return methods;
}
