// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Intelligence – Speaker Identification
// =============================================================================

import type { Page } from 'puppeteer'

export interface SpeakerProfile {
  id: string
  name: string
  firstSeen: number
  messageCount: number
}

/**
 * Identifies the current speaker using signals available in the X Space UI.
 *
 * Strategy priority:
 * 1. DOM inspection — X Spaces shows a visual indicator (green ring / animation)
 *    around the active speaker's avatar.
 * 2. Energy-based speaker-change heuristic — large energy shift after silence
 *    suggests a different person started talking.
 */
export class SpeakerIdentifier {
  private speakers: Map<string, SpeakerProfile> = new Map()
  private currentSpeaker: string | null = null
  private lastEnergy = 0

  /**
   * Attempt to identify the active speaker by inspecting the X Space DOM.
   * Returns the speaker's display name, or `null` if detection fails.
   */
  async identifyFromUI(page: Page | null): Promise<string | null> {
    if (!page) return null

    try {
      const name: string | null = await page.evaluate(() => {
        // X Spaces renders speaker avatars with data-testid attributes.
        // The actively-speaking avatar gets an animation or visual indicator.
        const avatars = document.querySelectorAll(
          '[data-testid="SpaceSpeakerAvatar"], [data-testid="speakerAvatar"]',
        )
        for (const avatar of avatars) {
          const isActive =
            avatar.closest('[data-testid="activeSpeaker"]') ||
            avatar.querySelector('[style*="animation"]') ||
            avatar.closest('[class*="speaking"]')
          if (isActive) {
            const nameEl =
              avatar.closest('[data-testid="speakerSlot"]')?.querySelector('span') ||
              avatar.parentElement?.querySelector('span')
            return nameEl?.textContent?.trim() ?? null
          }
        }

        // Fallback: look for any element that signals "currently speaking"
        const speakingIndicator = document.querySelector(
          '[data-testid="speakingIndicator"], [aria-label*="speaking"]',
        )
        if (speakingIndicator) {
          const nameEl = speakingIndicator.closest('[data-testid="speakerSlot"]')?.querySelector('span')
          return nameEl?.textContent?.trim() ?? null
        }

        return null
      })

      if (name) {
        this.currentSpeaker = name
        this.trackSpeaker(name)
      }

      return name
    } catch {
      // DOM evaluation can fail if page navigated away or closed
      return null
    }
  }

  /**
   * Heuristic: detect whether the speaker likely changed based on audio
   * energy profile and silence gap duration.
   */
  detectSpeakerChange(
    currentEnergy: number,
    previousEnergy: number,
    silenceGapMs: number,
  ): boolean {
    const energyRatio = currentEnergy / (previousEnergy || 0.001)
    const changed = silenceGapMs > 500 && (energyRatio > 2.0 || energyRatio < 0.5)

    this.lastEnergy = currentEnergy
    return changed
  }

  /** Register or update a known speaker. */
  addSpeaker(id: string, name: string): void {
    const existing = this.speakers.get(id)
    if (existing) {
      existing.name = name
    } else {
      this.speakers.set(id, { id, name, firstSeen: Date.now(), messageCount: 0 })
    }
  }

  /** Get the currently active speaker (last identified). */
  getCurrentSpeaker(): string | null {
    return this.currentSpeaker
  }

  /** Return all known speakers. */
  getKnownSpeakers(): SpeakerProfile[] {
    return [...this.speakers.values()]
  }

  /** Increment message count for a speaker identified by name. */
  private trackSpeaker(name: string): void {
    // Find by name or create with name as id
    let profile: SpeakerProfile | undefined
    for (const p of this.speakers.values()) {
      if (p.name === name) {
        profile = p
        break
      }
    }

    if (profile) {
      profile.messageCount++
    } else {
      const id = name.toLowerCase().replace(/\s+/g, '_')
      this.speakers.set(id, { id, name, firstSeen: Date.now(), messageCount: 1 })
    }
  }
}


