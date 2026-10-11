// CAD Forge program writer: the model ladder that writes build123d.
//
// The platform chain (api/_lib/llm.js) caps every rung at ~12 s so chat fails
// over fast. A complete parametric program is 2-4K tokens of exact Python and
// the models that write it well take 20-120 s, so CAD gets its own ladder, in
// the same shape as api/_lib/x-content/llm.js: strongest first, each rung with
// a timeout sized for code, a 429 retried once after a pause, and the general
// chain as the last rung so a write is never refused while anything answers.
//
// Order was set by a bake-off on 2026-10-09 against the real worker (six
// prompts that defeated the general chain): Kimi K3 built every design it was
// not rate limited on, mostly first try; Nemotron Super needed repair rounds
// but converges; GLM 5.3 returned no program within two minutes and is not
// used. All NIM rungs are free on the platform NVIDIA key.

import { llmComplete } from '../llm.js';
import { recordEvent } from '../usage.js';

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_TOKENS = 4_000;
const RETRY_PAUSE_MS = 3_000;

export const CAD_WRITER_MODEL_DEFAULT = 'moonshotai/kimi-k3';

export function writerRungs(env = process.env) {
	const rungs = [];
	if (env.NVIDIA_API_KEY) {
		rungs.push({ name: 'nvidia', url: NIM_URL, key: env.NVIDIA_API_KEY, model: env.CAD_WRITER_MODEL || CAD_WRITER_MODEL_DEFAULT, timeoutMs: 150_000 });
		rungs.push({ name: 'nvidia', url: NIM_URL, key: env.NVIDIA_API_KEY, model: 'nvidia/nemotron-3-super-120b-a12b', timeoutMs: 60_000 });
	}
	if (env.GROQ_API_KEY) {
		rungs.push({ name: 'groq', url: GROQ_URL, key: env.GROQ_API_KEY, model: 'openai/gpt-oss-120b', timeoutMs: 45_000 });
	}
	return rungs;
}

function isRetryable(status, body) {
	if (status >= 500) return true;
	return status === 429 && !/billing|credit|quota exceeded for|insufficient|not active/i.test(String(body));
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function callRung(rung, { system, user, deadline, fetchImpl }) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		const budget = Math.min(rung.timeoutMs, deadline - Date.now());
		if (budget < 5_000) return { error: 'budget exhausted' };
		const started = Date.now();
		let res;
		try {
			res = await fetchImpl(rung.url, {
				method: 'POST',
				headers: { authorization: `Bearer ${rung.key}`, 'content-type': 'application/json' },
				body: JSON.stringify({
					model: rung.model,
					max_tokens: MAX_TOKENS,
					temperature: 0.2,
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content: user },
					],
					...(rung.name === 'nvidia' ? { chat_template_kwargs: { enable_thinking: false, thinking: false } } : {}),
				}),
				signal: AbortSignal.timeout(Math.floor(budget)),
			});
		} catch (err) {
			return { error: `unreachable: ${err?.message}` };
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			if (attempt === 1 && isRetryable(res.status, body)) {
				await pause(RETRY_PAUSE_MS);
				continue;
			}
			return { error: `${res.status} ${body.slice(0, 160)}` };
		}
		const data = await res.json().catch(() => null);
		const text = data?.choices?.[0]?.message?.content;
		if (typeof text !== 'string' || !text.trim()) return { error: 'empty completion' };
		return {
			text,
			latencyMs: Date.now() - started,
			usage: { input: data?.usage?.prompt_tokens || 0, output: data?.usage?.completion_tokens || 0 },
		};
	}
	return { error: 'retries exhausted' };
}

/**
 * Write (or rewrite) a program. Returns { text, provider, model }. Throws the
 * general chain's error only when every rung, the general chain included, fails.
 */
export async function writeCad({ system, user, deadline = Date.now() + 180_000, track = {}, fetchImpl = fetch, env = process.env }) {
	const failures = [];
	for (const rung of writerRungs(env)) {
		const out = await callRung(rung, { system, user, deadline, fetchImpl });
		if (out.text) {
			recordEvent({
				kind: 'llm',
				provider: rung.name,
				model: rung.model,
				inputTokens: out.usage.input,
				outputTokens: out.usage.output,
				costMicroUsd: 0,
				latencyMs: out.latencyMs,
				userId: track.userId ?? null,
				tool: 'cad-forge',
			});
			return { text: out.text, provider: rung.name, model: rung.model };
		}
		failures.push(`${rung.model}: ${out.error}`);
	}
	if (failures.length) console.warn('[cad-writer] ladder exhausted, using the general chain:', failures.join(' | '));
	const remaining = deadline - Date.now();
	const completion = await llmComplete({
		system,
		user,
		maxTokens: MAX_TOKENS,
		timeoutMs: Math.max(20_000, remaining),
		track: { tool: 'cad-forge', ...track },
	});
	return { text: completion?.text || '', provider: completion?.provider || null, model: completion?.model || null };
}
