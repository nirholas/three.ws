// Refuse to start a second OKX chat-bot daemon while another host is already
// serving agent #2632.
//
// The bot's whole identity (the onchainos wallet keyring plus the XMTP client
// database) is ONE state object with exactly one writer, which is why the Cloud
// Run service is pinned to --max-instances=1. A local revive started while that
// service is up puts a second daemon on the same inbox and a second writer on
// the same identity, and recovering a torn identity costs a human email OTP.
//
// The read is deliberately credential-free: /api/healthz already turns the
// bot's heartbeat row into the `okx_chat_bot` subsystem, so this works from a
// fresh clone with no DATABASE_URL, no gcloud login, and no secrets. That
// matters because the machine most likely to run a revive by mistake is the one
// with the least set up.

/** Public health endpoint carrying the okx_chat_bot subsystem. */
export const DEFAULT_HEALTHZ_URL = 'https://three.ws/api/healthz';

/**
 * Decide whether a local daemon may be started.
 *
 * Fail-open on ignorance, fail-closed on evidence: an unreachable endpoint must
 * never block the emergency revive (the case where everything is down is
 * exactly when this script is needed), but a host we can SEE beating must.
 *
 * @param {{ status?: string, detail?: string, host?: string|null, hostDurable?: boolean|null }|null} subsystem
 *   The `okx_chat_bot` entry from /api/healthz, or null when it could not be read.
 * @param {{ localHost?: string|null, reachable?: boolean }} [opts]
 * @returns {{ blocked: boolean, code: string, detail: string, host: string|null }}
 */
export function classifyLocalRevive(subsystem, { localHost = null, reachable = true } = {}) {
	if (!reachable || !subsystem) {
		return {
			blocked: false,
			code: 'unreadable',
			detail: 'could not read the platform health endpoint, so no remote host could be ruled out',
			host: null,
		};
	}
	const status = String(subsystem.status || 'unknown');
	const detail = String(subsystem.detail || '');
	const host = typeof subsystem.host === 'string' && subsystem.host ? subsystem.host : null;

	// Nothing has ever hosted this bot. This is the one "no host" verdict the
	// endpoint states positively, so it is the only one read as an all-clear.
	if (status === 'unknown' && /no heartbeat reported yet/.test(detail)) {
		return { blocked: false, code: 'never_hosted', detail: 'no host has ever reported a heartbeat', host: null };
	}
	// The host stopped beating. This is the emergency the local path exists for.
	if (status === 'down' && /^heartbeat /.test(detail)) {
		return { blocked: false, code: 'host_gone', detail: detail || 'the host stopped beating', host };
	}
	// Re-staging the workspace on the machine that is already the host is the
	// intended use: same daemon, same identity, one writer.
	if (host && localHost && host === localHost) {
		return { blocked: false, code: 'self', detail: `this machine (${host}) is the beating host`, host };
	}
	// A beat with no host named is still a beat. Not knowing WHICH machine is
	// serving chat is not a licence to add a second one, and this branch is not
	// hypothetical: an API build older than the `host` field reports exactly
	// this, and reading it as an all-clear started a rival daemon on 2026-09-09.
	if (!host) {
		return {
			blocked: true,
			code: 'unnamed_host_beating',
			detail: `the bot reports ${status}, so a host is serving agent #2632, but the health endpoint does not name it`,
			host: null,
		};
	}
	return {
		blocked: true,
		code: subsystem.hostDurable === false ? 'stopgap_host_beating' : 'durable_host_beating',
		detail: `${host} is serving agent #2632 right now (${status})`,
		host,
	};
}

/**
 * Read the okx_chat_bot subsystem from the public health endpoint.
 *
 * Never throws: every failure is reported as unreachable, and the caller turns
 * that into a warning rather than a refusal.
 *
 * @param {{ url?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ reachable: boolean, subsystem: object|null, error: string|null }>}
 */
export async function fetchOkxBotSubsystem({
	url = process.env.OKX_BOT_HEALTHZ_URL || DEFAULT_HEALTHZ_URL,
	timeoutMs = 10_000,
	fetchImpl = fetch,
} = {}) {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json' } });
		if (!res.ok) return { reachable: false, subsystem: null, error: `HTTP ${res.status}` };
		const body = await res.json();
		const list = body?.subsystems?.subsystems;
		if (!Array.isArray(list)) return { reachable: false, subsystem: null, error: 'no subsystem list in the response' };
		const found = list.find((s) => s?.name === 'okx_chat_bot') || null;
		return { reachable: true, subsystem: found, error: found ? null : 'okx_chat_bot not reported' };
	} catch (err) {
		return { reachable: false, subsystem: null, error: err?.message || String(err) };
	} finally {
		clearTimeout(timer);
	}
}
