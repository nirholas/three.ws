// LLM provider abstraction. Calls go through a proxy URL by default —
// never ship API keys in the browser.

export class AnthropicProvider {
	constructor({
		model = 'claude-opus-4-6',
		proxyURL,
		apiKey,
		agentId,
		apiOrigin,
		temperature = 0.7,
		maxTokens = 4096,
		thinking = 'auto',
	} = {}) {
		this.model = model;
		this.apiKey = apiKey;
		this.temperature = temperature;
		this.maxTokens = maxTokens;
		this.thinking = thinking;

		// Priority: explicit proxyURL > direct key > we-pay fallback
		if (proxyURL) {
			this.proxyURL = proxyURL;
		} else if (!apiKey && agentId && apiOrigin) {
			this.proxyURL = `${apiOrigin}/api/llm/anthropic?agent=${encodeURIComponent(agentId)}`;
		} else {
			this.proxyURL = null;
		}
	}

	async complete({ system, messages, tools }) {
		const body = {
			model: this.model,
			max_tokens: this.maxTokens,
			temperature: this.temperature,
			system,
			messages,
		};
		if (tools && tools.length) body.tools = tools;
		if (this.thinking === 'always') {
			body.thinking = { type: 'enabled', budget_tokens: 2048 };
		}

		const url = this.proxyURL || 'https://api.anthropic.com/v1/messages';
		const headers = { 'content-type': 'application/json' };
		if (this.apiKey) {
			headers['x-api-key'] = this.apiKey;
			headers['anthropic-version'] = '2023-06-01';
			headers['anthropic-dangerous-direct-browser-access'] = 'true';
		}

		const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Anthropic ${res.status}: ${text}`);
		}
		const data = await res.json();
		return this._normalize(data);
	}

	_normalize(data) {
		// Convert Anthropic response shape into the runtime's common shape:
		// { text, toolCalls: [{ id, name, input }], stopReason }
		const out = { text: '', toolCalls: [], thinking: '', stopReason: data.stop_reason };
		for (const block of data.content || []) {
			if (block.type === 'text') out.text += block.text;
			else if (block.type === 'thinking') out.thinking += block.thinking || '';
			else if (block.type === 'tool_use') {
				out.toolCalls.push({ id: block.id, name: block.name, input: block.input });
			}
		}
		return out;
	}

	// Convert normalized tool results back into a user-role message
	formatToolResults(results) {
		return {
			role: 'user',
			content: results.map((r) => ({
				type: 'tool_result',
				tool_use_id: r.id,
				content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output),
				is_error: !!r.isError,
			})),
		};
	}

	formatAssistantWithToolCalls(text, toolCalls) {
		const content = [];
		if (text) content.push({ type: 'text', text });
		for (const c of toolCalls) {
			content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
		}
		return { role: 'assistant', content };
	}
}

export class NullProvider {
	// Used when brain.provider === "none" — skills drive the agent.
	async complete() {
		return { text: '', toolCalls: [], stopReason: 'end_turn' };
	}
	formatToolResults() {
		return { role: 'user', content: [] };
	}
	formatAssistantWithToolCalls(text) {
		return { role: 'assistant', content: text || '' };
	}
}

export function createProvider(config = {}) {
	const provider = config.provider || 'anthropic';
	if (provider === 'anthropic') return new AnthropicProvider(config);
	if (provider === 'none') return new NullProvider();
	throw new Error(`Unsupported provider: ${provider}. Supported: anthropic, none`);
}
