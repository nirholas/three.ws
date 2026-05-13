// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Multi-Tenant Architecture Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOrganization,
  deleteOrganization,
  suspendOrganization,
  reactivateOrganization,
  changePlan,
  getOrganization,
  getOrganizationBySlug,
  resolveApiKey,
  getOrgMembers,
  getOrgQuotas,
  getOrgApiKeys,
  getTenantEvents,
  addMember,
  removeMember,
  __resetStores,
} from '../tenant/organization';
import { PLANS, getPlan, getDefaultQuotas } from '../tenant/plans';
import { createFeatureFlags } from '../tenant/feature-flags';
import { runWithTenant, getTenantContext, getTenantContextOrNull, getCurrentOrgId } from '../tenant/context';
import { QuotaEnforcer } from '../tenant/quota-enforcer';
import { TenantRepository } from '../tenant/repository';
import { runIsolationChecks } from '../db/isolation-check';
import type { TenantContext, PlanTier } from '../tenant/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContext(orgId: string, plan: PlanTier = 'developer'): TenantContext {
  const planDef = getPlan(plan);
  return {
    orgId,
    plan: planDef,
    quotas: getDefaultQuotas(plan),
    features: createFeatureFlags(planDef.features),
    org: {
      id: orgId,
      name: 'Test Org',
      slug: 'test-org',
      ownerId: 'user-1',
      plan,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

// ---------------------------------------------------------------------------
// Plan Definitions
// ---------------------------------------------------------------------------

describe('Plan Definitions', () => {
  it('should have all five plan tiers', () => {
    const tiers: PlanTier[] = ['free', 'developer', 'pro', 'business', 'enterprise'];
    for (const tier of tiers) {
      expect(PLANS[tier]).toBeDefined();
      expect(PLANS[tier].tier).toBe(tier);
    }
  });

  it('should have increasing quotas across tiers', () => {
    const tiers: PlanTier[] = ['free', 'developer', 'pro', 'business'];
    for (let i = 1; i < tiers.length; i++) {
      const prev = PLANS[tiers[i - 1]];
      const curr = PLANS[tiers[i]];
      expect(curr.maxAgents).toBeGreaterThan(prev.maxAgents);
      expect(curr.maxConcurrentSessions).toBeGreaterThan(prev.maxConcurrentSessions);
      expect(curr.maxApiCallsPerMinute).toBeGreaterThan(prev.maxApiCallsPerMinute);
    }
  });

  it('should have enterprise with Infinity quotas', () => {
    expect(PLANS.enterprise.maxAgents).toBe(Infinity);
    expect(PLANS.enterprise.maxConcurrentSessions).toBe(Infinity);
    expect(PLANS.enterprise.maxSessionMinutesPerMonth).toBe(Infinity);
    expect(PLANS.enterprise.price).toBeNull();
  });

  it('should throw for unknown plan tier', () => {
    expect(() => getPlan('nonexistent' as PlanTier)).toThrow('Unknown plan tier');
  });

  it('should return default quotas with zero usage', () => {
    const quotas = getDefaultQuotas('developer');
    expect(quotas.currentAgents).toBe(0);
    expect(quotas.currentSessions).toBe(0);
    expect(quotas.usedSessionMinutes).toBe(0);
    expect(quotas.maxAgents).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

describe('Feature Flags', () => {
  it('should resolve explicit features', () => {
    const flags = createFeatureFlags(['single-agent', 'basic-tts']);
    expect(flags.isEnabled('single-agent')).toBe(true);
    expect(flags.isEnabled('basic-tts')).toBe(true);
    expect(flags.isEnabled('multi-agent')).toBe(false);
    expect(flags.isEnabled('webhooks')).toBe(false);
  });

  it('should resolve wildcard features', () => {
    const flags = createFeatureFlags(['*']);
    expect(flags.isEnabled('single-agent')).toBe(true);
    expect(flags.isEnabled('multi-agent')).toBe(true);
    expect(flags.isEnabled('webhooks')).toBe(true);
    expect(flags.isEnabled('white-label')).toBe(true);
    expect(flags.isEnabled('dedicated-infra')).toBe(true);
  });

  it('should resolve wildcard with exclusions', () => {
    const flags = createFeatureFlags(['*', '-white-label', '-dedicated-infra']);
    expect(flags.isEnabled('single-agent')).toBe(true);
    expect(flags.isEnabled('webhooks')).toBe(true);
    expect(flags.isEnabled('white-label')).toBe(false);
    expect(flags.isEnabled('dedicated-infra')).toBe(false);
  });

  it('should return all enabled features', () => {
    const flags = createFeatureFlags(['single-agent', 'basic-tts']);
    expect(flags.enabled()).toEqual(['single-agent', 'basic-tts']);
  });

  it('pro plan should exclude white-label, custom-sla, dedicated-infra', () => {
    const flags = createFeatureFlags(PLANS.pro.features);
    expect(flags.isEnabled('webhooks')).toBe(true);
    expect(flags.isEnabled('white-label')).toBe(false);
    expect(flags.isEnabled('custom-sla')).toBe(false);
    expect(flags.isEnabled('dedicated-infra')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tenant Context (AsyncLocalStorage)
// ---------------------------------------------------------------------------

describe('Tenant Context', () => {
  it('should return null outside of tenant scope', () => {
    expect(getTenantContextOrNull()).toBeNull();
  });

  it('should throw when getting context outside scope', () => {
    expect(() => getTenantContext()).toThrow('No tenant context available');
  });

  it('should provide context within runWithTenant', () => {
    const ctx = buildContext('org-1');
    runWithTenant(ctx, () => {
      const resolved = getTenantContext();
      expect(resolved.orgId).toBe('org-1');
      expect(resolved.plan.tier).toBe('developer');
    });
  });

  it('should isolate nested contexts', () => {
    const ctxA = buildContext('org-a');
    const ctxB = buildContext('org-b');

    runWithTenant(ctxA, () => {
      expect(getCurrentOrgId()).toBe('org-a');

      runWithTenant(ctxB, () => {
        expect(getCurrentOrgId()).toBe('org-b');
      });

      // Back to A after nested B exits
      expect(getCurrentOrgId()).toBe('org-a');
    });
  });

  it('should return null again after scope exits', () => {
    const ctx = buildContext('org-1');
    runWithTenant(ctx, () => {
      expect(getTenantContextOrNull()).not.toBeNull();
    });
    expect(getTenantContextOrNull()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Organization Lifecycle
// ---------------------------------------------------------------------------

describe('Organization Lifecycle', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('should create an organization with owner and API key', () => {
    const result = createOrganization({
      name: 'Acme Corp',
      ownerEmail: 'admin@acme.com',
      ownerName: 'Admin User',
    });

    expect(result.org.name).toBe('Acme Corp');
    expect(result.org.slug).toBe('acme-corp');
    expect(result.org.status).toBe('active');
    expect(result.org.plan).toBe('free');
    expect(result.owner.role).toBe('owner');
    expect(result.owner.email).toBe('admin@acme.com');
    expect(result.apiKey.rawValue).toMatch(/^xsa_/);
    expect(result.apiKey.key.orgId).toBe(result.org.id);
  });

  it('should create with custom plan and slug', () => {
    const result = createOrganization({
      name: 'Pro Company',
      ownerEmail: 'admin@pro.com',
      plan: 'pro',
      slug: 'pro-co',
    });

    expect(result.org.plan).toBe('pro');
    expect(result.org.slug).toBe('pro-co');
  });

  it('should reject duplicate slugs', () => {
    createOrganization({ name: 'First', ownerEmail: 'a@a.com', slug: 'unique-slug' });
    expect(() =>
      createOrganization({ name: 'Second', ownerEmail: 'b@b.com', slug: 'unique-slug' }),
    ).toThrow('already taken');
  });

  it('should look up org by slug', () => {
    const { org } = createOrganization({ name: 'Slug Test', ownerEmail: 'a@a.com' });
    const found = getOrganizationBySlug(org.slug);
    expect(found?.id).toBe(org.id);
    expect(getOrganizationBySlug('nonexistent')).toBeUndefined();
  });

  it('should resolve API key to org', () => {
    const { org, apiKey } = createOrganization({ name: 'Key Test', ownerEmail: 'a@a.com' });
    const resolved = resolveApiKey(apiKey.rawValue);
    expect(resolved?.org.id).toBe(org.id);
    expect(resolveApiKey('invalid-key')).toBeUndefined();
  });

  it('should suspend and reactivate an organization', () => {
    const { org } = createOrganization({ name: 'Suspend Test', ownerEmail: 'a@a.com' });

    suspendOrganization(org.id, 'non_payment');
    const suspended = getOrganization(org.id);
    expect(suspended?.status).toBe('suspended');
    expect(suspended?.suspensionReason).toBe('non_payment');

    reactivateOrganization(org.id);
    const reactivated = getOrganization(org.id);
    expect(reactivated?.status).toBe('active');
    expect(reactivated?.suspensionReason).toBeUndefined();
  });

  it('should not double-suspend', () => {
    const { org } = createOrganization({ name: 'Double Suspend', ownerEmail: 'a@a.com' });
    suspendOrganization(org.id, 'abuse');
    expect(() => suspendOrganization(org.id, 'abuse')).toThrow('already suspended');
  });

  it('should delete an organization', () => {
    const { org } = createOrganization({ name: 'Delete Test', ownerEmail: 'a@a.com' });
    deleteOrganization(org.id);
    const deleted = getOrganization(org.id);
    expect(deleted?.status).toBe('deleted');
  });

  it('should change plan', () => {
    const { org } = createOrganization({ name: 'Plan Test', ownerEmail: 'a@a.com' });
    expect(org.plan).toBe('free');

    changePlan(org.id, 'pro');
    const updated = getOrganization(org.id);
    expect(updated?.plan).toBe('pro');
  });

  it('should track tenant events', () => {
    const { org } = createOrganization({ name: 'Events Test', ownerEmail: 'a@a.com' });
    suspendOrganization(org.id, 'abuse');
    reactivateOrganization(org.id);

    const events = getTenantEvents(org.id);
    expect(events.length).toBe(3); // created, suspended, reactivated
    expect(events[0].type).toBe('org.created');
    expect(events[1].type).toBe('org.suspended');
    expect(events[2].type).toBe('org.reactivated');
  });
});

// ---------------------------------------------------------------------------
// Member Management
// ---------------------------------------------------------------------------

describe('Member Management', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('should add and list members', () => {
    const { org } = createOrganization({ name: 'Members Test', ownerEmail: 'owner@test.com' });

    addMember({ orgId: org.id, email: 'member@test.com', role: 'member' });
    addMember({ orgId: org.id, email: 'admin@test.com', role: 'admin' });

    const members = getOrgMembers(org.id);
    expect(members.length).toBe(3); // owner + 2 members
    expect(members.find((m) => m.email === 'member@test.com')?.role).toBe('member');
  });

  it('should reject duplicate email in same org', () => {
    const { org } = createOrganization({ name: 'Dup Test', ownerEmail: 'owner@test.com' });
    addMember({ orgId: org.id, email: 'dup@test.com' });
    expect(() => addMember({ orgId: org.id, email: 'dup@test.com' })).toThrow('already exists');
  });

  it('should remove member but not owner', () => {
    const { org, owner } = createOrganization({ name: 'Remove Test', ownerEmail: 'owner@test.com' });
    const member = addMember({ orgId: org.id, email: 'remove@test.com' });

    removeMember(org.id, member.userId);
    expect(getOrgMembers(org.id).length).toBe(1); // only owner remains

    expect(() => removeMember(org.id, owner.userId)).toThrow('Cannot remove the organization owner');
  });
});

// ---------------------------------------------------------------------------
// Quota Enforcer
// ---------------------------------------------------------------------------

describe('Quota Enforcer', () => {
  it('should pass when within limits', () => {
    const ctx = buildContext('org-1', 'developer');
    expect(() => QuotaEnforcer.validate(ctx, 'create-agent')).not.toThrow();
    expect(() => QuotaEnforcer.validate(ctx, 'start-session')).not.toThrow();
  });

  it('should throw when max agents exceeded', () => {
    const ctx = buildContext('org-1', 'free');
    ctx.quotas.currentAgents = 1; // free plan allows 1
    expect(() => QuotaEnforcer.checkAgentCreation(ctx.quotas)).toThrow('maxAgents');
  });

  it('should throw when max sessions exceeded', () => {
    const ctx = buildContext('org-1', 'free');
    ctx.quotas.currentSessions = 1; // free plan allows 1
    expect(() => QuotaEnforcer.checkSessionStart(ctx.quotas)).toThrow('maxConcurrentSessions');
  });

  it('should throw when session minutes exhausted', () => {
    const ctx = buildContext('org-1', 'free');
    ctx.quotas.usedSessionMinutes = 60; // free plan allows 60
    expect(() => QuotaEnforcer.checkSessionStart(ctx.quotas)).toThrow('maxSessionMinutesPerMonth');
  });

  it('should throw when feature not available', () => {
    const ctx = buildContext('org-1', 'free');
    expect(() => QuotaEnforcer.checkFeature(ctx, 'multi-agent')).toThrow('feature:multi-agent');
  });

  it('should pass feature check when available', () => {
    const ctx = buildContext('org-1', 'developer');
    expect(() => QuotaEnforcer.checkFeature(ctx, 'multi-agent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tenant Repository
// ---------------------------------------------------------------------------

describe('Tenant Repository', () => {
  let repo: TenantRepository<{ id: string; data: string }>;

  beforeEach(() => {
    repo = new TenantRepository('test');
  });

  it('should isolate data between orgs', () => {
    repo.create('org-a', { id: '1', data: 'a-data' });
    repo.create('org-b', { id: '1', data: 'b-data' });

    expect(repo.get('org-a', '1')?.data).toBe('a-data');
    expect(repo.get('org-b', '1')?.data).toBe('b-data');
  });

  it('should not leak data across orgs on list', () => {
    repo.create('org-a', { id: '1', data: 'a1' });
    repo.create('org-a', { id: '2', data: 'a2' });
    repo.create('org-b', { id: '3', data: 'b1' });

    expect(repo.list('org-a').length).toBe(2);
    expect(repo.list('org-b').length).toBe(1);
    expect(repo.list('org-c').length).toBe(0);
  });

  it('should support context-based access', () => {
    repo.create('org-a', { id: '1', data: 'secret-a' });
    repo.create('org-b', { id: '2', data: 'secret-b' });

    const ctxA = buildContext('org-a');
    runWithTenant(ctxA, () => {
      const items = repo.listFromContext();
      expect(items.length).toBe(1);
      expect(items[0].data).toBe('secret-a');
    });
  });

  it('should scope delete to org', () => {
    repo.create('org-a', { id: '1', data: 'a' });
    repo.create('org-b', { id: '1', data: 'b' });

    repo.delete('org-a', '1');
    expect(repo.get('org-a', '1')).toBeUndefined();
    expect(repo.get('org-b', '1')?.data).toBe('b');
  });

  it('should scope deleteAll to org', () => {
    repo.create('org-a', { id: '1', data: 'a1' });
    repo.create('org-a', { id: '2', data: 'a2' });
    repo.create('org-b', { id: '3', data: 'b1' });

    repo.deleteAll('org-a');
    expect(repo.count('org-a')).toBe(0);
    expect(repo.count('org-b')).toBe(1);
  });

  it('should update within org scope', () => {
    repo.create('org-a', { id: '1', data: 'original' });
    repo.update('org-a', '1', { data: 'updated' });
    expect(repo.get('org-a', '1')?.data).toBe('updated');
  });

  it('should throw when updating non-existent entity in org', () => {
    repo.create('org-a', { id: '1', data: 'a' });
    expect(() => repo.update('org-b', '1', { data: 'hack' })).toThrow('not found');
  });

  it('should find within org scope', () => {
    repo.create('org-a', { id: '1', data: 'match' });
    repo.create('org-a', { id: '2', data: 'no-match' });
    repo.create('org-b', { id: '3', data: 'match' });

    const found = repo.find('org-a', (e) => e.data === 'match');
    expect(found.length).toBe(1);
    expect(found[0].id).toBe('1');
  });

  it('should reject duplicate entity in same org', () => {
    repo.create('org-a', { id: '1', data: 'a' });
    expect(() => repo.create('org-a', { id: '1', data: 'dup' })).toThrow('already exists');
  });
});

// ---------------------------------------------------------------------------
// Data Isolation Integration Test
// ---------------------------------------------------------------------------

describe('Data Isolation Verification', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('should pass all isolation checks', () => {
    const report = runIsolationChecks();

    for (const result of report.results) {
      expect(result.passed, `FAILED: ${result.check} — ${result.details}`).toBe(true);
    }

    expect(report.passed).toBe(true);
    expect(report.tenantsCreated).toBe(2);
  });
});


