// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Organization Management Routes — RBAC, members, roles, teams, invitations
// =============================================================================

import { Router, type Request, type Response } from 'express'
import { createHash, randomBytes } from 'crypto'
import {
  OrganizationRepository,
  MemberRepository,
  CustomRoleRepository,
  InvitationRepository,
  TeamRepository,
  AuditRepository,
  UserRepository,
} from 'xspace-agent'
import { authorize, requireRole, requireEnterprise } from '../middleware/authorize'
import {
  ROLES,
  resolvePermissions,
  isRoleAtLeast,
  validatePermissions,
  type BuiltInRole,
  type RoleDefinition,
} from 'xspace-agent'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function auditLog(
  audit: AuditRepository,
  req: Request,
  action: string,
  resourceType: string,
  resourceId: string | undefined,
  details?: Record<string, unknown>,
) {
  const ctx = req.tenant
  if (!ctx) return
  audit.log({
    orgId: ctx.orgId,
    actorId: ctx.userId ?? null,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    details: details ?? {},
    actorIp: req.ip ?? null,
  }).catch(() => { /* best-effort */ })
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createOrgRoutes(): Router {
  const router = Router()
  const orgRepo = new OrganizationRepository()
  const memberRepo = new MemberRepository()
  const customRoleRepo = new CustomRoleRepository()
  const invitationRepo = new InvitationRepository()
  const teamRepo = new TeamRepository()
  const auditRepo = new AuditRepository()
  const userRepo = new UserRepository()

  // ═══════════════════════════════════════════════════════════════════════════
  // Organization CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /org — Get current org details
  router.get('/org', authorize('org:read'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const org = await orgRepo.findById(ctx.orgId)
      if (!org) {
        res.status(404).json({ error: 'Organization not found' })
        return
      }
      res.json({ org })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch organization', detail: err.message })
    }
  })

  // PATCH /org — Update org settings
  router.patch('/org', authorize('org:settings'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { name, settings } = req.body ?? {}
    try {
      const data: Record<string, unknown> = {}
      if (name) data.name = name
      if (settings) data.settings = settings

      const org = await orgRepo.update(ctx.orgId, data as any)
      auditLog(auditRepo, req, 'org.updated', 'organization', ctx.orgId, data)
      res.json({ org })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update organization', detail: err.message })
    }
  })

  // DELETE /org — Delete org (owner only, requires confirmation)
  router.delete('/org', authorize('org:delete'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { confirm } = req.body ?? {}

    if (confirm !== ctx.orgId) {
      res.status(400).json({
        error: 'Confirmation required',
        hint: 'Send { "confirm": "<org_id>" } to confirm deletion',
      })
      return
    }

    try {
      auditLog(auditRepo, req, 'org.deleted', 'organization', ctx.orgId)
      await orgRepo.delete(ctx.orgId)
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete organization', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Members
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /org/members — List all members with roles
  router.get('/org/members', authorize('members:read'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const members = await memberRepo.findByOrgId(ctx.orgId)
      res.json({ members })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list members', detail: err.message })
    }
  })

  // POST /org/members/invite — Invite user by email
  router.post('/org/members/invite', authorize('members:invite'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { email, role } = req.body ?? {}

    if (!email || !role) {
      res.status(400).json({ error: 'email and role are required' })
      return
    }

    // Validate role
    if (!(role in ROLES)) {
      res.status(400).json({ error: `Invalid role: ${role}` })
      return
    }

    // Prevent privilege escalation: inviter cannot assign a role higher than their own
    if (!isRoleAtLeast(ctx.userRole as BuiltInRole, role as BuiltInRole)) {
      res.status(403).json({
        error: 'Cannot invite with a role higher than your own',
        yourRole: ctx.userRole,
        requestedRole: role,
      })
      return
    }

    try {
      // Check if already a member
      const existingUser = await userRepo.findByEmail(email)
      if (existingUser) {
        const existingMember = await memberRepo.findByOrgAndUser(ctx.orgId, existingUser.id)
        if (existingMember) {
          res.status(409).json({ error: 'User is already a member of this organization' })
          return
        }
      }

      // Check for existing pending invitation
      const pending = await invitationRepo.findPendingByEmail(email, ctx.orgId)
      if (pending) {
        res.status(409).json({ error: 'A pending invitation already exists for this email' })
        return
      }

      // Create invitation token (7-day expiry)
      const token = randomBytes(32).toString('hex')
      const tokenHash = hashToken(token)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      const invitation = await invitationRepo.create({
        orgId: ctx.orgId,
        email,
        role,
        invitedBy: ctx.userId ?? null,
        tokenHash,
        expiresAt,
      })

      auditLog(auditRepo, req, 'member.invited', 'invitation', invitation.id, { email, role })

      res.status(201).json({
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        },
        // In production, this token would be sent via email, not returned in the response.
        // Included here for development/testing convenience.
        inviteToken: token,
      })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create invitation', detail: err.message })
    }
  })

  // POST /org/members/accept — Accept invitation
  router.post('/org/members/accept', async (req: Request, res: Response) => {
    const { token } = req.body ?? {}

    if (!token) {
      res.status(400).json({ error: 'token is required' })
      return
    }

    try {
      const tokenHash = hashToken(token)
      const invitation = await invitationRepo.findByTokenHash(tokenHash)

      if (!invitation) {
        res.status(404).json({ error: 'Invalid or expired invitation' })
        return
      }

      if (invitation.status !== 'pending') {
        res.status(400).json({ error: `Invitation is ${invitation.status}` })
        return
      }

      if (new Date() > invitation.expiresAt) {
        await invitationRepo.updateStatus(invitation.id, 'expired')
        res.status(400).json({ error: 'Invitation has expired' })
        return
      }

      // Find or create user
      let user = await userRepo.findByEmail(invitation.email)
      if (!user) {
        user = await userRepo.create({
          email: invitation.email,
          orgId: invitation.orgId,
          role: invitation.role,
        })
      }

      // Add as org member
      await memberRepo.add({
        orgId: invitation.orgId,
        userId: user.id,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      })

      // Mark invitation as accepted
      await invitationRepo.updateStatus(invitation.id, 'accepted')

      auditLog(auditRepo, req, 'member.joined', 'org_member', user.id, {
        orgId: invitation.orgId,
        role: invitation.role,
        viaInvitation: invitation.id,
      })

      res.json({
        member: {
          userId: user.id,
          orgId: invitation.orgId,
          role: invitation.role,
        },
      })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to accept invitation', detail: err.message })
    }
  })

  // PATCH /org/members/:userId — Update member role
  router.patch('/org/members/:userId', authorize('members:update'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { userId } = req.params
    const { role, customRoleId } = req.body ?? {}

    if (!role) {
      res.status(400).json({ error: 'role is required' })
      return
    }

    if (!(role in ROLES)) {
      res.status(400).json({ error: `Invalid role: ${role}` })
      return
    }

    // Prevent privilege escalation
    if (!isRoleAtLeast(ctx.userRole as BuiltInRole, role as BuiltInRole)) {
      res.status(403).json({ error: 'Cannot assign a role higher than your own' })
      return
    }

    // Cannot demote yourself
    if (userId === ctx.userId) {
      res.status(400).json({ error: 'Cannot change your own role' })
      return
    }

    try {
      const member = await memberRepo.findByOrgAndUser(ctx.orgId, userId)
      if (!member) {
        res.status(404).json({ error: 'Member not found' })
        return
      }

      // Cannot modify someone with a higher role
      if (!isRoleAtLeast(ctx.userRole as BuiltInRole, member.role as BuiltInRole)) {
        res.status(403).json({ error: 'Cannot modify a member with a higher role than yours' })
        return
      }

      const updated = await memberRepo.updateRole(ctx.orgId, userId, role, customRoleId)
      auditLog(auditRepo, req, 'member.role_changed', 'org_member', userId, {
        previousRole: member.role,
        newRole: role,
      })

      res.json({ member: updated })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update member', detail: err.message })
    }
  })

  // DELETE /org/members/:userId — Remove member
  router.delete('/org/members/:userId', authorize('members:remove'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { userId } = req.params

    // Cannot remove yourself
    if (userId === ctx.userId) {
      res.status(400).json({ error: 'Cannot remove yourself. Transfer ownership first.' })
      return
    }

    try {
      const member = await memberRepo.findByOrgAndUser(ctx.orgId, userId)
      if (!member) {
        res.status(404).json({ error: 'Member not found' })
        return
      }

      // Cannot remove someone with a higher role
      if (!isRoleAtLeast(ctx.userRole as BuiltInRole, member.role as BuiltInRole)) {
        res.status(403).json({ error: 'Cannot remove a member with a higher role than yours' })
        return
      }

      // Cannot remove the owner
      if (member.role === 'owner') {
        res.status(403).json({ error: 'Cannot remove the organization owner' })
        return
      }

      await memberRepo.remove(ctx.orgId, userId)
      auditLog(auditRepo, req, 'member.removed', 'org_member', userId, { role: member.role })

      res.json({ removed: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to remove member', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Custom Roles (Enterprise only)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /org/roles — List available roles (built-in + custom)
  router.get('/org/roles', authorize('org:read'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const builtIn = Object.entries(ROLES).map(([name, def]) => ({
        name,
        description: (def as RoleDefinition).description,
        permissions: [...resolvePermissions(name as BuiltInRole)],
        builtIn: true,
      }))

      const custom = ctx.plan.tier === 'enterprise'
        ? (await customRoleRepo.findByOrgId(ctx.orgId)).map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            permissions: r.permissions,
            builtIn: false,
          }))
        : []

      res.json({ roles: [...builtIn, ...custom] })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list roles', detail: err.message })
    }
  })

  // POST /org/roles — Create custom role (Enterprise only)
  router.post('/org/roles', authorize('org:settings'), requireEnterprise(), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { name, description, permissions } = req.body ?? {}

    if (!name || !Array.isArray(permissions)) {
      res.status(400).json({ error: 'name and permissions[] are required' })
      return
    }

    const validation = validatePermissions(permissions)
    if (!validation.valid) {
      res.status(400).json({ error: 'Invalid permissions', invalid: validation.invalid })
      return
    }

    try {
      // Check for duplicate name
      const existing = await customRoleRepo.findByName(ctx.orgId, name)
      if (existing) {
        res.status(409).json({ error: `A custom role named '${name}' already exists` })
        return
      }

      const role = await customRoleRepo.create({
        orgId: ctx.orgId,
        name,
        description: description ?? null,
        permissions,
      })

      auditLog(auditRepo, req, 'custom_role.created', 'custom_role', role.id, { name, permissions })
      res.status(201).json({ role })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create custom role', detail: err.message })
    }
  })

  // PATCH /org/roles/:roleId — Update custom role
  router.patch('/org/roles/:roleId', authorize('org:settings'), requireEnterprise(), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { roleId } = req.params
    const { name, description, permissions } = req.body ?? {}

    try {
      const existing = await customRoleRepo.findById(roleId)
      if (!existing || existing.orgId !== ctx.orgId) {
        res.status(404).json({ error: 'Custom role not found' })
        return
      }

      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
      if (permissions !== undefined) {
        const validation = validatePermissions(permissions)
        if (!validation.valid) {
          res.status(400).json({ error: 'Invalid permissions', invalid: validation.invalid })
          return
        }
        data.permissions = permissions
      }

      const role = await customRoleRepo.update(roleId, data as any)
      auditLog(auditRepo, req, 'custom_role.updated', 'custom_role', roleId, data)
      res.json({ role })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update custom role', detail: err.message })
    }
  })

  // DELETE /org/roles/:roleId — Delete custom role
  router.delete('/org/roles/:roleId', authorize('org:settings'), requireEnterprise(), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { roleId } = req.params

    try {
      const existing = await customRoleRepo.findById(roleId)
      if (!existing || existing.orgId !== ctx.orgId) {
        res.status(404).json({ error: 'Custom role not found' })
        return
      }

      await customRoleRepo.delete(roleId)
      auditLog(auditRepo, req, 'custom_role.deleted', 'custom_role', roleId, { name: existing.name })
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete custom role', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Teams
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /org/teams — Create team
  router.post('/org/teams', authorize('teams:create'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { name, description, memberIds } = req.body ?? {}

    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    try {
      const team = await teamRepo.create({
        orgId: ctx.orgId,
        name,
        description: description ?? null,
        memberIds: memberIds ?? [],
      })

      auditLog(auditRepo, req, 'team.created', 'team', team.id, { name })
      res.status(201).json({ team })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create team', detail: err.message })
    }
  })

  // GET /org/teams — List teams
  router.get('/org/teams', authorize('teams:read'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const teamsList = await teamRepo.findByOrgId(ctx.orgId)
      res.json({ teams: teamsList })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list teams', detail: err.message })
    }
  })

  // PATCH /org/teams/:teamId — Update team
  router.patch('/org/teams/:teamId', authorize('teams:update'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { teamId } = req.params
    const { name, description, memberIds } = req.body ?? {}

    try {
      const existing = await teamRepo.findById(teamId)
      if (!existing || existing.orgId !== ctx.orgId) {
        res.status(404).json({ error: 'Team not found' })
        return
      }

      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
      if (memberIds !== undefined) data.memberIds = memberIds

      const team = await teamRepo.update(teamId, data as any)
      auditLog(auditRepo, req, 'team.updated', 'team', teamId, data)
      res.json({ team })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update team', detail: err.message })
    }
  })

  // DELETE /org/teams/:teamId — Delete team
  router.delete('/org/teams/:teamId', authorize('teams:delete'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const { teamId } = req.params

    try {
      const existing = await teamRepo.findById(teamId)
      if (!existing || existing.orgId !== ctx.orgId) {
        res.status(404).json({ error: 'Team not found' })
        return
      }

      await teamRepo.delete(teamId)
      auditLog(auditRepo, req, 'team.deleted', 'team', teamId, { name: existing.name })
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete team', detail: err.message })
    }
  })

  return router
}


