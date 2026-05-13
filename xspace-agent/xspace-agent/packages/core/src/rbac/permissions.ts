// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// RBAC — Role Definitions, Permission Scopes, and Authorization Checking
// =============================================================================

/** All granular permission scopes in the system. */
export const PERMISSION_SCOPES = [
  // Organization
  'org:read', 'org:update', 'org:delete', 'org:transfer', 'org:settings',
  // Members
  'members:read', 'members:invite', 'members:update', 'members:remove',
  // Agents
  'agents:read', 'agents:create', 'agents:update', 'agents:delete', 'agents:start', 'agents:stop', 'agents:speak',
  // Teams
  'teams:read', 'teams:create', 'teams:update', 'teams:delete',
  // Conversations
  'conversations:read', 'conversations:export', 'conversations:delete',
  // Analytics
  'analytics:read', 'analytics:export',
  // Usage
  'usage:read',
  // Billing
  'billing:read', 'billing:update', 'billing:manage',
  // API Keys
  'api-keys:read', 'api-keys:create', 'api-keys:revoke',
  // Webhooks
  'webhooks:read', 'webhooks:create', 'webhooks:update', 'webhooks:delete',
  // SSO
  'sso:read', 'sso:configure',
  // Audit
  'audit:read', 'audit:export',
  // Marketplace
  'marketplace:install', 'marketplace:publish',
  // Deployments (CI/CD)
  'deployments:read', 'deployments:create', 'deployments:promote', 'deployments:rollback',
] as const

export type Permission = (typeof PERMISSION_SCOPES)[number]

/** Built-in role names ordered by hierarchy (highest to lowest). */
export type BuiltInRole = 'owner' | 'admin' | 'manager' | 'developer' | 'viewer'

export interface RoleDefinition {
  name: BuiltInRole
  description: string
  inherits: BuiltInRole[]
  /** Direct permissions (not including inherited). */
  permissions: Permission[]
}

/** Built-in role definitions with hierarchical inheritance. */
export const ROLES: Record<BuiltInRole, RoleDefinition> = {
  owner: {
    name: 'owner',
    description: 'Full control, billing, can delete org',
    inherits: ['admin'],
    permissions: ['org:delete', 'org:transfer', 'billing:read', 'billing:update', 'billing:manage'],
  },
  admin: {
    name: 'admin',
    description: 'Full control except billing and org deletion',
    inherits: ['manager'],
    permissions: [
      'org:update', 'org:settings',
      'members:read', 'members:invite', 'members:update', 'members:remove',
      'api-keys:read', 'api-keys:create', 'api-keys:revoke',
      'sso:read', 'sso:configure', 'audit:read', 'audit:export',
      'analytics:export', 'marketplace:publish',
    ],
  },
  manager: {
    name: 'manager',
    description: 'Manage agents and teams',
    inherits: ['developer'],
    permissions: [
      'agents:delete', 'agents:speak',
      'teams:read', 'teams:create', 'teams:update', 'teams:delete',
      'webhooks:read', 'webhooks:create', 'webhooks:update', 'webhooks:delete',
      'conversations:delete',
      'deployments:promote', 'deployments:rollback',
    ],
  },
  developer: {
    name: 'developer',
    description: 'Create and configure agents',
    inherits: ['viewer'],
    permissions: [
      'agents:create', 'agents:update', 'agents:start', 'agents:stop',
      'conversations:export',
      'marketplace:install',
      'deployments:create',
    ],
  },
  viewer: {
    name: 'viewer',
    description: 'Read-only access',
    inherits: [],
    permissions: [
      'org:read', 'agents:read', 'conversations:read',
      'analytics:read', 'usage:read',
      'deployments:read',
    ],
  },
}

/** Role hierarchy level (lower = more powerful). */
const ROLE_LEVELS: Record<BuiltInRole, number> = {
  owner: 0,
  admin: 1,
  manager: 2,
  developer: 3,
  viewer: 4,
}

/**
 * Resolve all permissions for a built-in role, including inherited ones.
 * Results are cached after first computation.
 */
const resolvedCache = new Map<BuiltInRole, Set<Permission>>()

export function resolvePermissions(role: BuiltInRole): Set<Permission> {
  const cached = resolvedCache.get(role)
  if (cached) return cached

  const perms = new Set<Permission>()
  const def = ROLES[role]
  for (const p of def.permissions) perms.add(p)
  for (const parent of def.inherits) {
    for (const p of resolvePermissions(parent)) perms.add(p)
  }

  resolvedCache.set(role, perms)
  return perms
}

/**
 * Check if a role has a specific permission.
 */
export function roleHasPermission(role: BuiltInRole, permission: Permission): boolean {
  return resolvePermissions(role).has(permission)
}

/**
 * Check if a role has ALL of the specified permissions.
 */
export function roleHasAllPermissions(role: BuiltInRole, permissions: Permission[]): boolean {
  const resolved = resolvePermissions(role)
  return permissions.every((p) => resolved.has(p))
}

/**
 * Check whether `actorRole` is equal to or higher than `targetRole` in the hierarchy.
 * Used to prevent privilege escalation (e.g., admin cannot assign owner role).
 */
export function isRoleAtLeast(actorRole: BuiltInRole, targetRole: BuiltInRole): boolean {
  return ROLE_LEVELS[actorRole] <= ROLE_LEVELS[targetRole]
}

/**
 * Check if a permission string matches a wildcard pattern.
 * Supports `resource:*` patterns for custom roles.
 */
export function matchesPermission(required: Permission, granted: string): boolean {
  if (granted === required) return true
  // Wildcard: "agents:*" matches "agents:create", "agents:delete", etc.
  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -1)
    return required.startsWith(prefix)
  }
  return false
}

/**
 * Check if a user has a required permission, considering:
 * 1. Built-in role permissions (with inheritance)
 * 2. Custom role permissions (if any)
 * 3. Explicit additional grants
 */
export function hasPermission(
  required: Permission,
  opts: {
    role: BuiltInRole
    customPermissions?: string[]
  },
): boolean {
  // Check built-in role
  if (roleHasPermission(opts.role, required)) return true

  // Check custom/additional permissions
  if (opts.customPermissions) {
    return opts.customPermissions.some((p) => matchesPermission(required, p))
  }

  return false
}

/**
 * Validate that a permission string is a known scope.
 */
export function isValidPermission(perm: string): perm is Permission {
  return (PERMISSION_SCOPES as readonly string[]).includes(perm)
}

/**
 * Validate an array of permission strings, allowing wildcards.
 */
export function validatePermissions(perms: string[]): { valid: boolean; invalid: string[] } {
  const invalid: string[] = []
  for (const p of perms) {
    if (p.endsWith(':*')) {
      const resource = p.slice(0, p.indexOf(':'))
      const hasAny = PERMISSION_SCOPES.some((s) => s.startsWith(resource + ':'))
      if (!hasAny) invalid.push(p)
    } else if (!isValidPermission(p)) {
      invalid.push(p)
    }
  }
  return { valid: invalid.length === 0, invalid }
}


