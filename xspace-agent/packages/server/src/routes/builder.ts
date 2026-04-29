// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  getFlowTemplates,
  getFlowTemplate,
  getFlowTemplatesByCategory,
  validateFlow,
  transpileFlowToConfig,
} from 'xspace-agent';
import type { AgentFlow, DeployConfig, DeployedAgent } from 'xspace-agent';
import { validate } from '../middleware/validation';
import { buildErrorResponse } from '../middleware/error-handler';
import { IdParamSchema } from '../schemas/common';
import {
  CreateFlowBodySchema,
  UpdateFlowBodySchema,
  ValidateFlowBodySchema,
  DeployFlowBodySchema,
  PreviewFlowBodySchema,
  FromTemplateBodySchema,
} from '../schemas/builder';

// In-memory storage (replace with DB in production)
const flows = new Map<string, AgentFlow>();
const deployments = new Map<string, DeployedAgent>();
const previewTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/** Create the builder router with all flow CRUD + deploy endpoints */
export function createBuilderRouter(): Router {
  const router = Router();

  // =========================================================================
  // Templates
  // =========================================================================

  /** GET /api/builder/templates — list all flow templates */
  router.get('/templates', (_req: Request, res: Response) => {
    const templates = getFlowTemplates();
    res.json({ templates });
  });

  /** GET /api/builder/templates/:id — get a single template */
  router.get('/templates/:id', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    const template = getFlowTemplate(req.params.id);
    if (!template) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', `Template '${req.params.id}' not found`, {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ template });
  });

  /** GET /api/builder/templates/category/:category — templates by category */
  router.get('/templates/category/:category', (req: Request, res: Response) => {
    const templates = getFlowTemplatesByCategory(req.params.category);
    res.json({ templates });
  });

  // =========================================================================
  // Flows CRUD
  // =========================================================================

  /** GET /api/builder/flows — list all saved flows */
  router.get('/flows', (_req: Request, res: Response) => {
    const allFlows = Array.from(flows.values()).map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      version: f.version,
      nodeCount: f.nodes.length,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
    res.json({ flows: allFlows });
  });

  /** GET /api/builder/flows/:id — get a single flow */
  router.get('/flows/:id', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    const flow = flows.get(req.params.id);
    if (!flow) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ flow });
  });

  /** POST /api/builder/flows — create a new flow */
  router.post('/flows', validate(CreateFlowBodySchema), (req: Request, res: Response) => {
    const body = (req as any).validated;
    const now = new Date().toISOString();
    const flow: AgentFlow = {
      id: randomUUID(),
      name: body.name,
      description: body.description || '',
      nodes: body.nodes || [],
      connections: body.connections || [],
      variables: body.variables || [],
      personality: body.personality || {
        name: 'Agent',
        role: 'AI Assistant',
        tone: 50,
        energy: 50,
        detail: 50,
        humor: 50,
        knowledgeAreas: [],
        excludeTopics: [],
        exampleConversations: [],
      },
      version: 1,
      templateId: body.templateId,
      createdAt: now,
      updatedAt: now,
    };

    flows.set(flow.id, flow);
    res.status(201).json({ flow });
  });

  /** POST /api/builder/flows/from-template/:templateId — create flow from template */
  router.post('/flows/from-template/:templateId', validate(FromTemplateBodySchema), (req: Request, res: Response) => {
    const template = getFlowTemplate(req.params.templateId);
    if (!template) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', `Template '${req.params.templateId}' not found`, {
        requestId: (req as any).id,
      }));
      return;
    }

    const body = (req as any).validated;
    const now = new Date().toISOString();
    const flow: AgentFlow = {
      id: randomUUID(),
      name: body.name || template.flow.name,
      description: template.flow.description,
      nodes: JSON.parse(JSON.stringify(template.flow.nodes)),
      connections: JSON.parse(JSON.stringify(template.flow.connections)),
      variables: JSON.parse(JSON.stringify(template.flow.variables)),
      personality: JSON.parse(JSON.stringify(template.flow.personality)),
      version: 1,
      templateId: template.id,
      createdAt: now,
      updatedAt: now,
    };

    flows.set(flow.id, flow);
    res.status(201).json({ flow });
  });

  /** PUT /api/builder/flows/:id — update an existing flow */
  router.put('/flows/:id', validate(IdParamSchema, 'params'), validate(UpdateFlowBodySchema), (req: Request, res: Response) => {
    const existing = flows.get(req.params.id);
    if (!existing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }

    const body = (req as any).validated;
    const updated: AgentFlow = {
      ...existing,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      nodes: body.nodes ?? existing.nodes,
      connections: body.connections ?? existing.connections,
      variables: body.variables ?? existing.variables,
      personality: body.personality ?? existing.personality,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    flows.set(updated.id, updated);
    res.json({ flow: updated });
  });

  /** DELETE /api/builder/flows/:id — delete a flow */
  router.delete('/flows/:id', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    if (!flows.has(req.params.id)) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    flows.delete(req.params.id);
    res.json({ success: true });
  });

  // =========================================================================
  // Validation
  // =========================================================================

  /** POST /api/builder/flows/:id/validate — validate a flow */
  router.post('/flows/:id/validate', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    const flow = flows.get(req.params.id);
    if (!flow) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }

    const result = validateFlow(flow);
    res.json(result);
  });

  /** POST /api/builder/validate — validate a flow without saving */
  router.post('/validate', validate(ValidateFlowBodySchema), (req: Request, res: Response) => {
    const flow = (req as any).validated as AgentFlow;
    const result = validateFlow(flow);
    res.json(result);
  });

  // =========================================================================
  // Transpile (flow → agent config)
  // =========================================================================

  /** POST /api/builder/flows/:id/transpile — convert flow to AgentConfig */
  router.post('/flows/:id/transpile', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    const flow = flows.get(req.params.id);
    if (!flow) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }

    const validation = validateFlow(flow);
    if (!validation.valid) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Flow has validation errors', {
        requestId: (req as any).id,
      }));
      return;
    }

    const config = transpileFlowToConfig(flow);
    res.json({ config });
  });

  // =========================================================================
  // Deploy
  // =========================================================================

  /** POST /api/builder/flows/:id/deploy — deploy a flow as a running agent */
  router.post('/flows/:id/deploy', validate(IdParamSchema, 'params'), validate(DeployFlowBodySchema), (req: Request, res: Response) => {
    const flow = flows.get(req.params.id);
    if (!flow) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }

    const validation = validateFlow(flow);
    if (!validation.valid) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Flow has validation errors — fix before deploying', {
        requestId: (req as any).id,
      }));
      return;
    }

    const deployConfig = (req as any).validated as DeployConfig;

    const deployment: DeployedAgent = {
      id: randomUUID(),
      flowId: flow.id,
      status: 'running',
      platform: deployConfig.platform,
      deployConfig,
      startedAt: new Date().toISOString(),
    };

    deployments.set(deployment.id, deployment);
    res.status(201).json({ deployment });
  });

  /** POST /api/builder/flows/:id/preview — create a 30-minute preview deployment */
  router.post('/flows/:id/preview', validate(IdParamSchema, 'params'), validate(PreviewFlowBodySchema), (req: Request, res: Response) => {
    const flow = flows.get(req.params.id);
    if (!flow) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Flow not found', {
        requestId: (req as any).id,
      }));
      return;
    }

    const body = (req as any).validated;
    const PREVIEW_DURATION_MS = 30 * 60 * 1000; // 30 minutes
    const expiresAt = new Date(Date.now() + PREVIEW_DURATION_MS).toISOString();

    const deployment: DeployedAgent = {
      id: randomUUID(),
      flowId: flow.id,
      status: 'preview',
      platform: body.platform || 'x_spaces',
      deployConfig: {
        platform: body.platform || 'x_spaces',
        mode: 'api_triggered',
        credentials: {},
      },
      startedAt: new Date().toISOString(),
      expiresAt,
    };

    deployments.set(deployment.id, deployment);

    // Auto-destroy after 30 minutes
    const timeout = setTimeout(() => {
      const d = deployments.get(deployment.id);
      if (d) {
        d.status = 'stopped';
        deployments.delete(deployment.id);
      }
      previewTimeouts.delete(deployment.id);
    }, PREVIEW_DURATION_MS);
    previewTimeouts.set(deployment.id, timeout);

    res.status(201).json({ deployment, previewUrl: `/preview/${deployment.id}` });
  });

  /** GET /api/builder/deployments — list all deployments */
  router.get('/deployments', (_req: Request, res: Response) => {
    const all = Array.from(deployments.values());
    res.json({ deployments: all });
  });

  /** GET /api/builder/deployments/:id — get deployment status */
  router.get('/deployments/:id', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Deployment not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ deployment });
  });

  /** POST /api/builder/deployments/:id/stop — stop a deployment */
  router.post('/deployments/:id/stop', validate(IdParamSchema, 'params'), (req: Request, res: Response) => {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Deployment not found', {
        requestId: (req as any).id,
      }));
      return;
    }

    deployment.status = 'stopped';

    // Clean up preview timeout if exists
    const timeout = previewTimeouts.get(deployment.id);
    if (timeout) {
      clearTimeout(timeout);
      previewTimeouts.delete(deployment.id);
    }

    res.json({ deployment });
  });

  return router;
}


