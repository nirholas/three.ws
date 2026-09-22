// Refuse web fetches that resolve to this machine or a private network unless
// the person turned that on. A page the agent reads is untrusted, and a link in
// it must not steer the agent into the router admin page or a local database.

import dns from 'node:dns/promises';
import net from 'node:net';

function v4Private(ip) {
	const [a, b] = ip.split('.').map(Number);
	return (
		a === 10 ||
		a === 127 ||
		a === 0 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) ||
		a >= 224
	);
}

export function isPrivateAddress(ip) {
	if (net.isIPv4(ip)) return v4Private(ip);
	if (net.isIPv6(ip)) {
		const lower = ip.toLowerCase();
		if (lower === '::1' || lower === '::') return true;
		const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped) return v4Private(mapped[1]);
		return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
	}
	return true;
}

/** Throws when `url` is not http(s) or resolves to a private address. */
export async function assertPublicUrl(url, { allowPrivate = false, lookup = dns.lookup } = {}) {
	let u;
	try {
		u = new URL(url);
	} catch {
		throw new Error(`not a valid URL: ${url}`);
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`only http and https URLs can be fetched, not ${u.protocol}`);
	if (allowPrivate) return u;
	const host = u.hostname.replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
		throw new Error(`${host} is on this machine or the local network. Set webFetch.allowPrivate to true in agent.json to allow it.`);
	}
	const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
	for (const { address } of addrs) {
		if (isPrivateAddress(address)) {
			throw new Error(`${host} resolves to a private address (${address}). Set webFetch.allowPrivate to true in agent.json to allow it.`);
		}
	}
	return u;
}
