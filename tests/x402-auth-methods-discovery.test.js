// The free auth path (Bearer scope or SIWX) is advertised in discovery docs
// instead of as amount-0 accepts[] entries in the 402 challenge.

import { describe, expect, it } from 'vitest';

import { buildOpenApiDoc } from '../api/openapi-json.js';
import { buildX402DiscoveryDoc } from '../api/wk.js';
import { authMethodsFor } from '../api/_lib/x402/route-auth-hints.js';

const ROUTES = ['/api/x402/agent-reputation', '/api/x402/agent-bouncer'];

describe('auth methods discovery', () => {
	it('lists oauth2 and sign-in-with-x on both routes in /openapi.json', () => {
		const doc = buildOpenApiDoc('https://three.ws');
		for (const route of ROUTES) {
			const op = doc.paths[route].get;
			expect(op, route).toBeDefined();
			expect(op['x-auth-methods'].map((m) => m.type)).toEqual(['oauth2', 'sign-in-with-x']);
			expect(op['x-auth-methods'][0].scope).toBe('read:agent-reputation');
			expect(op.security).toEqual([]);
		}
	});

	it('lists the same methods on both routes in /.well-known/x402.json', async () => {
		const doc = await buildX402DiscoveryDoc();
		for (const route of ROUTES) {
			const resource = doc.resources.find((r) => r.path === route);
			expect(resource, route).toBeDefined();
			expect(resource.authMethods).toEqual(authMethodsFor(route));
			expect(resource.accepts.every((a) => String(a.amount) !== '0')).toBe(true);
		}
	});

	it('does not tag routes without a free auth path', async () => {
		const doc = await buildX402DiscoveryDoc();
		const other = doc.resources.find((r) => r.path && !ROUTES.includes(r.path));
		expect(other.authMethods).toBeUndefined();
		expect(authMethodsFor('/api/x402/three-intel')).toBeNull();
	});
});
