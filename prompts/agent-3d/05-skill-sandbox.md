# Task 05 — Worker-isolated skill handler execution

## Context

[src/skills/index.js](../../src/skills/index.js) loads skill `handlers.js` via dynamic `import()`. This gives handlers full DOM access, `window`, arbitrary network — too much. Per [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md) § Security model, code skills should execute in an isolated scope with a fixed `ctx` API as their only capability.

Realms (the proposal) isn't available yet. Workers are. A Web Worker-hosted handler gets:
- No DOM access.
- No direct `window`, `document`, or origin access beyond what we postMessage in.
- Only `fetch` (we can override) and whatever APIs we explicitly expose.

## Goal

Move skill handler execution into a shared Web Worker. The main-thread `ctx` API becomes a proxy that postMessages calls into the worker, which executes the handler and returns a structured-cloneable result. Viewer-side effects (play clip, set expression) flow back through request messages.

## Deliverable

1. **`src/skills/sandbox-worker.js`** (new file):
	 - Receives `{ type: "install", uri, handlersSrc }` messages, evaluates the source in the worker scope (via `Function()` or `importScripts()` for classic workers; prefer a module worker with a `blob:` URL).
	 - Receives `{ type: "invoke", skillURI, toolName, args }` messages. Calls the handler with a worker-side `ctx` that:
		 - Has the same method names as main-thread ctx (`viewer.play`, `memory.write`, `speak`, `loadClip`, ...).
		 - Each call becomes a `{ type: "request", id, method, args }` message back to main, which awaits and replies with `{ type: "response", id, result }`.
	 - Tracks in-flight requests by id; rejects on timeout (30s).
2. **`src/skills/sandbox-host.js`** (new file):
	 - Singleton worker manager. `getHost()` returns the shared worker instance.
	 - `invoke(skillURI, toolName, args, mainThreadCtx)` — posts to the worker, listens for request messages, forwards each to `mainThreadCtx`, posts responses, resolves when the worker returns the final result.
	 - Handles worker death/restart.
3. **Refactor `Skill.invoke()`** in [src/skills/index.js](../../src/skills/index.js):
	 - Instead of calling the in-process handler, delegate to `sandbox-host.getHost().invoke(...)` — passing the main-thread `ctx` from the runtime as the proxy target.
	 - Load `handlersSrc` as text (not dynamic import) and send to the worker at install time.
4. **Opt-out escape hatch**:
	 - Manifests can set `manifest.sandboxPolicy: "trusted-main-thread"` (name-bikeshed; document it) to bypass the worker for owner-signed skills. This preserves the current behavior for trusted skills while defaulting new skills to sandboxed.
5. **Spec update** — [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md) § Security model: document the worker sandbox and the opt-out.

## Audit checklist

- [ ] Skill handlers can no longer read `document.cookie`, `window.localStorage`, or any DOM from inside the handler code.
- [ ] Skill handlers can still perform their intended effects (play clips, set expression, write memory, speak) via `ctx`.
- [ ] `ctx.fetch(url)` in a worker still works (Workers have native fetch) — verify for same-origin + CORS targets.
- [ ] Error propagation: an exception in a handler surfaces as `{ error: "..." }` to the runtime without crashing the worker.
- [ ] Worker is shared across all skills of a single agent (one worker per agent instance, not per skill).
- [ ] 30s timeout on any single `ctx` method call prevents hung handlers.
- [ ] Memory write from inside a handler actually persists — the proxy round-trip is tested.
- [ ] Manifest-level `sandboxPolicy: "trusted-main-thread"` still works for owner-signed skills.
- [ ] Worker terminates cleanly on `element.destroy()`.

## Constraints

- No new npm dependencies.
- The worker must be a module worker (`new Worker(url, { type: "module" })`) so it can `import` shared utilities. Ship the worker source as a bundled `.js` in `dist-lib/`.
- Do not use `eval()` directly — use `Function()` or a `Blob`-URL module import.
- Do not break the existing `handlers.js` contract — handler code should not need to be rewritten for the sandbox unless it was doing something prohibited.
- Preserve the `ctx` API surface exactly as documented in [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md).

## Verification

1. `node --check` on new files.
2. `npm run build:lib` passes.
3. Integration test: mount an agent with the wave skill ([examples/skills/wave/](../../examples/skills/wave/)); trigger the tool; confirm the wave animation plays and the memory note is written.
4. Security test: write a hostile handler that tries to `document.title = "pwnd"` and confirm it throws (or silently no-ops — document which).

## Scope boundaries — do NOT do these

- Do not move the Viewer or Three.js into the worker. The main thread stays the render thread.
- Do not virtualize the entire skill module graph — only handlers execute in the worker.
- Do not attempt CSP or Realms. Worker isolation is enough for v0.1.
- Do not add a permissions UI ("this skill wants to X, allow?") — that's a follow-up.

## Reporting

- Bundle-size impact of the worker shim.
- Any performance regression in tool-call latency (expect +5-20ms for the postMessage round-trip).
- Which existing skills (if any) needed code changes to work in the sandbox.
- Document the final policy name for the opt-out and your rationale.
