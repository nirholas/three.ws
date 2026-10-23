// Reads a payment challenge off a 402 response into a flat list of offers, one
// per way the server is willing to be paid. Two wire formats are understood:
//   x402 v2  PAYMENT-REQUIRED header, base64 JSON { x402Version: 2, accepts: [...] }
//   x402 v1  JSON body        { x402Version: 1, accepts: [...] } (network "solana")
//   MPP      WWW-Authenticate: Payment id=..., method="solana", intent="charge", request=<base64url JCS>
// Parsing never throws on a foreign challenge; it just yields no offers for it.

import { b64urlDecodeJson } from './encoding.js';
import { isSolanaNetwork, normalizeNetwork } from './permissions.js';

function parseBase64Json(text) {
	try {
		return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

function toBigInt(value) {
	try {
		const n = BigInt(value);
		return n >= 0n ? n : null;
	} catch {
		return null;
	}
}

function x402Offers(required, version) {
	if (!required || !Array.isArray(required.accepts)) return [];
	const offers = [];
	for (const accept of required.accepts) {
		if (!accept || typeof accept !== 'object') continue;
		const amountAtomic = toBigInt(accept.amount ?? accept.maxAmountRequired);
		if (amountAtomic === null || typeof accept.payTo !== 'string' || typeof accept.asset !== 'string') continue;
		const decimals = Number.isInteger(accept.extra?.decimals) ? accept.extra.decimals : undefined;
		offers.push({
			protocol: 'x402',
			version,
			scheme: accept.scheme,
			network: normalizeNetwork(accept.network),
			asset: accept.asset,
			payTo: accept.payTo,
			amountAtomic,
			decimals,
			unsupported: accept.scheme === 'exact' ? undefined : `x402 scheme "${accept.scheme}" is not supported (only "exact")`,
			raw: accept,
			required,
		});
	}
	return offers;
}

/** Split a WWW-Authenticate value into challenges: [{ scheme, params }]. Handles quoted strings and multiple challenges. */
export function parseAuthenticate(header) {
	const challenges = [];
	let current = null;
	let i = 0;
	const s = String(header ?? '');
	const skip = () => {
		while (i < s.length && /[\s,]/.test(s[i])) i++;
	};
	while (i < s.length) {
		skip();
		const start = i;
		while (i < s.length && !/[\s=,]/.test(s[i])) i++;
		const token = s.slice(start, i);
		if (!token) break;
		let j = i;
		while (j < s.length && s[j] === ' ') j++;
		if (s[j] === '=') {
			i = j + 1;
			let value;
			if (s[i] === '"') {
				i++;
				let out = '';
				while (i < s.length && s[i] !== '"') {
					if (s[i] === '\\' && i + 1 < s.length) i++;
					out += s[i++];
				}
				i++;
				value = out;
			} else {
				const vStart = i;
				while (i < s.length && s[i] !== ',' && !/\s/.test(s[i])) i++;
				value = s.slice(vStart, i);
			}
			if (current) current.params[token.toLowerCase()] = value;
		} else {
			current = { scheme: token, params: {} };
			challenges.push(current);
		}
	}
	return challenges;
}

function mppOffers(authenticate, now) {
	const offers = [];
	for (const ch of parseAuthenticate(authenticate)) {
		if (ch.scheme.toLowerCase() !== 'payment') continue;
		const p = ch.params;
		if (p.method !== 'solana' || p.intent !== 'charge' || !p.request || !p.id) continue;
		let request;
		try {
			request = b64urlDecodeJson(p.request);
		} catch {
			continue;
		}
		const amountAtomic = toBigInt(request.amount);
		if (amountAtomic === null || typeof request.recipient !== 'string' || typeof request.currency !== 'string') continue;
		const details = request.methodDetails ?? {};
		const network = normalizeNetwork(details.network ?? 'mainnet');
		let unsupported;
		if (request.currency === 'sol') unsupported = 'native SOL charges are not supported (SPL tokens only)';
		else if (details.confidential) unsupported = 'confidential transfers are not supported';
		else if (Array.isArray(details.splits) && details.splits.length > 0) unsupported = 'payment splits are not supported';
		else if (!Number.isInteger(details.decimals)) unsupported = 'the challenge does not state the token decimals';
		else if (details.feePayer && typeof details.feePayerKey !== 'string') unsupported = 'feePayer is set without feePayerKey';
		if (p.expires && Date.parse(p.expires) <= now) unsupported = unsupported ?? 'challenge_expired';
		offers.push({
			protocol: 'mpp',
			version: 1,
			network,
			asset: request.currency,
			payTo: request.recipient,
			amountAtomic,
			decimals: Number.isInteger(details.decimals) ? details.decimals : undefined,
			unsupported,
			expired: Boolean(p.expires && Date.parse(p.expires) <= now),
			challenge: { id: p.id, realm: p.realm, method: p.method, intent: p.intent, request: p.request, ...(p.expires ? { expires: p.expires } : {}) },
			request,
		});
	}
	return offers;
}

/**
 * @param {Response} response a 402 response (body not yet consumed)
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ offers: object[], bodyText: string }>}
 */
export async function readChallenge(response, { now = Date.now() } = {}) {
	const bodyText = await response.text();
	const offers = [];
	const header = response.headers.get('payment-required');
	if (header) {
		offers.push(...x402Offers(parseBase64Json(header), 2));
	} else {
		let body = null;
		try {
			body = JSON.parse(bodyText);
		} catch {
			// not a JSON body, so there is no x402 v1 challenge in it
		}
		if (body && Array.isArray(body.accepts)) offers.push(...x402Offers(body, body.x402Version ?? 1));
	}
	const authenticate = response.headers.get('www-authenticate');
	if (authenticate) offers.push(...mppOffers(authenticate, now));
	return { offers, bodyText };
}

export { isSolanaNetwork };
