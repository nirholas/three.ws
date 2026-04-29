// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Quota Enforcer — Runtime quota checking and enforcement
// =============================================================================

import type { Quotas, PlanTier, TenantContext } from './types';
import { getPlan } from './plans';

/** Quota violation error with HTTP-friendly status code. */
export class QuotaExceededError extends Error {
  readonly statusCode = 429;
  readonly quotaType: string;
  readonly current: number;
  readonly limit: number;

  constructor(quotaType: string, current: number, limit: number) {
    super(`Quota exceeded: ${quotaType} (${current}/${limit})`);
    this.name = 'QuotaExceededError';
    this.quotaType = quotaType;
    this.current = current;
    this.limit = limit;
  }
}

/**
 * QuotaEnforcer checks runtime quotas against plan limits.
 * Throws QuotaExceededError when a limit is breached.
 */
export class QuotaEnforcer {
  /**
   * Check if the tenant can create a new agent.
   */
  static checkAgentCreation(quotas: Quotas): void {
    if (quotas.currentAgents >= quotas.maxAgents) {
      throw new QuotaExceededError('maxAgents', quotas.currentAgents, quotas.maxAgents);
    }
  }

  /**
   * Check if the tenant can start a new session.
   */
  static checkSessionStart(quotas: Quotas): void {
    if (quotas.currentSessions >= quotas.maxConcurrentSessions) {
      throw new QuotaExceededError(
        'maxConcurrentSessions',
        quotas.currentSessions,
        quotas.maxConcurrentSessions,
      );
    }

    if (quotas.usedSessionMinutes >= quotas.maxSessionMinutesPerMonth) {
      throw new QuotaExceededError(
        'maxSessionMinutesPerMonth',
        quotas.usedSessionMinutes,
        quotas.maxSessionMinutesPerMonth,
      );
    }
  }

  /**
   * Check if a feature is available on the tenant's plan.
   */
  static checkFeature(ctx: TenantContext, feature: string): void {
    if (!ctx.features.isEnabled(feature)) {
      throw new QuotaExceededError(
        `feature:${feature}`,
        0,
        0,
      );
    }
  }

  /**
   * Validate all quotas for a given operation.
   */
  static validate(
    ctx: TenantContext,
    operation: 'create-agent' | 'start-session' | 'api-call',
  ): void {
    switch (operation) {
      case 'create-agent':
        QuotaEnforcer.checkAgentCreation(ctx.quotas);
        break;
      case 'start-session':
        QuotaEnforcer.checkSessionStart(ctx.quotas);
        break;
      case 'api-call':
        // API rate limiting is handled by the rate limiter middleware
        // with tenant-specific limits from ctx.quotas.maxApiCallsPerMinute
        break;
    }
  }
}


