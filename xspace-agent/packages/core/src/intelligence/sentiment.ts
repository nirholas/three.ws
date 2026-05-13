// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Intelligence – Sentiment Detection
// =============================================================================

import type { Sentiment } from '../types'

const POSITIVE_PATTERN =
  /\b(great|awesome|love|amazing|excellent|fantastic|wonderful|thanks|thank you|agree|yes|exactly|perfect|brilliant|cool|nice)\b/

const NEGATIVE_PATTERN =
  /\b(terrible|awful|hate|stupid|ridiculous|annoying|frustrating|wrong|disagree|no way|nonsense|horrible|sucks|worst)\b/

const FRUSTRATED_PATTERN =
  /\b(can't believe|sick of|tired of|fed up|give me a break|seriously|come on|enough)\b/

const QUESTION_STARTERS =
  /^(what|how|why|when|where|who|which|can|could|would|do|does|is|are|will|should|have|has)\b/

/**
 * Lightweight, keyword + pattern-based sentiment detection.
 * No LLM call required — runs synchronously.
 */
export function detectSentiment(text: string): Sentiment {
  const lower = text.toLowerCase().trim()

  // Question detection
  if (lower.includes('?') || QUESTION_STARTERS.test(lower)) {
    return 'question'
  }

  // Frustrated signals (check before generic negative)
  if (FRUSTRATED_PATTERN.test(lower)) return 'frustrated'

  // Excited signals (ALL CAPS, repeated exclamation marks)
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 10 && letters === letters.toUpperCase()) return 'excited'
  if ((text.match(/!/g) || []).length >= 2) return 'excited'

  // Positive signals
  if (POSITIVE_PATTERN.test(lower)) return 'positive'

  // Negative signals
  if (NEGATIVE_PATTERN.test(lower)) return 'negative'

  return 'neutral'
}


