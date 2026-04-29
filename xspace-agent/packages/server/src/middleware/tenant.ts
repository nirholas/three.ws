// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§89]

// =============================================================================
// Tenant Resolution Middleware — Resolves tenant context from every request
// =============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import {
  resolveApiKey,
  getOrganizationBySlug,
  getOrganization,
  getOrgQuotas,
  getPlan,
  createFeatureFlags,
  runWithTenant,
} from 'xspace-agent/dist/tenant';
import type { TenantContext, Organization } from 'xspace-agent/dist/tenant';

// ---------------------------------------------------------------------------
// Express types augmentation
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

// ---------------------------------------------------------------------------
// Tenant Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve tenant context from an API key string.
 * Returns null if the key is invalid or the org is not active.
 */
function resolveFromApiKey(apiKeyValue: string): TenantContext | null {
  const result = resolveApiKey(apiKeyValue);
  if (!result) return null;

  const { org, apiKey } = result;
  if (org.status === 'deleted') return null;

  return buildTenantContext(org, apiKey.createdBy);
}

/**
 * Resolve tenant context from a subdomain slug.
 * E.g., "acme" from "acme.xspaceagent.com"
 */
function resolveFromSlug(slug: string): TenantContext | null {
  const org = getOrganizationBySlug(slug);
  if (!org || org.status === 'deleted') return null;
  return buildTenantContext(org);
}

/**
 * Resolve tenant context from an org ID (for JWT-based auth).
 */
function resolveFromOrgId(orgId: string): TenantContext | null {
  const org = getOrganization(orgId);
  if (!org || org.status === 'deleted') return null;
  return buildTenantContext(org);
}

/**
 * Build a TenantContext from an organization record.
 */
function buildTenantContext(org: Organization, userId?: string): TenantContext {
  const plan = getPlan(org.plan);
  const quotas = getOrgQuotas(org.id);
  const features = createFeatureFlags(plan.features);

  return {
    orgId: org.id,
    userId,
    plan,
    quotas,
    features,
    org,
  };
}

/**
 * Extract subdomain slug from the Host header.
 * E.g., "acme.xspaceagent.com" -> "acme"
 * Returns null for bare domains or localhost.
 */
function extractSubdomain(host: string | undefined): string | null {
  if (!host) return null;

  // Strip port
  const hostname = host.split(':')[0];

  // Skip localhost and IP addresses
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  const parts = hostname.split('.');
  // Need at least 3 parts: subdomain.domain.tld
  if (parts.length < 3) return null;

  const subdomain = parts[0];
  // Skip common non-tenant subdomains
  if (['www', 'api', 'app', 'admin'].includes(subdomain)) return null;

  return subdomain;
}

// ---------------------------------------------------------------------------
// Express Middleware
// ---------------------------------------------------------------------------

export interface TenantMiddlewareOptions {
  /** Paths that don't require tenant context (e.g., /health). */
  excludePaths?: string[];
  /** Allow ?org=<slug> query param for development. */
  allowQueryParam?: boolean;
}

/**
 * Express middleware that resolves tenant context from the incoming request.
 *
 * Resolution order:
 * 1. X-API-Key header → look up org from API key
 * 2. Authorization: Bearer <key> → look up org from API key
 * 3. X-Org-Id header → resolve org by ID (for JWT-authenticated requests)
 * 4. Subdomain: {slug}.xspaceagent.com → look up org by slug
 * 5. ?org=<slug> query param (development only)
 *
 * Suspended orgs receive a 403 with suspension details.
 */
export function createTenantMiddleware(options: TenantMiddlewareOptions = {}) {
  const { excludePaths = ['/health', '/metrics'], allowQueryParam = false } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip excluded paths
    if (excludePaths.some((p) => req.path === p || req.path.startsWith(p))) {
      return next();
    }

    let tenant: TenantContext | null = null;

    // 1. X-API-Key header
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      tenant = resolveFromApiKey(apiKey);
    }

    // 2. Authorization: Bearer <key>
    if (!tenant) {
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        // Try as API key first
        tenant = resolveFromApiKey(token);
        // In production, also try JWT decoding here
      }
    }

    // 3. X-Org-Id header (for pre-authenticated requests via API gateway)
    if (!tenant) {
      const orgId = req.headers['x-org-id'] as string | undefined;
      if (orgId) {
        tenant = resolveFromOrgId(orgId);
      }
    }

    // 4. Subdomain resolution
    if (!tenant) {
      const subdomain = extractSubdomain(req.headers.host);
      if (subdomain) {
        tenant = resolveFromSlug(subdomain);
      }
    }

    // 5. Query param (development only)
    if (!tenant && allowQueryParam) {
      const orgSlug = req.query.org as string | undefined;
      if (orgSlug) {
        tenant = resolveFromSlug(orgSlug);
      }
    }

    // No tenant resolved
    if (!tenant) {
      res.status(401).json({
        error: 'Tenant context required',
        hint: 'Provide an API key via X-API-Key header, or use subdomain routing',
      });
      return;
    }

    // Check suspension
    if (tenant.org.status === 'suspended') {
      const statusCode = tenant.org.suspensionReason === 'non_payment' ? 402 : 403;
      res.status(statusCode).json({
        error: 'Organization suspended',
        reason: tenant.org.suspensionReason,
        hint: 'Contact support to resolve this issue',
      });
      return;
    }

    // Attach tenant to request and run handler within tenant context
    req.tenant = tenant;
    runWithTenant(tenant, () => next());
  };
}

// ---------------------------------------------------------------------------
// Socket.IO Middleware
// ---------------------------------------------------------------------------

/**
 * Socket.IO middleware that resolves tenant context from the handshake.
 *
 * Clients must provide tenant identification via:
 * - handshake.auth.apiKey
 * - handshake.headers['x-api-key']
 * - handshake.auth.orgId (for pre-authenticated connections)
 */
export function socketTenantMiddleware() {
  return (socket: Socket, next: (err?: Error) => void) => {
    let tenant: TenantContext | null = null;

    // Try API key from auth payload
    const apiKey =
      socket.handshake.auth?.apiKey ??
      (socket.handshake.headers?.['x-api-key'] as string | undefined);

    if (apiKey) {
      tenant = resolveFromApiKey(apiKey);
    }

    // Try org ID from auth payload
    if (!tenant && socket.handshake.auth?.orgId) {
      tenant = resolveFromOrgId(socket.handshake.auth.orgId);
    }

    if (!tenant) {
      next(new Error('Tenant context required. Provide apiKey in handshake auth.'));
      return;
    }

    if (tenant.org.status === 'suspended') {
      next(new Error(`Organization suspended: ${tenant.org.suspensionReason}`));
      return;
    }

    // Attach tenant to socket data for access in event handlers
    (socket as any).tenant = tenant;
    next();
  };
}

/**
 * Helper to get the tenant context from a Socket.IO socket.
 */
export function getSocketTenant(socket: Socket): TenantContext {
  const tenant = (socket as any).tenant as TenantContext | undefined;
  if (!tenant) {
    throw new Error('No tenant context on socket. Ensure socketTenantMiddleware is applied.');
  }
  return tenant;
}


