# Task: Write Tests for the Skills Registry

## Context

This is the `three.ws` 3D agent platform. The skill system (`src/agent-skills.js`, 459 lines) is the plugin layer that lets agents perform actions beyond LLM text generation. External skills are loaded from URLs (IPFS, Arweave, HTTPS), gated by a trust mode (`any`, `owned-only`, `whitelist`), and executed with a rich context object. This file has **zero test coverage**.

## Goal

Write a vitest test suite at `tests/src/agent-skills.test.js`.

## Files to Read First

- `src/agent-skills.js` — `SkillRegistry` class: `install(spec, { bundleBase })`, trust modes, dependency loading, handler execution
- `src/agent-protocol.js` — `AgentProtocol`, `ACTION_TYPES` (skills emit `perform-skill`, `skill-done`, `skill-error`)
- `src/skill-manifest.js` — skill manifest format
- `tests/src/agent-protocol.test.js` — reference for test style

## What to Test

### Installation & trust
1. `install(spec)` in `any` trust mode accepts any skill regardless of origin
2. `install(spec)` in `owned-only` mode rejects a skill whose origin doesn't match the agent owner
3. `install(spec)` in `whitelist` mode rejects skills not in the whitelist
4. `install(spec)` in `whitelist` mode accepts a skill that is on the whitelist
5. Installing a skill with `dependencies` triggers recursive loading of each dependency URL (mock fetch)
6. Installing the same skill name twice does not duplicate it in the registry

### Skill execution
7. Calling an installed skill invokes its `handler` with `(args, ctx)`
8. The `ctx` object passed to the handler contains `speak`, `remember`, `fetch`, and `call`
9. A successful handler result emits `skill-done` on the protocol with `{ skill, result: { success: true } }`
10. A handler that throws emits `skill-error` on the protocol with the error message
11. `ctx.speak(text)` emits a `speak` action on the protocol
12. `ctx.remember(entry)` emits a `remember` action on the protocol

### Skill lookup
13. After installing, the skill is discoverable via the registry (e.g., `registry.get(name)` or equivalent)
14. Requesting an uninstalled skill returns null/undefined (no crash)

### Manifest loading
15. A skill spec loaded from `ipfs://` URL is fetched and normalized correctly (mock fetch + IPFS gateway)
16. A skill spec loaded from `https://` URL is fetched and normalized correctly (mock fetch)

## Approach

- Mock `fetch` with `vi.stubGlobal('fetch', ...)` to return fixture skill manifests
- Use a real `AgentProtocol` instance and assert emitted events
- Keep fixture skill specs minimal: `{ name, description, signature: [], handler: vi.fn() }`
- Trust mode tests need a mock "agent owner" identity — pass it as constructor arg or mock the identity module

## Success Criteria

- `npm test tests/src/agent-skills.test.js` passes
- Trust modes, dependency loading, execution lifecycle, and error handling all covered
- No real network calls
