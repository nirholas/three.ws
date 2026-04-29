// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

// =============================================================================
// Tenant-Scoped Repository — Base class for tenant-isolated data access
// =============================================================================

import type { OrgId } from './types';
import { getCurrentOrgId } from './context';

/**
 * Generic in-memory tenant-scoped repository.
 *
 * All data is partitioned by orgId. Queries always filter by the current
 * tenant context, making cross-tenant data leakage impossible at the
 * repository layer.
 *
 * In production, this will be replaced with Drizzle/PostgreSQL repositories
 * that use RLS policies as defense-in-depth.
 *
 * @typeParam T - The entity type stored in this repository.
 */
export class TenantRepository<T extends { id: string }> {
  /** Storage: orgId -> entityId -> entity */
  private store = new Map<OrgId, Map<string, T>>();

  constructor(readonly entityName: string) {}

  /** Get the partition map for an org, creating if needed. */
  private partition(orgId: OrgId): Map<string, T> {
    let p = this.store.get(orgId);
    if (!p) {
      p = new Map();
      this.store.set(orgId, p);
    }
    return p;
  }

  /**
   * Create an entity under the given org.
   * orgId is REQUIRED — never optional, never inferred silently.
   */
  create(orgId: OrgId, entity: T): T {
    const p = this.partition(orgId);
    if (p.has(entity.id)) {
      throw new Error(`${this.entityName} with id ${entity.id} already exists in org ${orgId}`);
    }
    p.set(entity.id, entity);
    return entity;
  }

  /**
   * Get an entity by ID within an org.
   * Returns undefined if not found (never leaks data from other orgs).
   */
  get(orgId: OrgId, entityId: string): T | undefined {
    return this.partition(orgId).get(entityId);
  }

  /**
   * Get an entity by ID using the current AsyncLocalStorage tenant context.
   * Convenience method for request-scoped code.
   */
  getFromContext(entityId: string): T | undefined {
    return this.get(getCurrentOrgId(), entityId);
  }

  /**
   * List all entities for an org.
   */
  list(orgId: OrgId): T[] {
    return [...this.partition(orgId).values()];
  }

  /**
   * List all entities using the current AsyncLocalStorage tenant context.
   */
  listFromContext(): T[] {
    return this.list(getCurrentOrgId());
  }

  /**
   * Update an entity. Must exist in the specified org.
   */
  update(orgId: OrgId, entityId: string, updates: Partial<T>): T {
    const p = this.partition(orgId);
    const existing = p.get(entityId);
    if (!existing) {
      throw new Error(`${this.entityName} with id ${entityId} not found in org ${orgId}`);
    }
    const updated = { ...existing, ...updates, id: entityId };
    p.set(entityId, updated);
    return updated;
  }

  /**
   * Delete an entity from an org.
   */
  delete(orgId: OrgId, entityId: string): boolean {
    return this.partition(orgId).delete(entityId);
  }

  /**
   * Count entities in an org.
   */
  count(orgId: OrgId): number {
    return this.partition(orgId).size;
  }

  /**
   * Check if an entity exists in an org.
   */
  exists(orgId: OrgId, entityId: string): boolean {
    return this.partition(orgId).has(entityId);
  }

  /**
   * Find entities matching a predicate within an org.
   */
  find(orgId: OrgId, predicate: (entity: T) => boolean): T[] {
    return this.list(orgId).filter(predicate);
  }

  /**
   * Remove all data for an org (used during org deletion).
   */
  deleteAll(orgId: OrgId): void {
    this.store.delete(orgId);
  }

  /** Reset all data. For testing only. */
  __reset(): void {
    this.store.clear();
  }
}


