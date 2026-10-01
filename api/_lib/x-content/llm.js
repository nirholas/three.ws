// The model chain both editorial jobs run on: drafting a post from an evidence
// brief, and reviewing one before it ships.
//
// Order is cost and quality, strongest first: Claude on Vertex AI (Google
// credits, the standing approval in the operating rules), gpt-oss-120b on Groq
// (funded, fast, text-only), Claude through OpenRouter, OpenAI, then Kimi K3 on
// NVIDIA NIM (free, multimodal, slow). A rung with no credentials is skipped; a
// rung that errors, or that answers with something the caller cannot parse,
// falls through to the next one. Falling through on a parse failure is
// deliberate: a model that returns prose where JSON was asked for has failed the
// call, and the next rung usually will not.
//
// The Groq rung is text-only: it skips any request that carries an image, so a
// review that must see its media never gets an image-blind verdict from it and
// falls to a multimodal rung (Vertex or NVIDIA) instead. It still serves the
// drafting job, whose brief is text, which is why it sits high: when the paid
// multimodal rungs are unfunded, drafting stays fast and reliable on it while
// review still routes to NVIDIA.

export const EDITOR_MODEL = 'claude-opus-5';

async function viaVertex({ system, parts }) {
	const { vertexClaudeConfigured, vertexAnthropicMessages } = await import('../vertex-claude.js');
	if (!vertexClaudeConfigured()) return null;
	const content = parts.map((part) => (part.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } } : { type: 'text', text: part.text }));
	const response = await vertexAnthropicMessages({ model: EDITOR_MODEL, max_tokens: 6000, system, messages: [{ role: 'user', content }] });
	if (!response.ok) throw new Error(`Vertex ${response.status}: ${(await response.text()).slice(0, 200)}`);
	const body = await response.json();
	return { model: `vertex:${EDITOR_MODEL}`, text: body.content.filter((block) => block.type === 'text').map((block) => block.text).join('') };
}

// One rung, one model. A dropped connection, a 5xx, or a plain rate limit is
// the provider having a bad minute, and while every paid rung is out of
// billing the free one is the only editor left, so it is worth another try.
// A refusal about billing or credentials would only repeat, so it falls
// through to the next rung at once.
export const RUNG_ATTEMPTS = 3;
export const RUNG_RETRY_MS = 4000;
// The answer budget the reasoning rung asks for. Kimi K3 spends part of it
// thinking before it writes, and with no limit sent the provider's default ran
// out mid-thought: the reply came back with no content at all and the review
// failed as if no model had answered. This leaves room for both. Only that rung
// sends it: Groq counts a requested budget against its per-minute token limit,
// and OpenAI's reasoning models refuse the parameter outright.
export const RUNG_MAX_TOKENS = 16_000;

export function isRetryable({ status = null, body = '', networkError = false } = {}) {
	if (networkError) return true;
	if (status >= 500) return true;
	return status === 429 && !/billing|credit|quota|insufficient|not active/i.test(String(body));
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function viaChatCompletions({ system, parts }, { url, key, model, label, extraHeaders = {}, textOnly = false, fetchImpl = fetch, attempts = RUNG_ATTEMPTS, retryMs = RUNG_RETRY_MS, maxTokens = null }) {
	if (!key) return null;
	if (textOnly && parts.some((part) => part.type === 'image')) return null;
	const content = parts.map((part) => (part.type === 'image' ? { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } } : { type: 'text', text: part.text }));
	const body = JSON.stringify({ model, ...(maxTokens ? { max_tokens: maxTokens } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content }] });
	for (let attempt = 1; ; attempt++) {
		let response;
		try {
			response = await fetchImpl(url, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extraHeaders },
				body,
				signal: AbortSignal.timeout(600_000),
			});
		} catch (err) {
			if (attempt < attempts && isRetryable({ networkError: true })) {
				await pause(retryMs * attempt);
				continue;
			}
			throw new Error(`${label} ${err?.message || err}${attempt > 1 ? ` (after ${attempt} tries)` : ''}`);
		}
		if (response.ok) {
			const parsed = await response.json();
			const choice = parsed.choices?.[0];
			const text = choice?.message?.content || '';
			if (text.trim()) return { model: `${label}:${model}`, text };
			// An empty reply is the model running out of room or having a bad
			// minute, not an answer, so it is tried again like a dropped call.
			if (attempt < attempts) {
				await pause(retryMs * attempt);
				continue;
			}
			throw new Error(`${label} returned an empty reply${choice?.finish_reason ? ` (finish_reason ${choice.finish_reason})` : ''} after ${attempt} tries`);
		}
		const text = (await response.text()).slice(0, 200);
		if (attempt < attempts && isRetryable({ status: response.status, body: text })) {
			await pause(retryMs * attempt);
			continue;
		}
		throw new Error(`${label} ${response.status}: ${text}${attempt > 1 ? ` (after ${attempt} tries)` : ''}`);
	}
}

// Exported for tests: one chat-completions rung with an injected fetch.
export const chatCompletionsRung = viaChatCompletions;

export function modelRungs(request, env = process.env) {
	return [
		() => viaVertex(request),
		() => viaChatCompletions(request, { url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: 'openai/gpt-oss-120b', label: 'groq', textOnly: true }),
		() => viaChatCompletions(request, { url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: `anthropic/${EDITOR_MODEL}`, label: 'openrouter', extraHeaders: { 'http-referer': 'https://three.ws', 'x-title': 'three.ws editorial review' } }),
		() => viaChatCompletions(request, { url: 'https://api.openai.com/v1/chat/completions', key: env.OPENAI_API_KEY, model: 'gpt-5.5-pro', label: 'openai' }),
		() => viaChatCompletions(request, { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: env.NVIDIA_API_KEY, model: 'moonshotai/kimi-k3', label: 'nvidia', maxTokens: RUNG_MAX_TOKENS }),
	];
}

// `parse` turns a rung's raw text into the caller's shape and may throw to
// reject that rung. The parsed value comes back with the model that produced it
// and the failures of every rung above it.
export async function callModelChain(request, { env = process.env, parse = (text) => text } = {}) {
	const failures = [];
	for (const rung of modelRungs(request, env)) {
		try {
			const result = await rung();
			if (!result) continue;
			return { value: parse(result.text), model: result.model, fallbacks: failures };
		} catch (err) {
			failures.push(err.message);
		}
	}
	throw new Error(`no model was reachable:\n  ${failures.join('\n  ') || 'no credentials for Vertex, OpenRouter, OpenAI, or NVIDIA'}`);
}
