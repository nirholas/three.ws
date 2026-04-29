// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import * as fs from 'fs';
import * as path from 'path';
import { debug, warn } from './logger';

export interface AIConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
}

export interface VoiceConfig {
  provider: string;
  apiKey?: string;
  voiceId?: string;
}

export interface AuthConfig {
  cookiePath?: string;
  authToken?: string;
}

export interface BehaviorConfig {
  autoRespond?: boolean;
  silenceThreshold?: number;
}

export interface AgentConfig {
  ai: AIConfig;
  voice: VoiceConfig;
  auth: AuthConfig;
  behavior: BehaviorConfig;
}

const DEFAULTS: AgentConfig = {
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are a helpful AI agent participating in an X Space.',
  },
  voice: {
    provider: 'openai',
  },
  auth: {
    cookiePath: './.cookies.json',
  },
  behavior: {
    autoRespond: true,
    silenceThreshold: 1.5,
  },
};

export function getDefaults(): AgentConfig {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

/**
 * Load config from a JSON file. Returns null if file doesn't exist.
 */
export function loadConfigFile(filePath: string): Partial<AgentConfig> | null {
  const resolved = path.resolve(filePath);
  debug('Looking for config at', resolved);

  if (!fs.existsSync(resolved)) {
    debug('Config file not found:', resolved);
    return null;
  }

  // Warn if the file is readable by group or others
  try {
    const stat = fs.statSync(resolved);
    // eslint-disable-next-line no-bitwise
    if (stat.mode & 0o044) {
      warn(
        `Config file ${resolved} is readable by group/others and may expose credentials. ` +
        'Run: chmod 600 ' + resolved + '  to restrict access.'
      );
    }
  } catch {
    // Non-fatal — best-effort check
  }

  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw);
    debug('Loaded config from', resolved);
    return parsed;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`Failed to parse config file ${resolved}: ${message}`);
    return null;
  }
}

/**
 * Load config from environment variables.
 */
export function loadEnvConfig(): Partial<AgentConfig> {
  const env: Partial<AgentConfig> = {};

  const aiProvider = process.env.AI_PROVIDER;
  const aiModel = process.env.AI_MODEL;
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY;
  const systemPrompt = process.env.SYSTEM_PROMPT;

  if (aiProvider || aiModel || apiKey || systemPrompt) {
    const ai: Partial<AIConfig> = {};
    if (aiProvider) ai.provider = aiProvider;
    if (aiModel) ai.model = aiModel;
    if (apiKey) ai.apiKey = apiKey;
    if (systemPrompt) ai.systemPrompt = systemPrompt;
    // Provider is required in AIConfig; fall back to 'openai' when only other fields are set
    env.ai = { provider: ai.provider || 'openai', ...ai };
  }

  if (process.env.TTS_PROVIDER) {
    env.voice = { provider: process.env.TTS_PROVIDER };
  }
  if (process.env.X_AUTH_TOKEN) {
    env.auth = { authToken: process.env.X_AUTH_TOKEN };
  }

  return env;
}

/**
 * Deep merge objects, with later sources taking priority.
 */
export function deepMerge(...sources: (Record<string, unknown> | null | undefined)[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = deepMerge(
          (result[key] as Record<string, unknown>) || {},
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Resolve final config from all sources (CLI flags > file > env > defaults).
 */
export function resolveConfig(
  configPath: string,
  cliFlags: Partial<AgentConfig>
): AgentConfig {
  const defaults = getDefaults();
  const envConfig = loadEnvConfig();
  const fileConfig = loadConfigFile(configPath);

  return deepMerge(
    defaults as unknown as Record<string, unknown>,
    envConfig as unknown as Record<string, unknown>,
    fileConfig as unknown as Record<string, unknown>,
    cliFlags as unknown as Record<string, unknown>
  ) as unknown as AgentConfig;
}

/**
 * Write config to a JSON file.
 * Emits a warning if the resulting file would be world-readable.
 */
export function writeConfigFile(filePath: string, config: AgentConfig): void {
  const resolved = path.resolve(filePath);
  const content = JSON.stringify(
    { $schema: 'https://unpkg.com/xspace-agent/config-schema.json', ...config },
    null,
    2
  );
  // Write with owner-only permissions (0o600) to prevent other users from
  // reading credentials stored in the config file.
  fs.writeFileSync(resolved, content, { encoding: 'utf-8', mode: 0o600 });

  // Sanity-check: warn if something changed the permissions to be world-readable
  try {
    const stat = fs.statSync(resolved);
    // eslint-disable-next-line no-bitwise
    if (stat.mode & 0o044) {
      warn(
        `Config file ${resolved} is readable by group/others. ` +
        'Run: chmod 600 ' + resolved + '  to restrict access.'
      );
    }
  } catch {
    // Non-fatal — best-effort check
  }
}

/**
 * Map the config to environment variables expected by the core modules.
 */
export function configToEnv(config: AgentConfig): void {
  if (config.ai.provider) process.env.AI_PROVIDER = config.ai.provider;
  if (config.ai.systemPrompt) process.env.SYSTEM_PROMPT = config.ai.systemPrompt;

  // Set API key for the appropriate provider
  if (config.ai.apiKey) {
    switch (config.ai.provider) {
      case 'claude':
        process.env.ANTHROPIC_API_KEY = config.ai.apiKey;
        break;
      case 'groq':
        process.env.GROQ_API_KEY = config.ai.apiKey;
        break;
      default:
        process.env.OPENAI_API_KEY = config.ai.apiKey;
    }
  }

  if (config.voice.provider) process.env.TTS_PROVIDER = config.voice.provider;
  if (config.voice.apiKey) process.env.ELEVENLABS_API_KEY = config.voice.apiKey;
  if (config.auth.authToken) process.env.X_AUTH_TOKEN = config.auth.authToken;
  if (config.auth.cookiePath) process.env.COOKIE_PATH = config.auth.cookiePath;
}


