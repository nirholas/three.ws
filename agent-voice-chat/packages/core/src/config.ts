// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// xspace-agent — Configuration Validation (Zod)
// =============================================================================

import { z } from 'zod';
import { ConfigValidationError } from './errors';

/**
 * Zod schema for {@link AuthConfig}.
 * Requires either `token` or `username` + `password`.
 */
const AuthConfigSchema = z
  .object({
    token: z.string().optional(),
    ct0: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    email: z.string().email('Must be a valid email address').optional(),
    cookiePath: z.string().optional(),
  })
  .refine((auth) => auth.token || (auth.username && auth.password), {
    message:
      'Either auth.token or auth.username + auth.password is required for authentication',
  });

/** Zod schema for {@link AIConfig}. */
const AIConfigSchema = z.object({
  provider: z.enum(['openai', 'claude', 'groq', 'custom']),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  systemPrompt: z.string().min(1, 'systemPrompt is required'),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxHistory: z.number().int().positive().optional(),
  timeout: z
    .object({
      streamStart: z.number().int().positive().optional(),
      total: z.number().int().positive().optional(),
    })
    .optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      maxSize: z.number().int().positive().optional(),
      ttlMs: z.number().int().positive().optional(),
    })
    .optional(),
  custom: z.any().optional(),
});

/** Zod schema for {@link VoiceConfig}. */
const VoiceConfigSchema = z.object({
  provider: z.enum(['elevenlabs', 'openai', 'browser']),
  apiKey: z.string().optional(),
  voiceId: z.string().optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
  stability: z.number().min(0).max(1).optional(),
});

/** Zod schema for {@link BrowserConfig}. */
const BrowserConfigSchema = z.object({
  headless: z.boolean().optional(),
  executablePath: z.string().optional(),
  userDataDir: z.string().optional(),
  proxy: z.string().optional(),
  args: z.array(z.string()).optional(),
});

/** Zod schema for {@link BehaviorConfig}. */
const BehaviorConfigSchema = z.object({
  autoRespond: z.boolean().optional(),
  silenceThreshold: z.number().positive().optional(),
  minSpeechDuration: z.number().positive().optional(),
  maxResponseLength: z.number().int().positive().optional(),
  respondToSelf: z.boolean().optional(),
  turnDelay: z.number().int().nonnegative().optional(),
});

/**
 * Full Zod schema for the top-level {@link AgentConfig}.
 *
 * @example
 * ```typescript
 * import { AgentConfigSchema } from 'xspace-agent';
 *
 * const result = AgentConfigSchema.safeParse(myConfig);
 * if (!result.success) {
 *   console.error(result.error.issues);
 * }
 * ```
 */
export const AgentConfigSchema = z.object({
  auth: AuthConfigSchema,
  ai: AIConfigSchema,
  voice: VoiceConfigSchema.optional(),
  browser: BrowserConfigSchema.optional(),
  behavior: BehaviorConfigSchema.optional(),
  logger: z.any().optional(),
});

/** The validated type inferred from {@link AgentConfigSchema}. */
export type ValidatedAgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Validate an {@link AgentConfig} object against the schema.
 * Throws a {@link ConfigValidationError} with all issues if validation fails.
 *
 * @param config - The configuration object to validate
 * @returns The validated and typed configuration
 * @throws {ConfigValidationError} If the configuration is invalid
 *
 * @example
 * ```typescript
 * import { validateConfig } from 'xspace-agent';
 *
 * try {
 *   const config = validateConfig({
 *     auth: { token: process.env.X_AUTH_TOKEN },
 *     ai: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, systemPrompt: 'Hello' },
 *   });
 * } catch (err) {
 *   // ConfigValidationError with specific messages like:
 *   //   - "ai.systemPrompt: systemPrompt is required"
 *   //   - "auth: Either auth.token or auth.username + auth.password is required"
 * }
 * ```
 */
export function validateConfig(config: unknown): ValidatedAgentConfig {
  const result = AgentConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    throw new ConfigValidationError(errors);
  }
  return result.data;
}


