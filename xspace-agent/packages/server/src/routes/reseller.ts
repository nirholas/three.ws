// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Reseller Routes — White-Label & Sub-Organization Management
// =============================================================================

import { Router, type Request, type Response } from 'express'
import {
  ResellerService,
  CustomDomainService,
  ImpersonationService,
  AuditRepository,
  AgentTemplateRepository,
  ResellerRepository,
} from 'xspace-agent'
import type {
  WhiteLabelTier,
  WhiteLabelConfig,
  CreateCustomDomainInput,
} from 'xspace-agent'
import { authorize, requireRole } from '../middleware/authorize'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Middleware: require reseller
// ---------------------------------------------------------------------------

async function requireReseller(req: Request, res: Response, next: () => void) {
  const ctx = req.tenant
  if (!ctx) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const resellerRepo = new ResellerRepository()
  const reseller = await resellerRepo.findByOrgId(ctx.orgId)
  if (!reseller) {
    res.status(403).json({
      error: 'Forbidden',
      hint: 'This organization is not a registered reseller',
    })
    return
  }

  if (reseller.status !== 'active') {
    res.status(403).json({
      error: 'Forbidden',
      hint: `Reseller account is ${reseller.status}`,
    })
    return
  }

  // Attach reseller to request for downstream handlers
  ;(req as any).reseller = reseller
  next()
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createResellerRoutes(): Router {
  const router = Router()
  const resellerService = new ResellerService()
  const domainService = new CustomDomainService()
  const impersonationService = new ImpersonationService()
  const templateRepo = new AgentTemplateRepository()
  const auditRepo = new AuditRepository()

  // ═══════════════════════════════════════════════════════════════════════════
  // Reseller Profile
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /reseller — Get reseller profile
  router.get('/reseller', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    res.json({ reseller })
  })

  // PATCH /reseller — Update reseller config (branding, etc.)
  router.patch('/reseller', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    const { config, tier } = req.body ?? {}

    try {
      const data: Record<string, unknown> = {}
      if (config) data.config = config
      if (tier) data.tier = tier

      const updated = await resellerService.updateReseller(reseller.id, data as any)
      auditLog(auditRepo, req, 'reseller.updated', 'reseller', reseller.id, data)
      res.json({ reseller: updated })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update reseller', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Sub-Organizations
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /reseller/sub-orgs — Create sub-organization
  router.post('/reseller/sub-orgs', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const reseller = (req as any).reseller
    const { name, slug, plan, settings } = req.body ?? {}

    if (!name || !slug) {
      res.status(400).json({ error: 'name and slug are required' })
      return
    }

    try {
      const subOrg = await resellerService.createSubOrg({
        resellerId: reseller.id,
        parentOrgId: ctx.orgId,
        name,
        slug,
        plan,
        settings,
      })

      auditLog(auditRepo, req, 'sub_org.created', 'sub_organization', subOrg.id, { name, slug })
      res.status(201).json({ subOrg })
    } catch (err: any) {
      if (err.message.includes('limit reached')) {
        res.status(429).json({ error: err.message })
      } else {
        res.status(500).json({ error: 'Failed to create sub-organization', detail: err.message })
      }
    }
  })

  // GET /reseller/sub-orgs — List all sub-organizations
  router.get('/reseller/sub-orgs', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const subOrgs = await resellerService.listSubOrgs(reseller.id)
      res.json({ subOrgs })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list sub-organizations', detail: err.message })
    }
  })

  // GET /reseller/sub-orgs/:id — Sub-org details
  router.get('/reseller/sub-orgs/:id', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const subOrg = await resellerService.getSubOrg(req.params.id)
      if (!subOrg || subOrg.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Sub-organization not found' })
        return
      }
      res.json({ subOrg })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get sub-organization', detail: err.message })
    }
  })

  // PATCH /reseller/sub-orgs/:id — Update sub-org settings
  router.patch('/reseller/sub-orgs/:id', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    const { name, plan, settings } = req.body ?? {}

    try {
      const subOrg = await resellerService.getSubOrg(req.params.id)
      if (!subOrg || subOrg.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Sub-organization not found' })
        return
      }

      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (plan !== undefined) data.plan = plan
      if (settings !== undefined) data.settings = settings

      const updated = await resellerService.updateSubOrg(req.params.id, data as any)
      auditLog(auditRepo, req, 'sub_org.updated', 'sub_organization', req.params.id, data)
      res.json({ subOrg: updated })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update sub-organization', detail: err.message })
    }
  })

  // DELETE /reseller/sub-orgs/:id — Delete sub-org
  router.delete('/reseller/sub-orgs/:id', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const subOrg = await resellerService.getSubOrg(req.params.id)
      if (!subOrg || subOrg.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Sub-organization not found' })
        return
      }

      await resellerService.deleteSubOrg(req.params.id)
      auditLog(auditRepo, req, 'sub_org.deleted', 'sub_organization', req.params.id)
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete sub-organization', detail: err.message })
    }
  })

  // POST /reseller/sub-orgs/:id/suspend — Suspend sub-org
  router.post('/reseller/sub-orgs/:id/suspend', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const subOrg = await resellerService.getSubOrg(req.params.id)
      if (!subOrg || subOrg.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Sub-organization not found' })
        return
      }

      const updated = await resellerService.suspendSubOrg(req.params.id)
      auditLog(auditRepo, req, 'sub_org.suspended', 'sub_organization', req.params.id)
      res.json({ subOrg: updated })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to suspend sub-organization', detail: err.message })
    }
  })

  // POST /reseller/sub-orgs/:id/activate — Reactivate sub-org
  router.post('/reseller/sub-orgs/:id/activate', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const subOrg = await resellerService.getSubOrg(req.params.id)
      if (!subOrg || subOrg.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Sub-organization not found' })
        return
      }

      const updated = await resellerService.activateSubOrg(req.params.id)
      auditLog(auditRepo, req, 'sub_org.activated', 'sub_organization', req.params.id)
      res.json({ subOrg: updated })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to activate sub-organization', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Custom Domains
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /reseller/domains — Add custom domain
  router.post('/reseller/domains', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const reseller = (req as any).reseller
    const { domain, type } = req.body ?? {}

    if (!domain || !type) {
      res.status(400).json({ error: 'domain and type are required' })
      return
    }

    const validTypes = ['dashboard', 'api', 'docs', 'status']
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
      return
    }

    try {
      const result = await domainService.addDomain({
        resellerId: reseller.id,
        orgId: ctx.orgId,
        domain,
        type,
      })

      auditLog(auditRepo, req, 'custom_domain.created', 'custom_domain', result.domain.id, { domain, type })
      res.status(201).json(result)
    } catch (err: any) {
      if (err.message.includes('already registered')) {
        res.status(409).json({ error: err.message })
      } else {
        res.status(500).json({ error: 'Failed to add custom domain', detail: err.message })
      }
    }
  })

  // GET /reseller/domains — List custom domains
  router.get('/reseller/domains', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const domains = await domainService.listDomains(reseller.id)
      res.json({ domains })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list domains', detail: err.message })
    }
  })

  // POST /reseller/domains/:id/verify — Verify DNS for domain
  router.post('/reseller/domains/:id/verify', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    try {
      const result = await domainService.verifyDns(req.params.id)
      if (result.verified) {
        auditLog(auditRepo, req, 'custom_domain.verified', 'custom_domain', req.params.id)
      }
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to verify domain', detail: err.message })
    }
  })

  // POST /reseller/domains/:id/provision-tls — Provision TLS cert
  router.post('/reseller/domains/:id/provision-tls', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    try {
      const result = await domainService.provisionTls(req.params.id)
      auditLog(auditRepo, req, 'custom_domain.tls_provisioned', 'custom_domain', req.params.id)
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to provision TLS', detail: err.message })
    }
  })

  // DELETE /reseller/domains/:id — Remove custom domain
  router.delete('/reseller/domains/:id', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    try {
      await domainService.deleteDomain(req.params.id)
      auditLog(auditRepo, req, 'custom_domain.deleted', 'custom_domain', req.params.id)
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete domain', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Templates
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /reseller/templates — Create agent template
  router.post('/reseller/templates', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    const { name, description, config, isDefault, targetSubOrgs } = req.body ?? {}

    if (!name || !config) {
      res.status(400).json({ error: 'name and config are required' })
      return
    }

    try {
      const template = await templateRepo.create({
        resellerId: reseller.id,
        name,
        description: description ?? null,
        config,
        isDefault: isDefault ? 1 : 0,
        targetSubOrgs: targetSubOrgs ?? [],
      })

      auditLog(auditRepo, req, 'agent_template.created', 'agent_template', template.id, { name })
      res.status(201).json({ template })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create template', detail: err.message })
    }
  })

  // GET /reseller/templates — List agent templates
  router.get('/reseller/templates', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const templates = await templateRepo.findByResellerId(reseller.id)
      res.json({ templates })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list templates', detail: err.message })
    }
  })

  // PATCH /reseller/templates/:id — Update template
  router.patch('/reseller/templates/:id', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    const { name, description, config, isDefault, targetSubOrgs } = req.body ?? {}

    try {
      const existing = await templateRepo.findById(req.params.id)
      if (!existing || existing.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Template not found' })
        return
      }

      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
      if (config !== undefined) data.config = config
      if (isDefault !== undefined) data.isDefault = isDefault ? 1 : 0
      if (targetSubOrgs !== undefined) data.targetSubOrgs = targetSubOrgs

      const updated = await templateRepo.update(req.params.id, data as any)
      auditLog(auditRepo, req, 'agent_template.updated', 'agent_template', req.params.id, data)
      res.json({ template: updated })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update template', detail: err.message })
    }
  })

  // DELETE /reseller/templates/:id — Delete template
  router.delete('/reseller/templates/:id', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller

    try {
      const existing = await templateRepo.findById(req.params.id)
      if (!existing || existing.resellerId !== reseller.id) {
        res.status(404).json({ error: 'Template not found' })
        return
      }

      await templateRepo.delete(req.params.id)
      auditLog(auditRepo, req, 'agent_template.deleted', 'agent_template', req.params.id)
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete template', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Impersonation
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /reseller/impersonate — Start impersonation session
  router.post('/reseller/impersonate', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const ctx = req.tenant!
    const reseller = (req as any).reseller
    const { targetOrgId, targetUserId, durationMinutes } = req.body ?? {}

    if (!targetOrgId) {
      res.status(400).json({ error: 'targetOrgId is required' })
      return
    }

    try {
      const session = await impersonationService.startImpersonation({
        resellerId: reseller.id,
        adminUserId: ctx.userId!,
        targetOrgId,
        targetUserId,
        durationMinutes,
      })

      res.status(201).json({ session })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to start impersonation', detail: err.message })
    }
  })

  // DELETE /reseller/impersonate/:sessionId — End impersonation session
  router.delete('/reseller/impersonate/:sessionId', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      await impersonationService.endImpersonation(req.params.sessionId, ctx.userId!)
      res.json({ ended: true })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to end impersonation', detail: err.message })
    }
  })

  // POST /reseller/impersonate/:sessionId/renew — Renew session
  router.post('/reseller/impersonate/:sessionId/renew', authorize('org:settings'), requireReseller, async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const session = await impersonationService.renewSession(req.params.sessionId, ctx.userId!)
      res.json({ session })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to renew impersonation', detail: err.message })
    }
  })

  // GET /reseller/impersonate — List active impersonation sessions
  router.get('/reseller/impersonate', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const sessions = await impersonationService.listActiveSessions(ctx.userId!)
      res.json({ sessions })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to list sessions', detail: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Analytics & Billing
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /reseller/analytics — Aggregate analytics
  router.get('/reseller/analytics', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    try {
      const analytics = await resellerService.getAnalytics(reseller.id)
      res.json({ analytics })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get analytics', detail: err.message })
    }
  })

  // GET /reseller/billing — Wholesale billing summary
  router.get('/reseller/billing', authorize('org:read'), requireReseller, async (req: Request, res: Response) => {
    const reseller = (req as any).reseller
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const until = req.query.until ? new Date(req.query.until as string) : new Date()

    try {
      const billing = await resellerService.getBillingSummary(reseller.id, since, until)
      res.json({ billing })
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to get billing summary', detail: err.message })
    }
  })

  return router
}


