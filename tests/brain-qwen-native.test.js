// The Qwen Plus brain's native DashScope route must hand streamText a model the
// installed AI SDK can run. qwen-ai-provider@0.1.x built a specificationVersion
// "v1" model, which ai@5 and later reject with "Unsupported model version" the
// moment streamText touches it, so every native Qwen turn failed before the
// first token while the menu still advertised the model.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { resolveBrain } = await import('../api/brain/chat.js');

describe('qwen-plus native route', () => {
	let saved;
	beforeEach(() => {
		saved = process.env.DASHSCOPE_API_KEY;
		process.env.DASHSCOPE_API_KEY = 'sk-dashscope-test';
	});
	afterEach(() => {
		if (saved === undefined) delete process.env.DASHSCOPE_API_KEY;
		else process.env.DASHSCOPE_API_KEY = saved;
	});

	it('resolves to a native model on a specification the AI SDK accepts', () => {
		const plan = resolveBrain('qwen-plus');
		expect(plan.ok).toBe(true);
		expect(plan.primary.kind).toBe('model');
		expect(plan.primary.via).toBe('native');
		expect(plan.primary.model.specificationVersion).not.toBe('v1');
		expect(plan.primary.model.modelId).toBe('qwen-plus');
	});

	it('targets the DashScope international OpenAI-compatible endpoint', () => {
		const { model } = resolveBrain('qwen-plus').primary;
		expect(model.config.url({ path: '/chat/completions' })).toBe(
			'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
		);
	});
});
