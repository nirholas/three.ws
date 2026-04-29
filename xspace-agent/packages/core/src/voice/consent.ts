// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Voice Cloning & Custom TTS — Consent Manager
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getAppLogger } from '../observability/logger'
import type { VoiceConsent } from './types'

const log = getAppLogger('voice-consent')

/**
 * Manages voice cloning consent records for compliance and safety.
 *
 * Stores consent data as JSON on disk (file-based persistence, consistent
 * with the project's "no database dependencies" pattern).
 */
export class VoiceConsentManager {
  private readonly dataDir: string
  private consents: Map<string, VoiceConsent> = new Map()

  constructor(dataDir: string = join(process.cwd(), 'data', 'voice-consents')) {
    this.dataDir = dataDir
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
    this.load()
  }

  /**
   * Record consent for a voice cloning operation.
   * Must be called before creating a cloned voice.
   */
  recordConsent(consent: VoiceConsent): void {
    if (!consent.agreedToTerms) {
      throw new Error('Voice cloning requires agreement to terms of service')
    }
    if (consent.consentType === 'authorized' && !consent.consentDocument) {
      throw new Error('Cloning another person\'s voice requires a consent document')
    }

    this.consents.set(consent.voiceId, consent)
    this.save()
    log.info(
      { voiceId: consent.voiceId, type: consent.consentType },
      'Voice cloning consent recorded',
    )
  }

  /** Check whether consent has been recorded for a voice. */
  hasConsent(voiceId: string): boolean {
    return this.consents.has(voiceId)
  }

  /** Get the consent record for a voice. */
  getConsent(voiceId: string): VoiceConsent | undefined {
    return this.consents.get(voiceId)
  }

  /** Remove consent record (e.g. when voice is deleted). */
  removeConsent(voiceId: string): void {
    this.consents.delete(voiceId)
    this.save()
  }

  /**
   * Validate audio samples for basic quality requirements.
   *
   * - Minimum total duration: 60 seconds
   * - Supported formats only
   */
  validateSamples(
    samples: Array<{ format: string; durationSeconds: number }>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const validFormats = new Set(['wav', 'mp3'])

    const totalDuration = samples.reduce((sum, s) => sum + s.durationSeconds, 0)
    if (totalDuration < 60) {
      errors.push(
        `Minimum 60 seconds of audio required, got ${totalDuration.toFixed(1)}s`,
      )
    }

    for (let i = 0; i < samples.length; i++) {
      if (!validFormats.has(samples[i].format)) {
        errors.push(`Sample ${i + 1}: unsupported format '${samples[i].format}', use wav or mp3`)
      }
    }

    return { valid: errors.length === 0, errors }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private dataPath(): string {
    return join(this.dataDir, 'consents.json')
  }

  private load(): void {
    const path = this.dataPath()
    if (!existsSync(path)) return

    try {
      const raw = readFileSync(path, 'utf-8')
      const records: VoiceConsent[] = JSON.parse(raw)
      for (const record of records) {
        this.consents.set(record.voiceId, record)
      }
      log.debug({ count: records.length }, 'Voice consent records loaded')
    } catch (err) {
      log.warn({ err }, 'Failed to load voice consent records')
    }
  }

  private save(): void {
    const path = this.dataPath()
    const records = Array.from(this.consents.values())
    writeFileSync(path, JSON.stringify(records, null, 2), 'utf-8')
  }
}


