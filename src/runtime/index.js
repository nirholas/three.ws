// Runtime — wires LLM + tool dispatch + speech + memory into a single agent brain.
// Replaces the pattern-matched chatbot stub in avaturn-agent.js.

import { createProvider } from './providers.js';
import { createTTS, createSTT } from './speech.js';
import { BUILTIN_TOOLS, BUILTIN_HANDLERS } from './tools.js';

const MAX_TOOL_ITERATIONS = 8;

export class Runtime extends EventTarget {
	constructor({ manifest, viewer, memory, skills, providerConfig = {}, voiceConfig = {} } = {}) {
		super();
		this.manifest = manifest || {};
		this.viewer = viewer;
		this.memory = memory;
		this.skills = skills;

		this.provider = createProvider({
			...this.manifest.brain,
			...providerConfig,
		});
		this.tts = createTTS({ ...(this.manifest.voice?.tts), ...voiceConfig.tts });
		this.stt = createSTT({ ...(this.manifest.voice?.stt), ...voiceConfig.stt });

		this.messages = [];
		this._busy = false;
	}

	get systemPrompt() {
		const parts = [];
		if (this.manifest.instructions) parts.push(this.manifest.instructions);
		if (this.memory) {
			parts.push('\n\n<memory>\n' + this.memory.contextBlock({
				maxTokens: this.manifest.memory?.maxTokens || 8192,
			}) + '\n</memory>');
		}
		if (this.skills) parts.push(this.skills.systemPrompt());
		return parts.join('');
	}

	get tools() {
		const builtinNames = new Set(this.manifest.tools || BUILTIN_TOOLS.map((t) => t.name));
		const builtins = BUILTIN_TOOLS.filter((t) => builtinNames.has(t.name));
		const skillTools = this.skills ? this.skills.allTools() : [];
		return [...builtins, ...skillTools];
	}

	async send(userText, { voice = false } = {}) {
		if (this._busy) {
			throw new Error('Runtime busy — wait for current turn to finish');
		}
		this._busy = true;
		try {
			this.memory?.note('user_said', { text: userText });
			this.messages.push({ role: 'user', content: userText });
			this.dispatchEvent(new CustomEvent('brain:message', {
				detail: { role: 'user', content: userText },
			}));

			const reply = await this._loop();

			if (voice && reply.text && this.tts) {
				this.dispatchEvent(new CustomEvent('voice:speech-start', { detail: { text: reply.text } }));
				await this.tts.speak(reply.text);
				this.dispatchEvent(new CustomEvent('voice:speech-end', {}));
			}

			return reply;
		} finally {
			this._busy = false;
		}
	}

	async _loop() {
		let iter = 0;
		let finalText = '';

		while (iter++ < MAX_TOOL_ITERATIONS) {
			const response = await this.provider.complete({
				system: this.systemPrompt,
				messages: this.messages,
				tools: this.tools,
			});

			if (response.thinking) {
				this.dispatchEvent(new CustomEvent('brain:thinking', { detail: { content: response.thinking } }));
			}

			if (!response.toolCalls.length) {
				finalText = response.text;
				this.messages.push({ role: 'assistant', content: response.text });
				this.dispatchEvent(new CustomEvent('brain:message', {
					detail: { role: 'assistant', content: response.text },
				}));
				break;
			}

			// Record assistant turn with tool calls
			this.messages.push(
				this.provider.formatAssistantWithToolCalls(response.text, response.toolCalls),
			);
			if (response.text) {
				this.dispatchEvent(new CustomEvent('brain:message', {
					detail: { role: 'assistant', content: response.text },
				}));
			}

			// Dispatch each tool call
			const results = [];
			for (const call of response.toolCalls) {
				let output, isError = false;
				try {
					output = await this._dispatchTool(call);
				} catch (err) {
					output = { error: err.message || String(err) };
					isError = true;
				}
				this.dispatchEvent(new CustomEvent('skill:tool-called', {
					detail: { tool: call.name, args: call.input, result: output },
				}));
				results.push({ id: call.id, output, isError });
			}
			this.messages.push(this.provider.formatToolResults(results));
		}

		return { text: finalText };
	}

	async _dispatchTool(call) {
		const ctx = this._context();

		// Skill-provided tools first (they can shadow built-ins intentionally)
		const skill = this.skills?.findSkillForTool(call.name);
		if (skill) return skill.invoke(call.name, call.input, ctx);

		// Built-in
		const handler = BUILTIN_HANDLERS[call.name];
		if (!handler) throw new Error(`Unknown tool: ${call.name}`);
		return handler(call.input, ctx);
	}

	_context() {
		const skills = this.skills;
		return {
			viewer: this.viewer,
			memory: this.memory,
			llm: {
				complete: (prompt, opts) => this.provider.complete({
					system: opts?.system || '',
					messages: [{ role: 'user', content: prompt }],
					tools: opts?.tools,
				}),
			},
			speak: async (text) => {
				if (!this.tts) return;
				this.dispatchEvent(new CustomEvent('voice:speech-start', { detail: { text } }));
				await this.tts.speak(text);
				this.dispatchEvent(new CustomEvent('voice:speech-end', {}));
			},
			listen: (opts) => this.stt?.listen(opts),
			fetch: (url, opts) => fetch(url, opts),
			loadGLB: async (uri) => {
				// Delegates to viewer's loader. Actual wiring in element.js binds this.
				return this.viewer.loadGLB?.(uri);
			},
			loadClip: async (uri) => this.viewer.loadClip?.(uri),
			loadJSON: async (uri) => (await fetch(uri)).json(),
			call: async (toolName, args) => this._dispatchTool({ name: toolName, input: args }),
		};
	}

	async listen({ onInterim, onFinal } = {}) {
		if (!this.stt) throw new Error('STT not configured');
		this.dispatchEvent(new CustomEvent('voice:listen-start', {}));
		const text = await this.stt.listen({
			onInterim: (t) => {
				this.dispatchEvent(new CustomEvent('voice:transcript', { detail: { text: t, final: false } }));
				onInterim?.(t);
			},
			onFinal: (t) => {
				this.dispatchEvent(new CustomEvent('voice:transcript', { detail: { text: t, final: true } }));
				onFinal?.(t);
			},
		});
		return text;
	}

	clearConversation() {
		this.messages = [];
	}

	pause() { this.tts?.cancel(); this.stt?.stop(); }
	destroy() { this.pause(); this.messages = []; }
}
