#!/usr/bin/env node
// Provision and prove the OKX chat bot's payment-free AI lane: the bot's
// `anthropic-gateway` lane pointed at three.ws's own we-pay proxy.
//
// The bot's reply subsession is the `claude` CLI, and that CLI speaks one wire
// format to whatever ANTHROPIC_BASE_URL names. three.ws serves exactly that
// format at /api/llm/anthropic (the proxy every avatar embed uses, on the free
// model chain), and an SDK client reaches it at the agent-scoped base URL
// /api/llm/anthropic/agents/<agent>/v1/messages. So the lane needs no third-party
// account and no GCP billing: it needs an agent to meter against and a bearer
// credential the proxy admits. This script owns both.
//
//   node scripts/okx-bot-llm-gateway.mjs            # plan: read-only, prints what exists and what would change
//   node scripts/okx-bot-llm-gateway.mjs --apply    # create what is missing, then prove the lane
//   node scripts/okx-bot-llm-gateway.mjs --verify   # prove the lane only (no writes)
//   node scripts/okx-bot-llm-gateway.mjs --verify --cli   # also drive the real `claude` CLI through it
//   node scripts/okx-bot-llm-gateway.mjs --apply --rotate # mint a new key, then revoke the old one
//
// What it provisions, and why each piece is shaped the way it is:
//
//   * A SERVICE ACCOUNT user (`service_account = true`, on the platform's own
//     @agents.three.ws mailbox domain) that owns nothing but the metering agent.
//     The proxy admits a header-less caller only when it authenticates as a real
//     user, and whatever user that is, its bearer key is readable by the reply
//     subsession, which runs with tool access on buyer-supplied text. Issuing the
//     key to the platform's main account would hand that subsession every agent,
//     wallet and setting the platform owns; issuing it to an account that owns
//     one unpublished agent bounds a leaked key to that agent's AI budget.
//   * A dedicated, unpublished AGENT that the proxy meters. Per-agent rate limit,
//     monthly call quota and token budget come from its embed policy, set here so
//     a Claude Code turn (a 25k to 35k token prompt, several calls per reply)
//     fits: the embed default of 10 calls/min and 1M tokens/month would starve it
//     within a few conversations. Never someone else's agent.
//   * An API KEY for that account, stored only in Secret Manager
//     (SECRET, read by the Cloud Run runtime account), never printed, never
//     written to disk.
//
// The proof reuses the bot's own probe (workers/okx-chat-bot/provider.js
// probeLane) against the lane config.js builds from the same env the deploy
// sets, so "the script passed" and "the bot will elect this lane" are the same
// statement.

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { requireServiceEnvValue } from './lib/service-env.mjs';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const run = promisify(execFile);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY_ONLY = args.includes('--verify');
const ROTATE = args.includes('--rotate');
const CLI = args.includes('--cli');
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

export const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'aerial-vehicle-466722-p5';
export const API_BASE = flag('--base', process.env.OKX_BOT_GATEWAY_API_BASE || 'https://three.ws').replace(/\/+$/, '');
export const SERVICE_EMAIL = 'marketplace-chat@agents.three.ws';
export const SERVICE_USERNAME = 'marketplace-chat';
export const AGENT_PURPOSE = 'llm-gateway-meter';
export const AGENT_NAME = 'three.ws 3D Studio (marketplace chat)';
export const SECRET = 'okx-chat-bot-llm-gateway-token';
export const RUNTIME_SA = `three-ws@${PROJECT}.iam.gserviceaccount.com`;
export const KEY_NAME = 'marketplace chat bot: AI gateway';
// The free model the proxy serves this agent. Chosen on a live run of the
// `claude` CLI through the proxy (see the order file for the measurement): it
// must follow a 25k+ token agentic system prompt and emit real tool calls.
export const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const MODEL = flag('--model', process.env.OKX_BOT_ANTHROPIC_MODEL || DEFAULT_MODEL);

/**
 * The metering agent's embed policy. Only `brain` differs from the embed
 * default, and every number in it is sized to a Claude Code reply loop rather
 * than a browser chat widget.
 */
export function gatewayPolicy(model = MODEL) {
	return {
		version: 1,
		origins: { mode: 'allowlist', hosts: [] },
		// The CLI is a script-surface caller; nothing embeds this agent in a page.
		surfaces: { script: true, iframe: false, widget: false, mcp: false },
		brain: {
			mode: 'we-pay',
			proxy_url: null,
			model,
			// Several calls per reply, and the CLI retries a 429 with backoff, so a
			// ceiling here slows a burst rather than dropping a buyer.
			rate_limit_per_min: 30,
			monthly_quota: 20_000,
			// tokenBudgetFromPolicy: cents / 1.5 * 1000 tokens, so 45,000 cents is a
			// 30M token/month ceiling. On the free chain it is a runaway guard, not a
			// spend; it only turns into money if every free rung is down at once.
			cost_limit_cents: 45_000,
		},
		storage: { primary: 'r2', pinned_ipfs: false, onchain_attested: false },
	};
}

/** The base URL the bot's gateway lane is configured with. */
export function gatewayBaseUrl(agentId, base = API_BASE) {
	return `${base}/api/llm/anthropic/agents/${agentId}`;
}

const say = (...m) => console.log(...m);
const die = (msg, code = 1) => {
	console.error(`\n  FAILED: ${msg}\n`);
	process.exit(code);
};

function gcloud(argv, { input } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn('gcloud', [...argv, '--project', PROJECT, '--quiet'], { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => (stderr += d));
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(stderr.trim() || `gcloud exited ${code}`), { code, stderr }))));
		child.stdin.end(input ?? '');
	});
}

async function db() {
	// A fresh clone has no .env.local, so resolve production's copy off the API
	// service (a Secret Manager reference) rather than stall the deploy on it.
	if (!process.env.DATABASE_URL) {
		try {
			process.env.DATABASE_URL = requireServiceEnvValue('DATABASE_URL');
		} catch (err) {
			die(`DATABASE_URL is not set in .env.local and ${err.message}`);
		}
	}
	const { sql } = await import('../api/_lib/db.js');
	return sql;
}

async function findUser(sql) {
	const [row] = await sql`select id, service_account from users where email = ${SERVICE_EMAIL} and deleted_at is null limit 1`;
	return row || null;
}

async function findAgent(sql, userId) {
	const [row] = await sql`
		select id, name, is_published, embed_policy from agent_identities
		where user_id = ${userId} and deleted_at is null and meta->>'purpose' = ${AGENT_PURPOSE}
		order by created_at limit 1
	`;
	return row || null;
}

async function activeKeys(sql, userId) {
	return sql`
		select id, prefix, token_hash, created_at from api_keys
		where user_id = ${userId} and name = ${KEY_NAME} and revoked_at is null
		  and (expires_at is null or expires_at > now())
		order by created_at desc
	`;
}

async function secretState() {
	try {
		await gcloud(['secrets', 'describe', SECRET, '--format=value(name)']);
	} catch (err) {
		// Only a NOT_FOUND means the secret is missing. Anything else (an expired
		// gcloud login above all) means nobody could look, and reporting that as
		// "missing" would send --apply off to create a secret that already exists.
		if (/NOT_FOUND|not found/i.test(err?.stderr || err?.message || '')) return { exists: false, token: null };
		return { exists: null, token: null, error: String(err?.message || err).split('\n')[0].slice(0, 200) };
	}
	try {
		const { stdout } = await gcloud(['secrets', 'versions', 'access', 'latest', '--secret', SECRET]);
		return { exists: true, token: stdout.trim() || null };
	} catch {
		return { exists: true, token: null };
	}
}

async function hashOf(token) {
	const { sha256 } = await import('../api/_lib/crypto.js');
	return sha256(token);
}

async function ensureUser(sql) {
	const existing = await findUser(sql);
	if (existing) return { id: existing.id, created: false };
	const [row] = await sql`
		insert into users (email, display_name, username, plan, email_verified, service_account, created_at, updated_at)
		values (${SERVICE_EMAIL}, 'three.ws marketplace chat', ${SERVICE_USERNAME}, 'free', false, true, now(), now())
		returning id
	`;
	return { id: row.id, created: true };
}

async function ensureAgent(sql, userId, model) {
	const policy = JSON.stringify(gatewayPolicy(model));
	const existing = await findAgent(sql, userId);
	if (existing) {
		await sql`update agent_identities set embed_policy = ${policy}::jsonb, updated_at = now() where id = ${existing.id}`;
		return { id: existing.id, created: false };
	}
	const meta = JSON.stringify({ purpose: AGENT_PURPOSE, meters: 'the marketplace chat bot reply subsession (workers/okx-chat-bot)' });
	const [row] = await sql`
		insert into agent_identities (user_id, name, description, is_published, meta, embed_policy, created_at, updated_at)
		values (
			${userId}, ${AGENT_NAME},
			'Meters the AI budget of the three.ws marketplace chat bot. Not a public agent.',
			false, ${meta}::jsonb, ${policy}::jsonb, now(), now()
		)
		returning id
	`;
	return { id: row.id, created: true };
}

/**
 * Mint a key, store it as a new secret version, and only then (on --rotate)
 * revoke the keys it replaces, so there is never a moment with no working key.
 */
async function mintKeyIntoSecret(sql, userId, { secretExists, revokeIds }) {
	const { randomToken, sha256 } = await import('../api/_lib/crypto.js');
	const raw = `sk_live_${randomToken(28)}`;
	const [row] = await sql`
		insert into api_keys (user_id, name, prefix, token_hash, scope)
		values (${userId}, ${KEY_NAME}, ${raw.slice(0, 12)}, ${await sha256(raw)}, 'llm:proxy')
		returning id
	`;
	try {
		if (!secretExists) await gcloud(['secrets', 'create', SECRET, '--replication-policy=automatic']);
		await gcloud(['secrets', 'versions', 'add', SECRET, '--data-file=-'], { input: raw });
	} catch (err) {
		// A key no secret holds is a key nobody can use: take it back.
		await sql`update api_keys set revoked_at = now() where id = ${row.id}`;
		throw err;
	}
	if (revokeIds.length) await sql`update api_keys set revoked_at = now() where id = any(${revokeIds})`;
	return row.id;
}

async function grantRuntimeAccess() {
	await gcloud([
		'secrets',
		'add-iam-policy-binding',
		SECRET,
		`--member=serviceAccount:${RUNTIME_SA}`,
		'--role=roles/secretmanager.secretAccessor',
		'--format=none',
	]);
}

/** Prove the lane with the bot's own lane builder and probe. */
async function proveProbe(agentId, token, model) {
	const { providerLanes } = await import('../workers/okx-chat-bot/config.js');
	const { probeLane } = await import('../workers/okx-chat-bot/provider.js');
	const env = {
		OKX_BOT_ANTHROPIC_BASE_URL: gatewayBaseUrl(agentId),
		OKX_BOT_ANTHROPIC_AUTH_TOKEN: token,
		OKX_BOT_ANTHROPIC_MODEL: model,
	};
	const lane = providerLanes(env, '/nonexistent').find((l) => l.id === 'anthropic-gateway');
	if (!lane) return { code: 'unauthorized', detail: 'config.js built no gateway lane from this env' };
	return probeLane(lane, {});
}

/**
 * The same probe body on the proxy's canonical path (`?agent=`), which every
 * API build serves. When the agent-scoped SDK path is not live yet (the API
 * deploy carrying it has not landed), this still proves the credential, the
 * metering agent and the free model chain on production, so the only thing the
 * SDK-path probe can then be waiting on is that deploy.
 */
async function proveCanonical(agentId, token, model) {
	const res = await fetch(`${API_BASE}/api/llm/anthropic?agent=${agentId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
		body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
		signal: AbortSignal.timeout(60_000),
	}).catch((err) => ({ status: 0, text: async () => String(err?.message || err) }));
	const text = await res.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		/* non-JSON answers are reported by status and a short excerpt */
	}
	return {
		status: res.status,
		model: body?.model ?? null,
		reply: Array.isArray(body?.content) ? body.content.map((b) => b.text || '').join('').trim().slice(0, 80) : text.slice(0, 160),
	};
}

/**
 * Drive the real `claude` CLI through the lane, with the exact env overlay the
 * bot applies (config.js gatewayLane), in a throwaway HOME. This is the request
 * a buyer's message produces: a 25k+ token agentic system prompt, the full tool
 * list, streaming, and a tool call it has to make and read back.
 */
async function proveCli(agentId, token, model) {
	const { providerLanes } = await import('../workers/okx-chat-bot/config.js');
	const lane = providerLanes(
		{ OKX_BOT_ANTHROPIC_BASE_URL: gatewayBaseUrl(agentId), OKX_BOT_ANTHROPIC_AUTH_TOKEN: token, OKX_BOT_ANTHROPIC_MODEL: model },
		'/nonexistent',
	).find((l) => l.id === 'anthropic-gateway');
	const home = await mkdtemp(join(tmpdir(), 'okx-gateway-cli-'));
	const env = { PATH: process.env.PATH, HOME: home };
	for (const [k, v] of Object.entries(lane.env)) if (v !== null) env[k] = String(v);
	const marker = `gateway-proof-${Date.now().toString(36)}`;
	try {
		const { stdout } = await run(
			'claude',
			[
				'-p',
				`Use the Bash tool to run exactly: echo ${marker}. Then reply with one line: the command output.`,
				'--permission-mode',
				'bypassPermissions',
				'--output-format',
				'json',
			],
			{ env, cwd: home, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
		);
		const out = JSON.parse(stdout);
		const usedTool = (out.num_turns ?? 0) > 1;
		return {
			ok: !out.is_error && String(out.result || '').includes(marker) && usedTool,
			turns: out.num_turns,
			result: String(out.result || '').slice(0, 200),
			isError: !!out.is_error,
			durationMs: out.duration_ms,
		};
	} catch (err) {
		return { ok: false, error: String(err?.stderr || err?.stdout || err?.message || err).slice(0, 500) };
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

async function main() {
	const sql = await db();
	const user = await findUser(sql);
	const agent = user ? await findAgent(sql, user.id) : null;
	const keys = user ? await activeKeys(sql, user.id) : [];
	const secret = await secretState();
	const secretHash = secret.token ? await hashOf(secret.token) : null;
	const secretKey = secretHash ? keys.find((k) => k.token_hash === secretHash) : null;

	say(`\n  service account  ${SERVICE_EMAIL}: ${user ? `exists (${user.id})` : 'missing'}`);
	say(`  metering agent   ${agent ? `${agent.id} "${agent.name}"` : 'missing'}`);
	say(`  model            ${MODEL}`);
	say(`  api keys         ${keys.length} active`);
	say(`  secret           ${SECRET}: ${secret.exists === null ? `unknown (${secret.error})` : !secret.exists ? 'missing' : secretKey ? `holds active key ${secretKey.prefix}...` : 'holds no active key'}`);
	if (secret.exists === null && (APPLY || VERIFY_ONLY)) die('gcloud cannot read Secret Manager here: run `gcloud auth login`, then re-run');

	if (!APPLY && !VERIFY_ONLY) {
		say('\n  plan only: nothing was written. Re-run with --apply to provision, or --verify to prove an existing lane.\n');
		return;
	}

	let agentId = agent?.id;
	if (APPLY) {
		const u = await ensureUser(sql);
		const a = await ensureAgent(sql, u.id, MODEL);
		agentId = a.id;
		say(`\n  user   ${u.created ? 'created' : 'kept'} ${u.id}`);
		say(`  agent  ${a.created ? 'created' : 'policy re-asserted on'} ${a.id}`);
		if (!secretKey || ROTATE) {
			const replaced = ROTATE ? keys.map((k) => k.id) : [];
			const id = await mintKeyIntoSecret(sql, u.id, { secretExists: secret.exists, revokeIds: replaced });
			say(`  key    minted ${id} into ${SECRET}${replaced.length ? `, revoked ${replaced.length} older` : ''}`);
		} else {
			say(`  key    kept ${secretKey.prefix}...`);
		}
		await grantRuntimeAccess();
		say(`  iam    ${RUNTIME_SA} holds secretAccessor on ${SECRET}`);
	}

	if (!agentId) die('no metering agent exists yet: run with --apply first');
	const { token } = await secretState();
	if (!token) die(`${SECRET} holds no readable version: run with --apply`);

	const canonical = await proveCanonical(agentId, token, MODEL);
	say(`\n  proxy  POST ${API_BASE}/api/llm/anthropic?agent=${agentId}`);
	say(`         ${canonical.status} model=${canonical.model} reply=${JSON.stringify(canonical.reply)}`);

	const verdict = await proveProbe(agentId, token, MODEL);
	say(`\n  probe  POST ${gatewayBaseUrl(agentId)}/v1/messages  (${MODEL}, max_tokens 1)`);
	say(`         ${verdict.code}: ${verdict.detail}`);

	let cli = null;
	if (CLI) {
		cli = await proveCli(agentId, token, MODEL);
		say(`\n  cli    claude -p through the lane: ${cli.ok ? 'OK' : 'FAILED'}`);
		say(`         ${JSON.stringify(cli)}`);
	}

	say('\n  Deploy env for workers/okx-chat-bot/cloudbuild.yaml:');
	say(`    OKX_BOT_ANTHROPIC_BASE_URL=${gatewayBaseUrl(agentId)}`);
	say(`    OKX_BOT_ANTHROPIC_MODEL=${MODEL}`);
	say(`    OKX_BOT_ANTHROPIC_AUTH_TOKEN=${SECRET}:latest   (--set-secrets)\n`);

	if (verdict.code !== 'ok' || (cli && !cli.ok)) process.exit(2);
}

main().catch((err) => die(err?.message || String(err)));
