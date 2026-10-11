// IP allowlists for API keys: parse a list of addresses and CIDR ranges and
// decide whether a caller's address is inside one of them.
//
// Both IPv4 and IPv6 are handled by widening every address to a 128-bit
// integer (IPv4 as an IPv4-mapped IPv6 address), so one comparison covers
// both families and an IPv4 rule matches the same caller whether the proxy
// reports "1.2.3.4" or "::ffff:1.2.3.4". No third-party parser: node's
// net.isIP settles syntax and the widening is twenty lines.

import { isIP } from 'node:net';

const MAX_RULES = 64;
const V4_MAPPED_PREFIX = 0xffffn << 32n;

function v4ToBigInt(ip) {
	return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

function v6ToBigInt(ip) {
	// Strip a zone id ("%eth0") and expand "::".
	const bare = ip.split('%')[0];
	let head = bare;
	let tail = '';
	if (bare.includes('::')) [head, tail] = bare.split('::');
	const headParts = head ? head.split(':') : [];
	const tailParts = tail ? tail.split(':') : [];
	// An embedded IPv4 tail ("::ffff:1.2.3.4") occupies two groups.
	const expand = (parts) => parts.flatMap((p) => {
		if (p.includes('.')) {
			const n = v4ToBigInt(p);
			return [((n >> 16n) & 0xffffn).toString(16), (n & 0xffffn).toString(16)];
		}
		return [p];
	});
	const h = expand(headParts);
	const t = expand(tailParts);
	const missing = 8 - h.length - t.length;
	const groups = [...h, ...Array(Math.max(0, missing)).fill('0'), ...t];
	return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g || '0', 16)), 0n);
}

/** Widen any textual IP to a 128-bit integer, or null when it is not an IP. */
export function ipToBigInt(ip) {
	const v = isIP(String(ip || ''));
	if (v === 4) return V4_MAPPED_PREFIX | v4ToBigInt(ip);
	if (v === 6) return v6ToBigInt(ip);
	return null;
}

/**
 * Parse one rule ("1.2.3.4", "10.0.0.0/8", "2001:db8::/32").
 * @returns {{ rule: string, base: bigint, mask: bigint } | null}
 */
export function parseIpRule(rule) {
	const text = String(rule || '').trim();
	if (!text) return null;
	const [addr, prefixText] = text.split('/');
	const family = isIP(addr);
	if (!family) return null;
	const width = family === 4 ? 32 : 128;
	const prefix = prefixText == null ? width : Number(prefixText);
	if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) return null;
	// For IPv4 the mask sits in the low 32 bits of the mapped address.
	const bits = family === 4 ? prefix + 96 : prefix;
	const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
	const base = ipToBigInt(addr) & mask;
	return { rule: text, base, mask };
}

/**
 * Validate a user-supplied allowlist. Returns { rules, invalid } where rules
 * are the normalized strings to store and invalid names every rejected entry.
 */
export function normalizeIpAllowlist(list) {
	const rules = [];
	const invalid = [];
	const seen = new Set();
	for (const raw of Array.isArray(list) ? list : []) {
		const parsed = parseIpRule(raw);
		if (!parsed) {
			invalid.push(String(raw));
			continue;
		}
		if (seen.has(parsed.rule)) continue;
		seen.add(parsed.rule);
		rules.push(parsed.rule);
	}
	if (rules.length > MAX_RULES) invalid.push(`more than ${MAX_RULES} rules`);
	return { rules, invalid };
}

/** True when `ip` is inside at least one rule. An empty list allows everyone. */
export function ipAllowed(ip, rules) {
	if (!Array.isArray(rules) || rules.length === 0) return true;
	const n = ipToBigInt(ip);
	if (n == null) return false;
	for (const raw of rules) {
		const r = parseIpRule(raw);
		if (r && (n & r.mask) === r.base) return true;
	}
	return false;
}

export const IP_ALLOWLIST_MAX_RULES = MAX_RULES;
