// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§77]

export interface PersonalityVoice {
  provider: 'elevenlabs' | 'openai' | 'browser';
  voiceId?: string;
  speed?: number;
  stability?: number;
}

export interface PersonalityBehavior {
  maxResponseTokens?: number;
  temperature?: number;
  respondToChat?: boolean;
  autoConverse?: boolean;
  interruptible?: boolean;
}

export interface Personality {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  voice: PersonalityVoice;
  avatar?: string;
  behavior: PersonalityBehavior;
  context: string[];
}

export interface PersonalityWithMeta extends Personality {
  isPreset: boolean;
}


