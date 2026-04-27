# Final Integration — Close the 28% Gap to 100%

This folder contains **7 parallel-safe prompts** that finish the three.ws platform: they build the 3 sprint-100 modules that were never created, wire the 4 orphan modules that shipped without integration, and close out the LobeHub plugin integration, camera-capture decision, and end-to-end smoke test.

The audit that produced these prompts found that ~72% of the stated work is wired and functional. Files exist for most sprint-100 deliverables but many are orphans — real code, zero import sites. Three files mapped in the sprint-100 plan were never written at all.

## Running rules

1. **Run in any order.** Every prompt below owns a **disjoint** set of files. Shared-file edits use uniquely-named anchor comments so two agents will not collide.
2. **One agent, one prompt.** Open a new chat, paste the `.md` contents as the first message.
3. **Self-archive when done.** The last step of every prompt is `git mv prompts/final-integration/<this-file>.md prompts/archive/final-integration/<this-file>.md`. Run it yourself — the wrapper will not do it for you.
4. **Own only the files listed.** Read anything; write nothing outside the owned set. If a piece you need does not exist, stub it and note the stub — do not reach into someone else's files.
5. **Prettier** before committing: tabs, 4-wide, single quotes, 100-col. `npx prettier --write` every file you touched.
6. **Verify** with `node --check <file>` on every JS file and `npm run build`. Paste both outputs into your report.
7. **No new runtime deps** unless the prompt explicitly lists them. Bundle size matters.
8. **ESM only** in `src/` and `api/`. No CommonJS. No TypeScript in the main app (SDK & lobehub-plugin are allowed TS — they are separate packages).
9. **JSDoc for public APIs.** No long docstrings or multi-paragraph comments. Follow the conventions in `CLAUDE.md`.
10. **Do not** amend the contract ABI, deployed addresses, or `REGISTRY_DEPLOYMENTS`. Read-only unless the prompt says otherwise.

## File-ownership map (no overlaps)

| #   | Prompt                            | Primary new files                                                                           | Shared-file anchors                                                                   |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 01  | `01-embed-bridges.md`             | `src/embed-host-bridge.js`, `src/embed-action-bridge.js`                                    | `src/element.js` — anchor `EMBED_BRIDGES`                                             |
| 02  | `02-idle-animation.md`            | `src/idle-animation.js`                                                                     | `src/agent-avatar.js` — anchor `IDLE_LOOP`                                            |
| 03  | `03-agent-home-integration.md`    | (none)                                                                                      | `agent-home.html` — anchor `AGENT_HOME_ORPHANS`                                       |
| 04  | `04-discover-page.md`             | `public/discover/index.html`, `public/discover/discover.js`, `public/discover/discover.css` | homepage CTA added via anchor `DISCOVER_LINK` in `index.html`                         |
| 05  | `05-lobehub-real-integration.md`  | everything under `lobehub-plugin/`                                                          | —                                                                                     |
| 06  | `06-camera-capture-resolution.md` | —                                                                                           | `src/camera-capture.js` (delete or repurpose) + `src/camera-capture.css`              |
| 07  | `07-qa-smoke-test.md`             | `docs/SMOKE_TEST.md`                                                                        | — (read-only audit; may open small surgical fixes in any file with 1-line patch rule) |

## Shared-file anchor protocol

When a prompt edits a shared file (`src/element.js`, `src/agent-avatar.js`, `agent-home.html`, `index.html`), it must:

1. Find the anchor comment named in the map above, e.g. `<!-- BEGIN:AGENT_HOME_ORPHANS --> ... <!-- END:AGENT_HOME_ORPHANS -->`.
2. If the anchor block does not yet exist, **create it** at the location the prompt describes, with both `BEGIN` and `END` comment markers.
3. Only insert new code **between** those markers. Never edit code outside them.
4. If your anchor name already contains content from a previous run, treat it as the latest version and either extend or replace — use `git diff` to understand context before overwriting.

This guarantees parallel runs never stomp each other even if two agents touch the same file.

## What counts as "done"

A prompt is complete when:

- Every file listed under **Deliverables** exists and passes `node --check`.
- `npm run build` succeeds with zero new warnings.
- The **Acceptance** checklist passes.
- The **Report** block is posted in the chat (files changed, commands run + output, what was skipped, unrelated bugs noticed).
- The prompt file has been `git mv`d into `prompts/archive/final-integration/`.

If you cannot complete everything, commit what works, archive anyway with a **Partially Complete** banner at the top of the archived file describing exactly what was left undone. Do NOT leave the prompt in `final-integration/` — a prompt in that folder means "not attempted yet." Partial work belongs in archive with notes.

## Reporting template

Every prompt ends with this block in the agent's final message:

```
## Report
**Files changed:** <list>
**Commands run:** <list with output snippets>
**Skipped / stubbed:** <list with reason>
**Unrelated bugs noticed:** <list, do NOT fix them here>
**Archive command run:** git mv prompts/final-integration/XX-foo.md prompts/archive/final-integration/XX-foo.md  — ✅/❌
```

## After all 7 are archived

Overall completion target: **≥95%**. Remaining 5% is product/design polish beyond the scope of these prompts and should be re-scoped by a human PM pass.
