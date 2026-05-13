# Task 14: Unit Test Coverage to 90%+

## Context
Tests exist in `packages/core/tests/` and `packages/core/src/__tests__/` using Vitest. Coverage targets are ~80% but we need 90%+ for enterprise grade.

## Requirements

### Coverage Targets
- Statements: 90%+
- Branches: 85%+
- Functions: 90%+
- Lines: 90%+

### Priority Files to Test (highest impact)
Run `npx vitest run --coverage` first to identify gaps, then focus on:

1. **`packages/core/src/agent.ts`** (XSpaceAgent) — Test all lifecycle methods: constructor, join, leave, destroy. Test event emissions. Test error handling for invalid configs. Test middleware registration.

2. **`packages/core/src/team.ts`** (AgentTeam) — Test team creation, agent addition/removal, turn coordination, team state machine transitions.

3. **`packages/core/src/fsm/machine.ts`** (StateMachine) — Test all state transitions, invalid transitions (should throw), event callbacks, guard conditions.

4. **`packages/core/src/browser/selector-engine.ts`** (SelectorEngine) — Test each strategy (CSS, text, ARIA), fallback behavior, self-healing when primary selector fails.

5. **`packages/core/src/audio/pipeline.ts`** (AudioPipeline) — Test pipeline start/stop, middleware hooks, audio chunk processing, error propagation.

6. **`packages/core/src/conversation.ts`** (ConversationManager) — Test message adding, token counting, context windowing, history retrieval, max length enforcement.

7. **`packages/core/src/providers/router.ts`** (ProviderRouter) — Test routing logic, fallback on failure, provider selection, health-based routing.

8. **`packages/core/src/providers/cost-tracker.ts`** (CostTracker) — Test cost calculation per provider, cumulative tracking, reset.

9. **`packages/core/src/turns/decision-engine.ts`** (DecisionEngine) — Test should-respond logic for various scenarios: direct address, question detection, topic relevance, cooldown.

10. **`packages/core/src/plugins/manager.ts`** (PluginManager) — Test plugin registration, lifecycle hooks, error isolation (one plugin failing shouldn't crash others).

### Test Patterns
- Use mock providers (don't call real APIs in unit tests)
- Use `vi.mock()` for external dependencies
- Test both success and error paths
- Test edge cases: empty inputs, null values, very large inputs
- Test async operations with proper await/assertions
- Group tests with `describe` blocks matching the class structure

### Test Utilities
If not already present, create test helpers:
- `createMockLLMProvider()` — returns a mock implementing `LLMProvider` interface
- `createMockSTTProvider()` — returns a mock implementing `STTProvider` interface
- `createMockTTSProvider()` — returns a mock implementing `TTSProvider` interface
- `createTestAgent(overrides?)` — creates an XSpaceAgent with sensible test defaults
- `createTestConfig(overrides?)` — creates a valid config object

### Configuration
Update `vitest.config.ts` (or create if missing):
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types.ts',
        '**/index.ts', // barrel exports
      ]
    },
    testTimeout: 10000,
  }
})
```

## Files to Create
- Tests for any untested files identified by coverage report
- `packages/core/tests/helpers/mocks.ts` — shared mock factories
- `packages/core/tests/helpers/fixtures.ts` — test data fixtures

## Files to Modify
- `packages/core/vitest.config.ts` — update thresholds
- Existing test files — add missing test cases

## Acceptance Criteria
- [ ] `npx vitest run --coverage` shows 90%+ statements
- [ ] All core classes have comprehensive test suites
- [ ] Error paths are tested (not just happy paths)
- [ ] No tests rely on external APIs or network calls
- [ ] Tests run in < 30 seconds total
- [ ] Coverage report is generated in HTML format for review
- [ ] CI pipeline enforces coverage thresholds (fails if below)


