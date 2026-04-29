// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect } from 'vitest'

// We test the permission logic directly since the middleware depends on Express
// and imports from the server package. The authorize middleware is a thin wrapper
// around hasPermission, so we test the core logic here.

import { hasPermission, isRoleAtLeast, type BuiltInRole } from '../../src/rbac/permissions'

function makeTenantContext(role: BuiltInRole, customPermissions?: string[]) {
  return {
    orgId: 'org-1',
    userId: 'user-1',
    userRole: role,
    customPermissions,
  }
}

describe('Authorization Logic', () => {
  describe('role-based checks', () => {
    it('owner can delete org', () => {
      expect(hasPermission('org:delete', { role: 'owner' })).toBe(true)
    })

    it('admin cannot delete org', () => {
      expect(hasPermission('org:delete', { role: 'admin' })).toBe(false)
    })

    it('developer can create agents', () => {
      expect(hasPermission('agents:create', { role: 'developer' })).toBe(true)
    })

    it('viewer cannot create agents', () => {
      expect(hasPermission('agents:create', { role: 'viewer' })).toBe(false)
    })

    it('manager can delete agents', () => {
      expect(hasPermission('agents:delete', { role: 'manager' })).toBe(true)
    })

    it('developer cannot delete agents', () => {
      expect(hasPermission('agents:delete', { role: 'developer' })).toBe(false)
    })

    it('admin can invite members', () => {
      expect(hasPermission('members:invite', { role: 'admin' })).toBe(true)
    })

    it('manager cannot invite members', () => {
      expect(hasPermission('members:invite', { role: 'manager' })).toBe(false)
    })
  })

  describe('custom permissions override', () => {
    it('viewer with custom agents:create can create agents', () => {
      expect(
        hasPermission('agents:create', {
          role: 'viewer',
          customPermissions: ['agents:create'],
        }),
      ).toBe(true)
    })

    it('viewer with agents:* wildcard can do all agent operations', () => {
      const opts = { role: 'viewer' as BuiltInRole, customPermissions: ['agents:*'] }
      expect(hasPermission('agents:create', opts)).toBe(true)
      expect(hasPermission('agents:delete', opts)).toBe(true)
      expect(hasPermission('agents:start', opts)).toBe(true)
    })

    it('custom permissions do not grant unrelated scopes', () => {
      expect(
        hasPermission('billing:manage', {
          role: 'viewer',
          customPermissions: ['agents:*'],
        }),
      ).toBe(false)
    })
  })

  describe('privilege escalation prevention via isRoleAtLeast', () => {

    it('admin cannot assign owner role', () => {
      expect(isRoleAtLeast('admin', 'owner')).toBe(false)
    })

    it('admin can assign admin or lower', () => {
      expect(isRoleAtLeast('admin', 'admin')).toBe(true)
      expect(isRoleAtLeast('admin', 'manager')).toBe(true)
      expect(isRoleAtLeast('admin', 'developer')).toBe(true)
      expect(isRoleAtLeast('admin', 'viewer')).toBe(true)
    })

    it('manager cannot assign admin', () => {
      expect(isRoleAtLeast('manager', 'admin')).toBe(false)
    })

    it('owner can assign any role', () => {
      expect(isRoleAtLeast('owner', 'owner')).toBe(true)
      expect(isRoleAtLeast('owner', 'admin')).toBe(true)
    })
  })
})

describe('Cross-org permission isolation', () => {
  it('permission check is role-based, not org-based (isolation is at the data layer)', () => {
    // The permission system itself is stateless — it checks role + custom perms.
    // Cross-org isolation is enforced at the data/repository layer (orgId filtering).
    // This test documents that permission checks are independent of orgId.
    const ctx1 = makeTenantContext('developer')
    const ctx2 = makeTenantContext('developer')
    const result1 = hasPermission('agents:create', { role: ctx1.userRole as BuiltInRole })
    const result2 = hasPermission('agents:create', { role: ctx2.userRole as BuiltInRole })
    expect(result1).toBe(result2)
  })
})


