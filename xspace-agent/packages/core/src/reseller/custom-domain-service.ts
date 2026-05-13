// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Custom Domain Service — DNS verification, TLS provisioning, routing
// =============================================================================

import { randomUUID } from 'node:crypto'
import { CustomDomainRepository } from '../db/repositories'
import type { CreateCustomDomainInput, DnsRecord, DomainStatus } from './types'

/** Target CNAME for custom domain DNS configuration. */
const CNAME_TARGET = 'proxy.xspaceagent.com'

export class CustomDomainService {
  private domainRepo = new CustomDomainRepository()

  /**
   * Initiate a custom domain setup. Returns the DNS record the reseller
   * must configure before verification can proceed.
   */
  async addDomain(input: CreateCustomDomainInput) {
    // Check for duplicate domain
    const existing = await this.domainRepo.findByDomain(input.domain)
    if (existing) {
      throw new Error(`Domain '${input.domain}' is already registered`)
    }

    // Generate DNS record instructions
    const dnsRecord: DnsRecord = {
      type: 'CNAME',
      name: input.domain,
      value: CNAME_TARGET,
    }

    const domain = await this.domainRepo.create({
      resellerId: input.resellerId,
      orgId: input.orgId,
      domain: input.domain,
      type: input.type,
      status: 'pending_verification',
      dnsRecord: dnsRecord as any,
    })

    return { domain, dnsRecord }
  }

  /**
   * Verify DNS propagation for a custom domain.
   * In production, this would perform actual DNS lookups.
   */
  async verifyDns(domainId: string): Promise<{ verified: boolean; domain: unknown }> {
    const domain = await this.domainRepo.findById(domainId)
    if (!domain) throw new Error('Domain not found')

    if (domain.status !== 'pending_verification') {
      return { verified: domain.status === 'active' || domain.status === 'dns_verified', domain }
    }

    // In production: perform DNS lookup to verify CNAME is configured
    // For now, we simulate verification success
    const verified = await this.performDnsLookup(domain.domain, (domain.dnsRecord as DnsRecord).value)

    if (verified) {
      const updated = await this.domainRepo.updateStatus(domainId, 'dns_verified')
      return { verified: true, domain: updated }
    }

    return { verified: false, domain }
  }

  /**
   * Provision TLS certificate for a verified domain.
   * In production, this would use Let's Encrypt or Cloudflare.
   */
  async provisionTls(domainId: string): Promise<{ provisioned: boolean; certificateId?: string }> {
    const domain = await this.domainRepo.findById(domainId)
    if (!domain) throw new Error('Domain not found')

    if (domain.status !== 'dns_verified') {
      throw new Error(`Domain must be DNS-verified before TLS provisioning (current: ${domain.status})`)
    }

    await this.domainRepo.updateStatus(domainId, 'tls_provisioning')

    // In production: issue Let's Encrypt cert or configure Cloudflare
    const certificateId = `cert_${randomUUID()}`

    const updated = await this.domainRepo.update(domainId, {
      status: 'active',
      tlsCertificateId: certificateId,
      verifiedAt: new Date(),
    } as any)

    return { provisioned: true, certificateId }
  }

  async getDomain(id: string) {
    return this.domainRepo.findById(id)
  }

  async getDomainByHostname(hostname: string) {
    return this.domainRepo.findByDomain(hostname)
  }

  async listDomains(resellerId: string) {
    return this.domainRepo.findByResellerId(resellerId)
  }

  async deleteDomain(id: string) {
    return this.domainRepo.delete(id)
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Perform a DNS CNAME lookup. In production this would use `dns.resolveCname()`.
   * Returns true if the domain resolves to the expected value.
   */
  private async performDnsLookup(domain: string, expectedValue: string): Promise<boolean> {
    try {
      const dns = await import('node:dns/promises')
      const records = await dns.resolveCname(domain)
      return records.some((r) => r === expectedValue || r.endsWith(`.${expectedValue}`))
    } catch {
      // DNS lookup failed — domain not yet configured
      return false
    }
  }
}


