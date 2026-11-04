// Config for the HQ MCP. The only knobs are which HQ deployment to read and
// how long to wait. Read-only: no key, no signer, no payment.

export function env(key, fallback) {
	const v = process.env[key];
	return v !== undefined && String(v).trim() !== '' ? String(v).trim() : fallback;
}

/** Origin of the HQ deployment serving /api/agent-tools. Required at call time, not at import. */
export function hqBase() {
	const raw = env('HQ_BASE');
	if (!raw) {
		throw Object.assign(
			new Error('HQ_BASE is not set. Point it at your HQ deployment origin, for example HQ_BASE=https://hq.example.com.'),
			{ code: 'not_configured' },
		);
	}
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw Object.assign(new Error(`HQ_BASE is not a valid URL: ${raw}`), { code: 'bad_config' });
	}
	return url.origin;
}

export const HTTP_TIMEOUT_MS = (() => {
	const raw = env('HQ_TIMEOUT_MS');
	if (raw === undefined) return 25000;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw Object.assign(new Error(`HQ_TIMEOUT_MS must be a positive number (got "${raw}")`), { code: 'bad_config' });
	}
	return n;
})();

export const USER_AGENT = '@three-ws/hq-mcp';
