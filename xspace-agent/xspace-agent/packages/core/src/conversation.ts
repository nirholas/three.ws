// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import type { Message, MiddlewareStage } from './types'

export interface ConversationConfig {
  systemPrompt: string
  maxHistory?: number
}

export class ConversationManager {
  private history: Message[] = []
  private systemPrompt: string
  private readonly maxHistory: number
  private middlewares: Map<MiddlewareStage, Array<(...args: any[]) => any>> = new Map()

  constructor(config: ConversationConfig) {
    this.systemPrompt = config.systemPrompt
    this.maxHistory = config.maxHistory ?? 20
  }

  addMessage(role: Message['role'], content: string): void {
    this.history.push({ role, content })
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory)
    }
  }

  getHistory(): Message[] {
    return [...this.history]
  }

  clearHistory(): void {
    this.history = []
  }

  getSystemPrompt(): string {
    return this.systemPrompt
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
  }

  // ── Middleware ──────────────────────────────────────────────

  use(stage: MiddlewareStage, handler: (...args: any[]) => any): void {
    if (!this.middlewares.has(stage)) {
      this.middlewares.set(stage, [])
    }
    this.middlewares.get(stage)!.push(handler)
  }

  async runMiddleware(stage: MiddlewareStage, ...args: any[]): Promise<any> {
    const handlers = this.middlewares.get(stage)
    if (!handlers || handlers.length === 0) {
      return args.length === 1 ? args[0] : { messages: args[0], systemPrompt: args[1] }
    }

    let result: any = args.length === 1 ? args[0] : { messages: args[0], systemPrompt: args[1] }
    for (const handler of handlers) {
      const output = await handler(result)
      if (output === null || output === undefined) return null
      result = output
    }
    return result
  }
}


