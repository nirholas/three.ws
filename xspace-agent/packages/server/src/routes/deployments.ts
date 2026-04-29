// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§88]

// =============================================================================
// Deployment Routes — Agent CI/CD & Versioning
// =============================================================================

import { Router, type Request, type Response } from 'express'
import {
  AgentRepository,
  AgentVersionRepository,
  AgentDeploymentRepository,
  AuditRepository,
  CICDService,
} from 'xspace-agent'
import type { CICDDeploymentEnvironment as DeploymentEnvironment, AgentTest } from 'xspace-agent'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validation'
import { buildErrorResponse } from '../middleware/error-handler'
import { IdParamSchema } from '../schemas/common'
import {
  VersionParamsSchema,
  CreateVersionBodySchema,
  RunTestsBodySchema,
  DeployBodySchema,
  PromoteBodySchema,
  RollbackBodySchema,
} from '../schemas/deployments'

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
// Route factory
// ---------------------------------------------------------------------------

export function createDeploymentRoutes(): Router {
  const router = Router()
  const agentRepo = new AgentRepository()
  const versionRepo = new AgentVersionRepository()
  const deploymentRepo = new AgentDeploymentRepository()
  const auditRepo = new AuditRepository()

  const cicd = new CICDService({
    versionRepo,
    deploymentRepo,
    agentRepo,
  })

  // -------------------------------------------------------------------------
  // Versions
  // -------------------------------------------------------------------------

  // GET /agents/:id/versions — List all versions
  router.get('/agents/:id/versions', validate(IdParamSchema, 'params'), authorize('deployments:read'), async (req: Request, res: Response) => {
    try {
      const versions = await cicd.listVersions(req.params.id)
      res.json({ versions })
    } catch (err: any) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to list versions', {
        requestId: (req as any).id,
      }))
    }
  })

  // GET /agents/:id/versions/:version — Get specific version
  router.get('/agents/:id/versions/:version', validate(VersionParamsSchema, 'params'), authorize('deployments:read'), async (req: Request, res: Response) => {
    try {
      const versionNum = parseInt(req.params.version, 10)
      const version = await cicd.getVersion(req.params.id, versionNum)
      if (!version) {
        res.status(404).json(buildErrorResponse('NOT_FOUND', 'Version not found', {
          requestId: (req as any).id,
        }))
        return
      }
      res.json(version)
    } catch (err: any) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to get version', {
        requestId: (req as any).id,
      }))
    }
  })

  // POST /agents/:id/versions — Create new version
  router.post('/agents/:id/versions', validate(IdParamSchema, 'params'), validate(CreateVersionBodySchema), authorize('deployments:create'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const { config, changelog } = (req as any).validated

      const version = await cicd.createVersion({
        agentId: req.params.id,
        orgId: ctx.orgId,
        config,
        changelog,
        createdBy: ctx.userId,
      })

      auditLog(auditRepo, req, 'version.created', 'agent_version', version.id, {
        agentId: req.params.id,
        version: version.version,
      })

      res.status(201).json(version)
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 500
      const code = status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'
      res.status(status).json(buildErrorResponse(code, 'Failed to create version', {
        requestId: (req as any).id,
      }))
    }
  })

  // -------------------------------------------------------------------------
  // Testing
  // -------------------------------------------------------------------------

  // POST /agents/:id/test — Run test suite against a version
  router.post('/agents/:id/test', validate(IdParamSchema, 'params'), validate(RunTestsBodySchema), authorize('deployments:create'), async (req: Request, res: Response) => {
    try {
      const { versionId, tests } = (req as any).validated

      const results = await cicd.runTests(versionId, tests)

      auditLog(auditRepo, req, 'version.tested', 'agent_version', versionId, {
        agentId: req.params.id,
        passed: results.passed,
        failed: results.failed,
        total: results.total,
      })

      res.json(results)
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404
        : err.message.includes('No test runner') ? 501
        : 500
      const code = status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'
      res.status(status).json(buildErrorResponse(code, 'Failed to run tests', {
        requestId: (req as any).id,
      }))
    }
  })

  // -------------------------------------------------------------------------
  // Deployment
  // -------------------------------------------------------------------------

  // POST /agents/:id/deploy — Deploy a version to an environment
  router.post('/agents/:id/deploy', validate(IdParamSchema, 'params'), validate(DeployBodySchema), authorize('deployments:create'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const { versionId, environment } = (req as any).validated

      const deployment = await cicd.deploy({
        agentId: req.params.id,
        versionId,
        environment,
        deployedBy: ctx.userId,
      })

      auditLog(auditRepo, req, 'deployment.created', 'agent_deployment', deployment.id, {
        agentId: req.params.id,
        versionId,
        environment,
      })

      res.status(201).json(deployment)
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 500
      const code = status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'
      res.status(status).json(buildErrorResponse(code, 'Failed to deploy', {
        requestId: (req as any).id,
      }))
    }
  })

  // GET /agents/:id/deployments — Deployment history
  router.get('/agents/:id/deployments', validate(IdParamSchema, 'params'), authorize('deployments:read'), async (req: Request, res: Response) => {
    try {
      const deployments = await cicd.listDeployments(req.params.id)
      res.json({ deployments })
    } catch (err: any) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', 'Failed to list deployments', {
        requestId: (req as any).id,
      }))
    }
  })

  // -------------------------------------------------------------------------
  // Promotion
  // -------------------------------------------------------------------------

  // POST /agents/:id/promote — Promote a version to the next environment
  router.post('/agents/:id/promote', validate(IdParamSchema, 'params'), validate(PromoteBodySchema), authorize('deployments:promote'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const { versionId, targetEnvironment } = (req as any).validated

      const deployment = await cicd.promote({
        agentId: req.params.id,
        versionId,
        targetEnvironment,
        deployedBy: ctx.userId,
      })

      auditLog(auditRepo, req, 'deployment.promoted', 'agent_deployment', deployment.id, {
        agentId: req.params.id,
        versionId,
        targetEnvironment,
      })

      res.json(deployment)
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404
        : err.message.includes('Cannot promote') ? 400
        : 500
      const code = status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'
      res.status(status).json(buildErrorResponse(code, 'Failed to promote', {
        requestId: (req as any).id,
      }))
    }
  })

  // -------------------------------------------------------------------------
  // Rollback
  // -------------------------------------------------------------------------

  // POST /agents/:id/rollback — Rollback to previous version
  router.post('/agents/:id/rollback', validate(IdParamSchema, 'params'), validate(RollbackBodySchema), authorize('deployments:rollback'), async (req: Request, res: Response) => {
    const ctx = req.tenant!
    try {
      const { environment, reason } = (req as any).validated

      const result = await cicd.rollback({
        agentId: req.params.id,
        environment,
        reason,
        rolledBackBy: ctx.userId,
      })

      auditLog(auditRepo, req, 'deployment.rolledback', 'agent_deployment', result.rolledBack.id, {
        agentId: req.params.id,
        environment,
        reason,
        reactivatedId: result.reactivated?.id,
      })

      res.json(result)
    } catch (err: any) {
      const status = err.message.includes('No active deployment') ? 404 : 500
      const code = status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'
      res.status(status).json(buildErrorResponse(code, 'Failed to rollback', {
        requestId: (req as any).id,
      }))
    }
  })

  return router
}


