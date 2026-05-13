// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect } from 'vitest';
import { validateFlow } from '../builder/validator';
import { transpileFlowToConfig } from '../builder/transpiler';
import { getFlowTemplates, getFlowTemplate, getFlowTemplatesByCategory } from '../builder/templates';
import type { AgentFlow } from '../builder/types';

// ---------------------------------------------------------------------------
// Helper: minimal valid flow
// ---------------------------------------------------------------------------
function makeFlow(overrides: Partial<AgentFlow> = {}): AgentFlow {
  return {
    id: 'test-flow-1',
    name: 'Test Flow',
    description: 'A test flow',
    nodes: [
      { id: 'trigger-1', type: 'trigger', kind: 'always_on', label: 'Always On', config: {}, position: { x: 0, y: 0 } },
      { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 200, y: 0 } },
      { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Think', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 200 }, position: { x: 400, y: 0 } },
      { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Speak', config: { provider: 'openai', voiceId: 'alloy' }, position: { x: 600, y: 0 } },
    ],
    connections: [
      { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
      { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
      { id: 'c3', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
    ],
    variables: [],
    personality: {
      name: 'TestBot',
      role: 'Test Assistant',
      tone: 50,
      energy: 50,
      detail: 50,
      humor: 50,
      knowledgeAreas: ['Testing'],
      excludeTopics: ['Secrets'],
      exampleConversations: [{ user: 'Hello', agent: 'Hi there!' }],
    },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------
describe('validateFlow', () => {
  it('accepts a valid flow', () => {
    const result = validateFlow(makeFlow());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a flow with no name', () => {
    const result = validateFlow(makeFlow({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('name'))).toBe(true);
  });

  it('rejects a flow with no nodes', () => {
    const result = validateFlow(makeFlow({ nodes: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('at least one node'))).toBe(true);
  });

  it('rejects a flow with no trigger', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'r1', type: 'responder', kind: 'speak', label: 'Speak', config: { provider: 'openai' }, position: { x: 0, y: 0 } },
      ],
      connections: [],
    });
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('trigger'))).toBe(true);
  });

  it('rejects a flow with no responder', () => {
    const flow = makeFlow({
      nodes: [
        { id: 't1', type: 'trigger', kind: 'always_on', label: 'Trigger', config: {}, position: { x: 0, y: 0 } },
      ],
      connections: [],
    });
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('responder'))).toBe(true);
  });

  it('detects duplicate node IDs', () => {
    const flow = makeFlow({
      nodes: [
        { id: 'dup', type: 'trigger', kind: 'always_on', label: 'T1', config: {}, position: { x: 0, y: 0 } },
        { id: 'dup', type: 'responder', kind: 'speak', label: 'R1', config: { provider: 'openai' }, position: { x: 200, y: 0 } },
      ],
    });
    const result = validateFlow(flow);
    expect(result.errors.some(e => e.message.includes('Duplicate'))).toBe(true);
  });

  it('detects connections to non-existent nodes', () => {
    const flow = makeFlow({
      connections: [
        { id: 'c1', sourceNodeId: 'ghost', sourceOutput: 'default', targetNodeId: 'trigger-1', targetInput: 'default' },
      ],
    });
    const result = validateFlow(flow);
    expect(result.errors.some(e => e.message.includes('non-existent'))).toBe(true);
  });

  it('warns about disconnected nodes', () => {
    const flow = makeFlow();
    flow.nodes.push({ id: 'orphan', type: 'modifier', kind: 'cooldown', label: 'Orphan', config: {}, position: { x: 800, y: 0 } });
    const result = validateFlow(flow);
    expect(result.warnings.some(w => w.message.includes('not connected'))).toBe(true);
  });

  it('rejects LLM node without provider', () => {
    const flow = makeFlow();
    const llmNode = flow.nodes.find(n => n.kind === 'llm_response')!;
    llmNode.config = {}; // remove provider
    const result = validateFlow(flow);
    expect(result.errors.some(e => e.message.includes('LLM node must have a provider'))).toBe(true);
  });

  it('warns when personality has no role', () => {
    const flow = makeFlow();
    flow.personality.role = '';
    const result = validateFlow(flow);
    expect(result.warnings.some(w => w.message.includes('role'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transpiler
// ---------------------------------------------------------------------------
describe('transpileFlowToConfig', () => {
  it('produces a valid AgentConfig from a flow', () => {
    const config = transpileFlowToConfig(makeFlow());
    expect(config.ai).toBeDefined();
    expect(config.ai.provider).toBe('openai');
    expect(config.ai.model).toBe('gpt-4o');
    expect(config.ai.maxTokens).toBe(200);
    expect(config.ai.systemPrompt).toContain('TestBot');
    expect(config.ai.systemPrompt).toContain('Test Assistant');
    expect(config.voice).toBeDefined();
    expect(config.voice!.provider).toBe('openai');
    expect(config.voice!.voiceId).toBe('alloy');
    expect(config.behavior).toBeDefined();
    expect(config.behavior!.autoRespond).toBe(true);
  });

  it('maps personality sliders into the system prompt', () => {
    const flow = makeFlow();
    flow.personality.tone = 80; // casual
    flow.personality.humor = 90; // playful
    const config = transpileFlowToConfig(flow);
    expect(config.ai.systemPrompt).toContain('casual');
    expect(config.ai.systemPrompt).toContain('playful');
  });

  it('maps formal personality sliders', () => {
    const flow = makeFlow();
    flow.personality.tone = 20; // formal
    flow.personality.energy = 20; // calm
    flow.personality.detail = 20; // brief
    flow.personality.humor = 20; // serious
    const config = transpileFlowToConfig(flow);
    expect(config.ai.systemPrompt).toContain('formal');
    expect(config.ai.systemPrompt).toContain('calm');
    expect(config.ai.systemPrompt).toContain('brief');
    expect(config.ai.systemPrompt).toContain('serious');
  });

  it('includes knowledge areas in prompt', () => {
    const config = transpileFlowToConfig(makeFlow());
    expect(config.ai.systemPrompt).toContain('Testing');
  });

  it('includes exclude topics in prompt', () => {
    const config = transpileFlowToConfig(makeFlow());
    expect(config.ai.systemPrompt).toContain('Secrets');
  });

  it('includes example conversations in prompt', () => {
    const config = transpileFlowToConfig(makeFlow());
    expect(config.ai.systemPrompt).toContain('Hello');
    expect(config.ai.systemPrompt).toContain('Hi there!');
  });

  it('maps temperature from humor + tone sliders', () => {
    const lowFlow = makeFlow();
    lowFlow.personality.tone = 0;
    lowFlow.personality.humor = 0;
    const lowConfig = transpileFlowToConfig(lowFlow);

    const highFlow = makeFlow();
    highFlow.personality.tone = 100;
    highFlow.personality.humor = 100;
    const highConfig = transpileFlowToConfig(highFlow);

    expect(lowConfig.ai.temperature).toBeCloseTo(0.3);
    expect(highConfig.ai.temperature).toBeCloseTo(1.0);
    expect(highConfig.ai.temperature!).toBeGreaterThan(lowConfig.ai.temperature!);
  });

  it('extracts silence threshold from silence_detection node', () => {
    const flow = makeFlow();
    flow.nodes.push({
      id: 'silence-1', type: 'listener', kind: 'silence_detection', label: 'Silence',
      config: { thresholdMs: 3000 }, position: { x: 0, y: 100 },
    });
    const config = transpileFlowToConfig(flow);
    expect(config.behavior!.silenceThreshold).toBe(3);
  });

  it('extracts turn delay from cooldown node', () => {
    const flow = makeFlow();
    flow.nodes.push({
      id: 'cd-1', type: 'modifier', kind: 'cooldown', label: 'Cooldown',
      config: { delayMs: 2500 }, position: { x: 0, y: 100 },
    });
    const config = transpileFlowToConfig(flow);
    expect(config.behavior!.turnDelay).toBe(2500);
  });

  it('defaults to openai when no LLM node', () => {
    const flow = makeFlow({
      nodes: [
        { id: 't1', type: 'trigger', kind: 'always_on', label: 'T', config: {}, position: { x: 0, y: 0 } },
        { id: 'r1', type: 'responder', kind: 'speak', label: 'S', config: {}, position: { x: 200, y: 0 } },
      ],
    });
    const config = transpileFlowToConfig(flow);
    expect(config.ai.provider).toBe('openai');
    expect(config.ai.maxTokens).toBe(300);
  });

  it('includes knowledge base instruction when KB node present', () => {
    const flow = makeFlow();
    flow.nodes.push({
      id: 'kb-1', type: 'processor', kind: 'knowledge_base', label: 'KB',
      config: { source: 'docs' }, position: { x: 0, y: 100 },
    });
    const config = transpileFlowToConfig(flow);
    expect(config.ai.systemPrompt).toContain('knowledge base');
  });

  it('includes conditional behavior in prompt', () => {
    const flow = makeFlow();
    flow.nodes.push({
      id: 'branch-1', type: 'branch', kind: 'conditional_branch', label: 'Check',
      config: { condition: 'user is frustrated', action: 'escalate to human' },
      position: { x: 0, y: 100 },
    });
    const config = transpileFlowToConfig(flow);
    expect(config.ai.systemPrompt).toContain('user is frustrated');
    expect(config.ai.systemPrompt).toContain('escalate to human');
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
describe('flow templates', () => {
  it('returns all 8 templates', () => {
    const templates = getFlowTemplates();
    expect(templates.length).toBe(8);
  });

  it('retrieves a template by ID', () => {
    const t = getFlowTemplate('customer-support');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Customer Support Bot');
  });

  it('returns undefined for unknown template ID', () => {
    expect(getFlowTemplate('nonexistent')).toBeUndefined();
  });

  it('filters templates by category', () => {
    const content = getFlowTemplatesByCategory('Content');
    expect(content.length).toBeGreaterThanOrEqual(1);
    expect(content.every(t => t.category === 'Content')).toBe(true);
  });

  it('returns empty array for unknown category', () => {
    expect(getFlowTemplatesByCategory('Nonexistent')).toHaveLength(0);
  });

  it('all templates have valid flows', () => {
    const templates = getFlowTemplates();
    for (const t of templates) {
      // Build a full AgentFlow from the template
      const flow: AgentFlow = {
        id: 'test',
        ...t.flow,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
    }
  });

  it('all templates can be transpiled', () => {
    const templates = getFlowTemplates();
    for (const t of templates) {
      const flow: AgentFlow = {
        id: 'test',
        ...t.flow,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const config = transpileFlowToConfig(flow);
      expect(config.ai).toBeDefined();
      expect(config.ai.systemPrompt.length).toBeGreaterThan(0);
      expect(config.voice).toBeDefined();
    }
  });

  it('each template has required metadata', () => {
    for (const t of getFlowTemplates()) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.rating).toBeGreaterThan(0);
      expect(t.rating).toBeLessThanOrEqual(5);
      expect(t.usageCount).toBeGreaterThan(0);
      expect(t.flow.nodes.length).toBeGreaterThan(0);
      expect(t.flow.personality.name).toBeTruthy();
    }
  });
});


