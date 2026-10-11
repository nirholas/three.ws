# partners 04: LiveKit avatar plugin and Pipecat avatar service

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

LiveKit Agents (14,665 stars, `livekit-client` 4.36M weekly downloads) lists 16 avatar providers on its avatar docs page, and every one is a 2D video face. three.ws already runs LiveKit voice ([`src/runtime/livekit-voice.js`](../../src/runtime/livekit-voice.js)). The tracker row for this plugin was parked on a design question: does a plugin need a server render lane? It does not. livekit/agents merged a plugin (PR #5821, 2026-07-20) that renders on the visitor's device and sends only motion data over LiveKit, which is how three.ws already works. Pipecat (16,309 stars) documents a community-integration route step by step and shares most of the work. LiveKit's new Startups program (up to USD 23,000) is the commercial door this opens.

## Step 0: re-derive the current state

    sed -n 1,60p src/runtime/livekit-voice.js
    sed -n 1,40p api/agents/_id/livekit-token.js
    gh pr view 5821 -R livekit/agents --json title,files,mergedAt
    gh api repos/livekit/agents/contents/CONTRIBUTING.md --jq .content | base64 -d | head -80
    gh api repos/pipecat-ai/pipecat/contents/COMMUNITY_INTEGRATIONS.md --jq .content | base64 -d | head -120

Read the merged plugin's layout to learn the expected package structure and the motion-data transport, as reference only (build our own; copy no code).

## Tasks

1. **The LiveKit plugin.** A Python package `livekit-plugins-threews` in `integrations/livekit/` laid out the way livekit/agents expects (`livekit-plugins/livekit-plugins-<name>`), with an `AvatarSession` that joins the room beside the agent and publishes viseme and gesture data derived from the agent's TTS audio. It passes their lint (ruff) and docs (pdoc) requirements.
2. **The client.** `<agent-3d>` gains a LiveKit mode: it joins with a token, subscribes to the plugin's motion data, and drives lip sync and gestures on the visitor's device. Reuse the existing viseme path.
3. **The Pipecat service.** `integrations/pipecat/` with a Pipecat frame processor that does the same for a Pipecat pipeline, plus everything COMMUNITY_INTEGRATIONS.md asks for: example, README, and the docs pull request text.
4. **A runnable example for each**, verified end to end against a local open-source `livekit-server` (no cloud credentials needed). Record the 30 to 60 second demo video Pipecat asks for from a real run.
5. **Submission text** in `marketing/growth/submissions/livekit-avatar-plugin.md` and `marketing/growth/submissions/pipecat-integration.md`, ready for owner order 938. Update the tracker row for the LiveKit plugin from `design_decision_required` to its new status.
6. **Docs.** README in each new directory, a doc page linked from [docs/start-here.md](../../docs/start-here.md), `STRUCTURE.md` row, changelog entry.

## Definition of done

- [ ] A voice agent in a local LiveKit room speaks and a browser `<agent-3d>` lip-syncs to it (screen recording or screenshots in the report).
- [ ] The Pipecat example runs end to end the same way, and the demo video exists.
- [ ] Both packages pass their upstream lint and docs checks locally.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] Submission files, READMEs, docs, `STRUCTURE.md` and changelog landed.

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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/087-partners-04-livekit-pipecat-avatar.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
