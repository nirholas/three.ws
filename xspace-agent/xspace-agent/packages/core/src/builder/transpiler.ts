// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import type { AgentConfig } from '../types';
import type { AgentFlow, PersonalityConfig } from './types';

/**
 * Transpile a visual AgentFlow into an SDK-compatible AgentConfig.
 * The flow's personality sliders, nodes, and connections are mapped
 * to the flat config the XSpaceAgent class expects.
 */
export function transpileFlowToConfig(flow: AgentFlow): AgentConfig {
  const personality = flow.personality;
  const systemPrompt = buildSystemPrompt(personality, flow);

  // Extract LLM config from processor nodes
  const llmNode = flow.nodes.find(n => n.kind === 'llm_response');
  const llmConfig = llmNode?.config ?? {};

  // Extract voice config from responder nodes
  const speakNode = flow.nodes.find(n => n.kind === 'speak');
  const voiceConfig = speakNode?.config ?? {};

  // Extract behavior from modifier nodes
  const cooldownNode = flow.nodes.find(n => n.kind === 'cooldown');
  const filterNode = flow.nodes.find(n => n.kind === 'filter');
  const silenceNode = flow.nodes.find(n => n.kind === 'silence_detection');

  return {
    auth: {}, // filled in at deploy time from credentials
    ai: {
      provider: (llmConfig.provider as any) || 'openai',
      model: (llmConfig.model as string) || undefined,
      systemPrompt,
      maxTokens: (llmConfig.maxTokens as number) || 300,
      temperature: mapTemperature(personality),
    },
    voice: {
      provider: (voiceConfig.provider as any) || 'openai',
      voiceId: (voiceConfig.voiceId as string) || undefined,
      speed: (voiceConfig.speed as number) || undefined,
      stability: (voiceConfig.stability as number) || undefined,
    },
    behavior: {
      autoRespond: true,
      silenceThreshold: silenceNode
        ? (silenceNode.config.thresholdMs as number ?? 1500) / 1000
        : 1.5,
      turnDelay: cooldownNode
        ? (cooldownNode.config.delayMs as number ?? 1500)
        : 1500,
    },
  };
}

function buildSystemPrompt(personality: PersonalityConfig, flow: AgentFlow): string {
  const lines: string[] = [];

  // Core identity
  lines.push(`You are ${personality.name}, a ${personality.role}.`);
  lines.push('');

  // Tone from sliders
  const toneDesc = personality.tone > 60 ? 'casual and approachable'
    : personality.tone < 40 ? 'formal and professional'
    : 'balanced and natural';
  const energyDesc = personality.energy > 60 ? 'enthusiastic and energetic'
    : personality.energy < 40 ? 'calm and measured'
    : 'moderately engaged';
  const detailDesc = personality.detail > 60 ? 'thorough and detailed'
    : personality.detail < 40 ? 'brief and concise'
    : 'appropriately detailed';
  const humorDesc = personality.humor > 60 ? 'playful and witty'
    : personality.humor < 40 ? 'serious and straightforward'
    : 'lightly humorous when appropriate';

  lines.push(`Your communication style is ${toneDesc}, ${energyDesc}, ${detailDesc}, and ${humorDesc}.`);
  lines.push('');

  // Knowledge areas
  if (personality.knowledgeAreas.length > 0) {
    lines.push(`Your areas of expertise: ${personality.knowledgeAreas.join(', ')}.`);
  }

  // Exclusions
  if (personality.excludeTopics.length > 0) {
    lines.push(`You must NOT discuss: ${personality.excludeTopics.join(', ')}.`);
  }

  // Example conversations
  if (personality.exampleConversations.length > 0) {
    lines.push('');
    lines.push('Example interactions:');
    for (const ex of personality.exampleConversations) {
      lines.push(`User: "${ex.user}"`);
      lines.push(`You: "${ex.agent}"`);
    }
  }

  // Knowledge base node instructions
  const kbNode = flow.nodes.find(n => n.kind === 'knowledge_base');
  if (kbNode) {
    lines.push('');
    lines.push('You have access to a knowledge base. Ground your responses in the provided context when relevant.');
  }

  // Branch/conditional instructions
  const branchNodes = flow.nodes.filter(n => n.kind === 'conditional_branch');
  if (branchNodes.length > 0) {
    lines.push('');
    lines.push('Conditional behaviors:');
    for (const bn of branchNodes) {
      const condition = bn.config.condition as string;
      const action = bn.config.action as string;
      if (condition && action) {
        lines.push(`- When ${condition}: ${action}`);
      }
    }
  }

  return lines.join('\n');
}

function mapTemperature(personality: PersonalityConfig): number {
  // Map humor + tone to temperature (more playful/casual = higher temp)
  const avg = (personality.humor + personality.tone) / 2;
  return 0.3 + (avg / 100) * 0.7; // Range: 0.3 - 1.0
}


