// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

import type { FlowTemplate } from './types';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'customer-support',
    name: 'Customer Support Bot',
    description: 'Answers FAQs, escalates to human, collects feedback.',
    category: 'Support',
    rating: 4.8,
    usageCount: 5200,
    icon: 'headset',
    flow: {
      name: 'Customer Support Bot',
      description: 'Answers FAQs, escalates to human, collects feedback.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'always_on', label: 'Always On', config: {}, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 250, y: 200 } },
        { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Think', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 200 }, position: { x: 450, y: 150 } },
        { id: 'branch-1', type: 'branch', kind: 'conditional_branch', label: 'Escalate?', config: { condition: 'sentiment is very negative or user asks for human', action: 'escalate to human agent' }, position: { x: 450, y: 300 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Respond', config: { provider: 'openai', voiceId: 'alloy' }, position: { x: 650, y: 150 } },
        { id: 'respond-2', type: 'responder', kind: 'handoff', label: 'Handoff', config: { target: 'human' }, position: { x: 650, y: 300 } },
        { id: 'mod-1', type: 'modifier', kind: 'cooldown', label: 'Cooldown', config: { delayMs: 1000 }, position: { x: 850, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'branch-1', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c5', sourceNodeId: 'branch-1', sourceOutput: 'true', targetNodeId: 'respond-2', targetInput: 'default' },
        { id: 'c6', sourceNodeId: 'respond-1', sourceOutput: 'default', targetNodeId: 'mod-1', targetInput: 'default' },
      ],
      variables: [],
      personality: {
        name: 'Alex',
        role: 'Customer Support Agent',
        tone: 40,
        energy: 50,
        detail: 60,
        humor: 20,
        knowledgeAreas: ['Product FAQ', 'Pricing', 'Technical Support'],
        excludeTopics: ['Competitors', 'Internal roadmap'],
        exampleConversations: [
          { user: "What's your pricing?", agent: "We have three tiers: Free, Pro at $29/month, and Enterprise with custom pricing. Which would you like to know more about?" },
        ],
      },
      version: 1,
      templateId: 'customer-support',
    },
  },
  {
    id: 'community-moderator',
    name: 'Community Moderator',
    description: 'Welcomes newcomers, enforces rules, guides discussion.',
    category: 'Community',
    rating: 4.5,
    usageCount: 3200,
    icon: 'users',
    flow: {
      name: 'Community Moderator',
      description: 'Welcomes newcomers, enforces rules, guides discussion.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'always_on', label: 'Always On', config: {}, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 250, y: 150 } },
        { id: 'listen-2', type: 'listener', kind: 'silence_detection', label: 'Silence Detect', config: { thresholdMs: 5000 }, position: { x: 250, y: 300 } },
        { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Think', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 250 }, position: { x: 450, y: 200 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Speak', config: { provider: 'openai', voiceId: 'nova' }, position: { x: 650, y: 200 } },
        { id: 'mod-1', type: 'modifier', kind: 'rate_limit', label: 'Rate Limit', config: { maxPerMinute: 5 }, position: { x: 850, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-2', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'listen-2', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c5', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c6', sourceNodeId: 'respond-1', sourceOutput: 'default', targetNodeId: 'mod-1', targetInput: 'default' },
      ],
      variables: [],
      personality: {
        name: 'Jordan',
        role: 'Community Moderator',
        tone: 70,
        energy: 70,
        detail: 40,
        humor: 50,
        knowledgeAreas: ['Community guidelines', 'Discussion facilitation'],
        excludeTopics: [],
        exampleConversations: [
          { user: 'Hey, first time here!', agent: "Welcome! Great to have you. We're discussing AI agents today — feel free to jump in anytime!" },
        ],
      },
      version: 1,
      templateId: 'community-moderator',
    },
  },
  {
    id: 'interview-conductor',
    name: 'Interview Conductor',
    description: 'Structured interviews with scoring and notes.',
    category: 'Content',
    rating: 4.3,
    usageCount: 1800,
    icon: 'mic',
    flow: {
      name: 'Interview Conductor',
      description: 'Structured interviews with scoring and notes.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'api_call', label: 'Start Interview', config: {}, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'openai', language: 'en' }, position: { x: 250, y: 200 } },
        { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Analyze & Respond', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 300 }, position: { x: 450, y: 200 } },
        { id: 'process-2', type: 'processor', kind: 'memory_recall', label: 'Track Answers', config: {}, position: { x: 450, y: 350 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Ask Question', config: { provider: 'openai', voiceId: 'onyx' }, position: { x: 650, y: 200 } },
        { id: 'mod-1', type: 'modifier', kind: 'cooldown', label: 'Pause', config: { delayMs: 2000 }, position: { x: 850, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-2', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c5', sourceNodeId: 'respond-1', sourceOutput: 'default', targetNodeId: 'mod-1', targetInput: 'default' },
      ],
      variables: [
        { name: 'currentQuestion', type: 'number', defaultValue: 0 },
        { name: 'scores', type: 'object', defaultValue: {} },
      ],
      personality: {
        name: 'Morgan',
        role: 'Professional Interviewer',
        tone: 30,
        energy: 40,
        detail: 70,
        humor: 10,
        knowledgeAreas: ['Interview techniques', 'Active listening'],
        excludeTopics: [],
        exampleConversations: [
          { user: 'I have 5 years of experience in Python.', agent: "That's great. Can you tell me about a challenging project where your Python skills were put to the test?" },
        ],
      },
      version: 1,
      templateId: 'interview-conductor',
    },
  },
  {
    id: 'sales-demo',
    name: 'Sales Demo Agent',
    description: 'Product demos, answers objections, collects leads.',
    category: 'Sales',
    rating: 4.6,
    usageCount: 2100,
    icon: 'trending-up',
    flow: {
      name: 'Sales Demo Agent',
      description: 'Product demos, answers objections, collects leads.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'always_on', label: 'Always On', config: {}, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 250, y: 200 } },
        { id: 'process-1', type: 'processor', kind: 'knowledge_base', label: 'Product KB', config: { source: 'product-docs' }, position: { x: 450, y: 100 } },
        { id: 'process-2', type: 'processor', kind: 'llm_response', label: 'Sales AI', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 250 }, position: { x: 450, y: 250 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Pitch', config: { provider: 'elevenlabs', voiceId: 'VR6AewLTigWG4xSOukaG' }, position: { x: 650, y: 200 } },
        { id: 'respond-2', type: 'responder', kind: 'webhook_out', label: 'Log Lead', config: { url: '' }, position: { x: 650, y: 350 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'process-2', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'process-2', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c5', sourceNodeId: 'process-2', sourceOutput: 'default', targetNodeId: 'respond-2', targetInput: 'default' },
      ],
      variables: [],
      personality: {
        name: 'Riley',
        role: 'Sales Demo Specialist',
        tone: 60,
        energy: 70,
        detail: 60,
        humor: 40,
        knowledgeAreas: ['Product features', 'Pricing', 'Case studies', 'ROI'],
        excludeTopics: ['Competitor pricing', 'Internal margins'],
        exampleConversations: [
          { user: "How is this different from competitors?", agent: "Great question! What sets us apart is our real-time voice AI — most competitors only offer text chat. Plus, our setup takes under 10 minutes." },
        ],
      },
      version: 1,
      templateId: 'sales-demo',
    },
  },
  {
    id: 'language-partner',
    name: 'Language Practice Partner',
    description: 'Conversational language practice with corrections.',
    category: 'Education',
    rating: 4.9,
    usageCount: 4500,
    icon: 'globe',
    flow: {
      name: 'Language Practice Partner',
      description: 'Conversational language practice with corrections.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'always_on', label: 'Always On', config: {}, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'openai', language: 'auto' }, position: { x: 250, y: 200 } },
        { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Language AI', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 200 }, position: { x: 450, y: 200 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Speak', config: { provider: 'openai', voiceId: 'nova', speed: 0.9 }, position: { x: 650, y: 200 } },
        { id: 'mod-1', type: 'modifier', kind: 'cooldown', label: 'Wait', config: { delayMs: 2000 }, position: { x: 850, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'respond-1', sourceOutput: 'default', targetNodeId: 'mod-1', targetInput: 'default' },
      ],
      variables: [
        { name: 'targetLanguage', type: 'string', defaultValue: 'Spanish' },
        { name: 'proficiencyLevel', type: 'string', defaultValue: 'intermediate' },
      ],
      personality: {
        name: 'Suki',
        role: 'Language Practice Partner',
        tone: 70,
        energy: 60,
        detail: 50,
        humor: 60,
        knowledgeAreas: ['Language learning', 'Grammar', 'Pronunciation', 'Cultural context'],
        excludeTopics: [],
        exampleConversations: [
          { user: 'Yo quiero ir al restaurante.', agent: "¡Muy bien! Almost perfect. Just a small note: you can also say 'Quiero ir al restaurante' — dropping the 'yo' sounds more natural in Spanish. Where would you like to eat?" },
        ],
      },
      version: 1,
      templateId: 'language-partner',
    },
  },
  {
    id: 'meeting-facilitator',
    name: 'Meeting Facilitator',
    description: 'Agenda management, time-keeping, action item capture.',
    category: 'Productivity',
    rating: 4.4,
    usageCount: 1500,
    icon: 'clipboard',
    flow: {
      name: 'Meeting Facilitator',
      description: 'Agenda management, time-keeping, action item capture.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'schedule', label: 'Meeting Start', config: { cron: '0 14 * * 1-5' }, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 250, y: 150 } },
        { id: 'listen-2', type: 'listener', kind: 'silence_detection', label: 'Dead Air', config: { thresholdMs: 8000 }, position: { x: 250, y: 300 } },
        { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Facilitate', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 200 }, position: { x: 450, y: 200 } },
        { id: 'process-2', type: 'processor', kind: 'memory_recall', label: 'Action Items', config: {}, position: { x: 450, y: 350 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Guide', config: { provider: 'openai', voiceId: 'alloy' }, position: { x: 650, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-2', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'listen-2', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c5', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c6', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-2', targetInput: 'default' },
      ],
      variables: [
        { name: 'agenda', type: 'object', defaultValue: [] },
        { name: 'actionItems', type: 'object', defaultValue: [] },
      ],
      personality: {
        name: 'Taylor',
        role: 'Meeting Facilitator',
        tone: 45,
        energy: 50,
        detail: 50,
        humor: 20,
        knowledgeAreas: ['Meeting facilitation', 'Time management', 'Action tracking'],
        excludeTopics: [],
        exampleConversations: [
          { user: "We should probably move on.", agent: "Good call. Let me capture the action items from this topic: Sarah will draft the proposal by Friday. Now, let's move to agenda item 3 — the Q2 roadmap." },
        ],
      },
      version: 1,
      templateId: 'meeting-facilitator',
    },
  },
  {
    id: 'news-commentator',
    name: 'News Commentator',
    description: 'Reads news, provides analysis, takes questions.',
    category: 'Content',
    rating: 4.1,
    usageCount: 900,
    icon: 'newspaper',
    flow: {
      name: 'News Commentator',
      description: 'Reads news, provides analysis, takes questions.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'always_on', label: 'Always On', config: {}, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 250, y: 200 } },
        { id: 'process-1', type: 'processor', kind: 'tool_call', label: 'Fetch News', config: { tool: 'web_search' }, position: { x: 450, y: 100 } },
        { id: 'process-2', type: 'processor', kind: 'llm_response', label: 'Analyze', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 300 }, position: { x: 450, y: 250 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Report', config: { provider: 'openai', voiceId: 'echo' }, position: { x: 650, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'process-2', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'process-2', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
      ],
      variables: [],
      personality: {
        name: 'Casey',
        role: 'News Analyst & Commentator',
        tone: 35,
        energy: 55,
        detail: 80,
        humor: 25,
        knowledgeAreas: ['Current events', 'Technology', 'Business', 'Politics'],
        excludeTopics: ['Conspiracy theories', 'Unverified claims'],
        exampleConversations: [
          { user: "What's happening with AI regulation?", agent: "The EU AI Act is now in its implementation phase, with the first compliance deadlines hitting this year. Meanwhile, the US is taking a more sector-specific approach..." },
        ],
      },
      version: 1,
      templateId: 'news-commentator',
    },
  },
  {
    id: 'trivia-host',
    name: 'Trivia Host',
    description: 'Interactive trivia games in Spaces/Discord.',
    category: 'Entertainment',
    rating: 4.7,
    usageCount: 2800,
    icon: 'zap',
    flow: {
      name: 'Trivia Host',
      description: 'Interactive trivia games in Spaces/Discord.',
      nodes: [
        { id: 'trigger-1', type: 'trigger', kind: 'keyword', label: 'Start Trivia', config: { keywords: ['start trivia', 'play trivia', 'trivia time'] }, position: { x: 50, y: 200 } },
        { id: 'listen-1', type: 'listener', kind: 'speech_to_text', label: 'Listen', config: { provider: 'groq', language: 'en' }, position: { x: 250, y: 200 } },
        { id: 'process-1', type: 'processor', kind: 'llm_response', label: 'Trivia AI', config: { provider: 'openai', model: 'gpt-4o', maxTokens: 200 }, position: { x: 450, y: 200 } },
        { id: 'respond-1', type: 'responder', kind: 'speak', label: 'Ask/Score', config: { provider: 'openai', voiceId: 'fable' }, position: { x: 650, y: 200 } },
        { id: 'mod-1', type: 'modifier', kind: 'cooldown', label: 'Think Time', config: { delayMs: 5000 }, position: { x: 850, y: 200 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'trigger-1', sourceOutput: 'default', targetNodeId: 'listen-1', targetInput: 'default' },
        { id: 'c2', sourceNodeId: 'listen-1', sourceOutput: 'default', targetNodeId: 'process-1', targetInput: 'default' },
        { id: 'c3', sourceNodeId: 'process-1', sourceOutput: 'default', targetNodeId: 'respond-1', targetInput: 'default' },
        { id: 'c4', sourceNodeId: 'respond-1', sourceOutput: 'default', targetNodeId: 'mod-1', targetInput: 'default' },
      ],
      variables: [
        { name: 'scores', type: 'object', defaultValue: {} },
        { name: 'currentRound', type: 'number', defaultValue: 1 },
        { name: 'category', type: 'string', defaultValue: 'General Knowledge' },
      ],
      personality: {
        name: 'Zephyr',
        role: 'Trivia Game Host',
        tone: 80,
        energy: 90,
        detail: 40,
        humor: 80,
        knowledgeAreas: ['General knowledge', 'Science', 'History', 'Pop culture', 'Sports'],
        excludeTopics: [],
        exampleConversations: [
          { user: 'Paris!', agent: "That's correct! Paris IS the capital of France — 10 points to you! Next question: What year did the first iPhone launch?" },
        ],
      },
      version: 1,
      templateId: 'trivia-host',
    },
  },
];

/** Get all flow templates */
export function getFlowTemplates(): FlowTemplate[] {
  return FLOW_TEMPLATES;
}

/** Get a flow template by ID */
export function getFlowTemplate(id: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find(t => t.id === id);
}

/** Get flow templates by category */
export function getFlowTemplatesByCategory(category: string): FlowTemplate[] {
  return FLOW_TEMPLATES.filter(t => t.category.toLowerCase() === category.toLowerCase());
}


