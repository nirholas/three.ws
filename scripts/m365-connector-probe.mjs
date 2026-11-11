#!/usr/bin/env node
// Live probe for the Microsoft 365 Copilot connector's Graph client.
//
// Calls the real https://graph.microsoft.com/v1.0/external/connections through
// the same graphRequest() the sync uses, and prints exactly what Microsoft
// answered. Without a tenant token (the default) Graph answers its documented
// 401 InvalidAuthenticationToken, which proves the request shape, the endpoint
// and the error parsing end to end. With M365_PROBE_TENANT set and the Entra
// app configured (MS_ENTRA_SSO_CLIENT_ID / MS_ENTRA_SSO_CLIENT_SECRET), it
// fetches an app-only token for that tenant and lists the connections the app
// owns there instead.
//
//   node scripts/m365-connector-probe.mjs
//   M365_PROBE_TENANT=<tenant guid> node scripts/m365-connector-probe.mjs

import { GRAPH_BASE, GraphError, graphRequest, tenantToken, explainFailure } from '../api/_lib/m365-connector.js';

const tenant = process.env.M365_PROBE_TENANT || null;
const url = `${GRAPH_BASE}/external/connections`;

let token = '';
if (tenant) {
	token = await tenantToken(tenant);
	console.log(`token: app-only token issued for tenant ${tenant}`);
}

try {
	const res = await graphRequest({ token, url, maxAttempts: 2 });
	const body = await res.json();
	console.log(JSON.stringify({ request: `GET ${url}`, status: res.status, connections: (body.value || []).map((c) => ({ id: c.id, name: c.name, state: c.state })) }, null, 2));
} catch (err) {
	if (!(err instanceof GraphError)) throw err;
	console.log(JSON.stringify({ request: `GET ${url}`, status: err.status, graphErrorCode: err.code, graphMessage: err.message, explained: explainFailure(err) }, null, 2));
	process.exitCode = err.status === 401 || err.status === 403 ? 0 : 1;
}
