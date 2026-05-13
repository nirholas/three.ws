// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// CI/CD — Agent Test Runner
// =============================================================================

import type { AgentTest, AgentTestResult, TestSuiteResult } from './types'

export interface TestRunnerProvider {
  /** Generate a response for the given input using the agent config. */
  generateResponse(input: string, config: unknown): Promise<{
    response: string
    latencyMs: number
    sentiment?: number
    handoffTarget?: string | null
  }>
}

/**
 * Runs a suite of agent tests against a configuration using a pluggable provider.
 */
export class AgentTestRunner {
  constructor(private provider: TestRunnerProvider) {}

  async runSuite(tests: AgentTest[], config: unknown): Promise<TestSuiteResult> {
    const suiteStart = Date.now()
    const results: AgentTestResult[] = []

    for (const test of tests) {
      const result = await this.runTest(test, config)
      results.push(result)
    }

    const durationMs = Date.now() - suiteStart
    return {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      durationMs,
      results,
      ranAt: new Date().toISOString(),
    }
  }

  async runTest(test: AgentTest, config: unknown): Promise<AgentTestResult> {
    const start = Date.now()
    const checks: AgentTestResult['checks'] = {}
    let actualResponse: string | undefined
    let error: string | undefined

    try {
      const result = await this.provider.generateResponse(test.input, config)
      const durationMs = Date.now() - start
      actualResponse = result.response
      const responded = result.response.length > 0

      // Check: shouldRespond
      const { expectedBehavior: expected } = test
      checks.shouldRespond = {
        expected: expected.shouldRespond,
        actual: responded,
        passed: expected.shouldRespond === responded,
      }

      // Check: responseContains
      if (expected.responseContains && responded) {
        const lower = result.response.toLowerCase()
        const found = expected.responseContains.filter((s) => lower.includes(s.toLowerCase()))
        const missing = expected.responseContains.filter((s) => !lower.includes(s.toLowerCase()))
        checks.responseContains = {
          expected: expected.responseContains,
          found,
          missing,
          passed: missing.length === 0,
        }
      }

      // Check: responseExcludes
      if (expected.responseExcludes && responded) {
        const lower = result.response.toLowerCase()
        const violations = expected.responseExcludes.filter((s) => lower.includes(s.toLowerCase()))
        checks.responseExcludes = {
          expected: expected.responseExcludes,
          violations,
          passed: violations.length === 0,
        }
      }

      // Check: sentimentRange
      if (expected.sentimentRange && result.sentiment !== undefined) {
        const [min, max] = expected.sentimentRange
        checks.sentimentRange = {
          expected: expected.sentimentRange,
          actual: result.sentiment,
          passed: result.sentiment >= min && result.sentiment <= max,
        }
      }

      // Check: maxLatencyMs
      if (expected.maxLatencyMs) {
        checks.maxLatencyMs = {
          expected: expected.maxLatencyMs,
          actual: result.latencyMs,
          passed: result.latencyMs <= expected.maxLatencyMs,
        }
      }

      // Check: shouldHandoff
      if (expected.shouldHandoff) {
        checks.shouldHandoff = {
          expected: expected.shouldHandoff,
          actual: result.handoffTarget ?? null,
          passed: result.handoffTarget === expected.shouldHandoff,
        }
      }

      const allPassed = Object.values(checks).every((c) => c.passed)

      return {
        name: test.name,
        passed: allPassed,
        durationMs,
        actualResponse,
        checks,
      }
    } catch (err: any) {
      error = err.message
      return {
        name: test.name,
        passed: false,
        durationMs: Date.now() - start,
        actualResponse,
        error,
        checks,
      }
    }
  }
}


