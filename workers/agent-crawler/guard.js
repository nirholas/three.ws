// The network fence for a browser that goes wherever links lead.
//
// guardHost(): every request the crawler's pages make is resolved first and
// refused when ANY address it resolves to is private, loopback, link-local or
// reserved. That is what keeps a hostile page (or a mission seed pointing at an
// internal name) from turning the crawler into a probe of the network it runs in.
// Dependency-free so tests/agent-crawler-guard.test.js can pin it.

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';

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

// The address a hostname connects to is decided HERE, at connect time, and the
// socket uses exactly that address. guardHost() alone checks one lookup and then
// lets the HTTP client resolve again, so a DNS answer that flips between the two
// (rebinding) would slip a private address past the fence.
export function guardedLookup(hostname, options, callback) {
	const cb = typeof options === 'function' ? options : callback;
	const wantAll = typeof options === 'object' && options?.all === true;
	dns.lookup(hostname, { all: true, verbatim: true }).then(
		(addrs) => {
			if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
				cb(new Error(`refused private host ${hostname}`));
				return;
			}
			if (wantAll) cb(null, addrs);
			else cb(null, addrs[0].address, addrs[0].family);
		},
		(err) => cb(err),
	);
}

function pinnedRequest(u, { headers, signal }) {
	return new Promise((resolve, reject) => {
		const client = u.protocol === 'https:' ? https : http;
		const req = client.request(
			u,
			{ method: 'GET', headers, lookup: guardedLookup, signal },
			(res) => {
				const responseHeaders = new Headers();
				for (const [k, v] of Object.entries(res.headers)) {
					if (Array.isArray(v)) for (const item of v) responseHeaders.append(k, item);
					else if (v !== undefined) responseHeaders.set(k, v);
				}
				const noBody = [101, 204, 205, 304].includes(res.statusCode);
				if (noBody) res.resume();
				resolve(new Response(noBody ? null : Readable.toWeb(res), { status: res.statusCode, headers: responseHeaders }));
			},
		);
		req.on('error', reject);
		req.end();
	});
}

// fetch() for the crawler's own side requests (robots.txt, search reseeds),
// with the same host fence and a hard timeout. Redirects are followed by hand so
// every hop's host passes guardHost before we connect to it; following them
// natively would only have checked the first URL.
const MAX_REDIRECTS = 5;

export async function guardedFetch(url, { timeoutMs = 8000, headers = {} } = {}) {
	const signal = AbortSignal.timeout(timeoutMs);
	let u = new URL(url);
	for (let hops = 0; ; hops++) {
		if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`refused scheme ${u.protocol}`);
		if (!(await guardHost(u.hostname))) throw new Error(`refused private host ${u.hostname}`);
		const requestHeaders = { 'user-agent': USER_AGENT, accept: '*/*', ...headers };
		const res = net.isIP(u.hostname.replace(/^\[|\]$/g, ''))
			? await fetch(u, { headers: requestHeaders, redirect: 'manual', signal })
			: await pinnedRequest(u, { headers: requestHeaders, signal });
		const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
		if (!location) return res;
		await res.body?.cancel().catch(() => {});
		if (hops >= MAX_REDIRECTS) throw new Error('too many redirects');
		u = new URL(location, u);
	}
}
