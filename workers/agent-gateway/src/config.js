// Worker configuration, read once at boot from the environment. Every knob has
// a production default, so the Cloud Run service needs only credentials.

function int(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
	const raw = env[name];
	if (raw == null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
	return Math.min(max, Math.max(min, Math.floor(n)));
}

function list(env, name) {
	const raw = String(env[name] || '').trim();
	return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null;
}

/**
 * @typedef {object} GatewayConfig
 * @property {number} port            health endpoint port (Cloud Run injects PORT)
 * @property {number} concurrency     inbox rows processed at once (one per chat)
 * @property {number} pollMs          idle wait between claims when the inbox is empty
 * @property {number} leaseSeconds    how long a claimed row is held before another worker may take it
 * @property {number} maxAttempts     attempts before a row is dead-lettered
 * @property {number} backoffBaseMs   first retry delay; doubles per attempt
 * @property {number} backoffMaxMs    ceiling on a single retry delay
 * @property {number} turnTimeoutMs   a row still running after this is failed and its lease released
 * @property {number} sweepMs         preview expiry sweep and inbox prune interval
 * @property {number} pruneKeepDays   finished rows older than this are deleted
 * @property {number} shutdownGraceMs how long SIGTERM waits for in-flight rows
 * @property {string[]|null} platforms   restrict the adapters that load (default: every configured one)
 * @property {string[]|null} chatKeys    drain only these chats (debugging one chat)
 * @property {boolean} telegramPolling   pull Telegram updates with getUpdates instead of the webhook (local development)
 * @property {boolean} discordGateway    hold a Discord gateway connection for DMs and mentions
 */

/** @returns {GatewayConfig} */
export function loadConfig(env = process.env) {
	return {
		port: int(env, 'PORT', 8080, { min: 1, max: 65535 }),
		concurrency: int(env, 'GATEWAY_CONCURRENCY', 8, { min: 1, max: 64 }),
		pollMs: int(env, 'GATEWAY_POLL_MS', 1500, { min: 100 }),
		leaseSeconds: int(env, 'GATEWAY_LEASE_SECONDS', 90, { min: 15 }),
		maxAttempts: int(env, 'GATEWAY_MAX_ATTEMPTS', 5, { min: 1, max: 20 }),
		backoffBaseMs: int(env, 'GATEWAY_BACKOFF_BASE_MS', 5000, { min: 0 }),
		backoffMaxMs: int(env, 'GATEWAY_BACKOFF_MAX_MS', 300_000, { min: 0 }),
		turnTimeoutMs: int(env, 'GATEWAY_TURN_TIMEOUT_MS', 300_000, { min: 1000 }),
		sweepMs: int(env, 'GATEWAY_SWEEP_MS', 60_000, { min: 1000 }),
		pruneKeepDays: int(env, 'GATEWAY_PRUNE_KEEP_DAYS', 7, { min: 1 }),
		shutdownGraceMs: int(env, 'GATEWAY_SHUTDOWN_GRACE_MS', 8000, { min: 0 }),
		platforms: list(env, 'GATEWAY_PLATFORMS'),
		chatKeys: list(env, 'GATEWAY_CHAT_KEYS'),
		telegramPolling: env.GATEWAY_TELEGRAM_POLLING === '1',
		discordGateway: env.GATEWAY_DISCORD_GATEWAY !== '0',
	};
}
