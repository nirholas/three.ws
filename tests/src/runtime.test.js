import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Runtime } from '../../src/runtime/index.js';
import { NullProvider } from '../../src/runtime/providers.js';
import { BUILTIN_HANDLERS } from '../../src/runtime/tools.js';

// Disable voice in all Runtime instances — avoids BrowserTTS/BrowserSTT in tests
const NO_VOICE = { tts: { provider: 'none' }, stt: { provider: 'none' } };

// ── Mock provider factory ─────────────────────────────────────────────────────

function mockProvider(responses) {
	let idx = 0;
	return {
		complete: vi.fn(() => {
			const r = responses[idx < responses.length ? idx++ : responses.length - 1];
			return Promise.resolve(r);
		}),
		formatAssistantWithToolCalls(text, toolCalls) {
			const content = [];
			if (text) content.push({ type: 'text', text });
			for (const c of toolCalls)
				content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
			return { role: 'assistant', content };
		},
		formatToolResults(results) {
			return {
				role: 'user',
				content: results.map((r) => ({
					type: 'tool_result',
					tool_use_id: r.id,
					content: JSON.stringify(r.output),
					is_error: !!r.isError,
				})),
			};
		},
	};
}

// Shorthand response shapes
const textResp = (text) => ({ text, toolCalls: [], thinking: '', stopReason: 'end_turn' });
const toolResp = (name, input = {}, id = 'call_1') => ({
	text: '',
	toolCalls: [{ id, name, input }],
	thinking: '',
	stopReason: 'tool_use',
});

// Build a Runtime with a mock provider and optional overrides
function makeRuntime(provider, { viewer = null, memory = null, skills = null, manifest = {} } = {}) {
	const rt = new Runtime({
		manifest,
		viewer,
		memory,
		skills,
		providerConfig: { provider: 'none' },
		voiceConfig: NO_VOICE,
	});
	rt.provider = provider;
	return rt;
}

// Collect CustomEvent detail objects from a Runtime EventTarget
function collect(runtime, eventName) {
	const events = [];
	runtime.addEventListener(eventName, (e) => events.push(e.detail));
	return events;
}

// ── NullProvider ──────────────────────────────────────────────────────────────

describe('NullProvider', () => {
	it('complete() resolves immediately without making HTTP calls', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const p = new NullProvider();
		const result = await p.complete({ system: '', messages: [], tools: [] });
		expect(result.text).toBe('');
		expect(result.toolCalls).toEqual([]);
		expect(result.stopReason).toBe('end_turn');
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});

// ── Text response flow ────────────────────────────────────────────────────────

describe('Runtime — text response', () => {
	it('calls provider.complete with user message and returns final text', async () => {
		const provider = mockProvider([textResp('Hello world')]);
		const rt = makeRuntime(provider);
		const result = await rt.send('Hi');
		expect(provider.complete).toHaveBeenCalledOnce();
		expect(provider.complete.mock.calls[0][0].messages[0]).toMatchObject({
			role: 'user',
			content: 'Hi',
		});
		expect(result.text).toBe('Hello world');
	});

	it('emits brain:message for user turn then assistant turn', async () => {
		const provider = mockProvider([textResp('Hello world')]);
		const rt = makeRuntime(provider);
		const events = collect(rt, 'brain:message');
		await rt.send('Hi');
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({ role: 'user', content: 'Hi' });
		expect(events[1]).toMatchObject({ role: 'assistant', content: 'Hello world' });
	});

	it('appends both turns to runtime.messages', async () => {
		const provider = mockProvider([textResp('Reply')]);
		const rt = makeRuntime(provider);
		await rt.send('Hello');
		expect(rt.messages).toHaveLength(2);
		expect(rt.messages[0]).toMatchObject({ role: 'user', content: 'Hello' });
		expect(rt.messages[1]).toMatchObject({ role: 'assistant', content: 'Reply' });
	});
});

// ── Thinking ──────────────────────────────────────────────────────────────────

describe('Runtime — thinking events', () => {
	it('emits brain:thinking when provider returns thinking content', async () => {
		const provider = mockProvider([
			{ text: 'Answer', toolCalls: [], thinking: 'Reasoning here', stopReason: 'end_turn' },
		]);
		const rt = makeRuntime(provider);
		const events = collect(rt, 'brain:thinking');
		await rt.send('question');
		expect(events).toHaveLength(1);
		expect(events[0].content).toBe('Reasoning here');
	});

	it('does not emit brain:thinking when thinking is empty', async () => {
		const provider = mockProvider([textResp('answer')]);
		const rt = makeRuntime(provider);
		const events = collect(rt, 'brain:thinking');
		await rt.send('question');
		expect(events).toHaveLength(0);
	});
});

// ── Tool call dispatch ────────────────────────────────────────────────────────

describe('Runtime — tool dispatch', () => {
	it('calls the built-in handler when provider returns a tool call', async () => {
		const provider = mockProvider([toolResp('lookAt', { target: 'user' }), textResp('Done')]);
		const viewer = { lookAt: vi.fn() };
		const rt = makeRuntime(provider, { viewer });
		await rt.send('look at me');
		expect(viewer.lookAt).toHaveBeenCalledWith('user');
	});

	it('emits skill:tool-called after each tool execution', async () => {
		const provider = mockProvider([toolResp('lookAt', { target: 'camera' }), textResp('Done')]);
		const rt = makeRuntime(provider, { viewer: { lookAt: vi.fn() } });
		const events = collect(rt, 'skill:tool-called');
		await rt.send('look');
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ tool: 'lookAt', args: { target: 'camera' } });
	});

	it('sends tool results back to provider on the next complete() call', async () => {
		const provider = mockProvider([
			toolResp('lookAt', { target: 'user' }, 'call_abc'),
			textResp('Done'),
		]);
		const rt = makeRuntime(provider, { viewer: { lookAt: vi.fn() } });
		await rt.send('look');
		expect(provider.complete).toHaveBeenCalledTimes(2);
		const secondMessages = provider.complete.mock.calls[1][0].messages;
		const toolResultMsg = secondMessages.find(
			(m) => m.role === 'user' && Array.isArray(m.content),
		);
		expect(toolResultMsg).toBeDefined();
		expect(toolResultMsg.content[0].tool_use_id).toBe('call_abc');
	});

	it('skill-provided tool shadows built-in when skills.findSkillForTool returns a match', async () => {
		const provider = mockProvider([toolResp('wave', {}), textResp('Done')]);
		const skillInvoke = vi.fn().mockResolvedValue({ ok: true, from: 'skill' });
		const skills = {
			findSkillForTool: vi.fn().mockReturnValue({ invoke: skillInvoke }),
			allTools: () => [],
			systemPrompt: () => '',
		};
		const rt = makeRuntime(provider, { skills });
		await rt.send('wave');
		expect(skillInvoke).toHaveBeenCalledWith('wave', {}, expect.any(Object));
	});
});

// ── MAX_TOOL_ITERATIONS guard ─────────────────────────────────────────────────

describe('Runtime — MAX_TOOL_ITERATIONS', () => {
	it('exits the loop after 8 iterations even if provider keeps returning tool calls', async () => {
		const infiniteProvider = {
			complete: vi.fn(() => Promise.resolve(toolResp('lookAt', { target: 'user' }))),
			formatAssistantWithToolCalls(text, toolCalls) {
				return {
					role: 'assistant',
					content: toolCalls.map((c) => ({
						type: 'tool_use',
						id: c.id,
						name: c.name,
						input: c.input,
					})),
				};
			},
			formatToolResults(results) {
				return {
					role: 'user',
					content: results.map((r) => ({
						type: 'tool_result',
						tool_use_id: r.id,
						content: JSON.stringify(r.output),
					})),
				};
			},
		};
		const rt = makeRuntime(infiniteProvider, { viewer: { lookAt: vi.fn() } });
		const result = await rt.send('go');
		expect(infiniteProvider.complete).toHaveBeenCalledTimes(8);
		expect(result.text).toBe('');
	});
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('Runtime — tool error handling', () => {
	it('records isError and continues loop without throwing when tool is unknown', async () => {
		const provider = mockProvider([toolResp('nonexistent_tool', {}), textResp('Recovered')]);
		const rt = makeRuntime(provider);
		const toolEvents = collect(rt, 'skill:tool-called');
		const result = await rt.send('do something');
		expect(result.text).toBe('Recovered');
		expect(toolEvents[0].result).toMatchObject({ error: expect.stringContaining('Unknown tool') });
	});

	it('records isError when tool handler throws and still reaches final response', async () => {
		const provider = mockProvider([toolResp('lookAt', { target: 'user' }), textResp('OK')]);
		const viewer = {
			lookAt: vi.fn(() => {
				throw new Error('viewer not ready');
			}),
		};
		const rt = makeRuntime(provider, { viewer });
		const toolEvents = collect(rt, 'skill:tool-called');
		const result = await rt.send('look');
		expect(result.text).toBe('OK');
		expect(toolEvents[0].result).toMatchObject({ error: 'viewer not ready' });
	});
});

// ── Busy guard ────────────────────────────────────────────────────────────────

describe('Runtime — busy guard', () => {
	it('throws if send() is called while a turn is in progress', async () => {
		const provider = mockProvider([textResp('ok')]);
		const rt = makeRuntime(provider);
		const first = rt.send('first');
		await expect(rt.send('second')).rejects.toThrow('Runtime busy');
		await first;
	});

	it('clears busy flag after send() completes', async () => {
		const provider = mockProvider([textResp('ok'), textResp('ok2')]);
		const rt = makeRuntime(provider);
		await rt.send('first');
		await expect(rt.send('second')).resolves.toMatchObject({ text: 'ok2' });
	});
});

// ── BUILTIN_HANDLERS ──────────────────────────────────────────────────────────

describe('BUILTIN_HANDLERS.speak', () => {
	it('calls ctx.speak with the text and returns ok', async () => {
		const ctx = { speak: vi.fn().mockResolvedValue(undefined) };
		const result = await BUILTIN_HANDLERS.speak({ text: 'Hello there' }, ctx);
		expect(ctx.speak).toHaveBeenCalledWith('Hello there');
		expect(result).toEqual({ ok: true });
	});
});

describe('BUILTIN_HANDLERS.remember', () => {
	it('writes to ctx.memory and returns ok with the saved key', async () => {
		const ctx = { memory: { write: vi.fn() } };
		const args = {
			key: 'user_role',
			name: 'User role',
			description: 'What the user does',
			type: 'user',
			body: 'The user is a developer.',
		};
		const result = await BUILTIN_HANDLERS.remember(args, ctx);
		expect(ctx.memory.write).toHaveBeenCalledWith('user_role', {
			name: 'User role',
			description: 'What the user does',
			type: 'user',
			body: 'The user is a developer.',
		});
		expect(result).toEqual({ ok: true, saved: 'user_role' });
	});
});

describe('BUILTIN_HANDLERS.lookAt', () => {
	it('calls ctx.viewer.lookAt with the target and returns ok', async () => {
		const ctx = { viewer: { lookAt: vi.fn() } };
		const result = await BUILTIN_HANDLERS.lookAt({ target: 'camera' }, ctx);
		expect(ctx.viewer.lookAt).toHaveBeenCalledWith('camera');
		expect(result).toEqual({ ok: true, target: 'camera' });
	});

	it('defaults target to "user" when not provided', async () => {
		const ctx = { viewer: { lookAt: vi.fn() } };
		const result = await BUILTIN_HANDLERS.lookAt({}, ctx);
		expect(ctx.viewer.lookAt).toHaveBeenCalledWith('user');
		expect(result.target).toBe('user');
	});
});

describe('BUILTIN_HANDLERS.setExpression', () => {
	it('calls ctx.viewer.setExpression with preset and intensity', async () => {
		const ctx = { viewer: { setExpression: vi.fn() } };
		const result = await BUILTIN_HANDLERS.setExpression({ preset: 'happy', intensity: 0.8 }, ctx);
		expect(ctx.viewer.setExpression).toHaveBeenCalledWith('happy', 0.8);
		expect(result).toEqual({ ok: true, preset: 'happy' });
	});

	it('defaults intensity to 1 when not provided', async () => {
		const ctx = { viewer: { setExpression: vi.fn() } };
		await BUILTIN_HANDLERS.setExpression({ preset: 'sad' }, ctx);
		expect(ctx.viewer.setExpression).toHaveBeenCalledWith('sad', 1);
	});
});
