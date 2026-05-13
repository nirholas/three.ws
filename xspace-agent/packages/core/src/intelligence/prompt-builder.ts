// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// Intelligence – Dynamic System Prompt Builder
// =============================================================================

import type { TopicTracker } from './topic-tracker'
import type { SpeakerIdentifier } from './speaker-id'

/**
 * Builds system prompts that adapt to the current conversation context —
 * current topic, known speakers, and behavioral guidance.
 */
export class PromptBuilder {
  private basePrompt: string
  private topicTracker: TopicTracker
  private speakerIdentifier: SpeakerIdentifier

  constructor(
    basePrompt: string,
    topicTracker: TopicTracker,
    speakerIdentifier: SpeakerIdentifier,
  ) {
    this.basePrompt = basePrompt
    this.topicTracker = topicTracker
    this.speakerIdentifier = speakerIdentifier
  }

  /** Update the base system prompt. */
  setBasePrompt(prompt: string): void {
    this.basePrompt = prompt
  }

  /** Build a context-aware system prompt. */
  build(): string {
    const parts = [this.basePrompt]

    // Current topic context
    const topic = this.topicTracker.getCurrentTopic()
    if (topic !== 'general') {
      parts.push(`\nThe current topic of discussion is: ${topic}`)
    }

    // Known speakers
    const speakers = this.speakerIdentifier.getKnownSpeakers()
    if (speakers.length > 0) {
      parts.push(`\nPeople in the Space: ${speakers.map(s => s.name).join(', ')}`)
    }

    // Behavioral guidance
    parts.push(`\nConversation guidelines:`)
    parts.push(`- Keep responses concise (2-3 sentences for casual topics, more for technical questions)`)
    parts.push(`- Reference what speakers said by name when responding`)
    parts.push(`- If the topic changes, acknowledge the transition naturally`)

    return parts.join('\n')
  }
}


