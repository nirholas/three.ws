// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Reseller Service — Sub-org management, wholesale billing, analytics
// =============================================================================

import { randomUUID } from 'node:crypto'
import {
  ResellerRepository,
  SubOrganizationRepository,
  OrganizationRepository,
  type NewReseller,
  type NewSubOrganization,
} from '../db/repositories'
import type {
  WhiteLabelTier,
  WhiteLabelConfig,
  CreateResellerInput,
  CreateSubOrgInput,
  ResellerBillingSummary,
  ResellerAnalytics,
} from './types'
import { getWholesaleDiscount, WHITE_LABEL_FEATURES } from './types'

export class ResellerService {
  private resellerRepo = new ResellerRepository()
  private subOrgRepo = new SubOrganizationRepository()
  private orgRepo = new OrganizationRepository()

  // -------------------------------------------------------------------------
  // Reseller CRUD
  // -------------------------------------------------------------------------

  async createReseller(input: CreateResellerInput) {
    const discount = getWholesaleDiscount(0)

    const reseller = await this.resellerRepo.create({
      orgId: input.orgId,
      tier: input.tier,
      status: 'active',
      config: input.config as any,
      wholesaleDiscount: discount,
      maxSubOrgs: input.maxSubOrgs ?? this.getDefaultMaxSubOrgs(input.tier),
    })

    return reseller
  }

  async getReseller(id: string) {
    return this.resellerRepo.findById(id)
  }

  async getResellerByOrgId(orgId: string) {
    return this.resellerRepo.findByOrgId(orgId)
  }

  async updateReseller(id: string, data: Partial<{ tier: WhiteLabelTier; config: WhiteLabelConfig; maxSubOrgs: number; status: string }>) {
    return this.resellerRepo.update(id, data as any)
  }

  async deleteReseller(id: string) {
    return this.resellerRepo.delete(id)
  }

  // -------------------------------------------------------------------------
  // Sub-Organization Management
  // -------------------------------------------------------------------------

  async createSubOrg(input: CreateSubOrgInput) {
    const reseller = await this.resellerRepo.findById(input.resellerId)
    if (!reseller) {
      throw new Error('Reseller not found')
    }

    if (reseller.status !== 'active') {
      throw new Error(`Reseller is ${reseller.status}, cannot create sub-organizations`)
    }

    // Check sub-org limit
    const currentCount = await this.subOrgRepo.countByReseller(input.resellerId)
    if (currentCount >= reseller.maxSubOrgs) {
      throw new Error(`Sub-organization limit reached (${reseller.maxSubOrgs})`)
    }

    // Create the underlying organization
    const org = await this.orgRepo.create({
      name: input.name,
      slug: input.slug,
      plan: input.plan ?? 'free',
      settings: input.settings ?? {},
    })

    // Create the sub-org record linking reseller → org
    const subOrg = await this.subOrgRepo.create({
      resellerId: input.resellerId,
      parentOrgId: input.parentOrgId,
      orgId: org.id,
      name: input.name,
      slug: input.slug,
      plan: input.plan ?? 'free',
      settings: input.settings ?? {},
    })

    // Update wholesale discount based on new count
    const newCount = currentCount + 1
    const newDiscount = getWholesaleDiscount(newCount)
    if (newDiscount !== reseller.wholesaleDiscount) {
      await this.resellerRepo.update(reseller.id, { wholesaleDiscount: newDiscount })
    }

    return subOrg
  }

  async getSubOrg(id: string) {
    return this.subOrgRepo.findById(id)
  }

  async listSubOrgs(resellerId: string) {
    return this.subOrgRepo.findByResellerId(resellerId)
  }

  async updateSubOrg(id: string, data: Partial<{ name: string; plan: string; settings: Record<string, unknown> }>) {
    return this.subOrgRepo.update(id, data as any)
  }

  async suspendSubOrg(id: string) {
    return this.subOrgRepo.updateStatus(id, 'suspended')
  }

  async activateSubOrg(id: string) {
    return this.subOrgRepo.updateStatus(id, 'active')
  }

  async deleteSubOrg(id: string) {
    const subOrg = await this.subOrgRepo.findById(id)
    if (!subOrg) throw new Error('Sub-organization not found')

    // Delete the underlying org and the sub-org record
    await this.subOrgRepo.delete(id)
    await this.orgRepo.delete(subOrg.orgId)
  }

  // -------------------------------------------------------------------------
  // Wholesale Billing
  // -------------------------------------------------------------------------

  async getBillingSummary(resellerId: string, periodStart: Date, periodEnd: Date): Promise<ResellerBillingSummary> {
    const reseller = await this.resellerRepo.findById(resellerId)
    if (!reseller) throw new Error('Reseller not found')

    const subOrgCount = await this.subOrgRepo.countByReseller(resellerId)
    const discount = getWholesaleDiscount(subOrgCount)

    return {
      resellerId,
      period: { start: periodStart, end: periodEnd },
      subOrgCount,
      wholesaleDiscount: discount,
      totalUsage: [], // Populated by usage aggregation in production
      totalCostCents: 0,
    }
  }

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------

  async getAnalytics(resellerId: string): Promise<ResellerAnalytics> {
    const subOrgCount = await this.subOrgRepo.countByReseller(resellerId)
    const activeSubOrgs = await this.subOrgRepo.countByResellerAndStatus(resellerId, 'active')

    return {
      resellerId,
      subOrgCount,
      activeSubOrgs,
      totalAgents: 0,      // Aggregated from sub-org agents in production
      totalSessions: 0,    // Aggregated from sub-org sessions in production
      totalUsageMinutes: 0, // Aggregated from sub-org usage in production
      revenueEstimateCents: 0,
    }
  }

  // -------------------------------------------------------------------------
  // Feature Gating
  // -------------------------------------------------------------------------

  hasFeature(tier: WhiteLabelTier, feature: string): boolean {
    return WHITE_LABEL_FEATURES[tier]?.includes(feature) ?? false
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getDefaultMaxSubOrgs(tier: WhiteLabelTier): number {
    switch (tier) {
      case 'branded': return 10
      case 'full': return 50
      case 'enterprise_oem': return 500
      default: return 10
    }
  }
}


