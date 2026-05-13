// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import fs from 'fs'
import path from 'path'
import type { Personality, PersonalityWithMeta } from './types'

const PRESETS_DIR = path.join(__dirname, 'presets')
const CUSTOM_DIR = path.join(__dirname, 'custom')

// Validate personality shape
function isValidPersonality(obj: unknown): obj is Personality {
  if (!obj || typeof obj !== 'object') return false
  const p = obj as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.description === 'string' &&
    typeof p.systemPrompt === 'string' &&
    p.systemPrompt.length > 0 &&
    typeof p.voice === 'object' &&
    p.voice !== null &&
    Array.isArray(p.context)
  )
}

// Sanitize personality ID to prevent path traversal
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

function loadFromDir(dir: string, isPreset: boolean): PersonalityWithMeta[] {
  if (!fs.existsSync(dir)) return []

  const results: PersonalityWithMeta[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
      if (isValidPersonality(raw)) {
        results.push({ ...raw, isPreset })
      }
    } catch {
      // Skip malformed files
    }
  }
  return results
}

export class PersonalityLoader {
  private cache: Map<string, PersonalityWithMeta> = new Map()

  constructor() {
    this.reload()
  }

  /** Reload all personalities from disk */
  reload(): void {
    this.cache.clear()
    const presets = loadFromDir(PRESETS_DIR, true)
    const custom = loadFromDir(CUSTOM_DIR, false)
    for (const p of [...presets, ...custom]) {
      this.cache.set(p.id, p)
    }
  }

  /** List all available personalities */
  list(): PersonalityWithMeta[] {
    return Array.from(this.cache.values())
  }

  /** Get a personality by ID */
  get(id: string): PersonalityWithMeta | undefined {
    return this.cache.get(id)
  }

  /** Create a new custom personality */
  create(personality: Personality): PersonalityWithMeta {
    const id = sanitizeId(personality.id)
    if (!id) throw new Error('Invalid personality ID')
    if (this.cache.has(id) && this.cache.get(id)!.isPreset) {
      throw new Error('Cannot overwrite a preset personality')
    }

    if (!fs.existsSync(CUSTOM_DIR)) {
      fs.mkdirSync(CUSTOM_DIR, { recursive: true })
    }

    const filePath = path.join(CUSTOM_DIR, `${id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(personality, null, 2), 'utf-8')

    const withMeta: PersonalityWithMeta = { ...personality, id, isPreset: false }
    this.cache.set(id, withMeta)
    return withMeta
  }

  /** Update an existing custom personality */
  update(id: string, updates: Partial<Personality>): PersonalityWithMeta {
    const safeId = sanitizeId(id)
    const existing = this.cache.get(safeId)
    if (!existing) throw new Error(`Personality '${safeId}' not found`)
    if (existing.isPreset) throw new Error('Cannot modify a preset personality')

    const updated: PersonalityWithMeta = {
      ...existing,
      ...updates,
      id: safeId, // Prevent ID change
      isPreset: false,
    }

    if (!isValidPersonality(updated)) {
      throw new Error('Invalid personality data after update')
    }

    const filePath = path.join(CUSTOM_DIR, `${safeId}.json`)
    const { isPreset: _, ...toWrite } = updated
    fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2), 'utf-8')

    this.cache.set(safeId, updated)
    return updated
  }

  /** Delete a custom personality */
  delete(id: string): void {
    const safeId = sanitizeId(id)
    const existing = this.cache.get(safeId)
    if (!existing) throw new Error(`Personality '${safeId}' not found`)
    if (existing.isPreset) throw new Error('Cannot delete a preset personality')

    const filePath = path.join(CUSTOM_DIR, `${safeId}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    this.cache.delete(safeId)
  }
}


