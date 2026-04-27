# 05 — LobeHub Plugin: Ship a Real Integration

## Context

[lobehub-plugin/](../../lobehub-plugin/) is the package that lets LobeChat users drop a three.ws avatar into their chat sidebar. Today it is **scaffolding only**: a manifest that looks right, a React component with `TODO: Hook into Lobe's onAssistantMessage event`, and a bridge that posts messages into a void because the host receiver didn't exist.

By the time you run this prompt, the receiver side (prompt 01 — `EmbedActionBridge`) may or may not be complete:

- If `src/embed-action-bridge.js` exists → target the real wire protocol spec documented there.
- If it does not → implement the bridge side against the schema described in `01-embed-bridges.md` (envelope: `{v, source, id, inReplyTo, kind, op, payload}`). Prompt 01 and this prompt are spec-compatible by construction.

The goal is a **shippable** LobeHub plugin — not a scaffold. When this is done, a LobeChat user can search the plugin registry, install `@3dagent/lobehub-plugin`, paste an agent id, and have an embodied avatar appear in their chat that reacts to assistant messages.

## Goal

Ship an installable LobeHub plugin with:

- A correct manifest matching the current LobeHub plugin schema.
- A React iframe host that resolves an agent id → `<agent-3d>` iframe → working bridge.
- A working hook into LobeChat's message stream (assistant messages → `avatar.speak(...)` with sentiment).
- Clean build output in `lobehub-plugin/dist/` consumable by LobeChat's plugin runtime.
- A local dev harness (a tiny HTML page that simulates the LobeChat host) so we can verify the plugin without running all of LobeChat.
- Submission-ready metadata (icon, screenshots dir, LICENSE, README with install instructions).

## Files you own

Everything under:

- `lobehub-plugin/**` (except `node_modules/`)
- `public/.well-known/lobehub-plugin.json` (the manifest served from the three.ws origin for remote-plugin installs)
- `public/lobehub/iframe/**` (the iframe target referenced by the manifest — create if it doesn't fully exist yet)

## Files read-only

- `src/embed-action-bridge.js` (if it exists after prompt 01 completes) — the receiver contract.
- `01-embed-bridges.md` — the wire protocol spec.
- `src/element.js` — `<agent-3d>` web component surface.
- `specs/EMBED_SPEC.md` — embed contract.
- `api/agents/[id].js` — the agent record shape the iframe will display.

## Acceptance — what "shippable" means

1. **Manifest.** `public/.well-known/lobehub-plugin.json` validates against the current LobeHub plugin-manifest JSON Schema. Check the LobeHub docs (<https://lobehub.com/docs/usage/plugins/development>) for the schemaVersion and ensure:
    - `identifier` is globally unique (`3d-agent` is reasonable).
    - `$schema` points to the canonical URL.
    - `api` entries either all resolve to real endpoints or the `api` array is omitted if this is iframe-only.
    - `ui.url` points to `https://three.ws/lobehub/iframe/` and that route actually serves HTML.
    - `settings` schema matches what the React component reads (`agentId`, `apiOrigin`).
2. **Iframe host.** `public/lobehub/iframe/index.html` renders `<agent-three.ws-id="{{agentId}}">` with correct styling for a 420–640px sidebar frame. Transparent background, no scrollbars, respects the `agentId` query param (the LobeHub host passes settings as querystring or fragment — implement whichever the real manifest spec requires).
3. **React plugin package.** `lobehub-plugin/src/`:
    - `AgentPane.tsx` — remove the `TODO: Hook into Lobe's onAssistantMessage` placeholder. Use whatever `@lobehub/ui` / `@lobehub/chat-plugin-sdk` package exposes for assistant-message observation. If the SDK shape is unstable, document fallback to the `window.addEventListener('lobe:assistantMessage', …)` path explicitly with a README note + a clear code comment explaining why this fallback exists.
    - `bridge.ts` — align with the final wire protocol from prompt 01. Every `op` in the manifest's `api` array (`render_agent`, `speak`, `gesture`, `emote`) has a matching bridge method. Handshake, timeout, origin check.
    - `config-schema.ts` — export a zod-like validator (or hand-rolled if zod isn't in deps) that guards `PluginSettings`.
    - `index.ts` — default export the plugin entry expected by the LobeHub runtime.
4. **Build.**
    - `cd lobehub-plugin && npm install && npm run build` produces `dist/bundle.js` with a tree-shaken, production-minified build.
    - No warnings in the build output.
    - `npm run type-check` passes.
5. **Dev harness.** `lobehub-plugin/dev/index.html` (new file) loads the built plugin inside a page that mocks the LobeChat host message contract. Include a button to inject a fake assistant message so the avatar can be seen reacting in isolation.
6. **Docs.**
    - `lobehub-plugin/README.md` — install instructions, config options, troubleshooting, link to the manifest URL for "one-click" install in LobeChat.
    - `LICENSE` file (MIT or Apache-2 — match what the rest of the repo uses).
7. **Icons / screenshots.**
    - `lobehub-plugin/assets/icon-256.png` (transparent square, 256×256) — if asset missing, generate a placeholder SVG + note in report that a designed icon needs replacing before launch.
    - `lobehub-plugin/assets/screenshots/` with at least one screenshot referenced by the README.

## Allowed new deps

`lobehub-plugin/package.json` may add:

- `@lobehub/chat-plugin-sdk` (or the current official plugin SDK name — verify on npm at build time).
- `zod` if you use it for config validation — optional.
- Nothing else.

The main app bundle (`package.json` at repo root) must not grow. Plugin deps are scoped to the plugin package.

## Bridge alignment

When prompt 01's `EmbedActionBridge` is live, it handles incoming requests with these ops:

- `ping` → responds `pong`.
- `speak`, `gesture`, `emote`, `look` → emits on `AgentProtocol`.
- `setAgent` → swap agent id.
- `subscribe` → start echoing agent events back to parent.

Your `bridge.ts` sends requests matching this exact envelope and op set. If you find any mismatch, **do not edit prompt 01's files** — document the mismatch in your report and follow the canonical spec in `01-embed-bridges.md`. The plugin is the client of the bridge; the bridge is the contract.

## Deliverables checklist

- [ ] Manifest schema-validated and reachable at `/.well-known/lobehub-plugin.json`.
- [ ] Iframe host at `/lobehub/iframe/` renders correctly in isolation.
- [ ] React plugin package builds with zero warnings, zero TODO comments, zero placeholder event names.
- [ ] `npm --prefix lobehub-plugin run build` succeeds.
- [ ] `npm --prefix lobehub-plugin run type-check` passes.
- [ ] Dev harness verifies the end-to-end loop without running LobeChat.
- [ ] README describes install steps a real LobeHub user would follow.
- [ ] Icon + screenshot assets present (placeholders acceptable with a flagged TODO).
- [ ] Bridge protocol matches prompt 01 spec exactly.
- [ ] No changes to main `package.json` or main `src/`.
- [ ] Prettier pass on all touched files (LobeHub plugin may follow its own TS formatter — keep it consistent with existing files in the package).

## Acceptance

- `cd lobehub-plugin && npm install && npm run build && npm run type-check` all pass.
- Manifest validates: if a validator is available locally, run it; otherwise use <https://www.jsonschemavalidator.net/> with the `$schema` URL.
- Manual dev harness: open `lobehub-plugin/dev/index.html` via `python3 -m http.server` (or equivalent). Click the "inject assistant message" button. The avatar in the iframe visibly speaks.
- `git grep -n "TODO" lobehub-plugin/src/` returns zero hits.
- `git grep -n "placeholder" lobehub-plugin/src/` returns zero hits (or every hit has an accompanying explanation in the README).

## Report + archive

Post the report block from `00-README.md`. Include:

- Exact LobeHub SDK package name + version you targeted.
- Whether the SDK exposes a real `onAssistantMessage` hook (and what you used if it doesn't).
- Build output bytes (`dist/bundle.js` size).

Then:

```bash
git mv prompts/final-integration/05-lobehub-real-integration.md prompts/archive/final-integration/05-lobehub-real-integration.md
```

Commit: `feat(lobehub): ship real plugin — manifest, bridge, dev harness`.
