// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Voice Cloning & Custom TTS — VoiceService
// =============================================================================

import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getAppLogger } from '../observability/logger'
import type { VoiceCloningProvider } from './cloning-provider'
import { VoiceConsentManager } from './consent'
import type {
  AudioSample,
  Voice,
  VoiceConsent,
  VoiceCreateConfig,
  VoiceDesignParams,
  VoiceListingConfig,
  VoicePreview,
  VoiceSettings,
} from './types'

const log = getAppLogger('voice-service')

export interface VoiceServiceConfig {
  /** Directory for persisting voice data. */
  dataDir?: string
  /** The cloning provider to use. */
  provider: VoiceCloningProvider
}

/**
 * Service for managing custom voices — cloning, designing, previewing,
 * and assigning voices to agents.
 *
 * Persistence is file-based (JSON), consistent with the project's approach.
 */
export class VoiceService {
  private readonly dataDir: string
  private readonly provider: VoiceCloningProvider
  private readonly consent: VoiceConsentManager
  private voices: Map<string, Voice> = new Map()

  constructor(config: VoiceServiceConfig) {
    this.dataDir = config.dataDir ?? join(process.cwd(), 'data', 'voices')
    this.provider = config.provider
    this.consent = new VoiceConsentManager(
      join(this.dataDir, 'consents'),
    )
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
    this.load()
  }

  // ---------------------------------------------------------------------------
  // Voice CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a voice record (metadata only — does not call the provider).
   * Use {@link cloneVoice} or {@link designVoice} for provider-backed creation.
   */
  async createVoice(orgId: string, config: VoiceCreateConfig): Promise<Voice> {
    const voice: Voice = {
      id: randomUUID(),
      orgId,
      name: config.name,
      description: config.description,
      language: config.language,
      gender: config.gender,
      age: config.age,
      style: config.style,
      providerVoiceId: '',
      provider: 'elevenlabs',
      source: 'library',
      settings: {
        stability: 0.5,
        similarityBoost: 0.8,
        style: 0.0,
        speed: 1.0,
      },
      published: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.voices.set(voice.id, voice)
    this.save()
    log.info({ voiceId: voice.id, name: voice.name }, 'Voice created')
    return voice
  }

  /**
   * Clone a voice from audio samples.
   *
   * Requires consent to be recorded before cloning.
   * Minimum 60 seconds of total audio across all samples.
   */
  async cloneVoice(
    orgId: string,
    samples: AudioSample[],
    name: string,
    consentData: Omit<VoiceConsent, 'voiceId' | 'timestamp'>,
  ): Promise<Voice> {
    // Validate samples
    const validation = this.consent.validateSamples(samples)
    if (!validation.valid) {
      throw new Error(`Invalid audio samples: ${validation.errors.join('; ')}`)
    }

    // Create voice on provider
    const { providerVoiceId } = await this.provider.cloneVoice(
      samples,
      name,
      `Cloned voice for org ${orgId}`,
    )

    const voice: Voice = {
      id: randomUUID(),
      orgId,
      name,
      description: `Cloned voice: ${name}`,
      language: 'en',
      gender: 'neutral',
      age: 'middle',
      style: 'conversational',
      providerVoiceId,
      provider: 'elevenlabs',
      source: 'cloned',
      settings: {
        stability: 0.5,
        similarityBoost: 0.8,
        style: 0.0,
        speed: 1.0,
      },
      published: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Record consent
    this.consent.recordConsent({
      voiceId: voice.id,
      consentType: consentData.consentType,
      consentDocument: consentData.consentDocument,
      agreedToTerms: consentData.agreedToTerms,
      ipAddress: consentData.ipAddress,
      timestamp: new Date().toISOString(),
    })

    this.voices.set(voice.id, voice)
    this.save()
    log.info({ voiceId: voice.id, providerVoiceId, name }, 'Voice cloned')
    return voice
  }

  /**
   * Design a voice from a text description (no samples needed).
   */
  async designVoice(orgId: string, params: VoiceDesignParams): Promise<Voice> {
    const { providerVoiceId } = await this.provider.designVoice(params)

    const voice: Voice = {
      id: randomUUID(),
      orgId,
      name: `Designed voice — ${params.gender} ${params.age}`,
      description: params.description,
      language: 'en',
      gender: params.gender,
      age: params.age,
      style: params.style,
      providerVoiceId,
      provider: 'elevenlabs',
      source: 'designed',
      settings: {
        stability: 0.5,
        similarityBoost: 0.8,
        style: 0.0,
        speed: 1.0,
      },
      published: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.voices.set(voice.id, voice)
    this.save()
    log.info({ voiceId: voice.id, providerVoiceId }, 'Voice designed')
    return voice
  }

  /** Delete a custom voice and its provider-side voice. */
  async deleteVoice(orgId: string, voiceId: string): Promise<void> {
    const voice = this.getOrgVoice(orgId, voiceId)

    // Delete from provider if it has a provider voice
    if (voice.providerVoiceId) {
      await this.provider.deleteVoice(voice.providerVoiceId)
    }

    this.consent.removeConsent(voiceId)
    this.voices.delete(voiceId)
    this.save()
    log.info({ voiceId, name: voice.name }, 'Voice deleted')
  }

  /** List all voices for an organization. */
  listVoices(orgId: string): Voice[] {
    return Array.from(this.voices.values()).filter((v) => v.orgId === orgId)
  }

  /** Get a single voice by ID. */
  getVoice(voiceId: string): Voice | undefined {
    return this.voices.get(voiceId)
  }

  /** Generate a voice preview. */
  async previewVoice(voiceId: string, text: string): Promise<VoicePreview> {
    const voice = this.voices.get(voiceId)
    if (!voice) throw new Error(`Voice not found: ${voiceId}`)
    if (!voice.providerVoiceId) throw new Error('Voice has no provider voice ID')

    return this.provider.previewVoice(voice.providerVoiceId, text)
  }

  // ---------------------------------------------------------------------------
  // Voice Management
  // ---------------------------------------------------------------------------

  /** Update voice settings. */
  async updateVoice(
    orgId: string,
    voiceId: string,
    updates: Partial<Pick<Voice, 'name' | 'description' | 'settings'>>,
  ): Promise<Voice> {
    const voice = this.getOrgVoice(orgId, voiceId)

    if (updates.name !== undefined) voice.name = updates.name
    if (updates.description !== undefined) voice.description = updates.description
    if (updates.settings) {
      voice.settings = { ...voice.settings, ...updates.settings }
      // Sync settings to provider
      if (voice.providerVoiceId) {
        await this.provider.updateVoiceSettings(voice.providerVoiceId, updates.settings)
      }
    }

    voice.updatedAt = new Date().toISOString()
    this.save()
    log.debug({ voiceId, updates: Object.keys(updates) }, 'Voice updated')
    return voice
  }

  /** Share a voice with another organization. */
  async shareVoice(orgId: string, voiceId: string, targetOrgId: string): Promise<void> {
    const voice = this.getOrgVoice(orgId, voiceId)

    // Create a copy for the target org
    const shared: Voice = {
      ...voice,
      id: randomUUID(),
      orgId: targetOrgId,
      source: 'library',
      published: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.voices.set(shared.id, shared)
    this.save()
    log.info({ voiceId, targetOrgId, sharedId: shared.id }, 'Voice shared')
  }

  /** Publish a voice to the marketplace. */
  async publishToMarketplace(
    orgId: string,
    voiceId: string,
    _listing: VoiceListingConfig,
  ): Promise<void> {
    const voice = this.getOrgVoice(orgId, voiceId)
    voice.published = true
    voice.updatedAt = new Date().toISOString()
    this.save()
    log.info({ voiceId, name: voice.name }, 'Voice published to marketplace')
  }

  /** Get all published marketplace voices. */
  listMarketplaceVoices(): Voice[] {
    return Array.from(this.voices.values()).filter((v) => v.published)
  }

  /** Get consent information for a voice. */
  getConsent(voiceId: string): VoiceConsent | undefined {
    return this.consent.getConsent(voiceId)
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private getOrgVoice(orgId: string, voiceId: string): Voice {
    const voice = this.voices.get(voiceId)
    if (!voice) throw new Error(`Voice not found: ${voiceId}`)
    if (voice.orgId !== orgId) throw new Error('Voice does not belong to this organization')
    return voice
  }

  private dataPath(): string {
    return join(this.dataDir, 'voices.json')
  }

  private load(): void {
    const path = this.dataPath()
    if (!existsSync(path)) return

    try {
      const raw = readFileSync(path, 'utf-8')
      const records: Voice[] = JSON.parse(raw)
      for (const record of records) {
        this.voices.set(record.id, record)
      }
      log.debug({ count: records.length }, 'Voices loaded from disk')
    } catch (err) {
      log.warn({ err }, 'Failed to load voices from disk')
    }
  }

  private save(): void {
    const path = this.dataPath()
    const records = Array.from(this.voices.values())
    writeFileSync(path, JSON.stringify(records, null, 2), 'utf-8')
  }
}


