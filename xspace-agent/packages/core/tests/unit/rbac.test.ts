// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§86]

import { describe, it, expect } from 'vitest'
import {
  ROLES,
  PERMISSION_SCOPES,
  resolvePermissions,
  roleHasPermission,
  roleHasAllPermissions,
  isRoleAtLeast,
  matchesPermission,
  hasPermission,
  isValidPermission,
  validatePermissions,
  type BuiltInRole,
  type Permission,
} from '../../src/rbac/permissions'

// =============================================================================
// Role Definitions
// =============================================================================

describe('RBAC — Role Definitions', () => {
  it('defines all 5 built-in roles', () => {
    const roles = Object.keys(ROLES)
    expect(roles).toEqual(['owner', 'admin', 'manager', 'developer', 'viewer'])
  })

  it('viewer has no inherited roles', () => {
    expect(ROLES.viewer.inherits).toEqual([])
  })

  it('each role inherits from the next lower role', () => {
    expect(ROLES.owner.inherits).toContain('admin')
    expect(ROLES.admin.inherits).toContain('manager')
    expect(ROLES.manager.inherits).toContain('developer')
    expect(ROLES.developer.inherits).toContain('viewer')
  })
})

// =============================================================================
// Permission Resolution (with inheritance)
// =============================================================================

describe('RBAC — Permission Resolution', () => {
  it('viewer gets only viewer permissions', () => {
    const perms = resolvePermissions('viewer')
    expect(perms.has('org:read')).toBe(true)
    expect(perms.has('agents:read')).toBe(true)
    expect(perms.has('conversations:read')).toBe(true)
    expect(perms.has('analytics:read')).toBe(true)
    expect(perms.has('usage:read')).toBe(true)
    // Should NOT have write permissions
    expect(perms.has('agents:create')).toBe(false)
    expect(perms.has('org:delete')).toBe(false)
  })

  it('developer inherits viewer permissions and adds its own', () => {
    const perms = resolvePermissions('developer')
    // Inherited from viewer
    expect(perms.has('org:read')).toBe(true)
    expect(perms.has('agents:read')).toBe(true)
    // Own permissions
    expect(perms.has('agents:create')).toBe(true)
    expect(perms.has('agents:update')).toBe(true)
    expect(perms.has('agents:start')).toBe(true)
    expect(perms.has('agents:stop')).toBe(true)
    // Should NOT have manager-level permissions
    expect(perms.has('agents:delete')).toBe(false)
    expect(perms.has('teams:create')).toBe(false)
  })

  it('manager inherits developer+viewer and adds its own', () => {
    const perms = resolvePermissions('manager')
    // From viewer
    expect(perms.has('org:read')).toBe(true)
    // From developer
    expect(perms.has('agents:create')).toBe(true)
    // Own
    expect(perms.has('agents:delete')).toBe(true)
    expect(perms.has('teams:create')).toBe(true)
    expect(perms.has('webhooks:create')).toBe(true)
    // Should NOT have admin-level
    expect(perms.has('members:invite')).toBe(false)
    expect(perms.has('sso:configure')).toBe(false)
  })

  it('admin inherits manager+developer+viewer and adds its own', () => {
    const perms = resolvePermissions('admin')
    // From viewer
    expect(perms.has('agents:read')).toBe(true)
    // From developer
    expect(perms.has('agents:create')).toBe(true)
    // From manager
    expect(perms.has('teams:create')).toBe(true)
    // Own
    expect(perms.has('members:invite')).toBe(true)
    expect(perms.has('members:update')).toBe(true)
    expect(perms.has('sso:configure')).toBe(true)
    expect(perms.has('audit:read')).toBe(true)
    // Should NOT have owner-level
    expect(perms.has('org:delete')).toBe(false)
    expect(perms.has('billing:manage')).toBe(false)
  })

  it('owner has all permissions including billing and org deletion', () => {
    const perms = resolvePermissions('owner')
    expect(perms.has('org:delete')).toBe(true)
    expect(perms.has('org:transfer')).toBe(true)
    expect(perms.has('billing:read')).toBe(true)
    expect(perms.has('billing:update')).toBe(true)
    expect(perms.has('billing:manage')).toBe(true)
    // All inherited
    expect(perms.has('agents:read')).toBe(true)
    expect(perms.has('agents:create')).toBe(true)
    expect(perms.has('teams:create')).toBe(true)
    expect(perms.has('members:invite')).toBe(true)
  })

  it('cached results are identical on repeated calls', () => {
    const a = resolvePermissions('admin')
    const b = resolvePermissions('admin')
    expect(a).toBe(b) // Same reference (cached)
  })
})

// =============================================================================
// Permission Checking
// =============================================================================

describe('RBAC — roleHasPermission', () => {
  it('returns true for directly assigned permissions', () => {
    expect(roleHasPermission('owner', 'org:delete')).toBe(true)
    expect(roleHasPermission('viewer', 'agents:read')).toBe(true)
  })

  it('returns true for inherited permissions', () => {
    expect(roleHasPermission('owner', 'agents:read')).toBe(true) // via admin > manager > developer > viewer
    expect(roleHasPermission('admin', 'agents:create')).toBe(true) // via manager > developer
  })

  it('returns false for permissions above role level', () => {
    expect(roleHasPermission('viewer', 'agents:create')).toBe(false)
    expect(roleHasPermission('developer', 'agents:delete')).toBe(false)
    expect(roleHasPermission('manager', 'members:invite')).toBe(false)
    expect(roleHasPermission('admin', 'org:delete')).toBe(false)
  })
})

describe('RBAC — roleHasAllPermissions', () => {
  it('returns true when role has all permissions', () => {
    expect(roleHasAllPermissions('owner', ['org:delete', 'billing:manage', 'agents:read'])).toBe(true)
  })

  it('returns false when role lacks any permission', () => {
    expect(roleHasAllPermissions('admin', ['agents:read', 'org:delete'])).toBe(false)
  })
})

// =============================================================================
// Role Hierarchy
// =============================================================================

describe('RBAC — isRoleAtLeast', () => {
  it('owner is at least any role', () => {
    expect(isRoleAtLeast('owner', 'owner')).toBe(true)
    expect(isRoleAtLeast('owner', 'admin')).toBe(true)
    expect(isRoleAtLeast('owner', 'viewer')).toBe(true)
  })

  it('viewer is only at least viewer', () => {
    expect(isRoleAtLeast('viewer', 'viewer')).toBe(true)
    expect(isRoleAtLeast('viewer', 'developer')).toBe(false)
    expect(isRoleAtLeast('viewer', 'owner')).toBe(false)
  })

  it('admin is at least admin, manager, developer, viewer but not owner', () => {
    expect(isRoleAtLeast('admin', 'admin')).toBe(true)
    expect(isRoleAtLeast('admin', 'manager')).toBe(true)
    expect(isRoleAtLeast('admin', 'developer')).toBe(true)
    expect(isRoleAtLeast('admin', 'viewer')).toBe(true)
    expect(isRoleAtLeast('admin', 'owner')).toBe(false)
  })
})

// =============================================================================
// Wildcard Permission Matching
// =============================================================================

describe('RBAC — matchesPermission', () => {
  it('exact match', () => {
    expect(matchesPermission('agents:create', 'agents:create')).toBe(true)
  })

  it('wildcard match', () => {
    expect(matchesPermission('agents:create', 'agents:*')).toBe(true)
    expect(matchesPermission('agents:delete', 'agents:*')).toBe(true)
  })

  it('wildcard does not match different resource', () => {
    expect(matchesPermission('teams:create', 'agents:*')).toBe(false)
  })

  it('non-matching exact', () => {
    expect(matchesPermission('agents:create', 'agents:delete')).toBe(false)
  })
})

// =============================================================================
// hasPermission (combined check)
// =============================================================================

describe('RBAC — hasPermission', () => {
  it('grants via built-in role', () => {
    expect(hasPermission('agents:create', { role: 'developer' })).toBe(true)
  })

  it('denies via built-in role when missing', () => {
    expect(hasPermission('agents:delete', { role: 'developer' })).toBe(false)
  })

  it('grants via custom permissions when role lacks it', () => {
    expect(
      hasPermission('agents:delete', {
        role: 'viewer',
        customPermissions: ['agents:delete'],
      }),
    ).toBe(true)
  })

  it('grants via wildcard custom permissions', () => {
    expect(
      hasPermission('agents:delete', {
        role: 'viewer',
        customPermissions: ['agents:*'],
      }),
    ).toBe(true)
  })

  it('denies when neither role nor custom permissions match', () => {
    expect(
      hasPermission('org:delete', {
        role: 'viewer',
        customPermissions: ['agents:*'],
      }),
    ).toBe(false)
  })
})

// =============================================================================
// Permission Validation
// =============================================================================

describe('RBAC — Permission Validation', () => {
  it('recognizes valid permission scopes', () => {
    expect(isValidPermission('agents:create')).toBe(true)
    expect(isValidPermission('org:delete')).toBe(true)
    expect(isValidPermission('billing:manage')).toBe(true)
  })

  it('rejects invalid permission scopes', () => {
    expect(isValidPermission('invalid:scope')).toBe(false)
    expect(isValidPermission('foo')).toBe(false)
  })

  it('validates an array of permissions', () => {
    const result = validatePermissions(['agents:create', 'org:read'])
    expect(result.valid).toBe(true)
    expect(result.invalid).toEqual([])
  })

  it('reports invalid entries in array', () => {
    const result = validatePermissions(['agents:create', 'invalid:perm', 'nope'])
    expect(result.valid).toBe(false)
    expect(result.invalid).toEqual(['invalid:perm', 'nope'])
  })

  it('accepts valid wildcard permissions', () => {
    const result = validatePermissions(['agents:*', 'org:*'])
    expect(result.valid).toBe(true)
  })

  it('rejects wildcards for non-existent resources', () => {
    const result = validatePermissions(['nonexistent:*'])
    expect(result.valid).toBe(false)
    expect(result.invalid).toEqual(['nonexistent:*'])
  })
})

// =============================================================================
// Coverage of all permission scopes
// =============================================================================

describe('RBAC — All permissions are assigned', () => {
  it('every permission scope is reachable by at least one built-in role', () => {
    const ownerPerms = resolvePermissions('owner')
    for (const scope of PERMISSION_SCOPES) {
      expect(ownerPerms.has(scope)).toBe(true)
    }
  })
})


