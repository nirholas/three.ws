# partners 07: A video-to-motion landing for creators whose mocap service closed

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/partners-00-CONTEXT.md](_context/partners-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: irreversible spend, git push or deploy, external posting, committing content that names a crypto project other than $THREE, destroying unrecoverable data. Batch every such ask into ONE message at the end.
- Never contact a third party: no email, issue, pull request, form, listing or post. Write the exact text into the repo and put the step in the owner message (context file rules).
- Never onboard a paid API or spend. Wire paid vendors behind their env var and prove the code against the real API with whatever free or sandbox access exists.
- Verify each upstream license from its LICENSE file before adopting anything.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. The em-dash and en-dash characters are banned.
- Concurrent agents share this worktree: stage explicit paths only and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Several online markerless motion-capture services have closed or stopped taking new captures in 2026 (the [prospects list](../../docs/partners/prospects.md) records which, with dates). Their users still have videos to turn into animation and nowhere to do it. three.ws already runs the pipeline: [`workers/model-video2motion`](../../workers/model-video2motion/) turns a video of a person into a retargetable clip on the canonical skeleton, and it powers /motion-swap. What is missing is a page that speaks to a creator who wants the animation file itself (FBX, BVH, GLB) rather than a composited video.

## Step 0: re-derive the current state

    sed -n 1,80p workers/model-video2motion/README.md
    grep -n '"path": "/motion-swap\|"path": "/mocap-studio\|"path": "/animations' data/pages.json
    ls src | grep -i -E "motion|mocap|bvh|fbx"
    grep -rn "BVHLoader\|FBXExporter\|bvh" src --include=*.js | head

Run one real video through the production worker (use a short clip of yourself or a CC0 video) and time it, so the page's copy quotes a measured duration. Check which export formats the client can already write.

## Tasks

1. **The landing page.** A new route (for example `/video-to-motion`) aimed at animators and VTubers: upload a video, preview the motion on a default avatar or the user's own, trim, and download. Every state is designed: idle, uploading, processing with the worker's real progress, result, failure with a retry path, and a limit reached state.
2. **Exports.** GLB with the clip, BVH, and FBX if a maintained open-source exporter supports it (check before writing one; if none qualifies, ship GLB and BVH and say why). Retarget onto any rig the user uploads through `src/animation-retarget.js`.
3. **Save to the library.** A signed-in user can save the clip to their own animations and apply it to their agents.
4. **Copy.** Neutral: "turn any video into an animation file", with no names of closed services. Whether to name them in outreach is the owner's decision, recorded in the owner message.
5. **Wire it in**: links from /motion-swap, /animations and /mocap-studio; `data/pages.json`; `STRUCTURE.md`; a doc page; changelog entry.

## Definition of done

- [ ] A real video becomes a downloadable GLB and BVH that load in Blender (screenshot of the import) or the three.js editor.
- [ ] The clip retargets onto an uploaded non-Mixamo rig in the browser.
- [ ] All states render at 320, 768 and 1440 pixels with no console errors.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] Page entry, `STRUCTURE.md`, doc and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/090-partners-07-video-to-motion-landing.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
