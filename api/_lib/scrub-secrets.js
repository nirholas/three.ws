// api/_lib/scrub-secrets.js
//
// Defense-in-depth for structured logs: recursively strip secret-bearing keys
// from any object before it is persisted. Every money-moving log path
// (circulation actions, custody events, ring reconciliation) writes a freeform
// `detail` blob; call sites are curated today, but a future field rename or a
// spread of a wallet/keypair object would otherwise silently write a private key
// into the database. This makes that structurally impossible.
//
// Pure, dependency-free, and cheap — safe to run on every write.

// Key names whose VALUE must never be logged, matched case-insensitively as a
// substring so `solanaSecretKey`, `encrypted_solana_secret`, `mnemonicPhrase`,
// etc. are all caught. Matching on the key (not the value) avoids false positives
// on legitimate data that merely looks random (mints, signatures, addresses).
const SECRET_KEY_PATTERNS = [
	'secret', 'privatekey', 'private_key', 'keypair', 'mnemonic', 'seed',
	'password', 'passphrase', 'apikey', 'api_key', 'token', 'bearer',
	'authorization', 'signingkey', 'signing_key',
];

const REDACTED = '[redacted]';

function isSecretKey(key) {
	const k = String(key).toLowerCase();
	return SECRET_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Return a deep copy of `value` with every secret-bearing key redacted at any
 * nesting depth. Arrays are walked element-wise. Non-plain values (strings,
 * numbers, BigInt, null) pass through untouched. Circular references are handled
 * so a live object (e.g. a Keypair with back-references) can be scrubbed safely.
 *
 * @param {*} value
 * @param {WeakSet} [seen] internal cycle guard
 * @returns {*}
 */
export function scrubSecrets(value, seen = new WeakSet()) {
	if (value == null || typeof value !== 'object') return value;
	if (seen.has(value)) return undefined; // drop cycles rather than throw
	seen.add(value);

	if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, seen));

	const out = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = isSecretKey(k) ? REDACTED : scrubSecrets(v, seen);
	}
	return out;
}

// Credentials carried in a URL, which scrubSecrets cannot reach: it redacts by
// KEY name on an object, and a message like
// `FetchError: request to https://rpc.example/?api-key=SECRET failed` is a plain
// string with no key to match. Solana web3.js embeds the full RPC URL in its
// network errors, so any path that logs a raw `err.message` from an on-chain
// call would otherwise spill HELIUS_API_KEY into the log sink.
//
// Two shapes carry a secret, and both occur here:
//   1. a query parameter  https://rpc.host/?api-key=SECRET
//   2. userinfo           postgres://user:PASSWORD@host/db
// The second matters just as much: a Neon/Postgres connection failure puts the
// whole DATABASE_URL, password included, into its error message.
const URL_QUERY_CREDENTIAL_RE = /([?&](?:api[-_]?key|access[-_]?token|token|secret|key|auth)=)[^&\s"'`]+/gi;
// `//user:` then anything up to the `@`. The username is kept (it is useful for
// debugging and is not the secret); only the password is masked.
const URL_USERINFO_RE = /(\/\/[^/@\s:]+:)[^/@\s]+@/g;
// Provider tokens are sometimes pasted into a user-supplied message rather
// than carried under a secret-shaped object key. Keep this list narrow to
// self-identifying formats so ordinary hashes and transaction ids survive.
const INLINE_PROVIDER_CREDENTIAL_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|cf(?:at|ut)_[A-Za-z0-9_-]{32,}|npm_[A-Za-z0-9]{36})\b/g;
// R2 S3 credentials do not have a unique prefix. Only redact their hex value
// when a credential label makes the meaning unambiguous.
const INLINE_R2_CREDENTIAL_RE = /((?:S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY|access\s+key\s+id|secret\s+access\s+key)\s*[:=]\s*)[a-f0-9]{32,64}\b/gi;

/**
 * Mask credential VALUES embedded in a URL inside a free-form string (typically
 * an error message) while keeping the rest of the text intact for debugging.
 * Covers both a known credential query parameter and a `user:password@` userinfo
 * segment; everything else is left readable.
 *
 * Use this on any string bound for a log sink; use `scrubSecrets` for objects.
 *
 * @param {*} text
 * @returns {string}
 */
export function redactUrlSecrets(text) {
	return String(text ?? '')
		.replace(URL_QUERY_CREDENTIAL_RE, '$1REDACTED')
		.replace(URL_USERINFO_RE, '$1REDACTED@')
		.replace(INLINE_PROVIDER_CREDENTIAL_RE, 'REDACTED')
		.replace(INLINE_R2_CREDENTIAL_RE, '$1REDACTED');
}
