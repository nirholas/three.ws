// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

export type {
  FlowNodeType,
  TriggerKind,
  ListenerKind,
  ProcessorKind,
  ResponderKind,
  ModifierKind,
  NodeKind,
  FlowNodePosition,
  FlowConnection,
  FlowNode,
  PersonalityConfig,
  FlowVariable,
  AgentFlow,
  DeployPlatform,
  DeployMode,
  DeployConfig,
  DeployedAgent,
  FlowTemplate,
  TestMessage,
  TestSession,
} from './types';

export { transpileFlowToConfig } from './transpiler';
export { validateFlow } from './validator';
export type { ValidationError, ValidationResult } from './validator';
export { FLOW_TEMPLATES, getFlowTemplates, getFlowTemplate, getFlowTemplatesByCategory } from './templates';


