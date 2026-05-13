// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoiceService } from '../../../src/voice/service'
import { VoiceConsentManager } from '../../../src/voice/consent'
import type { VoiceCloningProvider } from '../../../src/voice/cloning-provider'
import type { AudioSample, Voice } from '../../../src/voice/types'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function createMockProvider(): VoiceCloningProvider {
  return {
    name: 'mock',
    cloneVoice: vi.fn().mockResolvedValue({ providerVoiceId: 'prov-voice-123' }),
    designVoice: vi.fn().mockResolvedValue({ providerVoiceId: 'prov-voice-456' }),
    deleteVoice: vi.fn().mockResolvedValue(undefined),
    updateVoiceSettings: vi.fn().mockResolvedValue(undefined),
    previewVoice: vi.fn().mockResolvedValue({
      audioBuffer: Buffer.from('audio-preview'),
      durationSeconds: 2.5,
      format: 'mp3',
    }),
    listProviderVoices: vi.fn().mockResolvedValue([]),
    checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 50 }),
  }
}

function makeTestSamples(totalDuration: number = 90): AudioSample[] {
  return [
    {
      audioBuffer: Buffer.alloc(1024),
      format: 'wav',
      durationSeconds: totalDuration,
      transcript: 'Hello world test audio.',
    },
  ]
}

describe('VoiceService', () => {
  let tempDir: string
  let service: VoiceService
  let provider: VoiceCloningProvider

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'voice-test-'))
    provider = createMockProvider()
    service = new VoiceService({ dataDir: tempDir, provider })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('createVoice', () => {
    it('should create a voice with metadata', async () => {
      const voice = await service.createVoice('org-1', {
        name: 'Test Voice',
        description: 'A test voice',
        language: 'en',
        gender: 'female',
        age: 'young',
        style: 'conversational',
        sampleRate: 22050,
      })

      expect(voice.id).toBeDefined()
      expect(voice.orgId).toBe('org-1')
      expect(voice.name).toBe('Test Voice')
      expect(voice.source).toBe('library')
    })
  })

  describe('cloneVoice', () => {
    it('should clone a voice from audio samples', async () => {
      const samples = makeTestSamples()

      const voice = await service.cloneVoice('org-1', samples, 'My Clone', {
        consentType: 'self',
        agreedToTerms: true,
        ipAddress: '127.0.0.1',
      })

      expect(voice.id).toBeDefined()
      expect(voice.name).toBe('My Clone')
      expect(voice.source).toBe('cloned')
      expect(voice.providerVoiceId).toBe('prov-voice-123')
      expect(provider.cloneVoice).toHaveBeenCalledOnce()
    })

    it('should reject samples under 60 seconds', async () => {
      const samples = makeTestSamples(30) // Only 30 seconds

      await expect(
        service.cloneVoice('org-1', samples, 'Short', {
          consentType: 'self',
          agreedToTerms: true,
          ipAddress: '127.0.0.1',
        }),
      ).rejects.toThrow('Minimum 60 seconds')
    })

    it('should record consent', async () => {
      const samples = makeTestSamples()

      const voice = await service.cloneVoice('org-1', samples, 'Consented', {
        consentType: 'self',
        agreedToTerms: true,
        ipAddress: '127.0.0.1',
      })

      const consent = service.getConsent(voice.id)
      expect(consent).toBeDefined()
      expect(consent!.consentType).toBe('self')
      expect(consent!.agreedToTerms).toBe(true)
    })
  })

  describe('designVoice', () => {
    it('should design a voice from description', async () => {
      const voice = await service.designVoice('org-1', {
        description: 'A warm female voice with a British accent',
        gender: 'female',
        age: 'middle',
        style: 'professional',
      })

      expect(voice.id).toBeDefined()
      expect(voice.source).toBe('designed')
      expect(voice.providerVoiceId).toBe('prov-voice-456')
      expect(provider.designVoice).toHaveBeenCalledOnce()
    })
  })

  describe('deleteVoice', () => {
    it('should delete a voice and its provider voice', async () => {
      const voice = await service.createVoice('org-1', {
        name: 'To Delete',
        description: 'Will be deleted',
        language: 'en',
        gender: 'male',
        age: 'senior',
        style: 'authoritative',
        sampleRate: 44100,
      })

      // Manually set a provider voice ID
      const updated = await service.updateVoice('org-1', voice.id, {
        name: 'To Delete',
      })

      await service.deleteVoice('org-1', voice.id)

      expect(service.getVoice(voice.id)).toBeUndefined()
    })

    it('should reject deletion for wrong org', async () => {
      const voice = await service.createVoice('org-1', {
        name: 'Owned',
        description: 'Owned by org-1',
        language: 'en',
        gender: 'neutral',
        age: 'young',
        style: 'calm',
        sampleRate: 22050,
      })

      await expect(service.deleteVoice('org-2', voice.id)).rejects.toThrow(
        'does not belong to this organization',
      )
    })
  })

  describe('listVoices', () => {
    it('should list only voices for the given org', async () => {
      await service.createVoice('org-1', {
        name: 'Voice A',
        description: 'A',
        language: 'en',
        gender: 'male',
        age: 'young',
        style: 'energetic',
        sampleRate: 22050,
      })
      await service.createVoice('org-2', {
        name: 'Voice B',
        description: 'B',
        language: 'en',
        gender: 'female',
        age: 'middle',
        style: 'calm',
        sampleRate: 22050,
      })

      const org1Voices = service.listVoices('org-1')
      expect(org1Voices).toHaveLength(1)
      expect(org1Voices[0].name).toBe('Voice A')

      const org2Voices = service.listVoices('org-2')
      expect(org2Voices).toHaveLength(1)
      expect(org2Voices[0].name).toBe('Voice B')
    })
  })

  describe('previewVoice', () => {
    it('should generate a preview', async () => {
      const samples = makeTestSamples()
      const voice = await service.cloneVoice('org-1', samples, 'Preview Test', {
        consentType: 'self',
        agreedToTerms: true,
        ipAddress: '127.0.0.1',
      })

      const preview = await service.previewVoice(voice.id, 'Hello world')
      expect(preview.audioBuffer).toBeInstanceOf(Buffer)
      expect(preview.format).toBe('mp3')
    })

    it('should throw for unknown voice', async () => {
      await expect(service.previewVoice('non-existent', 'Hello')).rejects.toThrow('not found')
    })
  })

  describe('updateVoice', () => {
    it('should update voice name and settings', async () => {
      const voice = await service.createVoice('org-1', {
        name: 'Original',
        description: 'Desc',
        language: 'en',
        gender: 'neutral',
        age: 'middle',
        style: 'conversational',
        sampleRate: 22050,
      })

      const updated = await service.updateVoice('org-1', voice.id, {
        name: 'Updated Name',
        settings: { stability: 0.9, similarityBoost: 0.7, style: 0.3, speed: 1.5 },
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.settings.stability).toBe(0.9)
      expect(updated.settings.speed).toBe(1.5)
    })
  })

  describe('shareVoice', () => {
    it('should create a copy for the target org', async () => {
      const voice = await service.createVoice('org-1', {
        name: 'Shared',
        description: 'To share',
        language: 'en',
        gender: 'male',
        age: 'young',
        style: 'energetic',
        sampleRate: 22050,
      })

      await service.shareVoice('org-1', voice.id, 'org-2')

      const org2Voices = service.listVoices('org-2')
      expect(org2Voices).toHaveLength(1)
      expect(org2Voices[0].name).toBe('Shared')
      expect(org2Voices[0].id).not.toBe(voice.id) // Different ID
    })
  })

  describe('marketplace', () => {
    it('should publish and list marketplace voices', async () => {
      const voice = await service.createVoice('org-1', {
        name: 'Marketplace Voice',
        description: 'For sale',
        language: 'en',
        gender: 'female',
        age: 'middle',
        style: 'professional',
        sampleRate: 44100,
      })

      expect(service.listMarketplaceVoices()).toHaveLength(0)

      await service.publishToMarketplace('org-1', voice.id, {
        title: 'Pro Voice',
        description: 'Professional voice for business',
        tags: ['professional', 'female'],
        pricePerMonth: 10,
        previewText: 'Hello, how can I help you today?',
      })

      const marketplace = service.listMarketplaceVoices()
      expect(marketplace).toHaveLength(1)
      expect(marketplace[0].published).toBe(true)
    })
  })

  describe('persistence', () => {
    it('should persist and reload voices across instances', async () => {
      await service.createVoice('org-1', {
        name: 'Persisted',
        description: 'Should survive reload',
        language: 'en',
        gender: 'neutral',
        age: 'senior',
        style: 'calm',
        sampleRate: 22050,
      })

      // Create new service instance pointing to same directory
      const service2 = new VoiceService({ dataDir: tempDir, provider })
      const voices = service2.listVoices('org-1')
      expect(voices).toHaveLength(1)
      expect(voices[0].name).toBe('Persisted')
    })
  })
})

describe('VoiceConsentManager', () => {
  let tempDir: string
  let consent: VoiceConsentManager

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'consent-test-'))
    consent = new VoiceConsentManager(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should record and retrieve consent', () => {
    consent.recordConsent({
      voiceId: 'voice-1',
      consentType: 'self',
      agreedToTerms: true,
      ipAddress: '127.0.0.1',
      timestamp: new Date().toISOString(),
    })

    expect(consent.hasConsent('voice-1')).toBe(true)
    expect(consent.getConsent('voice-1')?.consentType).toBe('self')
  })

  it('should reject consent without agreed terms', () => {
    expect(() =>
      consent.recordConsent({
        voiceId: 'voice-2',
        consentType: 'self',
        agreedToTerms: false,
        ipAddress: '127.0.0.1',
        timestamp: new Date().toISOString(),
      }),
    ).toThrow('agreement to terms')
  })

  it('should require consent document for authorized type', () => {
    expect(() =>
      consent.recordConsent({
        voiceId: 'voice-3',
        consentType: 'authorized',
        agreedToTerms: true,
        ipAddress: '127.0.0.1',
        timestamp: new Date().toISOString(),
      }),
    ).toThrow('consent document')
  })

  it('should accept authorized consent with document', () => {
    consent.recordConsent({
      voiceId: 'voice-4',
      consentType: 'authorized',
      consentDocument: 'consent-form-signed.pdf',
      agreedToTerms: true,
      ipAddress: '127.0.0.1',
      timestamp: new Date().toISOString(),
    })

    expect(consent.hasConsent('voice-4')).toBe(true)
  })

  it('should validate sample duration', () => {
    const result = consent.validateSamples([
      { format: 'wav', durationSeconds: 30 },
      { format: 'mp3', durationSeconds: 20 },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Minimum 60 seconds')
  })

  it('should accept sufficient sample duration', () => {
    const result = consent.validateSamples([
      { format: 'wav', durationSeconds: 45 },
      { format: 'mp3', durationSeconds: 30 },
    ])

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject invalid formats', () => {
    const result = consent.validateSamples([
      { format: 'ogg', durationSeconds: 120 },
    ])

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('unsupported format')
  })

  it('should remove consent', () => {
    consent.recordConsent({
      voiceId: 'voice-5',
      consentType: 'self',
      agreedToTerms: true,
      ipAddress: '127.0.0.1',
      timestamp: new Date().toISOString(),
    })

    consent.removeConsent('voice-5')
    expect(consent.hasConsent('voice-5')).toBe(false)
  })
})


