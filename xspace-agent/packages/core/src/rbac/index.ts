// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// RBAC — Re-exports
// =============================================================================

export {
  PERMISSION_SCOPES,
  ROLES,
  resolvePermissions,
  roleHasPermission,
  roleHasAllPermissions,
  isRoleAtLeast,
  matchesPermission,
  hasPermission,
  isValidPermission,
  validatePermissions,
  type Permission,
  type BuiltInRole,
  type RoleDefinition,
} from './permissions'


