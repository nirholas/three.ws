// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// xspace-agent — Custom Error Classes
// Every error includes: code, message, hint, and optional docs URL
// =============================================================================

/**
 * Base error class for all xspace-agent errors.
 * Provides structured error information with a machine-readable code,
 * a human-readable message, and an actionable hint for resolution.
 *
 * @example
 * ```typescript
 * try {
 *   await agent.join(spaceUrl);
 * } catch (err) {
 *   if (err instanceof XSpaceError) {
 *     console.error(err.code);    // 'SPACE_NOT_FOUND'
 *     console.error(err.message); // 'Space not found: https://...'
 *     console.error(err.hint);    // 'Verify the Space URL is correct...'
 *   }
 * }
 * ```
 */
export class XSpaceError extends Error {
  /** Machine-readable error code (e.g. `AUTH_FAILED`, `SPACE_NOT_FOUND`). */
  public readonly code: string;

  /** Actionable suggestion for how to fix this error. */
  public readonly hint: string;

  /** Optional link to relevant documentation. */
  public readonly docsUrl?: string;

  constructor(code: string, message: string, hint: string, docsUrl?: string) {
    super(message);
    this.name = 'XSpaceError';
    this.code = code;
    this.hint = hint;
    this.docsUrl = docsUrl;
  }

  override toString(): string {
    let str = `[${this.code}] ${this.message}`;
    if (this.hint) str += `\n  Hint: ${this.hint}`;
    if (this.docsUrl) str += `\n  Docs: ${this.docsUrl}`;
    return str;
  }
}

/**
 * Thrown when X/Twitter authentication fails.
 *
 * Common causes: expired auth_token, invalid credentials, or missing environment variables.
 */
export class AuthenticationError extends XSpaceError {
  constructor(message: string, hint?: string) {
    super(
      'AUTH_FAILED',
      message,
      hint ??
        'Check your auth.token or auth.username/auth.password config. ' +
          'If using token auth, the token may have expired — get a fresh one from your browser cookies.',
    );
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the target X Space cannot be found or is not accessible.
 */
export class SpaceNotFoundError extends XSpaceError {
  constructor(url: string) {
    super(
      'SPACE_NOT_FOUND',
      `Space not found: ${url}`,
      'Verify the Space URL is correct and the Space is currently live. ' +
        'Ended Spaces cannot be joined.',
    );
    this.name = 'SpaceNotFoundError';
  }
}

/**
 * Thrown when the Space ends while the agent is connected.
 */
export class SpaceEndedError extends XSpaceError {
  constructor() {
    super(
      'SPACE_ENDED',
      'The Space has ended',
      'The Space ended while the agent was connected. ' +
        "Use agent.on('space-ended', ...) to handle this gracefully.",
    );
    this.name = 'SpaceEndedError';
  }
}

/**
 * Thrown when the browser cannot be launched or connected to.
 */
export class BrowserConnectionError extends XSpaceError {
  constructor(mode: string, detail: string) {
    super(
      'BROWSER_CONNECTION',
      `Browser connection failed (mode: ${mode}): ${detail}`,
      mode === 'connect'
        ? 'Make sure Chrome is running with --remote-debugging-port=9222 and you are logged into X.com.'
        : 'Make sure Puppeteer can launch Chrome. In Docker, you may need --no-sandbox flag.',
    );
    this.name = 'BrowserConnectionError';
  }
}

/**
 * Thrown when speaker access is not granted within the timeout period.
 */
export class SpeakerAccessDeniedError extends XSpaceError {
  constructor() {
    super(
      'SPEAKER_DENIED',
      'Speaker access was not granted',
      'The Space host needs to accept your speaker request. ' +
        'The bot will retry automatically, but it may take time.',
    );
    this.name = 'SpeakerAccessDeniedError';
  }
}

/**
 * Thrown when an AI provider (LLM, STT, or TTS) operation fails.
 */
export class ProviderError extends XSpaceError {
  constructor(provider: string, operation: string, detail: string) {
    super(
      'PROVIDER_ERROR',
      `${provider} ${operation} failed: ${detail}`,
      `Check your API key for ${provider} and verify you have sufficient credits/quota.`,
    );
    this.name = 'ProviderError';
  }
}

/**
 * Thrown when the agent configuration is invalid.
 * The `errors` array contains one entry per validation issue.
 */
export class ConfigValidationError extends XSpaceError {
  /** Individual validation error messages. */
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(
      'CONFIG_INVALID',
      `Invalid configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      'Check your .env file or AgentConfig object. See the README for all required variables.',
    );
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

/**
 * Thrown when a UI selector cannot find the target element after trying
 * all available strategies (CSS, text, aria, accessibility tree).
 */
export class SelectorBrokenError extends XSpaceError {
  constructor(selectorName: string, triedStrategies: string[]) {
    super(
      'SELECTOR_BROKEN',
      `Could not find UI element: ${selectorName}`,
      `All selector strategies failed: ${triedStrategies.join(', ')}. ` +
        'X may have updated their UI. Use the admin panel to override selectors at runtime, ' +
        'or update the selector definitions in browser/selectors.ts.',
    );
    this.name = 'SelectorBrokenError';
  }
}


