// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import type { AgentFlow, FlowNode, FlowConnection } from './types';

export interface ValidationError {
  nodeId?: string;
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/** Validate an agent flow for completeness and correctness */
export function validateFlow(flow: AgentFlow): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Must have a name
  if (!flow.name || flow.name.trim().length === 0) {
    errors.push({ message: 'Flow must have a name', severity: 'error' });
  }

  // Must have at least one node
  if (flow.nodes.length === 0) {
    errors.push({ message: 'Flow must have at least one node', severity: 'error' });
    return { valid: false, errors, warnings };
  }

  // Must have at least one trigger
  const triggers = flow.nodes.filter(n => n.type === 'trigger');
  if (triggers.length === 0) {
    errors.push({ message: 'Flow must have at least one trigger node', severity: 'error' });
  }

  // Must have at least one responder
  const responders = flow.nodes.filter(n => n.type === 'responder');
  if (responders.length === 0) {
    errors.push({ message: 'Flow must have at least one responder node', severity: 'error' });
  }

  // Check for duplicate node IDs
  const nodeIds = new Set<string>();
  for (const node of flow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Duplicate node ID: ${node.id}`, severity: 'error' });
    }
    nodeIds.add(node.id);
  }

  // Validate connections reference existing nodes
  for (const conn of flow.connections) {
    if (!nodeIds.has(conn.sourceNodeId)) {
      errors.push({
        message: `Connection references non-existent source node: ${conn.sourceNodeId}`,
        severity: 'error',
      });
    }
    if (!nodeIds.has(conn.targetNodeId)) {
      errors.push({
        message: `Connection references non-existent target node: ${conn.targetNodeId}`,
        severity: 'error',
      });
    }
  }

  // Check for disconnected nodes (warning)
  const connectedNodes = new Set<string>();
  for (const conn of flow.connections) {
    connectedNodes.add(conn.sourceNodeId);
    connectedNodes.add(conn.targetNodeId);
  }
  for (const node of flow.nodes) {
    if (!connectedNodes.has(node.id) && flow.nodes.length > 1) {
      warnings.push({
        nodeId: node.id,
        message: `Node "${node.label}" is not connected to any other node`,
        severity: 'warning',
      });
    }
  }

  // Validate personality
  if (!flow.personality.name || flow.personality.name.trim().length === 0) {
    errors.push({ field: 'personality.name', message: 'Agent must have a name', severity: 'error' });
  }
  if (!flow.personality.role || flow.personality.role.trim().length === 0) {
    warnings.push({ field: 'personality.role', message: 'Agent should have a role defined', severity: 'warning' });
  }

  // Validate LLM node has a provider
  const llmNodes = flow.nodes.filter(n => n.kind === 'llm_response');
  for (const llm of llmNodes) {
    if (!llm.config.provider) {
      errors.push({
        nodeId: llm.id,
        message: 'LLM node must have a provider configured',
        severity: 'error',
      });
    }
  }

  // Validate speak nodes have a voice provider
  const speakNodes = flow.nodes.filter(n => n.kind === 'speak');
  for (const speak of speakNodes) {
    if (!speak.config.provider) {
      warnings.push({
        nodeId: speak.id,
        message: 'Speak node should have a voice provider configured (defaults to openai)',
        severity: 'warning',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}


