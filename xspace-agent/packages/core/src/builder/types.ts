// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// Flow node types
export type FlowNodeType = 'trigger' | 'listener' | 'processor' | 'responder' | 'modifier' | 'branch';

// Trigger subtypes
export type TriggerKind = 'schedule' | 'api_call' | 'webhook' | 'keyword' | 'always_on';

// Listener subtypes
export type ListenerKind = 'speech_to_text' | 'keyword_detection' | 'sentiment_monitor' | 'silence_detection';

// Processor subtypes
export type ProcessorKind = 'llm_response' | 'knowledge_base' | 'conditional_branch' | 'memory_recall' | 'tool_call';

// Responder subtypes
export type ResponderKind = 'speak' | 'text_message' | 'action' | 'handoff' | 'webhook_out';

// Modifier subtypes
export type ModifierKind = 'cooldown' | 'rate_limit' | 'priority' | 'filter';

export type NodeKind = TriggerKind | ListenerKind | ProcessorKind | ResponderKind | ModifierKind | 'condition';

export interface FlowNodePosition {
  x: number;
  y: number;
}

export interface FlowConnection {
  id: string;
  sourceNodeId: string;
  sourceOutput: string;
  targetNodeId: string;
  targetInput: string;
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  kind: NodeKind;
  label: string;
  config: Record<string, unknown>;
  position: FlowNodePosition;
}

// Personality slider config
export interface PersonalityConfig {
  name: string;
  role: string;
  tone: number;       // 0 = formal, 100 = casual
  energy: number;     // 0 = calm, 100 = excited
  detail: number;     // 0 = brief, 100 = thorough
  humor: number;      // 0 = serious, 100 = playful
  knowledgeAreas: string[];
  excludeTopics: string[];
  exampleConversations: { user: string; agent: string }[];
}

export interface FlowVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  defaultValue?: unknown;
}

export interface AgentFlow {
  id: string;
  orgId?: string;
  name: string;
  description: string;
  nodes: FlowNode[];
  connections: FlowConnection[];
  variables: FlowVariable[];
  personality: PersonalityConfig;
  version: number;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
}

// Deploy target
export type DeployPlatform = 'x_spaces' | 'discord' | 'widget' | 'all';
export type DeployMode = 'always_on' | 'scheduled' | 'api_triggered';

export interface DeployConfig {
  platform: DeployPlatform;
  mode: DeployMode;
  schedule?: string; // cron expression
  credentials: Record<string, string>;
}

export interface DeployedAgent {
  id: string;
  flowId: string;
  orgId?: string;
  status: 'running' | 'stopped' | 'error' | 'preview';
  platform: DeployPlatform;
  deployConfig: DeployConfig;
  startedAt: string;
  expiresAt?: string; // for preview deployments
  error?: string;
}

// Template type for the gallery
export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  rating: number;
  usageCount: number;
  icon: string;
  flow: Omit<AgentFlow, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;
}

// Test session for in-browser testing
export interface TestMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  nodeId?: string; // which node generated this
}

export interface TestSession {
  id: string;
  flowId: string;
  messages: TestMessage[];
  activeNodes: string[]; // currently active node IDs
  status: 'running' | 'stopped';
  startedAt: number;
}


