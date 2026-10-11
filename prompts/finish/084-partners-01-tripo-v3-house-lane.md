# partners 01: Tripo v3 house lane, webhooks, and the endpoints we do not use yet

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

Tripo reached out on 2026-10-09. Its v3.1 model is a Forge lane today, but only for users who paste their own key, over the legacy v2 endpoint, so it ran 2 jobs in the 30 days before the brief while the open-weight TripoSG worker ran 197. The brief ([docs/partners/tripo.md](../../docs/partners/tripo.md)) offers Tripo a v3 migration, webhooks, and five endpoints we do not use yet, and asks for a partner key. This order builds all of it so that the deal, when it lands, is switched on by one env var: `TRIPO_API_KEY`. Nothing here waits on the deal, and everything is kept whichever way it goes.

## Step 0: re-derive the current state

    sed -n 1,90p api/_providers/tripo.js
    grep -n -A20 "tripo: Object.freeze" api/_lib/forge-tiers.js
    node scripts/read-service-env.mjs '^TRIPO' --names
    ls api/print/webhook/ && sed -n 1,40p "api/print/webhook/[provider].js"

Read the v2-to-v3 migration guide and the webhook, rig, retarget, low-poly, splat and segmentation pages at developers.tripo3d.ai, and record the endpoint, request and webhook signature scheme for each. Query `forge_creations` (DATABASE_URL in `.env.local`) for Tripo-family jobs by `backend` over the last 30 days, so the final report can show before and after.

## Tasks

1. **v3 client.** Move [`api/_providers/tripo.js`](../../api/_providers/tripo.js) to the v3 API per Tripo's migration guide, keeping the provider interface every caller uses and the `TRIPO_MODEL_VERSION` override. Unit tests pin the v3 request shapes.
2. **Signed webhooks.** Add a Tripo webhook receiver that verifies Tripo's signature, is idempotent on delivery id, and completes the job the same way polling does. Polling stays as the fallback when no webhook arrives in time. Follow the receiver pattern in `api/print/webhook/[provider].js`.
3. **House key.** When `TRIPO_API_KEY` is set on the service, Tripo becomes a house lane: a default engine on the High tier and an explicit "Tripo" choice in the engine picker, billed through our credits like the other house lanes. A user's own key still takes precedence when supplied. With the variable unset, behavior is byte-for-byte what it is today; prove that with a test.
4. **The endpoints we do not use yet**, each available only when a key (house or user) is present and each with its own UI state:
   - auto-rig and retarget on the avatar path, with output that passes `src/glb-canonicalize.js` and plays the canonical clips;
   - the low-poly (P-series) and quad options as a "game-ready" Forge preset;
   - image-to-splat on the splat stage ([docs/splat.md](../../docs/splat.md));
   - Smart Segmentation feeding the parts editor (coordinate with best3d order 070 if it is still open: one parts surface, not two).
5. **Attribution.** The engine picker, the result card and exported file metadata name Tripo and the model version.
6. **Reporting for the pilot.** A query script under `scripts/` that prints Tripo-lane jobs, completion rate and median latency by day from `forge_creations`, so the pilot report in the brief is one command.
7. **Docs.** The Tripo lane in [docs/forge.md](../../docs/forge.md); change the "Engineering, ready to run" section of [docs/partners/tripo.md](../../docs/partners/tripo.md) to say what shipped; a `data/changelog.json` entry for the user-visible parts (BYOK users get v3 and the new endpoints immediately), then `npm run build:pages`.

## Definition of done

- [ ] With a Tripo key available (a user key in a real BYOK session counts), a text job and an image job complete on v3, and a webhook delivery completes a job.
- [ ] With `TRIPO_API_KEY` unset, the engine list and job routing are unchanged (test output).
- [ ] Auto-rig output loads in the viewer and plays a canonical clip; the game-ready preset, splat and segmentation each produce a real artifact or show their designed unavailable state.
- [ ] `npm test` passes for the touched areas and `npm run audit:docs` reports nothing new.
- [ ] Docs and changelog entry landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| No Tripo key anywhere | Prove every request shape against the live v3 API's documented auth error, ship the code, and list `TRIPO_API_KEY` in the owner message. Approving a platform key is order 936. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/084-partners-01-tripo-v3-house-lane.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
