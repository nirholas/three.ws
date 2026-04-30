# Task: Resolve LobeHub integration spec unknowns before running integration tasks

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

The `prompts/lobehub-embed/` directory contains 8 tasks (00–08) for integrating three.ws agents into LobeHub (a popular open-source chat UI). Before any of those tasks can be run, several spec unknowns need to be resolved.

**Read `prompts/lobehub-embed/AUDIT.md` in full** — it documents all 6 categories of drift between the tasks as written and the current codebase. This task is to fix those spec issues.

The key unknowns from the audit:

1. **"The user's LobeHub fork" is undefined** — every task references it but never says what it is. We need to establish: repo URL, branch, version pin, local path.

2. **Task numbering collision in 06/07/08** — internal headers say "Task 01", "Task 03", "Task 04" but filenames are 06, 07, 08. Needs renumbering or explicit sub-stack labeling.

3. **6 `TODO(lobehub-spec)` comments** — in tasks 01–05, there are inline comments like `TODO(lobehub-spec): confirm the plugin manifest URL format` that were left for resolution. These need concrete answers before implementation.

4. **Stale repo path** — tasks say `/workspaces/3D` but the actual path is `/workspaces/3D-Agent`. Low impact (agents use their own working path) but should be corrected in the audit notes.

5. **Missing fast-path task** — `00-fork-sidebar-fastpath.md` was added to address the lack of a sidebar shortcut, but it hasn't been integrated into the README ordering.

6. **Uneven sub-stack ordering** — Tasks 06/07/08 are a "host SDK sub-stack" that depends on tasks 01–05 being complete first, but this is not documented.

---

## What to do

### Step 1: Establish the LobeHub fork

Check if there's a LobeHub fork linked anywhere in the project:
- `package.json` / `chat/package.json` — any `lobe-chat` dep or fork URL?
- `.gitmodules` — any LobeHub submodule?
- `prompts/lobehub-embed/README.md` — any fork URL mentioned?
- Git remote: `git remote -v` — any LobeHub remote?

If no fork is found, document the fact clearly in `prompts/lobehub-embed/FORK.md`:
```md
# LobeHub Fork

Status: NOT YET SET UP

Before running any lobehub-embed tasks, complete these steps:

1. Fork https://github.com/lobehub/lobe-chat
2. Note the fork URL here
3. Clone locally: `git clone <fork-url> ../lobe-chat-fork`
4. Note the local path here
5. Note the LobeHub version (check package.json in the fork): vX.Y.Z

Once done, fill in:
- Fork URL: 
- Local path: 
- Branch: 
- LobeHub version: 
```

### Step 2: Resolve the 6 TODO(lobehub-spec) comments

Read tasks 01–05 and find every `TODO(lobehub-spec):` comment. For each one, research the answer:

- Check LobeHub's plugin documentation: https://lobehub.com/docs/usage/plugins/development
- Check LobeHub's GitHub: https://github.com/lobehub/lobe-chat (plugin system, manifest format, iframe handshake protocol)
- Look at existing LobeHub plugins for reference implementations

For each resolved TODO, update the task file in-place — replace the `TODO(lobehub-spec):` comment with the actual answer.

Expected TODOs to resolve (verify by reading the files):
- Plugin manifest URL format and schema
- The iframe `postMessage` handshake protocol (what messages, in what order, with what payloads)
- The plugin auth handoff mechanism (how LobeHub passes user auth to the plugin iframe)
- The plugin message renderer format (how custom message types appear in the chat timeline)
- Any LobeHub version pinning requirements

### Step 3: Fix task numbering in 06/07/08

Update internal headers in:
- `prompts/lobehub-embed/06-host-sdk-package.md` — change `# Task 01` to `# Task 06 — @3dagent/embed host SDK package`
- `prompts/lobehub-embed/07-message-renderer.md` — change `# Task 03` to `# Task 07 — In-chat message renderer`
- `prompts/lobehub-embed/08-mention-autocomplete.md` — change `# Task 04` to `# Task 08 — @ autocomplete for agents`

Also update internal "Depends on task 03" references in 08 to "Depends on task 07."

### Step 4: Update the README

Update `prompts/lobehub-embed/README.md` to:
- Add task 00 to the ordered list
- Mark tasks 06/07/08 as "Host SDK sub-stack" with a note they depend on 01–05
- Add a "Prerequisites" section pointing to `FORK.md`

---

## Files to create/edit

**Create:**
- `prompts/lobehub-embed/FORK.md` — fork setup instructions + status

**Edit:**
- `prompts/lobehub-embed/01-plugin-manifest.md` — resolve TODO(lobehub-spec) comments
- `prompts/lobehub-embed/02-iframe-handshake.md` — resolve TODO(lobehub-spec) comments
- `prompts/lobehub-embed/03-host-auth-handoff.md` — resolve TODO(lobehub-spec) comments
- `prompts/lobehub-embed/04-action-passthrough.md` — resolve TODO(lobehub-spec) comments
- `prompts/lobehub-embed/05-plugin-submission.md` — resolve TODO(lobehub-spec) comments
- `prompts/lobehub-embed/06-host-sdk-package.md` — fix internal header
- `prompts/lobehub-embed/07-message-renderer.md` — fix internal header
- `prompts/lobehub-embed/08-mention-autocomplete.md` — fix internal header + dependency ref
- `prompts/lobehub-embed/README.md` — add task 00, sub-stack labels, prerequisites

**Do not touch:**
- `prompts/lobehub-embed/00-fork-sidebar-fastpath.md` — already correct
- Any implementation code

---

## Acceptance criteria

1. Every `TODO(lobehub-spec):` comment in tasks 01–05 is replaced with a concrete answer or marked `UNRESOLVABLE: <reason>` if the answer genuinely cannot be determined without the fork.
2. Tasks 06, 07, 08 have correct internal header numbers matching their filenames.
3. `prompts/lobehub-embed/FORK.md` exists and gives clear setup instructions.
4. `prompts/lobehub-embed/README.md` includes task 00 and marks the 06/07/08 sub-stack.
5. Running any lobehub-embed task after this should not hit a `TODO(lobehub-spec)` blocker.

## Research resources

- LobeHub plugin development docs: https://lobehub.com/docs/usage/plugins/development
- LobeHub plugin schema: https://github.com/lobehub/lobe-chat-plugins
- LobeHub source (plugin system): https://github.com/lobehub/lobe-chat/tree/main/src/services/plugin
- Existing community plugins: https://github.com/lobehub/lobe-chat-plugins/tree/main/plugins

## Constraints

- Do not start implementing any lobehub-embed feature. This task is research + documentation only.
- If a TODO requires testing against the actual LobeHub fork and the fork isn't set up, mark it `BLOCKED: requires fork setup` rather than guessing.
- Keep task file edits surgical — only replace the TODO comment and immediately surrounding context, don't rewrite the tasks.
