// The origin a handler uses to call this same deployment server-side, and to
// build links it hands back to callers.
//
// It is never taken from `x-forwarded-host`, and in production never from
// `host` either: both are whatever the client sent. A self-call that trusts
// them is an SSRF primitive (the server fetches `${host}/api/...` for any host
// the caller names) and, where the self-call carries an internal credential
// such as the forge seed header, a way to hand that credential to an attacker.
// Production always anchors on env.APP_ORIGIN, the same rule resolveResourceUrl
// (api/_lib/x402-spec.js) applies to payment URLs.
//
// Local development keeps working without configuration: a loopback Host header
// outside production is honored so `npm run dev` calls itself on its own port.

import { env } from './env.js';

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/**
 * @param {{ headers?: Record<string, string | string[] | undefined> }} [req]
 * @returns {string} absolute origin with no trailing slash
 */
export function selfOrigin(req) {
	if (!env.isProduction) {
		const host = String(req?.headers?.host || '').trim();
		if (LOOPBACK_HOST.test(host)) return `http://${host}`;
	}
	return env.APP_ORIGIN.replace(/\/$/, '');
}
