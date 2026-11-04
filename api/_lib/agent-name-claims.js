/**
 * Bidirectional ENS / DNS name claims for an agent (specs/ENS_AGENT_CLAIM.md).
 *
 * An agent card lists the names that claim it (`claims`); a name proves the
 * claim by pointing back at the agent (ENS text record `agent`, or a DNS TXT
 * record at `_agent.<domain>`). verifyClaims() checks the forward direction for
 * each listed name and reports one trust state per claim:
 *
 *   verified         both directions match
 *   half_from_agent  the card lists the name, the name does not point back
 *   half_from_name   the name points at the agent, the card does not list it
 *                    (only reachable for names the caller asks about)
 *   unverified       neither direction, or the check could not be completed
 *
 * Best effort and time bounded: at most MAX_CLAIMS names are looked up, each
 * within CLAIM_TIMEOUT_MS, and every failure is reported on the claim as a
 * `reason`, never thrown. Successful lookups are cached for the same five
 * minutes as the resolver endpoint's CACHE_HEADERS.
 */

import { domainToASCII } from 'node:url';
import { normalize } from 'viem/ens';
import { env } from './env.js';
import { fetchSafePublicUrl } from './ssrf-guard.js';

export const MAX_CLAIMS = 4;
export const CLAIM_TIMEOUT_MS = 3000;
export const CLAIM_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const DNS_TXT_TYPE = 16;
const DNS_NXDOMAIN = 3;
const REF_RE = /^eip155:(\d+):(0x[a-fA-F0-9]{40})\/(\d+)$/;
const DNS_NAME_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

const moduleCache = new Map();

/** Parse "ref1, ref2" into normalized refs, dropping malformed entries. */
export function parseRefList(value) {
	if (typeof value !== 'string') return [];
	const refs = [];
	for (const part of value.split(',')) {
		const m = REF_RE.exec(part.trim());
		if (m) refs.push({ chainId: Number(m[1]), registry: m[2].toLowerCase(), agentId: m[3] });
	}
	return refs;
}

/**
 * Parse one `_agent` TXT record ("v=agent1; ref=..."). Returns its refs, or
 * null when the record is not a valid v=agent1 record with at least one ref.
 */
export function parseDnsRecord(txt) {
	if (typeof txt !== 'string') return null;
	const fields = new Map();
	for (const piece of txt.split(';')) {
		const eq = piece.indexOf('=');
		if (eq < 0) continue;
		const key = piece.slice(0, eq).trim().toLowerCase();
		if (key && !fields.has(key)) fields.set(key, piece.slice(eq + 1).trim());
	}
	if (fields.get('v') !== 'agent1') return null;
	const refs = parseRefList(fields.get('ref'));
	return refs.length ? refs : null;
}

function refKey({ chainId, registry, agentId }) {
	return `eip155:${chainId}:${String(registry).toLowerCase()}/${agentId}`;
}

/** Validate and normalize a claim; returns { type, name } or { error }. */
function normalizeClaim(raw) {
	if (!raw || typeof raw !== 'object') return { error: 'claim is not an object' };
	const { type, name } = raw;
	if (type !== 'ens' && type !== 'dns') return { error: 'claim type must be "ens" or "dns"' };
	if (typeof name !== 'string' || !name.trim()) return { error: 'claim name is missing' };
	if (type === 'ens') {
		try {
			const n = normalize(name.trim());
			if (!n.includes('.')) return { error: 'not a valid ENS name' };
			return { type, name: n };
		} catch {
			return { error: 'not a valid ENS name' };
		}
	}
	const ascii = domainToASCII(name.trim().toLowerCase().replace(/\.$/, ''));
	if (!DNS_NAME_RE.test(ascii)) return { error: 'not a valid domain name' };
	return { type, name: ascii };
}

function typeForQueriedName(name) {
	return String(name).toLowerCase().endsWith('.eth') ? 'ens' : 'dns';
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error('lookup timed out')), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let mainnetClient = null;
async function defaultEnsText(name) {
	if (!mainnetClient) {
		const { createPublicClient, http } = await import('viem');
		const { mainnet } = await import('viem/chains');
		mainnetClient = createPublicClient({ chain: mainnet, transport: http(env.MAINNET_RPC_URL || undefined) });
	}
	return mainnetClient.getEnsText({ name, key: 'agent' });
}

/** A DoH TXT answer is one or more quoted chunks: "abc" "def". Join them. */
function decodeTxtData(data) {
	const chunks = [...String(data).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
	return chunks.length ? chunks.join('') : String(data);
}

async function defaultDnsTxt(name, timeoutMs = CLAIM_TIMEOUT_MS) {
	const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`;
	const res = await fetchSafePublicUrl(url, {
		headers: { accept: 'application/dns-json' },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) throw new Error(`DNS-over-HTTPS returned HTTP ${res.status}`);
	const body = await res.json();
	if (body.Status === DNS_NXDOMAIN) return [];
	if (body.Status !== 0) throw new Error(`DNS lookup failed with status ${body.Status}`);
	return (body.Answer || []).filter((a) => a.type === DNS_TXT_TYPE).map((a) => decodeTxtData(a.data));
}

/** Forward lookup: does `claim` point at `ref`? Returns { points, canonical }. */
async function forwardLookup(claim, ref, deps) {
	let refs = [];
	if (claim.type === 'ens') {
		refs = parseRefList(await deps.ensText(claim.name));
	} else {
		const records = await deps.dnsTxt(`_agent.${claim.name}`);
		for (const txt of records || []) {
			const parsed = parseDnsRecord(txt);
			if (parsed) {
				refs = parsed;
				break;
			}
		}
	}
	const target = refKey(ref);
	const index = refs.findIndex((r) => refKey(r) === target);
	return { points: index >= 0, canonical: index === 0 };
}

function cacheGet(cache, key, now) {
	if (!cache) return null;
	const hit = cache.get(key);
	if (!hit) return null;
	if (now - hit.at > CLAIM_CACHE_TTL_MS) {
		cache.delete(key);
		return null;
	}
	return hit.value;
}

function cacheSet(cache, key, value, now) {
	if (!cache) return;
	if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
	cache.set(key, { at: now, value });
}

function stateFor(listed, points) {
	if (listed) return points ? 'verified' : 'half_from_agent';
	return points ? 'half_from_name' : 'unverified';
}

function failure(raw, reason) {
	return {
		type: typeof raw?.type === 'string' ? raw.type : null,
		name: typeof raw?.name === 'string' ? raw.name : null,
		verified: false,
		state: 'unverified',
		reason,
	};
}

/**
 * @param {object|null} card   The resolved agent card; its `claims` array is checked.
 * @param {{ chainId: number, registry: string, agentId: string|number, names?: string[] }} ctx
 *        `names` are extra names to test even though the card does not list them.
 * @param {{ ensText?: Function, dnsTxt?: Function, cache?: Map|null, now?: () => number, timeoutMs?: number }} [deps]
 * @returns {Promise<Array<{ type: string|null, name: string|null, verified: boolean, state: string, reason?: string, canonical?: boolean }>>}
 */
export async function verifyClaims(card, ctx, deps = {}) {
	const listed = Array.isArray(card?.claims) ? card.claims : [];
	const extra = (ctx.names || []).map((name) => ({ type: typeForQueriedName(name), name, queried: true }));
	const entries = [...listed.map((raw) => ({ raw, listed: true })), ...extra.map((raw) => ({ raw, listed: false }))];
	if (!entries.length) return [];

	const timeoutMs = deps.timeoutMs ?? CLAIM_TIMEOUT_MS;
	const lookups = {
		ensText: deps.ensText ?? defaultEnsText,
		dnsTxt: deps.dnsTxt ?? ((name) => defaultDnsTxt(name, timeoutMs)),
	};
	const cache = deps.cache === undefined ? moduleCache : deps.cache;
	const now = deps.now ?? Date.now;
	const ref = { chainId: ctx.chainId, registry: ctx.registry, agentId: String(ctx.agentId) };

	// Names the card lists are not "half from name" when also queried: dedupe.
	const listedKeys = new Set();
	for (const { raw } of entries.filter((e) => e.listed)) {
		const n = normalizeClaim(raw);
		if (!n.error) listedKeys.add(`${n.type}|${n.name}`);
	}

	const seen = new Set();
	const work = entries.map((entry, index) => {
		if (index >= MAX_CLAIMS) {
			return Promise.resolve(failure(entry.raw, `not checked: only the first ${MAX_CLAIMS} claims are verified`));
		}
		const claim = normalizeClaim(entry.raw);
		if (claim.error) return Promise.resolve(failure(entry.raw, claim.error));
		const dedupeKey = `${claim.type}|${claim.name}`;
		if (!entry.listed && listedKeys.has(dedupeKey)) return null;
		if (seen.has(dedupeKey)) return null;
		seen.add(dedupeKey);

		const isListed = entry.listed;
		return (async () => {
			const key = `${dedupeKey}|${refKey(ref)}`;
			let forward = cacheGet(cache, key, now());
			if (!forward) {
				try {
					forward = await withTimeout(forwardLookup(claim, ref, lookups), timeoutMs);
				} catch (err) {
					const reason = err?.message === 'lookup timed out' ? `${claim.type} lookup timed out after ${timeoutMs} ms` : `${claim.type} lookup failed: ${err?.message || err}`;
					return { type: claim.type, name: claim.name, verified: false, state: 'unverified', reason };
				}
				cacheSet(cache, key, forward, now());
			}
			const state = stateFor(isListed, forward.points);
			const out = { type: claim.type, name: claim.name, verified: state === 'verified', state };
			if (forward.points) out.canonical = forward.canonical;
			if (state === 'half_from_agent') {
				out.reason = `${claim.name} does not point at this agent (${claim.type === 'ens' ? 'ENS text record "agent"' : 'TXT record at _agent.' + claim.name} has no matching ref)`;
			} else if (state === 'half_from_name') {
				out.reason = 'the name points at this agent but the agent card does not list it in claims';
			} else if (state === 'unverified') {
				out.reason = `${claim.name} does not point at this agent and the card does not list it`;
			}
			return out;
		})();
	});

	return (await Promise.all(work)).filter(Boolean);
}
