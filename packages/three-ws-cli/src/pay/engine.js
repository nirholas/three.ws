// The pay flow shared by the CLI and the MCP server: fetch, read the 402
// challenge, decide under the permissions file, optionally confirm, sign with the
// locally held key, retry once, record the spend. Redirects are never followed:
// a signed payment must only ever reach the origin the permissions approved.

import { readChallenge } from './challenge.js';
import { decide } from './decision.js';
import { EXIT, PayError, REASON } from './errors.js';
import { readMppReceipt, signMpp } from './mpp.js';
import { describeOffer, loadPermissions, recordSpend, spentToday } from './permissions.js';
import { readX402Receipt, rpcUrlFor, signX402 } from './x402.js';

const TIMEOUT_MS = 30_000;

function requestInit({ method, headers, body }) {
	return { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) };
}

function assertHttpUrl(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new PayError(EXIT.USAGE, 'invalid_url', `"${url}" is not a URL.`);
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new PayError(EXIT.USAGE, 'invalid_url', `Only http(s) URLs can be paid, got ${parsed.protocol}`);
	}
	return parsed;
}

async function readBody(response) {
	return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? '' };
}

/**
 * Fetch `url` and, when it answers 402, work out what paying would mean.
 * Returns { free: true, response } for a non-402 answer, else the decision.
 * Nothing is signed here.
 */
export async function quote({ url, env, request = {}, maxFlag, networkFlag, fetchImpl = fetch, now = Date.now() }) {
	const parsed = assertHttpUrl(url);
	const response = await fetchImpl(url, requestInit(request));
	if (response.status !== 402) return { free: true, response };
	const { offers, bodyText } = await readChallenge(response, { now });
	const perms = loadPermissions(env);
	const decision = decide({
		offers,
		perms,
		origin: parsed.origin,
		maxFlag,
		networkFlag,
		spent: (offer) => spentToday(env, offer, now),
	});
	return { free: false, url, origin: parsed.origin, decision, offers: offers.map(describeOffer), challengeBody: bodyText };
}

/**
 * Pay for `url`. `confirm(summary)` resolves true to approve a payment above the
 * confirmAbove threshold; without it such a payment is refused (exit 11).
 */
export async function pay({ url, env, request = {}, maxFlag, networkFlag, assumeYes = false, confirm, keystore, fetchImpl = fetch, now = Date.now() }) {
	const q = await quote({ url, env, request, maxFlag, networkFlag, fetchImpl, now });
	if (q.free) {
		const body = await readBody(q.response);
		return { paid: false, status: q.response.status, headers: Object.fromEntries(q.response.headers), ...body };
	}
	const { offer, confirm: needsConfirm } = q.decision;
	const summary = describeOffer(offer);

	if (needsConfirm && !assumeYes) {
		if (!confirm) {
			throw new PayError(EXIT.CONFIRMATION_REQUIRED, REASON.confirmRequired, `${summary.amount} is above confirmAbove and there is nobody to approve it. Re-run in a terminal, or pass --yes.`, { offer: summary });
		}
		if (!(await confirm({ url, ...summary }))) {
			throw new PayError(EXIT.PERMISSION_DENIED, REASON.declined, 'Payment declined.', { offer: summary });
		}
	}

	const signer = await keystore.signer();
	const rpcUrl = rpcUrlFor(offer.network, env);
	const base = requestInit(request);
	let retry;
	let readReceipt;
	if (offer.protocol === 'x402') {
		const { headers, httpClient } = await signX402({ offer, signer, rpcUrl });
		retry = { ...base, headers: { ...base.headers, ...headers } };
		readReceipt = (response) => readX402Receipt(httpClient, response);
	} else {
		const { authorization } = await signMpp({ offer, signer, rpcUrl });
		retry = { ...base, headers: { ...base.headers, authorization } };
		readReceipt = readMppReceipt;
	}

	const paid = await fetchImpl(url, retry);
	if (paid.status === 402) {
		const detail = (await paid.text()).slice(0, 500);
		throw new PayError(EXIT.PAYMENT_REJECTED, REASON.paymentRejected, 'The server still answered 402 after the payment was sent. Nothing was recorded against your daily limit.', { offer: summary, response: detail });
	}
	const receipt = readReceipt(paid);
	if (paid.ok || receipt) recordSpend(env, offer, now);
	const body = await readBody(paid);
	return { paid: true, status: paid.status, offer: summary, protocol: offer.protocol, payer: signer.address, receipt, headers: Object.fromEntries(paid.headers), ...body };
}
