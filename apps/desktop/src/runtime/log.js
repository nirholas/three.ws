// Structured runtime log with secret redaction. Nothing that reaches a file, the
// console or a crash report may carry key material, so every value passes
// through redact() on the way out: known secret field names are masked, and
// anything shaped like a Solana secret key (a 64-byte array, an 87 or 88
// character base58 string) or a bearer token is replaced.

import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const SECRET_KEYS = /^(secret|secretkey|secret_key|privatekey|private_key|seed|mnemonic|password|token|access_token|refresh_token|authorization|bearer|keypair)$/i;
const BASE58_SECRET = /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/g;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
const MAX_BYTES = 2 * 1024 * 1024;

export function redact(value, depth = 0) {
	if (depth > 6) return '[deep]';
	if (typeof value === 'string') return value.replace(BASE58_SECRET, '[redacted-key]').replace(BEARER, '$1[redacted]');
	if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
	if (Array.isArray(value)) {
		if (value.length >= 32 && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return '[redacted-bytes]';
		return value.map((v) => redact(v, depth + 1));
	}
	if (value && typeof value === 'object') {
		if (ArrayBuffer.isView(value)) return '[redacted-bytes]';
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
		return out;
	}
	return value;
}

export function createLogger({ file = null, sink = null, now = Date.now } = {}) {
	function write(level, event, data) {
		const line = { t: new Date(now()).toISOString(), level, event, ...(data ? { data: redact(data) } : {}) };
		const text = JSON.stringify(line);
		if (sink) sink(line);
		if (!file) return;
		try {
			mkdirSync(dirname(file), { recursive: true });
			try {
				if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
			} catch {
				// first write: nothing to rotate
			}
			appendFileSync(file, `${text}\n`, { mode: 0o600 });
		} catch {
			// Logging must never take the runtime down.
		}
	}
	return {
		info: (event, data) => write('info', event, data),
		warn: (event, data) => write('warn', event, data),
		error: (event, data) => write('error', event, data),
	};
}
