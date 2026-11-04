// Web Bot Auth: sign outbound agent HTTP requests so sites can tell a
// three.ws agent from an anonymous scraper.
//
// Implements the signing half of draft-meunier-web-bot-auth-architecture on
// RFC 9421 HTTP Message Signatures with Ed25519. A request carries
//   Signature-Agent: "https://three.ws"
//   Signature-Input: sig1=("@authority" "signature-agent");created=..;expires=..;
//                    keyid="<RFC 7638 thumbprint>";alg="ed25519";nonce="..";tag="web-bot-auth"
//   Signature:       sig1=:<base64>:
// and the verifier fetches the public key from the directory this module also
// builds (served at /.well-known/http-message-signatures-directory).
//
// The module is dependency-free (node:crypto only) so the agent-screen-pool
// worker can carry a byte-identical copy: tests/web-bot-auth.test.js fails when
// the two drift.
//
// The key comes from WEB_BOT_AUTH_PRIVATE_KEY: a PKCS8 PEM, or the base64 of a
// PKCS8 DER, or the base64 of a raw 32-byte Ed25519 seed. With no key set,
// signing is off and the directory 404s, so an unconfigured deploy never
// publishes a key it cannot sign with.

import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';

export const SIGNATURE_AGENT = 'https://three.ws';
export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
export const DIRECTORY_CONTENT_TYPE = 'application/http-message-signatures-directory+json';
export const DEFAULT_TTL_SECONDS = 300;

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Parse the configured private key into a KeyObject, or null when unset or unusable. */
export function loadPrivateKey(raw) {
	const text = String(raw || '').trim();
	if (!text) return null;
	try {
		if (text.includes('BEGIN')) return createPrivateKey(text);
		const bytes = Buffer.from(text, 'base64');
		if (bytes.length === 32) {
			return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, bytes]), format: 'der', type: 'pkcs8' });
		}
		return createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' });
	} catch {
		return null;
	}
}

/** Public JWK (kty OKP, crv Ed25519) with its RFC 7638 thumbprint as kid. */
export function publicJwk(privateKey) {
	const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
	if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') return null;
	return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: thumbprint(jwk) };
}

export function thumbprint(jwk) {
	const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
	return createHash('sha256').update(canonical).digest('base64url');
}

function paramsString(components, { created, expires, keyid, nonce, tag }) {
	const list = components.map((c) => `"${c}"`).join(' ');
	let out = `(${list});created=${created}`;
	if (expires) out += `;expires=${expires}`;
	out += `;keyid="${keyid}";alg="ed25519"`;
	if (nonce) out += `;nonce="${nonce}"`;
	if (tag) out += `;tag="${tag}"`;
	return out;
}

function authorityOf(url) {
	return new URL(url).host.toLowerCase();
}

/**
 * Signature headers for one outbound request.
 * @param {{ url: string, key: import('node:crypto').KeyObject, now?: number, ttlSeconds?: number, nonce?: string }} o
 * @returns {{ 'Signature-Agent': string, 'Signature-Input': string, Signature: string }}
 */
export function signRequest({ url, key, now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS, nonce }) {
	const jwk = publicJwk(key);
	if (!jwk) throw new Error('web-bot-auth: the private key is not an Ed25519 key');
	const created = Math.floor(now / 1000);
	const agent = `"${SIGNATURE_AGENT}"`;
	const params = paramsString(['@authority', 'signature-agent'], {
		created,
		expires: created + ttlSeconds,
		keyid: jwk.kid,
		nonce: nonce ?? randomBytes(24).toString('base64'),
		tag: 'web-bot-auth',
	});
	const base = `"@authority": ${authorityOf(url)}\n"signature-agent": ${agent}\n"@signature-params": ${params}`;
	const signature = sign(null, Buffer.from(base), key).toString('base64');
	return {
		'Signature-Agent': agent,
		'Signature-Input': `sig1=${params}`,
		Signature: `sig1=:${signature}:`,
	};
}

/** The JWKS body published at DIRECTORY_PATH. */
export function directoryBody(key) {
	const jwk = publicJwk(key);
	return jwk ? { keys: [jwk] } : null;
}

/**
 * Signature headers for the directory response itself, bound to the request's
 * authority, so a verifier can tell the directory was served by the key holder.
 */
export function signDirectoryResponse({ authority, key, now = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS }) {
	const jwk = publicJwk(key);
	const created = Math.floor(now / 1000);
	const params = paramsString(['@authority;req'], {
		created,
		expires: created + ttlSeconds,
		keyid: jwk.kid,
		tag: 'http-message-signatures-directory',
	});
	const base = `"@authority";req: ${String(authority).toLowerCase()}\n"@signature-params": ${params}`;
	const signature = sign(null, Buffer.from(base), key).toString('base64');
	return { 'Signature-Input': `sig1=${params}`, Signature: `sig1=:${signature}:` };
}

let envKey;
/** The deploy's signing key, read once from WEB_BOT_AUTH_PRIVATE_KEY. */
export function configuredKey(raw = process.env.WEB_BOT_AUTH_PRIVATE_KEY) {
	if (raw === process.env.WEB_BOT_AUTH_PRIVATE_KEY) {
		if (envKey === undefined) envKey = loadPrivateKey(raw);
		return envKey;
	}
	return loadPrivateKey(raw);
}

/**
 * Headers to add to an outbound request, or {} when signing is not configured
 * or the URL cannot be signed. Never throws: an unsigned fetch beats a failed one.
 */
export function botAuthHeaders(url, { key = configuredKey(), now } = {}) {
	if (!key) return {};
	try {
		return signRequest({ url, key, now });
	} catch {
		return {};
	}
}
