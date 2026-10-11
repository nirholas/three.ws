// The network fence for a browser that goes wherever links lead.
//
// guardHost(): every request the crawler's pages make is resolved first and
// refused when ANY address it resolves to is private, loopback, link-local or
// reserved. That is what keeps a hostile page (or a mission seed pointing at an
// internal name) from turning the crawler into a probe of the network it runs in.
// Dependency-free so tests/agent-crawler-guard.test.js can pin it.

import dns from 'node:dns/promises';
import net from 'node:net';

export const BOT_TOKEN = 'three.ws-crawler';
export const USER_AGENT =
	`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 ${BOT_TOKEN}/1.0 (+https://three.ws/crawl)`;

const blocked = new net.BlockList();
for (const [addr, prefix] of [
	['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
	['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
	['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
	['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(addr, prefix, 'ipv6');
// No ::ffff:0:0/96 rule on purpose: BlockList already checks an IPv4-mapped
// address against the IPv4 rules above, and a mapped-range rule would match
// EVERY plain IPv4 address, refusing the whole public web.

export function isBlockedAddress(ip) {
	const family = net.isIP(ip);
	if (!family) return true;
	return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const INTERNAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$|^metadata(\.google\.internal)?$/i;
const hostCache = new Map(); // host -> { ok, at }
const HOST_TTL_MS = 10 * 60_000;

export async function guardHost(hostname) {
	const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
	if (!host || INTERNAL_NAME.test(host)) return false;
	if (net.isIP(host)) return !isBlockedAddress(host);
	const hit = hostCache.get(host);
	if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit.ok;
	let ok = false;
	try {
		const addrs = await dns.lookup(host, { all: true, verbatim: true });
		ok = addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address));
	} catch {
		ok = false;
	}
	hostCache.set(host, { ok, at: Date.now() });
	if (hostCache.size > 5000) hostCache.delete(hostCache.keys().next().value);
	return ok;
}

// fetch() for the crawler's own side requests (robots.txt, search reseeds),
// with the same host fence and a hard timeout.
export async function guardedFetch(url, { timeoutMs = 8000, headers = {} } = {}) {
	const u = new URL(url);
	if (!(await guardHost(u.hostname))) throw new Error(`refused private host ${u.hostname}`);
	return fetch(u, {
		headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
		redirect: 'follow',
		signal: AbortSignal.timeout(timeoutMs),
	});
}
