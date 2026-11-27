// What a Forge endpoint answers when a provider fails while starting a job.
//
// A caught provider error carries the provider's own words: vendor names, task
// ids, internal hostnames, stack frames, sometimes a credential echoed back.
// Those belong in the server log, never in a response body, because the body
// reaches every direct API caller (MCP tools, SDKs, the ChatGPT surface), not
// only the Forge page that already ignores `message`.
//
// forgeFailureBody() returns our own copy plus a short `ref`, and logs the raw
// failure (credential shapes scrubbed) under that same ref, so a user who
// quotes the reference to support leads an operator to the exact log line.
// The page's copy map (src/forge-errors.js) shows `ref` as the reference.

import { randomBytes } from 'node:crypto';
import { scrubSecret } from './forge-byok-guard.js';

export const FORGE_FAILURE_COPY = Object.freeze({
	invalid_key: 'The provider rejected the API key you added. Check the key and paste it again, or switch to a free engine.',
	insufficient_credits: 'Your account with this provider is out of credits. Top it up with the provider, or switch to a free engine.',
	generation_failed: 'The generator could not start this job. Try again, and if it fails twice contact support with the reference.',
	rig_failed: 'The rigger could not start this job. Your model is unchanged. Try again in a moment.',
});

/**
 * @param {keyof typeof FORGE_FAILURE_COPY} code
 * @param {unknown} err the caught error, logged and never returned
 * @param {string} [where] a short label for the log line
 * @returns {{ error: string, message: string, ref: string }}
 */
export function forgeFailureBody(code, err, where = 'forge') {
	const ref = randomBytes(6).toString('hex');
	const raw = err instanceof Error ? err.message : String(err ?? '');
	console.error(`[${where}] ${code} ref=${ref}: ${scrubSecret(raw, null)}`);
	return { error: code, message: FORGE_FAILURE_COPY[code], ref };
}
