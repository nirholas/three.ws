// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Tenant Context — AsyncLocalStorage-based tenant context propagation
// =============================================================================

import { AsyncLocalStorage } from 'async_hooks';
import type { TenantContext, OrgId } from './types';

export type { TenantContext };

/**
 * AsyncLocalStorage instance that carries tenant context through the
 * entire request lifecycle without explicit parameter passing.
 *
 * Every code path that accesses tenant-scoped data should call
 * `getTenantContext()` to retrieve the current tenant.
 */
const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Run a callback within a tenant context.
 * All code executed inside the callback (including async operations)
 * can access the tenant via `getTenantContext()`.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

/**
 * Get the current tenant context.
 * Throws if called outside a tenant context (i.e., no middleware ran).
 */
export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context available. Ensure the request passed through tenant middleware.',
    );
  }
  return ctx;
}

/**
 * Get the current tenant context, or null if not in a tenant scope.
 * Useful for code paths that may run both inside and outside tenant context.
 */
export function getTenantContextOrNull(): TenantContext | null {
  return tenantStorage.getStore() ?? null;
}

/**
 * Get the current org ID from tenant context.
 * Convenience shorthand for `getTenantContext().orgId`.
 */
export function getCurrentOrgId(): OrgId {
  return getTenantContext().orgId;
}


