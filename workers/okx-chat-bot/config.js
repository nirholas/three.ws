// okx-chat-bot: configuration, resolved once at boot.
//
// Everything here is env-driven so the same image runs on Cloud Run, on a plain
// VM, and locally with no code change. The defaults are the production posture:
// state persisted to GCS, heartbeat on, session probed every minute.

import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const num = (v, fallback) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Every AI lane this host could authenticate through, best first.
 *
 * There used to be exactly one. That is a chain with a single rung, and on
 * 2026-09-04 the rung snapped: the GCP project's Vertex access started answering
 * `PERMISSION_DENIED: Lightning dunning decision is deny` (a billing hold that
 * reads like an IAM fault) and the host sat on that one dead lane, unable to
 * author a single reply, while other credentials the project holds went
 * unconsidered. Whichever lane is funded should be the lane that serves, and the
 * host should move to it by itself.
 *
 * Order is a policy, not a preference:
 *
 *   vertex             GCP credits, authenticated by the runtime service account.
 *                      No secret exists to leak, rotate or forget, and the spend
 *                      lands on the pool the platform already prefers.
 *   anthropic-key      a first-party ANTHROPIC_API_KEY.
 *   anthropic-gateway  any Anthropic-wire-format gateway (OpenRouter serves one
 *                      at /api/v1/messages). Opt-in: it only exists when an
 *                      operator sets its base URL and token, because it bills a
 *                      third-party account per token.
 *   anthropic-oauth    an interactive `claude` login on a developer host.
 *   openai-key         the codex CLI on OPENAI_API_KEY.
 *
 * Every lane carries the env its CLI needs, so electing one is applying that
 * overlay and respawning the daemon. A `null` value means "unset this", which is
 * what lets the gateway lane switch Vertex off for the subsession it spawns.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home where a CLI keeps an interactive login
 * @returns {Array<{ id: string, provider: string, transport: string, reason: string, env: Record<string,string|null> }>}
 */
export function providerLanes(env = process.env, home = env.OKX_BOT_HOME || homedir()) {
	const lanes = [];
	const onVertex =
		(env.CLAUDE_CODE_USE_VERTEX === '1' || env.CLAUDE_CODE_USE_VERTEX === 'true') &&
		!!(env.ANTHROPIC_VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT);
	if (onVertex) {
		lanes.push({
			id: 'vertex',
			provider: 'claude',
			transport: 'vertex',
			reason: 'Vertex AI, authenticated by the runtime service account (no key to rotate)',
			credentialed: true,
			env: {},
		});
	}
	if (env.ANTHROPIC_API_KEY) {
		lanes.push({
			id: 'anthropic-key',
			provider: 'claude',
			transport: 'api-key',
			reason: 'ANTHROPIC_API_KEY present',
			credentialed: true,
			env: { CLAUDE_CODE_USE_VERTEX: null, ANTHROPIC_BASE_URL: null },
		});
	}
	const gateway = gatewayLane(env);
	if (gateway) lanes.push(gateway);
	if (env.CLAUDE_CODE_OAUTH_TOKEN) {
		lanes.push({
			id: 'anthropic-oauth-token',
			provider: 'claude',
			transport: 'api-key',
			reason: 'CLAUDE_CODE_OAUTH_TOKEN present',
			credentialed: true,
			env: { CLAUDE_CODE_USE_VERTEX: null, ANTHROPIC_BASE_URL: null },
		});
	}
	if (existsSync(join(home, '.claude', '.credentials.json'))) {
		lanes.push({
			id: 'anthropic-login',
			provider: 'claude',
			transport: 'oauth-login',
			reason: 'claude CLI holds an interactive login',
			credentialed: true,
			env: {},
		});
	}
	if (env.OPENAI_API_KEY) {
		lanes.push({
			id: 'openai-key',
			provider: 'codex',
			transport: 'api-key',
			reason: 'OPENAI_API_KEY present',
			credentialed: true,
			env: {},
		});
	}
	return lanes;
}

/**
 * The Anthropic-compatible gateway lane, or null when none is configured.
 *
 * `claude` speaks one wire format and reads its endpoint from ANTHROPIC_BASE_URL,
 * so any service that serves `/v1/messages` is a usable lane for the same agentic
 * CLI the adapter already spawns. That keeps the task lifecycle intact, which a
 * one-shot completion responder would break.
 *
 * Deliberately opt-in: unlike Vertex it bills a third-party account per token, so
 * it must be a decision an operator made, never something the host picks up from
 * an unrelated key that happened to be on the service.
 */
function gatewayLane(env) {
	const base = (env.OKX_BOT_ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, '');
	const token = (env.OKX_BOT_ANTHROPIC_AUTH_TOKEN || '').trim();
	if (!base || !token) return null;
	const model = (env.OKX_BOT_ANTHROPIC_MODEL || '').trim();
	let label = base;
	try {
		label = new URL(base).host;
	} catch {
		/* a malformed base URL still names itself in the reason */
	}
	return {
		id: 'anthropic-gateway',
		provider: 'claude',
		transport: 'gateway',
		reason: `Anthropic-compatible gateway at ${label}${model ? ` (${model})` : ''}`,
		credentialed: true,
		env: {
			CLAUDE_CODE_USE_VERTEX: null,
			ANTHROPIC_BASE_URL: base,
			ANTHROPIC_AUTH_TOKEN: token,
			ANTHROPIC_API_KEY: null,
			...(model ? { ANTHROPIC_MODEL: model, ANTHROPIC_SMALL_FAST_MODEL: model } : {}),
		},
	};
}

/**
 * Narrow the chain to what an explicit pin allows.
 *
 * A pin names a provider CLI, not a lane, so `OKX_BOT_AI_PROVIDER=claude` keeps
 * every Anthropic lane and drops codex. A pin naming a provider with no lane at
 * all still returns an honest, uncredentialed single entry rather than silently
 * electing something the operator did not ask for.
 */
export function pinnedLanes(lanes, pinned) {
	if (!pinned) return lanes;
	const kept = lanes.filter((l) => l.provider === pinned);
	if (kept.length) return kept.map((l) => ({ ...l, reason: `pinned by OKX_BOT_AI_PROVIDER (${l.reason})` }));
	const external = pinned !== 'claude' && pinned !== 'codex';
	return [
		{
			id: `${pinned}-pinned`,
			provider: pinned,
			transport: external ? 'external' : 'none',
			reason: external
				? 'pinned by OKX_BOT_AI_PROVIDER (provider supplies its own auth)'
				: `pinned by OKX_BOT_AI_PROVIDER (no ${pinned === 'claude' ? 'Anthropic' : 'OpenAI'} credential)`,
			env: {},
			credentialed: external,
		},
	];
}

/**
 * Resolve the whole chain: the lanes to try, in order, and which one leads.
 *
 * `credentialed` on a lane only answers "is a credential configured". Whether it
 * still WORKS is a different question, and on this project the two answers have
 * differed in both directions: the GCP project's Vertex access and the OpenAI key
 * are each present and each refuse to serve. electProvider() in provider.js asks
 * each lane's own API, and its verdict is what readiness is judged on.
 *
 * The adapter does NOT read a reply out of the CLI's stdout: the spawned AI
 * subsession sends the reply itself through the `okx-a2a` CLI and drives the task
 * lifecycle (accept / negotiate / deliver). So every lane must spawn a genuinely
 * agentic CLI with tool access, never a one-shot completion call.
 *
 * @returns {{ lanes: Array<object>, head: object }}
 */
export function resolveProviderChain(env = process.env, home = env.OKX_BOT_HOME || homedir()) {
	const pinned = (env.OKX_BOT_AI_PROVIDER || '').trim().toLowerCase();
	const lanes = pinnedLanes(providerLanes(env, home), pinned);
	if (lanes.length) return { lanes, head: lanes[0] };
	return {
		lanes: [],
		head: {
			id: 'none',
			provider: 'claude',
			transport: 'none',
			reason: 'no AI-provider credential found, chat replies will fail until one is set',
			env: {},
			credentialed: false,
		},
	};
}

export function resolveHost(env = process.env) {
	if (env.K_SERVICE) {
		return { label: `cloudrun:${env.K_SERVICE}${env.K_REVISION ? ` (${env.K_REVISION})` : ''}`, durable: true };
	}
	const explicit = (env.OKX_BOT_HOST_LABEL || '').trim();
	if (explicit) return { label: explicit, durable: env.OKX_BOT_HOST_DURABLE === '1' };
	if (env.CODESPACE_NAME) return { label: `codespace:${env.CODESPACE_NAME}`, durable: false };
	return { label: `local:${hostname()}`, durable: false };
}

/**
 * Point the config at one lane of the chain.
 *
 * Every consumer (the heartbeat, the health body, cliEnv) reads the flat
 * `provider*` fields, so electing a lane is one mutation here rather than a
 * plumbing change in five files. Called at boot with the head of the chain and
 * again whenever a probe elects a different one.
 *
 * @param {ReturnType<loadConfig>} cfg
 * @param {{ id: string, provider: string, transport: string, reason: string, env: object }} lane
 */
export function applyLane(cfg, lane) {
	cfg.activeLane = lane;
	cfg.provider = lane.provider;
	cfg.providerTransport = lane.transport;
	cfg.providerReason = lane.reason;
	cfg.providerCredentialed = lane.credentialed === true;
	return cfg;
}

export function loadConfig(env = process.env) {
	const home = env.OKX_BOT_HOME || homedir();
	const chain = resolveProviderChain(env, home);
	const host = resolveHost(env);
	return {
		// HOME for both CLIs. Everything durable lands under it:
		//   $home/.okx-agent-task/  daemon state, sqlite, XMTP db, AI workspace
		//   $home/.onchainos/       wallet keyring, session, machine identity
		home,
		port: num(env.PORT, 0),

		agentId: env.OKX_BOT_AGENT_ID || '2632',

		// The XMTP daemon binary the supervisor owns. Overridable so a host that
		// installed it under a different name (or a test that needs a spawn to
		// fail) does not have to patch the supervisor.
		daemonBin: env.OKX_BOT_DAEMON_BIN || 'okx-a2a',

		// Durable state. Cloud Run's filesystem is in-memory and dies with the
		// revision, so the tree above is tarred to GCS and restored on boot.
		// Unset bucket = ephemeral mode (local dev, or a host with a real disk).
		stateBucket: (env.OKX_BOT_STATE_BUCKET || '').trim(),
		stateObject: env.OKX_BOT_STATE_OBJECT || 'okx-chat-bot/state.tar.gz',

		// The lanes this host may authenticate through, best first, and the one it
		// is currently using. A single-rung chain is what left the host sitting on
		// a dead Vertex credential for days; see providerLanes().
		chain: chain.lanes,
		activeLane: chain.head,
		provider: chain.head.provider,
		providerTransport: chain.head.transport,
		providerReason: chain.head.reason,
		providerCredentialed: chain.head.credentialed === true,

		// How often the provider's own API is asked whether the credential still
		// works. A configured credential is not a working one: on this project the
		// GCP billing hold and the OpenAI account both answer "denied" to a key
		// that is present and well-formed. Kept slow because it is a real call.
		providerProbeMs: num(env.OKX_BOT_PROVIDER_PROBE_MS, 15 * 60_000),

		// Where this process runs, and whether that place stays up on its own.
		// Reported on every beat so /api/healthz can tell a durable host from a
		// stopgap instead of calling both "online".
		host: host.label,
		hostDurable: host.durable,

		// Where the AI subsession's briefing and skills come from. Baked into the
		// image at /app; regenerated at boot so a redeploy always ships the live
		// catalog rather than whatever the last snapshot happened to contain.
		repoRoot: env.OKX_BOT_REPO_ROOT || '/app',

		heartbeatMs: num(env.OKX_BOT_HEARTBEAT_MS, 30_000),
		sessionProbeMs: num(env.OKX_BOT_SESSION_PROBE_MS, 60_000),
		snapshotMs: num(env.OKX_BOT_SNAPSHOT_MS, 5 * 60_000),
		// A logged-out session needs a human. Alert on the transition, then at most
		// this often while it stays out, so one OTP expiry doesn't page all night.
		alertRepeatMs: num(env.OKX_BOT_ALERT_REPEAT_MS, 6 * 60 * 60_000),
		// Restart backoff for the daemon child, capped.
		restartBaseMs: num(env.OKX_BOT_RESTART_BASE_MS, 2_000),
		restartMaxMs: num(env.OKX_BOT_RESTART_MAX_MS, 60_000),
	};
}

export function paths(cfg) {
	const agentTask = join(cfg.home, '.okx-agent-task');
	return {
		agentTask,
		onchainos: join(cfg.home, '.onchainos'),
		workspace: join(agentTask, 'workspace'),
		skills: join(agentTask, 'workspace', '.claude', 'skills'),
		logs: join(agentTask, 'logs'),
		lock: join(agentTask, 'run', 'daemon.lock'),
	};
}
