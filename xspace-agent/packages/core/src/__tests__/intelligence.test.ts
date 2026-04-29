// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectSentiment } from '../intelligence/sentiment'
import { SpeakerIdentifier } from '../intelligence/speaker-id'
import { TopicTracker } from '../intelligence/topic-tracker'
import { ContextManager } from '../intelligence/context-manager'
import { PromptBuilder } from '../intelligence/prompt-builder'
import { ConversationStore } from '../intelligence/persistence'
import type { Message, Sentiment } from '../types'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// =============================================================================
// Sentiment Detection
// =============================================================================

describe('detectSentiment', () => {
  it('should detect questions with question mark', () => {
    expect(detectSentiment('What do you think about this?')).toBe('question')
  })

  it('should detect questions by starter words', () => {
    expect(detectSentiment('How does this work')).toBe('question')
    expect(detectSentiment('Why is the sky blue')).toBe('question')
    expect(detectSentiment('Can you explain that')).toBe('question')
  })

  it('should detect positive sentiment', () => {
    expect(detectSentiment('That is great work')).toBe('positive')
    expect(detectSentiment('I love this idea')).toBe('positive')
    expect(detectSentiment('Thank you so much')).toBe('positive')
    expect(detectSentiment('This is amazing')).toBe('positive')
  })

  it('should detect negative sentiment', () => {
    expect(detectSentiment('This is terrible')).toBe('negative')
    expect(detectSentiment('I hate this approach')).toBe('negative')
    expect(detectSentiment('That is ridiculous')).toBe('negative')
  })

  it('should detect frustrated sentiment', () => {
    expect(detectSentiment("I can't believe this happened"  )).toBe('frustrated')
    expect(detectSentiment('I am sick of this')).toBe('frustrated')
    expect(detectSentiment('Give me a break with this')).toBe('frustrated')
  })

  it('should detect excited sentiment via ALL CAPS', () => {
    expect(detectSentiment('THIS IS SO INCREDIBLY COOL')).toBe('excited')
  })

  it('should detect excited sentiment via multiple exclamation marks', () => {
    expect(detectSentiment('Wow this is so cool!!')).toBe('excited')
    expect(detectSentiment('No way!! Really!!')).toBe('excited')
  })

  it('should return neutral for plain statements', () => {
    expect(detectSentiment('The meeting is at three pm')).toBe('neutral')
    expect(detectSentiment('I went to the store yesterday')).toBe('neutral')
  })

  it('should handle empty and short strings', () => {
    expect(detectSentiment('')).toBe('neutral')
    expect(detectSentiment('ok')).toBe('neutral')
  })
})

// =============================================================================
// Speaker Identifier
// =============================================================================

describe('SpeakerIdentifier', () => {
  let identifier: SpeakerIdentifier

  beforeEach(() => {
    identifier = new SpeakerIdentifier()
  })

  describe('addSpeaker / getKnownSpeakers', () => {
    it('should register and retrieve speakers', () => {
      identifier.addSpeaker('alice_1', 'Alice')
      identifier.addSpeaker('bob_2', 'Bob')

      const speakers = identifier.getKnownSpeakers()
      expect(speakers).toHaveLength(2)
      expect(speakers.map(s => s.name)).toContain('Alice')
      expect(speakers.map(s => s.name)).toContain('Bob')
    })

    it('should update existing speaker name', () => {
      identifier.addSpeaker('alice_1', 'Alice')
      identifier.addSpeaker('alice_1', 'Alice Smith')

      const speakers = identifier.getKnownSpeakers()
      expect(speakers).toHaveLength(1)
      expect(speakers[0].name).toBe('Alice Smith')
    })
  })

  describe('getCurrentSpeaker', () => {
    it('should return null initially', () => {
      expect(identifier.getCurrentSpeaker()).toBeNull()
    })
  })

  describe('identifyFromUI', () => {
    it('should return null when page is null', async () => {
      const result = await identifier.identifyFromUI(null)
      expect(result).toBeNull()
    })

    it('should return null when page.evaluate throws', async () => {
      const mockPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Page closed')),
      }
      const result = await identifier.identifyFromUI(mockPage as any)
      expect(result).toBeNull()
    })

    it('should return speaker name from DOM', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue('Alice'),
      }
      const result = await identifier.identifyFromUI(mockPage as any)
      expect(result).toBe('Alice')
      expect(identifier.getCurrentSpeaker()).toBe('Alice')
    })

    it('should track the speaker when identified', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue('Alice'),
      }
      await identifier.identifyFromUI(mockPage as any)
      await identifier.identifyFromUI(mockPage as any)

      const speakers = identifier.getKnownSpeakers()
      const alice = speakers.find(s => s.name === 'Alice')
      expect(alice).toBeDefined()
      expect(alice!.messageCount).toBe(2)
    })

    it('should return null when no active speaker found', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(null),
      }
      const result = await identifier.identifyFromUI(mockPage as any)
      expect(result).toBeNull()
    })
  })

  describe('detectSpeakerChange', () => {
    it('should detect speaker change with large energy shift after silence', () => {
      expect(identifier.detectSpeakerChange(100, 20, 600)).toBe(true)
    })

    it('should not detect change during short silence', () => {
      expect(identifier.detectSpeakerChange(100, 20, 200)).toBe(false)
    })

    it('should not detect change with similar energy', () => {
      expect(identifier.detectSpeakerChange(50, 45, 600)).toBe(false)
    })

    it('should detect change when energy drops significantly', () => {
      expect(identifier.detectSpeakerChange(10, 100, 600)).toBe(true)
    })
  })
})

// =============================================================================
// Topic Tracker
// =============================================================================

describe('TopicTracker', () => {
  let tracker: TopicTracker

  beforeEach(() => {
    tracker = new TopicTracker(3) // Update every 3 messages for faster testing
  })

  it('should start with general topic', () => {
    expect(tracker.getCurrentTopic()).toBe('general')
  })

  it('should extract keywords filtering stop words', () => {
    const keywords = tracker.extractTopicKeywords(
      'The quick brown fox jumps over the lazy dog',
    )
    expect(keywords).toContain('quick')
    expect(keywords).toContain('brown')
    expect(keywords).toContain('jumps')
    expect(keywords).toContain('lazy')
    expect(keywords).not.toContain('the')
    expect(keywords).not.toContain('over')
  })

  it('should filter short words', () => {
    const keywords = tracker.extractTopicKeywords('I am a cat in a box')
    expect(keywords).not.toContain('cat')
    expect(keywords).not.toContain('box')
    expect(keywords).not.toContain('am')
  })

  it('should update topic after reaching message threshold', () => {
    tracker.onMessage('Let us discuss javascript frameworks today')
    tracker.onMessage('React and javascript are popular frameworks')
    tracker.onMessage('Vue is another javascript framework option')

    // After 3 messages, topic should update
    const topic = tracker.getCurrentTopic()
    expect(topic).not.toBe('general')
    expect(topic).toContain('javascript')
  })

  it('should track topic history', () => {
    // First topic
    tracker.onMessage('javascript javascript javascript frameworks')
    tracker.onMessage('javascript frameworks react')
    tracker.onMessage('javascript frameworks vue')

    // Topic changes
    tracker.onMessage('python machine learning data science')
    tracker.onMessage('python data science algorithms')
    tracker.onMessage('python machine learning models')

    const history = tracker.getTopicHistory()
    expect(history.length).toBeGreaterThan(0)
  })

  it('should return a copy of topic history', () => {
    const h1 = tracker.getTopicHistory()
    const h2 = tracker.getTopicHistory()
    expect(h1).not.toBe(h2)
    expect(h1).toEqual(h2)
  })

  it('should handle empty message buffer gracefully', () => {
    tracker.updateTopic()
    expect(tracker.getCurrentTopic()).toBe('general')
  })
})

// =============================================================================
// Context Manager
// =============================================================================

describe('ContextManager', () => {
  let manager: ContextManager

  beforeEach(() => {
    // Small context window for testing compression
    manager = new ContextManager({ maxTokens: 200, reservedTokens: 50 })
  })

  it('should add messages', () => {
    manager.addMessage({ role: 'user', content: 'Hello' })
    const messages = manager.getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Hello')
  })

  it('should set token count in metadata', () => {
    manager.addMessage({ role: 'user', content: 'Hello world' })
    const messages = manager.getMessages()
    expect(messages[0].metadata?.tokens).toBeGreaterThan(0)
  })

  it('should set timestamp in metadata', () => {
    manager.addMessage({ role: 'user', content: 'Hello' })
    const messages = manager.getMessages()
    expect(messages[0].metadata?.timestamp).toBeGreaterThan(0)
  })

  it('should preserve existing metadata', () => {
    manager.addMessage({
      role: 'user',
      content: 'Hello',
      metadata: { speakerName: 'Alice', timestamp: 1000, sentiment: 'positive' },
    })
    const messages = manager.getMessages()
    expect(messages[0].metadata?.speakerName).toBe('Alice')
    expect(messages[0].metadata?.sentiment).toBe('positive')
  })

  it('should compress when exceeding token budget', () => {
    // Add enough messages to exceed the small budget (200 - 50 = 150 token budget)
    for (let i = 0; i < 20; i++) {
      manager.addMessage({
        role: 'user',
        content: `This is a message with some content to fill up the context window number ${i}`,
      })
    }

    const messages = manager.getMessages()
    // Should have been compressed — fewer messages than added
    expect(messages.length).toBeLessThan(20)

    // Should contain a summary system message
    const summaryMsg = messages.find(
      m => m.role === 'system' && m.content.includes('[Previous conversation summary:'),
    )
    expect(summaryMsg).toBeDefined()
  })

  it('should keep recent messages after compression', () => {
    for (let i = 0; i < 20; i++) {
      manager.addMessage({ role: 'user', content: `Message ${i} with enough text for tokens` })
    }

    const messages = manager.getMessages()
    const lastMsg = messages[messages.length - 1]
    expect(lastMsg.content).toContain('Message 19')
  })

  it('should clear all messages', () => {
    manager.addMessage({ role: 'user', content: 'Hello' })
    manager.clear()
    expect(manager.getMessages()).toHaveLength(0)
    expect(manager.getStats().totalTokens).toBe(0)
  })

  it('should return accurate stats', () => {
    manager.addMessage({ role: 'user', content: 'Hello' })
    manager.addMessage({ role: 'assistant', content: 'World' })

    const stats = manager.getStats()
    expect(stats.totalMessages).toBe(2)
    expect(stats.totalTokens).toBeGreaterThan(0)
    expect(stats.budget).toBe(150) // 200 - 50
  })

  it('should return a copy of messages', () => {
    manager.addMessage({ role: 'user', content: 'Hello' })
    const m1 = manager.getMessages()
    const m2 = manager.getMessages()
    expect(m1).not.toBe(m2)
    expect(m1).toEqual(m2)
  })

  it('should estimate tokens', () => {
    expect(manager.estimateTokens('Hello world')).toBe(3) // 11 chars / 4 ≈ 3
    expect(manager.estimateTokens('')).toBe(0)
  })

  it('should include speaker and topic info in summary', () => {
    // Add messages with metadata that will be compressed
    for (let i = 0; i < 20; i++) {
      manager.addMessage({
        role: 'user',
        content: `Message ${i} with some long content to fill tokens up`,
        metadata: {
          speakerName: i % 2 === 0 ? 'Alice' : 'Bob',
          topic: 'testing',
          timestamp: Date.now(),
        },
      })
    }

    const messages = manager.getMessages()
    const summaryMsg = messages.find(
      m => m.role === 'system' && m.content.includes('Previous conversation summary'),
    )
    expect(summaryMsg).toBeDefined()
    if (summaryMsg) {
      expect(summaryMsg.content).toContain('Alice')
      expect(summaryMsg.content).toContain('Bob')
      expect(summaryMsg.content).toContain('testing')
    }
  })
})

// =============================================================================
// Prompt Builder
// =============================================================================

describe('PromptBuilder', () => {
  let builder: PromptBuilder
  let topicTracker: TopicTracker
  let speakerIdentifier: SpeakerIdentifier

  beforeEach(() => {
    topicTracker = new TopicTracker()
    speakerIdentifier = new SpeakerIdentifier()
    builder = new PromptBuilder('You are a helpful assistant.', topicTracker, speakerIdentifier)
  })

  it('should include base prompt', () => {
    const prompt = builder.build()
    expect(prompt).toContain('You are a helpful assistant.')
  })

  it('should include conversation guidelines', () => {
    const prompt = builder.build()
    expect(prompt).toContain('Conversation guidelines:')
    expect(prompt).toContain('Keep responses concise')
  })

  it('should not include topic when it is general', () => {
    const prompt = builder.build()
    expect(prompt).not.toContain('current topic of discussion')
  })

  it('should include topic when not general', () => {
    // Force a topic change
    const tracker = new TopicTracker(1)
    tracker.onMessage('javascript frameworks react angular')
    const b = new PromptBuilder('base', tracker, speakerIdentifier)
    const prompt = b.build()
    expect(prompt).toContain('current topic of discussion')
  })

  it('should include known speakers', () => {
    speakerIdentifier.addSpeaker('alice', 'Alice')
    speakerIdentifier.addSpeaker('bob', 'Bob')
    const prompt = builder.build()
    expect(prompt).toContain('People in the Space: Alice, Bob')
  })

  it('should not include speakers section when none are known', () => {
    const prompt = builder.build()
    expect(prompt).not.toContain('People in the Space')
  })

  it('should update base prompt', () => {
    builder.setBasePrompt('New base prompt')
    const prompt = builder.build()
    expect(prompt).toContain('New base prompt')
    expect(prompt).not.toContain('You are a helpful assistant.')
  })
})

// =============================================================================
// Conversation Store (Persistence)
// =============================================================================

describe('ConversationStore', () => {
  let store: ConversationStore
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xspace-test-'))
    store = new ConversationStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should save and load a conversation', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello', metadata: { timestamp: 1000 } },
      { role: 'assistant', content: 'Hi there', metadata: { timestamp: 1001 } },
    ]

    await store.save('https://x.com/i/spaces/abc123', messages, {
      startedAt: 1000,
      speakers: ['Alice', 'Bob'],
      topics: ['greetings'],
      summary: 'A short conversation',
    })

    const loaded = await store.load('https://x.com/i/spaces/abc123')
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('abc123')
    expect(loaded!.messages).toHaveLength(2)
    expect(loaded!.speakers).toEqual(['Alice', 'Bob'])
    expect(loaded!.topics).toEqual(['greetings'])
    expect(loaded!.summary).toBe('A short conversation')
    expect(loaded!.spaceUrl).toBe('https://x.com/i/spaces/abc123')
  })

  it('should return null for non-existent conversation', async () => {
    const loaded = await store.load('https://x.com/i/spaces/nonexistent')
    expect(loaded).toBeNull()
  })

  it('should extract space ID from URL', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Test', metadata: { timestamp: 1000 } },
    ]

    await store.save('https://x.com/i/spaces/xyz789', messages, {
      startedAt: 1000,
      speakers: [],
      topics: [],
      summary: 'test',
    })

    const loaded = await store.load('https://x.com/i/spaces/xyz789')
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('xyz789')
  })

  it('should get recent conversations sorted by end time', async () => {
    const makeMessages = (): Message[] => [
      { role: 'user', content: 'Hello', metadata: { timestamp: Date.now() } },
    ]
    const makeMeta = (startedAt: number) => ({
      startedAt,
      speakers: [],
      topics: [],
      summary: 'test',
    })

    await store.save('https://x.com/i/spaces/first', makeMessages(), makeMeta(100))
    // Small delay to ensure different endedAt
    await store.save('https://x.com/i/spaces/second', makeMessages(), makeMeta(200))
    await store.save('https://x.com/i/spaces/third', makeMessages(), makeMeta(300))

    const recent = await store.getRecent(2)
    expect(recent).toHaveLength(2)
    // Should be ordered by endedAt descending
    expect(recent[0].endedAt).toBeGreaterThanOrEqual(recent[1].endedAt)
  })

  it('should return empty array when no conversations exist', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'xspace-empty-'))
    const emptyStore = new ConversationStore(emptyDir)
    const recent = await emptyStore.getRecent()
    expect(recent).toEqual([])
    await rm(emptyDir, { recursive: true, force: true })
  })

  it('should handle non-existent store directory gracefully', async () => {
    const badStore = new ConversationStore('/tmp/nonexistent-xspace-dir-test')
    const recent = await badStore.getRecent()
    expect(recent).toEqual([])
  })

  it('should handle URLs without spaces pattern', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Test', metadata: { timestamp: 1000 } },
    ]

    await store.save('https://x.com/some/other/path', messages, {
      startedAt: 1000,
      speakers: [],
      topics: [],
      summary: 'test',
    })

    const loaded = await store.load('https://x.com/some/other/path')
    expect(loaded).not.toBeNull()
  })
})


