// base64url and JSON Canonicalization (RFC 8785) for the MPP wire format.

export function b64urlEncode(input) {
	const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts input with or without padding, as the MPP spec requires. */
export function b64urlDecode(text) {
	return Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function b64urlDecodeJson(text) {
	return JSON.parse(b64urlDecode(text).toString('utf8'));
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, strings
 * and integers serialized the ECMAScript way. Non-finite numbers are rejected.
 */
export function canonicalJson(value) {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('canonical JSON cannot carry a non-finite number');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (typeof value === 'object') {
		const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
	}
	throw new Error(`canonical JSON cannot carry a ${typeof value}`);
}
