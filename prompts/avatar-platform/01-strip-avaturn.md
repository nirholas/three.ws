# Task: Remove Avaturn dependencies and rename the chat agent

## Context

Repo: `/workspaces/3D`. Two Avaturn packages are in [package.json:45-46](../../package.json#L45-L46):

- `@avaturn/sdk` — used by [src/avatar-creator.js:1](../../src/avatar-creator.js#L1) to embed Avaturn's hosted editor iframe (`preview.avaturn.dev/editor`).
- `@avaturn-live/web-sdk` — declared but **not imported anywhere** in `src/`. Dead weight; it's their realtime talking-head streaming product and not useful here.

[src/avaturn-agent.js](../../src/avaturn-agent.js) defines a class called `AvaturnAgent` but is 100% our own code — a plain chat/voice panel with no Avaturn integration. The name, CSS prefix (`avaturn-*`), and file path all falsely suggest vendor affiliation.

We are replacing Avaturn with an owned, self-hosted stack (see this directory's [README.md](./README.md)). This task yanks the deps and strips the misleading branding so downstream tasks have a clean slate.

## Goal

After this task:

1. Neither `@avaturn/sdk` nor `@avaturn-live/web-sdk` appear in `package.json` or the lockfile.
2. [src/avatar-creator.js](../../src/avatar-creator.js) is **deleted** (replacement comes in tasks 03, 16, 17).
3. [src/avaturn-agent.js](../../src/avaturn-agent.js) is renamed to `src/agent-panel.js`, class renamed to `AgentPanel`, CSS prefix changed from `avaturn-` to `agent-`. Behavior unchanged.
4. Any imports/callers updated.
5. CSS selectors updated in [style.css](../../style.css) (search for `.avaturn-`).
6. The app boots and the chat panel works exactly as before — just with new names.

## Deliverable

1. **Package surgery** — `npm uninstall @avaturn/sdk @avaturn-live/web-sdk`. Confirm [package.json](../../package.json) and lockfile diff is exactly the two removals.
2. **Delete** [src/avatar-creator.js](../../src/avatar-creator.js). Search for any imports (`import .* from .*avatar-creator`) and remove them — update callers to no-op the creator-open path with a `console.warn('[creator] not yet wired — see avatar-platform task 03+')`. Don't leave dead buttons; comment them out with a TODO pointing at task 16.
3. **Rename** [src/avaturn-agent.js](../../src/avaturn-agent.js) → `src/agent-panel.js`. Inside:
   - Class `AvaturnAgent` → `AgentPanel`.
   - All CSS classes `avaturn-*` → `agent-*` (keep the suffix: `avaturn-panel` → `agent-panel`, `avaturn-mic` → `agent-mic`, etc.).
   - The header title `SperaxOS` stays (it's a valid brand label).
4. **Update [src/app.js](../../src/app.js)** — import path and class name. No behavioral changes.
5. **Update [style.css](../../style.css)** — replace every `.avaturn-*` selector with `.agent-*`. Verify none are missed.
6. **Update [src/avaturn-agent.js](../../src/avaturn-agent.js) callers** if any exist outside app.js (there shouldn't be).

## Audit checklist

- [ ] `grep -r "avaturn" src/` returns **zero** matches (case-insensitive).
- [ ] `grep -r "avaturn" package.json package-lock.json` returns zero matches.
- [ ] `grep -r "AvaturnAgent\|AvaturnSDK" .` returns zero matches outside `node_modules/` and this prompts folder.
- [ ] `.avaturn-` does not appear in [style.css](../../style.css).
- [ ] The toggle button opens the chat panel, messages send, mic works — same as before.
- [ ] `npx vite build` completes with no new errors.
- [ ] `node --check src/agent-panel.js` parses.

## Constraints

- Do **not** implement the new creator, editor, or VRM loading in this task. Those are tasks 02, 03, 16.
- Do **not** change chat/voice behavior. This is a pure rename + deletion pass.
- Do **not** touch [src/viewer.js](../../src/viewer.js) or any rendering code.
- Keep git history clean: one commit for the npm uninstall + deletion, one for the rename. Or a single coherent commit if you prefer — document the choice in reporting.

## Verification

1. `npm uninstall @avaturn/sdk @avaturn-live/web-sdk` — watch the lockfile diff.
2. `npx vite build` passes.
3. `npm run dev`, open the app:
   - Agent panel toggle works.
   - Typing + pressing Enter echoes a reply.
   - Mic button still toggles active state.
4. Open DevTools, inspect panel DOM — classes are all `agent-*`, no `avaturn-*`.
5. Drag-drop a `.glb` into the viewer — it still loads (confirms nothing accidental in viewer path).

## Scope boundaries — do NOT do these

- Do not start vendoring CharacterStudio, three-vrm, TalkingHead, or any of the replacement stack. That's tasks 02+.
- Do not remove the agent panel's response logic. The rule-based replies stay until task 14.
- Do not rename `SperaxOS` in the header string; that's brand copy, not vendor label.
- Do not touch the `src/` files listed under `features/` — the pretext experiments are independent.

## Reporting

- Confirm the exact lines removed from package.json and any transitive deps that fell out of the lockfile.
- List every file touched by the rename, with old → new identifier mapping.
- Any usages of `@avaturn-live/web-sdk` you found that the initial grep missed.
- Screenshot-or-describe the chat panel before/after to confirm visual parity.
