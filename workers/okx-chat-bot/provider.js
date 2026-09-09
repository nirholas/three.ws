// okx-chat-bot: does the AI credential actually work, right now?
//
// config.js answers "is a credential configured". That is a weaker question than
// it looks, and on this project the two answers came apart in both directions on
// 2026-09-04: the GCP project's Vertex access answers
// `PERMISSION_DENIED: Lightning dunning decision is deny` (a billing hold that
// reads like an IAM problem), and the `openai-api-key` secret is a valid,
// well-formed key whose account answers `billing_not_active`. Either one would
// have satisfied a presence check, booted green, received a buyer's message and
// never answered it, which is precisely the silent failure this worker exists to
// kill, rebuilt one level up.
//
// So the credential is asked, not assumed. One tiny request to the provider's own
// API, classified into a verdict readiness is judged on:
//
//   ok            the provider answered; a reply can be authored
//   unauthorized  the provider refused the credential (expired, revoked, unpaid)
//   unreachable   the network or the provider blipped; not the credential's fault
//   unprobed      no cheap, honest probe exists for this transport
//
// `unreachable` deliberately does NOT fail readiness. A provider outage is real
// but transient and self-heals; treating it like a dead key would page a human
// for something no human can fix, and a page nobody can act on is how alerts get
// ignored.

import { execFile } from 'node:child_process';
import { getGcpAccessToken } from '../../api/_lib/gcp-auth.js';
import { cliEnv } from './cli.js';
import { log } from './log.js';

const PROBE_TIMEOUT_MS = 20_000;

// Small on purpose: the probe exists to exercise auth, not to generate text.
const VERTEX_PROBE_MODEL = 'claude-haiku-4-5@20251001';
const ANTHROPIC_PROBE_MODEL = 'claude-haiku-4-5-20251001';
const OPENAI_PROBE_MODEL = 'gpt-4o-mini';

/**
 * Turn an HTTP status into a credential verdict.
 *
 * 400 and 404 count as `ok`: the provider had to authenticate the caller before
 * it could object to the model id or the request shape, so a quibble about the
 * body is proof the credential was accepted. Only an explicit refusal
 * (401/403/402, or a 429 that names billing rather than rate) is the credential's
 * fault; everything else is the provider having a bad minute.
 */
export function classifyProbeStatus(status, body = '') {
	if (status >= 200 && status < 300) return { code: 'ok', detail: 'the provider answered' };
	if (status === 400 || status === 404) {
		return { code: 'ok', detail: `credential accepted (provider returned ${status} on the probe request itself)` };
	}
	if (status === 401 || status === 403 || status === 402) {
		return { code: 'unauthorized', detail: `the provider refused the credential (${status}): ${summarize(body)}` };
	}
	if (status === 429) {
		// A rate limit is transient and is not the credential's fault. A suspended
		// or unpaid account also answers 429, and that one no retry will fix.
		const billing = /billing|not active|quota|insufficient|suspend/i.test(body);
		return billing
			? { code: 'unauthorized', detail: `the provider account cannot serve requests: ${summarize(body)}` }
			: { code: 'unreachable', detail: 'rate limited by the provider' };
	}
	return { code: 'unreachable', detail: `provider returned ${status}: ${summarize(body)}` };
}

function summarize(body) {
	const text = String(body || '').replace(/\s+/g, ' ').trim();
	try {
		const j = JSON.parse(text);
		return String(j?.error?.message || j?.error?.status || text).slice(0, 200);
	} catch {
		return text.slice(0, 200);
	}
}

async function postJson(url, headers, body) {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body),
			signal: ctl.signal,
		});
		return classifyProbeStatus(res.status, await res.text());
	} catch (err) {
		return { code: 'unreachable', detail: `probe request failed: ${err?.message || err}` };
	} finally {
		clearTimeout(timer);
	}
}

function vertexLocation(env) {
	return (env.CLOUD_ML_REGION || env.GOOGLE_CLOUD_LOCATION_CLAUDE || 'global').trim();
}

async function probeVertex(env) {
	const project = env.ANTHROPIC_VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
	const location = vertexLocation(env);
	const model = env.OKX_BOT_VERTEX_PROBE_MODEL || VERTEX_PROBE_MODEL;
	let token;
	try {
		token = await getGcpAccessToken();
	} catch (err) {
		// No ADC at all is a configuration fault, not a blip: the CLI will fail the
		// same way on the buyer's first message.
		return { code: 'unauthorized', detail: `no GCP credentials for Vertex: ${err?.message || err}` };
	}
	const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
	return postJson(
		`https://${host}/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${model}:rawPredict`,
		{ authorization: `Bearer ${token}` },
		{ anthropic_version: 'vertex-2023-10-16', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
	);
}

async function probeAnthropicKey(env) {
	return postJson(
		'https://api.anthropic.com/v1/messages',
		{ 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
		{ model: ANTHROPIC_PROBE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
	);
}

async function probeOpenAiKey(env) {
	return postJson(
		'https://api.openai.com/v1/chat/completions',
		{ authorization: `Bearer ${env.OPENAI_API_KEY}` },
		{ model: OPENAI_PROBE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
	);
}

async function probeAnthropicBearer(env, key) {
	return postJson(
		'https://api.anthropic.com/v1/messages',
		{ authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
		{ model: ANTHROPIC_PROBE_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
	);
}

/**
 * Probe an Anthropic-wire-format gateway at its own base URL.
 *
 * `${base}/v1/messages` is the same path the CLI itself builds from
 * ANTHROPIC_BASE_URL, so the probe fails exactly where a real reply would. That
 * matters more than it sounds: OpenRouter's gateway lives at
 * `https://openrouter.ai/api/v1/messages`, so its base URL is
 * `https://openrouter.ai/api` and the intuitive `.../api/v1` is one path segment
 * too deep. Configured that way the endpoint answers 404 forever.
 *
 * Gateways disagree about which header carries the credential (OpenRouter reads
 * `Authorization`, Anthropic reads `x-api-key`), so both are sent: whichever the
 * gateway reads, the other is ignored. The model id is the lane's own, because a
 * gateway that authenticates fine still refuses an id from a different catalog.
 *
 * And unlike a first-party provider, a gateway's 400/404 is NOT proof the
 * credential works. classifyProbeStatus() reads those as "the provider had to
 * authenticate me before it could object to my request", which is true of
 * api.anthropic.com and useless here: a wrong base URL or an unroutable model id
 * produces exactly that status and then fails every real reply. So a gateway
 * lane is elected on a 2xx and nothing else.
 */
async function probeGateway(lane) {
	const base = String(lane.env.ANTHROPIC_BASE_URL || '').replace(/\/+$/, '');
	const model = lane.env.ANTHROPIC_MODEL || ANTHROPIC_PROBE_MODEL;
	const key = lane.env.ANTHROPIC_AUTH_TOKEN || '';
	const url = `${base}/v1/messages`;
	const verdict = await postJson(
		url,
		{ authorization: `Bearer ${key}`, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
		{ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
	);
	if (verdict.code === 'ok' && /returned (400|404)/.test(verdict.detail)) {
		return {
			code: 'unauthorized',
			detail: `the gateway ${url} rejected the probe request (model ${model}): ${verdict.detail}. ` +
				'Check OKX_BOT_ANTHROPIC_BASE_URL (it must be the prefix the CLI appends /v1/messages to) and OKX_BOT_ANTHROPIC_MODEL.',
		};
	}
	return verdict;
}

/**
 * Ask ONE lane whether it will serve this host.
 *
 * The lane's env overlay is layered over the process env first, so a lane is
 * probed exactly as the spawned CLI would experience it. Probing the ambient env
 * instead is how a gateway lane would report on Vertex's credential and elect
 * itself on someone else's verdict.
 *
 * @param {{ id: string, provider: string, transport: string, env: Record<string,string|null> }} lane
 * @param {NodeJS.ProcessEnv} [ambient]
 */
export async function probeLane(lane, ambient = process.env) {
	const env = { ...ambient };
	for (const [k, v] of Object.entries(lane.env || {})) {
		if (v === null || v === undefined) delete env[k];
		else env[k] = String(v);
	}
	const wrap = (r) => ({ ...r, lane: lane.id, transport: lane.transport, checkedAt: Date.now() });

	// Dispatch on the LANE's transport, never on what the ambient env happens to
	// hold. A developer host running on an interactive grant usually also has an
	// unrelated key in its environment, and probing that key would answer for a
	// credential this lane does not use.
	if (lane.transport === 'none') return wrap({ code: 'unauthorized', detail: 'no AI-provider credential is configured' });
	if (lane.transport === 'vertex') return wrap(await probeVertex(env));
	if (lane.transport === 'gateway') return wrap(await probeGateway(lane));
	if (lane.transport === 'api-key' && lane.provider === 'claude') {
		return env.ANTHROPIC_API_KEY
			? wrap(await probeAnthropicKey(env))
			: wrap(await probeAnthropicBearer(env, env.CLAUDE_CODE_OAUTH_TOKEN || ''));
	}
	if (lane.transport === 'api-key' && lane.provider === 'codex' && env.OPENAI_API_KEY) {
		return wrap(await probeOpenAiKey(env));
	}

	// An interactive OAuth grant is refreshed by the CLI itself; there is no
	// endpoint this worker can call that proves the grant without reimplementing
	// that refresh. Claiming a verdict here would be inventing one, so the probe
	// abstains and the presence check stands.
	return wrap({ code: 'unprobed', detail: `no credential probe exists for the ${lane.transport} transport` });
}

// Which verdict a host would rather be on when no lane outright works. `ok` is
// the only one that serves a buyer; after that an unprovable grant beats a
// provider having a bad minute, which beats a credential that was refused
// outright. Election walks this order so the reported verdict is the best truth
// available rather than whichever lane happened to be listed first.
const VERDICT_RANK = { ok: 0, unprobed: 1, unreachable: 2, unauthorized: 3 };

/**
 * Probe the chain in order and elect the first lane that can actually serve.
 *
 * Stops at the first `ok`: the lanes are ordered by policy (GCP credits first,
 * a metered third-party gateway last), so the first working one is also the one
 * that should be used, and probing the rest would spend money to learn nothing.
 *
 * @param {Array<object>} chain
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ elected: object|null, verdict: object, lanes: Array<object> }>}
 */
export async function electProvider(chain, env = process.env) {
	const lanes = [];
	for (const lane of chain) {
		const verdict = await probeLane(lane, env);
		lanes.push(verdict);
		if (verdict.code === 'ok') return { elected: lane, verdict, lanes };
	}
	if (!lanes.length) return { elected: null, verdict: null, lanes };
	let best = 0;
	for (let i = 1; i < lanes.length; i++) {
		if (VERDICT_RANK[lanes[i].code] < VERDICT_RANK[lanes[best].code]) best = i;
	}
	// `unprobed` is the one non-ok verdict a host may still serve on: it means the
	// credential could not be asked, not that it was refused.
	const elected = lanes[best].code === 'unprobed' ? chain[best] : null;
	return { elected, verdict: lanes[best], lanes };
}

/**
 * Hand the codex CLI its API key.
 *
 * Codex >= 0.153 does NOT authenticate from `OPENAI_API_KEY` in the environment:
 * it reads ~/.codex/auth.json, and without it every request fails
 * `401 Missing bearer or basic authentication in header` while the env var sits
 * there looking correct. `codex login --with-api-key` reads the key from stdin
 * and writes that file, so this runs at boot, before the daemon can spawn a
 * subsession. Keyless providers are a no-op.
 *
 * @param {ReturnType<import('./config.js').loadConfig>} cfg
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ ran: boolean, ok: boolean, detail: string }>}
 */
export function loginCodex(cfg, env = process.env) {
	if (cfg.provider !== 'codex') return Promise.resolve({ ran: false, ok: true, detail: 'provider is not codex' });
	const key = env.OPENAI_API_KEY;
	if (!key) return Promise.resolve({ ran: false, ok: false, detail: 'codex is the provider but OPENAI_API_KEY is unset' });

	return new Promise((resolve) => {
		const child = execFile(
			'codex',
			['login', '--with-api-key'],
			{ env: cliEnv(cfg), timeout: 60_000, encoding: 'utf8' },
			(err, stdout, stderr) => {
				const detail = (stderr || stdout || '').trim().slice(0, 300);
				if (err) log.error('codex login failed', { detail });
				resolve({ ran: true, ok: !err, detail: detail || (err ? String(err.message) : 'logged in') });
			},
		);
		child.stdin?.end(key);
	});
}
