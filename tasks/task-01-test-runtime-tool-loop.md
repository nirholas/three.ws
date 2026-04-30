# Task: Write Tests for the Agent Runtime Tool Loop

## Context

This is the `three.ws` 3D agent platform. The agent runtime lives in `src/runtime/`. It drives all LLM-powered agent behavior: sending messages to Claude, executing tool calls, and emitting protocol events. This core flow has **zero test coverage**.

## Goal

Write a vitest test suite for the agent runtime tool loop. Tests should live at `tests/src/runtime.test.js`.

## Files to Read First

- `src/runtime/index.js` (~236 lines) — the main runtime class and tool loop (`MAX_TOOL_ITERATIONS=8`)
- `src/runtime/tools.js` (~174 lines) — `BUILTIN_TOOLS` definitions (wave, lookAt, play_clip, setExpression, speak, remember)
- `src/runtime/providers.js` (~116 lines) — `AnthropicProvider` and `NullProvider`
- `src/agent-protocol.js` — `AgentProtocol` event bus, `ACTION_TYPES`
- `tests/src/agent-protocol.test.js` — existing test for reference on style/setup

## What to Test

### Tool loop behavior (`src/runtime/index.js`)
1. Sends user message to provider and gets a response
2. When provider returns a tool call, the runtime dispatches `perform-skill` on the protocol and calls the tool handler
3. Tool loop terminates after `MAX_TOOL_ITERATIONS` (8) even if provider keeps returning tool calls
4. When provider returns a text response (no tool call), loop ends and `speak` action is emitted
5. `think` actions are emitted when provider streams thinking steps (if applicable)
6. Error in tool handler emits `skill-error` on protocol and does not crash the loop

### Built-in tools (`src/runtime/tools.js`)
7. `speak` tool emits `speak` action on protocol with correct text/sentiment payload
8. `remember` tool emits `remember` action on protocol with the provided memory entry
9. `lookAt` tool emits `look-at` action with the correct target
10. `setExpression` tool emits `emote` action with trigger and weight

### NullProvider (`src/runtime/providers.js`)
11. `NullProvider.complete()` returns an empty/noop response without calling any API

## Approach

- Use `NullProvider` (or a mock) to avoid real API calls — keep tests fully offline
- Mock `AgentProtocol` or use a real instance and assert emitted events via `protocol.on()`
- Use `vi.fn()` for tool handlers to assert they were called with correct args
- Follow the existing test style in `tests/src/agent-protocol.test.js`

## Success Criteria

- `npm test tests/src/runtime.test.js` passes with all tests green
- No real HTTP calls made during tests
- Each test is isolated (no shared mutable state between tests)
