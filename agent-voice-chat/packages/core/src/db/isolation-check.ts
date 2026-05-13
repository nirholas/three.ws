// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Data Isolation Verification — Automated cross-tenant leakage detection
// =============================================================================

import {
  createOrganization,
  __resetStores,
} from '../tenant/organization';
import { runWithTenant, getTenantContext } from '../tenant/context';
import { TenantRepository } from '../tenant/repository';
import type { TenantContext, Organization } from '../tenant/types';
import { getPlan as getPlanFn } from '../tenant/plans';
import { createFeatureFlags as createFlagsFn } from '../tenant/feature-flags';

export { __resetStores };

/** Test entity for isolation checks. */
interface TestEntity {
  id: string;
  name: string;
  secret: string;
}

/** Result of a single isolation check. */
export interface IsolationCheckResult {
  check: string;
  passed: boolean;
  details?: string;
}

/** Full isolation report. */
export interface IsolationReport {
  passed: boolean;
  results: IsolationCheckResult[];
  tenantsCreated: number;
  timestamp: Date;
}

function buildContext(org: Organization, userId?: string): TenantContext {
  const plan = getPlanFn(org.plan);
  return {
    orgId: org.id,
    userId,
    plan,
    quotas: {
      maxAgents: plan.maxAgents,
      currentAgents: 0,
      maxConcurrentSessions: plan.maxConcurrentSessions,
      currentSessions: 0,
      maxSessionMinutesPerMonth: plan.maxSessionMinutesPerMonth,
      usedSessionMinutes: 0,
      maxApiCallsPerMinute: plan.maxApiCallsPerMinute,
    },
    features: createFlagsFn(plan.features),
    org,
  };
}

/**
 * Run the full suite of data isolation checks.
 *
 * Creates two test tenants and verifies that data from one tenant
 * is never visible to the other through any access path.
 *
 * Designed to run in CI on every PR.
 */
export function runIsolationChecks(): IsolationReport {
  const results: IsolationCheckResult[] = [];

  // Create two test tenants
  const tenantA = createOrganization({
    name: 'Isolation Test A',
    ownerEmail: 'a@test.com',
    slug: 'isolation-test-a',
  });

  const tenantB = createOrganization({
    name: 'Isolation Test B',
    ownerEmail: 'b@test.com',
    slug: 'isolation-test-b',
  });

  const ctxA = buildContext(tenantA.org, tenantA.owner.userId);
  const ctxB = buildContext(tenantB.org, tenantB.owner.userId);

  // ------------------------------------------------------------------
  // Check 1: TenantRepository — direct access isolation
  // ------------------------------------------------------------------
  const repo = new TenantRepository<TestEntity>('test-entity');

  repo.create(tenantA.org.id, { id: 'e1', name: 'Entity A1', secret: 'secret-a' });
  repo.create(tenantA.org.id, { id: 'e2', name: 'Entity A2', secret: 'secret-a2' });
  repo.create(tenantB.org.id, { id: 'e1', name: 'Entity B1', secret: 'secret-b' });

  // Tenant B should NOT see Tenant A's entities
  const bEntities = repo.list(tenantB.org.id);
  results.push({
    check: 'Repository: Tenant B list does not include Tenant A data',
    passed: bEntities.length === 1 && bEntities[0].name === 'Entity B1',
    details: `Tenant B sees ${bEntities.length} entities: ${bEntities.map((e) => e.name).join(', ')}`,
  });

  // Same entity ID in different orgs should return different data
  const aEntity = repo.get(tenantA.org.id, 'e1');
  const bEntity = repo.get(tenantB.org.id, 'e1');
  results.push({
    check: 'Repository: Same entity ID returns different data per tenant',
    passed: aEntity?.secret === 'secret-a' && bEntity?.secret === 'secret-b',
    details: `A.secret=${aEntity?.secret}, B.secret=${bEntity?.secret}`,
  });

  // Tenant B cannot access Tenant A's entity by ID
  const crossAccess = repo.get(tenantB.org.id, 'e2');
  results.push({
    check: 'Repository: Cross-tenant entity access returns undefined',
    passed: crossAccess === undefined,
    details: `Cross-access result: ${crossAccess === undefined ? 'undefined (correct)' : JSON.stringify(crossAccess)}`,
  });

  // ------------------------------------------------------------------
  // Check 2: TenantRepository — context-based access isolation
  // ------------------------------------------------------------------
  let contextCheckPassed = false;
  runWithTenant(ctxB, () => {
    const entities = repo.listFromContext();
    contextCheckPassed = entities.length === 1 && entities[0].secret === 'secret-b';
  });
  results.push({
    check: 'Repository: Context-based list scoped to current tenant',
    passed: contextCheckPassed,
  });

  // ------------------------------------------------------------------
  // Check 3: TenantRepository — deletion isolation
  // ------------------------------------------------------------------
  repo.delete(tenantA.org.id, 'e1');
  const bAfterDelete = repo.get(tenantB.org.id, 'e1');
  results.push({
    check: 'Repository: Deleting in Tenant A does not affect Tenant B',
    passed: bAfterDelete?.secret === 'secret-b',
  });

  // ------------------------------------------------------------------
  // Check 4: TenantRepository — count isolation
  // ------------------------------------------------------------------
  results.push({
    check: 'Repository: Count is scoped per tenant',
    passed: repo.count(tenantA.org.id) === 1 && repo.count(tenantB.org.id) === 1,
    details: `A count=${repo.count(tenantA.org.id)}, B count=${repo.count(tenantB.org.id)}`,
  });

  // ------------------------------------------------------------------
  // Check 5: TenantRepository — find isolation
  // ------------------------------------------------------------------
  const foundInA = repo.find(tenantA.org.id, () => true);
  const foundInB = repo.find(tenantB.org.id, () => true);
  results.push({
    check: 'Repository: Find scoped per tenant',
    passed: foundInA.every((e) => e.secret.startsWith('secret-a')) &&
            foundInB.every((e) => e.secret === 'secret-b'),
  });

  // ------------------------------------------------------------------
  // Check 6: TenantRepository — deleteAll only affects target tenant
  // ------------------------------------------------------------------
  repo.deleteAll(tenantA.org.id);
  results.push({
    check: 'Repository: deleteAll only removes target tenant data',
    passed: repo.count(tenantA.org.id) === 0 && repo.count(tenantB.org.id) === 1,
  });

  // ------------------------------------------------------------------
  // Check 7: AsyncLocalStorage context isolation
  // ------------------------------------------------------------------
  let contextA: string | undefined;
  let contextB: string | undefined;

  runWithTenant(ctxA, () => {
    contextA = getTenantContext().orgId;
    runWithTenant(ctxB, () => {
      contextB = getTenantContext().orgId;
    });
    // After nested context exits, should be back to A
    const afterNested = getTenantContext().orgId;
    results.push({
      check: 'Context: Nested tenant contexts isolate correctly',
      passed:
        contextA === tenantA.org.id &&
        contextB === tenantB.org.id &&
        afterNested === tenantA.org.id,
      details: `A=${contextA}, B=${contextB}, afterNested=${afterNested}`,
    });
  });

  // ------------------------------------------------------------------
  // Check 8: Organization data isolation
  // ------------------------------------------------------------------
  const orgA = tenantA.org;
  const orgB = tenantB.org;
  results.push({
    check: 'Organization: Different orgs have different IDs',
    passed: orgA.id !== orgB.id,
  });

  results.push({
    check: 'Organization: Different orgs have different slugs',
    passed: orgA.slug !== orgB.slug,
  });

  // ------------------------------------------------------------------
  // Check 9: API key isolation
  // ------------------------------------------------------------------
  results.push({
    check: 'API Key: Each org gets its own API key',
    passed:
      tenantA.apiKey.key.orgId === tenantA.org.id &&
      tenantB.apiKey.key.orgId === tenantB.org.id &&
      tenantA.apiKey.rawValue !== tenantB.apiKey.rawValue,
  });

  // Cleanup
  repo.__reset();

  const passed = results.every((r) => r.passed);

  return {
    passed,
    results,
    tenantsCreated: 2,
    timestamp: new Date(),
  };
}


