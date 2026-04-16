# LobeHub-embed audit — findings against the current codebase

Read this before dispatching any of the 01–08 tasks. Everything below is a factual delta between the tasks as written and what actually exists in the repo today (and in the broader workflow). Nothing here fixes the tasks — it tells the doing-agent what to correct inline.

Commit reference at audit time: `main` HEAD.

## Summary

The 8 existing tasks are well-structured but carry six categories of drift: **stale repo path**, **missing "which fork" config**, **broken internal numbering**, **uneven ordering** (06/07/08 depend on each other and aren't obvious), **a missing fast-path** (now added — [00-fork-sidebar-fastpath.md](./00-fork-sidebar-fastpath.md)), and **deferred `lobehub-spec` unknowns** that should be resolved before the stack runs. Tasks 01–05 are internally consistent; 06–08 are a second sub-stack that should be marked as such.

## Findings

### 1. Stale repo path (01–05)

Tasks 01–05 state `Repo: /workspaces/3D`. That path was from a GitHub Codespaces config that's no longer canonical — the working path on local dev machines and this harness is `/home/user/3D-Agent` or wherever the clone lives.

**Impact:** low. Any agent will clone to its own path and ignore this. But it's a trust signal — if one fact is stale, others might be too.

**Fix (for the doing-agent):** ignore `/workspaces/3D`; use the actual working directory. Do not "correct" the prompts as part of an implementation task — that's a docs-only PR.

### 2. "The user's LobeHub fork" is undefined

Every task references "the user's LobeHub fork" (01, 02, 03, 04, 05) but never points at it: repo URL, branch, version pin, whether it's on disk.

**Impact:** high. Tasks 02, 04, 07, 08 require the fork to test against. Without it, they fall back to a mock.

**Fix:** before starting any of 01–08, capture these three facts in the PR description:

```
LobeHub fork:    <url>
Branch:          <branch>
Checked out at:  <local path>
LobeHub version: <pnpm ls lobe-chat or package.json version>
```

If the fork is unavailable, note explicitly that the `mock-host.html` fallback from task 05 is being used — and flag that smoke results are therefore partial.

### 3. Task numbering collision (06, 07, 08)

Files in the folder are `06-host-sdk-package.md`, `07-message-renderer.md`, `08-mention-autocomplete.md`. Their in-file headers say `Task 01`, `Task 03`, `Task 04` respectively. They were clearly authored as a separate 01–04 series ("host SDK sub-stack") and copied in without renumbering.

Evidence:
- [06-host-sdk-package.md:1](./06-host-sdk-package.md) → `# Task 01 — @3dagent/embed host SDK package`
- [07-message-renderer.md:1](./07-message-renderer.md) → `# Task 03 — In-chat message renderer`
- [08-mention-autocomplete.md:1](./08-mention-autocomplete.md) → `# Task 04 — @ autocomplete for agents`

**Impact:** medium. An agent dispatched "task 01" may open the wrong file. "Depends on task 03" inside 08 means "depends on 07."

**Fix:** rename internal headers to match filenames, OR re-scope the two sub-stacks explicitly. See **finding 5** below for the recommended resolution.

### 4. Task 07 references a non-existent task ("from task 01")

[07-message-renderer.md](./07-message-renderer.md) says `Depends on: Task 01 (SDK) shipped or pinned via git URL.` But task 01 in this folder is `01-plugin-manifest.md`, not an SDK task.

The intended dependency is **task 06** (`@3dagent/embed` SDK package, labeled "Task 01" inside its own file).

**Impact:** medium. Confusing. An agent reading 07 will pick up 01 and get misled.

**Fix:** in a docs PR, rewrite the dependency line to `Depends on: 06-host-sdk-package.md (@3dagent/embed SDK)`. Do not fix during an implementation task.

### 5. Two sub-stacks mixed in one folder

Looking at the files end-to-end, there are actually **two separate deliverables** smashed into this folder:

- **Plugin stack (01–05)** — ship a LobeHub marketplace plugin. Iframe-in-chat-bubble. `postMessage` handshake. Marketplace PR.
- **Host SDK + mention stack (06–08)** — ship `@3dagent/embed` npm package, a React renderer for `@mentions` in chat messages, and the `@`-autocomplete. This is adjacent work that lives in the fork, not in the marketplace plugin.

They overlap (both iframe our embed, both use `postMessage`) but they ship to different consumers: the plugin ships to LobeHub's marketplace; the SDK ships to npm + is consumed by the fork itself.

**Impact:** medium. Running 01–05 gives you a plugin. Running 06–08 gives you a fork mod. Running both gives you plugin-plus-fork-mod. The README orders them as a single 01–08 sequence which implies they compose linearly. They don't.

**Fix (recommended):** split into two series. Either:

- (a) Move 06–08 to a new folder `prompts/lobehub-fork-mods/`, or
- (b) Keep the folder but re-letter 06–08 as `A-host-sdk-package.md`, `B-message-renderer.md`, `C-mention-autocomplete.md` so the filename alphabetics signal "separate sub-stack." Keep their existing "Task 01/03/04" internal headers after renaming the file series.

Option (a) is cleaner. Blocked on user preference — flag in the reporting block.

### 6. Unresolved `TODO(lobehub-spec)` flags

Tasks 01, 02, 03, 05 are peppered with `TODO(lobehub-spec): confirm against https://lobehub.com/docs/usage/plugins/development` for plugin format, user-context envelope, submission format, etc.

**Impact:** high. Whole tasks can't complete without these resolved. Running task 01 without confirmed plugin format produces a manifest that may fail to load in LobeHub.

**Fix:** add a new **task 00a — resolve LobeHub spec unknowns** before the 01–05 sequence runs. Its deliverable is a single markdown answer sheet (committed to this folder as `SPEC-NOTES.md`) enumerating every `TODO(lobehub-spec)` flag and its resolution, sourced from the live docs. Each doing-agent for 01–05 reads `SPEC-NOTES.md` first.

This task is **not** created in this audit — it's on the user's todo list to dispatch before plugin work starts. Consider it a blocking dependency for 01.

### 7. Task 02 assumes an old embed.html structure

[02-iframe-handshake.md](./02-iframe-handshake.md) says the embed.html "already... listens for `{ __agent, type: 'action', action }` messages and relays them to agent-protocol." Verified via reading [public/agent/embed.html](../../public/agent/embed.html) — **true**. Structure matches.

**Impact:** none. No action.

### 8. Task 06 references `vite.lib.config.js` which doesn't exist

[06-host-sdk-package.md:19](./06-host-sdk-package.md) says `vite.lib.config.js if it exists, or whatever npm run build:lib uses`. The actual config is a single `vite.config.js` that switches via `TARGET=lib` env var. See [vite.config.js:118-134](../../vite.config.js).

**Impact:** low. The task includes the "or whatever" escape hatch, so an agent will find the right file.

**Fix:** update the line to reference `vite.config.js`'s `libConfig` branch directly. Docs-only.

### 9. No fast-path for "just put an avatar in my fork's sidebar"

The most natural user ask — "I have a fork, I want an avatar in the sidebar, right now" — has no task that ships that by itself. Each of 01–08 is part of a larger plan.

**Impact:** high. This is the demo that sells the feature.

**Fix:** [00-fork-sidebar-fastpath.md](./00-fork-sidebar-fastpath.md) now exists, created alongside this audit. Dispatch that FIRST; then decide whether to continue into 01–05 (plugin) or 06–08 (mentions) or both.

### 10. Empathy Layer discipline is correctly enforced

Every task that touches the embed restates the rule "do not flatten the Empathy Layer" — 02, 03, 04, 05. That rule is the product's actual moat and the prompts correctly protect it. **Keep doing this.**

**Impact:** positive. No action needed beyond reinforcement.

### 11. `prompts/claude-lobehub/` is empty except for a README

Sibling folder has only `00-README.md` and no task files. That's fine if the claude-artifact path is being handled elsewhere, but worth noting so an agent looking for a full claude-lobehub stack doesn't think they're missing files.

**Impact:** none. No action here.

## Recommended dispatch order after this audit

```
00-fork-sidebar-fastpath.md   ← ships the sidebar demo TODAY
                                (lives in fork; no marketplace plumbing)

    --- (decide: ship as plugin too?) ---

00a-spec-notes.md             ← new task: resolve TODO(lobehub-spec) flags
                                (you dispatch this; audit doesn't author it)
01-plugin-manifest.md         ← marketplace plugin begins here
02-iframe-handshake.md
03-host-auth-handoff.md
04-action-passthrough.md
05-plugin-submission.md

    --- (parallel: ship the host SDK + @mention UX) ---

06-host-sdk-package.md        ← @3dagent/embed npm package
07-message-renderer.md        ← inline agent mentions in chat messages
08-mention-autocomplete.md    ← @ trigger menu
```

## What an agent doing any 01–08 task should verify first

1. LobeHub fork is accessible and checked out — capture url/branch/version.
2. `SPEC-NOTES.md` exists or all `TODO(lobehub-spec)` flags in the task are acceptable-to-leave as-is (ask if unsure).
3. The sibling task's "Files off-limits" list.
4. The repo-path mismatch (`/workspaces/3D` → actual) is ignored, not corrected inline.
5. If your task sits in the 06–08 sub-stack, read [06-host-sdk-package.md](./06-host-sdk-package.md) even if you're doing 07 or 08 — they share an SDK surface.

## What's NOT in scope for this audit

- Rewriting any of the 01–08 tasks to fix these findings. Each fix is its own trivial docs PR.
- Sourcing LobeHub's plugin spec from the live docs — that's the `SPEC-NOTES.md` task.
- Creating the missing `SPEC-NOTES.md` task. Flagged as a blocker for the user to dispatch.

---

Last reviewed against repo HEAD at the time of authoring. Re-audit recommended after any of 01–08 ships or after the LobeHub fork version changes materially.
