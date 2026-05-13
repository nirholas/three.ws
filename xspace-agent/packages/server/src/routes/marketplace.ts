// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Marketplace Routes — Browse, install, publish, review, admin
// =============================================================================

import { Router, type Request, type Response } from 'express'
import {
  MarketplaceListingRepository,
  MarketplaceInstallRepository,
  MarketplaceReviewRepository,
  PublisherPayoutRepository,
} from 'xspace-agent'
import type { ListingSearchOptions } from 'xspace-agent'
import { validate } from '../middleware/validation'
import { buildErrorResponse } from '../middleware/error-handler'
import { IdParamSchema, SlugParamSchema } from '../schemas/common'
import {
  MarketplaceSearchQuerySchema,
  PublishListingBodySchema,
  SubmitReviewBodySchema,
  UpdateReviewBodySchema,
  InstallBodySchema,
  AdminRejectBodySchema,
} from '../schemas/marketplace'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_FEE_PERCENT = 30

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createMarketplaceRoutes(): Router {
  const router = Router()
  const listingRepo = new MarketplaceListingRepository()
  const installRepo = new MarketplaceInstallRepository()
  const reviewRepo = new MarketplaceReviewRepository()
  const payoutRepo = new PublisherPayoutRepository()

  // =========================================================================
  // Browse
  // =========================================================================

  // ── GET /marketplace — Search/browse listings ──────────────────────────

  router.get('/marketplace', validate(MarketplaceSearchQuerySchema, 'query'), async (req: Request, res: Response) => {
    const validated = (req as any).validated
    const options: ListingSearchOptions = {
      query: validated.q,
      type: validated.type,
      category: validated.category,
      pricingModel: validated.pricing,
      sort: validated.sort,
      limit: validated.limit,
      offset: validated.offset,
    }

    const { listings, total } = await listingRepo.search(options)

    res.json({
      listings: listings.map(sanitizeListing),
      total,
      limit: options.limit,
      offset: options.offset,
    })
  })

  // ── GET /marketplace/featured — Featured/trending ──────────────────────

  router.get('/marketplace/featured', async (_req: Request, res: Response) => {
    const listings = await listingRepo.findFeatured()
    res.json({ listings: listings.map(sanitizeListing) })
  })

  // ── GET /marketplace/categories — Category list with counts ────────────

  router.get('/marketplace/categories', async (_req: Request, res: Response) => {
    const categories = await listingRepo.getCategories()
    res.json({ categories })
  })

  // ── GET /marketplace/:slug — Listing detail ────────────────────────────

  router.get('/marketplace/:slug', validate(SlugParamSchema, 'params'), async (req: Request, res: Response) => {
    const listing = await listingRepo.findBySlug(req.params.slug)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }
    res.json({ listing: sanitizeListing(listing) })
  })

  // ── GET /marketplace/:slug/reviews — Listing reviews ───────────────────

  router.get('/marketplace/:slug/reviews', validate(SlugParamSchema, 'params'), async (req: Request, res: Response) => {
    const listing = await listingRepo.findBySlug(req.params.slug)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    const limit = Math.min(Number(req.query.limit) || 20, 100)
    const offset = Number(req.query.offset) || 0
    const reviews = await reviewRepo.findByListing(listing.id, limit, offset)

    res.json({ reviews, listingId: listing.id })
  })

  // =========================================================================
  // Install / Uninstall
  // =========================================================================

  // ── POST /marketplace/:slug/install — Install or purchase ──────────────

  router.post('/marketplace/:slug/install', validate(SlugParamSchema, 'params'), validate(InstallBodySchema), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const listing = await listingRepo.findBySlug(req.params.slug)
    if (!listing || listing.status !== 'published') {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    // Check if already installed
    const existing = await installRepo.findByListingAndOrg(listing.id, tenant.orgId)
    if (existing) {
      res.status(409).json(buildErrorResponse('VALIDATION_ERROR', 'Already installed', {
        requestId: (req as any).id,
      }))
      return
    }

    const install = await installRepo.create({
      listingId: listing.id,
      orgId: tenant.orgId,
      installedBy: tenant.userId,
      config: (req as any).validated.config ?? {},
    })

    await listingRepo.incrementInstallCount(listing.id)

    res.status(201).json({ install })
  })

  // ── DELETE /marketplace/:slug/uninstall — Uninstall ────────────────────

  router.delete('/marketplace/:slug/uninstall', validate(SlugParamSchema, 'params'), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const listing = await listingRepo.findBySlug(req.params.slug)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    const install = await installRepo.findByListingAndOrg(listing.id, tenant.orgId)
    if (!install) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Not installed', {
        requestId: (req as any).id,
      }))
      return
    }

    await installRepo.cancel(install.id)
    await listingRepo.decrementInstallCount(listing.id)

    res.json({ success: true })
  })

  // ── GET /marketplace/installed — Installed items for org ───────────────

  router.get('/marketplace/installed', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const installs = await installRepo.findByOrgId(tenant.orgId)
    res.json({ installs })
  })

  // =========================================================================
  // Publisher
  // =========================================================================

  // ── POST /marketplace/publish — Submit listing for review ──────────────

  router.post('/marketplace/publish', validate(PublishListingBodySchema), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const body = (req as any).validated

    // Generate slug from name
    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    // Check slug uniqueness
    const existingSlug = await listingRepo.findBySlug(slug)
    if (existingSlug) {
      res.status(409).json(buildErrorResponse('VALIDATION_ERROR', 'A listing with a similar name already exists', {
        requestId: (req as any).id,
      }))
      return
    }

    const listing = await listingRepo.create({
      publisherId: tenant.userId,
      publisherOrgId: tenant.orgId,
      name: body.name,
      slug,
      type: body.type,
      category: body.category,
      description: body.description,
      longDescription: body.longDescription,
      pricingModel: body.pricingModel,
      priceCents: body.priceCents ?? null,
      version: body.version,
      tags: body.tags ?? [],
      iconUrl: body.iconUrl,
      screenshots: body.screenshots ?? [],
      demoUrl: body.demoUrl,
      sourceUrl: body.sourceUrl,
      documentationUrl: body.documentationUrl,
      supportEmail: body.supportEmail,
      manifest: body.manifest ?? {},
      minPlatformVersion: body.minPlatformVersion,
      status: 'in_review',
    })

    res.status(201).json({ listing })
  })

  // ── PATCH /marketplace/listings/:id — Update listing ───────────────────

  router.patch('/marketplace/listings/:id', validate(IdParamSchema, 'params'), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const listing = await listingRepo.findById(req.params.id)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    if (listing.publisherOrgId !== tenant.orgId) {
      res.status(403).json(buildErrorResponse('FORBIDDEN', 'Not authorized to update this listing', {
        requestId: (req as any).id,
      }))
      return
    }

    const allowedFields = [
      'description', 'longDescription', 'tags', 'iconUrl', 'screenshots',
      'demoUrl', 'sourceUrl', 'documentationUrl', 'supportEmail',
      'manifest', 'version', 'minPlatformVersion',
    ] as const

    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field]
      }
    }

    const updated = await listingRepo.update(req.params.id, updates)
    res.json({ listing: updated })
  })

  // ── GET /marketplace/publisher/listings — Publisher's listings ──────────

  router.get('/marketplace/publisher/listings', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const listings = await listingRepo.findByPublisher(tenant.orgId)
    res.json({ listings })
  })

  // ── GET /marketplace/publisher/analytics — Revenue & analytics ─────────

  router.get('/marketplace/publisher/analytics', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const listings = await listingRepo.findByPublisher(tenant.orgId)
    const payouts = await payoutRepo.findByPublisher(tenant.orgId)

    const totalInstalls = listings.reduce((sum, l) => sum + (l.installCount ?? 0), 0)
    const avgRating = listings.length > 0
      ? listings.reduce((sum, l) => sum + (l.ratingAvg ?? 0), 0) / listings.length
      : 0
    const totalRevenueCents = payouts.reduce((sum, p) => sum + (p.netPayoutCents ?? 0), 0)

    res.json({
      listingCount: listings.length,
      totalInstalls,
      avgRating: Math.round(avgRating * 100) / 100,
      totalRevenueCents,
      recentPayouts: payouts.slice(0, 6),
      listings: listings.map((l) => ({
        id: l.id,
        name: l.name,
        slug: l.slug,
        installCount: l.installCount,
        ratingAvg: l.ratingAvg,
        ratingCount: l.ratingCount,
        status: l.status,
      })),
    })
  })

  // =========================================================================
  // Reviews
  // =========================================================================

  // ── POST /marketplace/:slug/reviews — Submit review ────────────────────

  router.post('/marketplace/:slug/reviews', validate(SlugParamSchema, 'params'), validate(SubmitReviewBodySchema), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const listing = await listingRepo.findBySlug(req.params.slug)
    if (!listing || listing.status !== 'published') {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    const { rating, title, body } = (req as any).validated

    // Check if user already reviewed
    const existing = await reviewRepo.findByUserAndListing(tenant.userId!, listing.id)
    if (existing) {
      res.status(409).json(buildErrorResponse('VALIDATION_ERROR', 'You have already reviewed this listing', {
        requestId: (req as any).id,
      }))
      return
    }

    // Must have installed to review
    const install = await installRepo.findByListingAndOrg(listing.id, tenant.orgId)
    if (!install) {
      res.status(403).json(buildErrorResponse('FORBIDDEN', 'You must install a listing before reviewing it', {
        requestId: (req as any).id,
      }))
      return
    }

    const review = await reviewRepo.create({
      listingId: listing.id,
      userId: tenant.userId,
      orgId: tenant.orgId,
      rating,
      title,
      body,
    })

    // Update listing aggregate rating
    const stats = await reviewRepo.getListingStats(listing.id)
    await listingRepo.updateRating(listing.id, stats.avg, stats.count)

    res.status(201).json({ review })
  })

  // ── PUT /marketplace/:slug/reviews/:id — Update review ─────────────────

  router.put('/marketplace/:slug/reviews/:id', validate(SlugParamSchema, 'params'), validate(UpdateReviewBodySchema), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const review = await reviewRepo.findById(req.params.id)
    if (!review) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Review not found', {
        requestId: (req as any).id,
      }))
      return
    }

    if (review.userId !== tenant.userId) {
      res.status(403).json(buildErrorResponse('FORBIDDEN', 'Not authorized to update this review', {
        requestId: (req as any).id,
      }))
      return
    }

    const { rating, title, body } = (req as any).validated

    const updated = await reviewRepo.update(req.params.id, { rating, title, body })

    // Recalculate listing rating
    const listing = await listingRepo.findBySlug(req.params.slug)
    if (listing) {
      const stats = await reviewRepo.getListingStats(listing.id)
      await listingRepo.updateRating(listing.id, stats.avg, stats.count)
    }

    res.json({ review: updated })
  })

  // ── DELETE /marketplace/:slug/reviews/:id — Delete review ──────────────

  router.delete('/marketplace/:slug/reviews/:id', validate(SlugParamSchema, 'params'), async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json(buildErrorResponse('AUTH_REQUIRED', 'Tenant context required', {
        requestId: (req as any).id,
      }))
      return
    }

    const review = await reviewRepo.findById(req.params.id)
    if (!review) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Review not found', {
        requestId: (req as any).id,
      }))
      return
    }

    if (review.userId !== tenant.userId) {
      res.status(403).json(buildErrorResponse('FORBIDDEN', 'Not authorized to delete this review', {
        requestId: (req as any).id,
      }))
      return
    }

    await reviewRepo.delete(req.params.id)

    // Recalculate listing rating
    const listing = await listingRepo.findBySlug(req.params.slug)
    if (listing) {
      const stats = await reviewRepo.getListingStats(listing.id)
      await listingRepo.updateRating(listing.id, stats.avg, stats.count)
    }

    res.json({ success: true })
  })

  // =========================================================================
  // Admin
  // =========================================================================

  // ── GET /admin/marketplace/review-queue — Pending review ───────────────

  router.get('/admin/marketplace/review-queue', async (_req: Request, res: Response) => {
    const listings = await listingRepo.findPendingReview()
    res.json({ listings })
  })

  // ── POST /admin/marketplace/:id/approve — Approve listing ─────────────

  router.post('/admin/marketplace/:id/approve', validate(IdParamSchema, 'params'), async (req: Request, res: Response) => {
    const listing = await listingRepo.findById(req.params.id)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    const updated = await listingRepo.update(req.params.id, { status: 'published' })
    res.json({ listing: updated })
  })

  // ── POST /admin/marketplace/:id/reject — Reject listing ───────────────

  router.post('/admin/marketplace/:id/reject', validate(IdParamSchema, 'params'), validate(AdminRejectBodySchema), async (req: Request, res: Response) => {
    const listing = await listingRepo.findById(req.params.id)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    const updated = await listingRepo.update(req.params.id, {
      status: 'draft',
      reviewNotes: (req as any).validated.reason,
    })
    res.json({ listing: updated })
  })

  // ── POST /admin/marketplace/:id/suspend — Suspend listing ─────────────

  router.post('/admin/marketplace/:id/suspend', validate(IdParamSchema, 'params'), validate(AdminRejectBodySchema), async (req: Request, res: Response) => {
    const listing = await listingRepo.findById(req.params.id)
    if (!listing) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Listing not found', {
        requestId: (req as any).id,
      }))
      return
    }

    const updated = await listingRepo.update(req.params.id, {
      status: 'suspended',
      reviewNotes: (req as any).validated.reason,
    })
    res.json({ listing: updated })
  })

  return router
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip internal-only fields from listing for public API responses. */
function sanitizeListing(listing: Record<string, unknown>) {
  const { reviewNotes, ...rest } = listing
  return rest
}


