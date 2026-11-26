# nvidia 28: An avatar says the same line in every language our NVIDIA voice supports, with the face animated from each language's own audio

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3278 (`npm run dev -- --port 3278 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, the Inception portal edit, any forum or social post) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **Measured 2026-11-26:** the NVIDIA speech lane (`magpie_tts`) answered 100% of probes and is working; do not change its request, voice defaults or function id. The hosted Audio2Face lane answered 7 of 55 probes and is not protected, but this order does not reorder face lanes: it uses whatever the avatar stack serves today, including its fallback.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

NVIDIA's blueprint catalog includes a Content Localization blueprint whose point is lip sync that matches translated audio, done on video after the fact. A 3D avatar does not have that problem: the face is animated from the audio itself, so a line spoken in Spanish gets Spanish mouth shapes for free. three.ws already has every part (translation through NVIDIA-hosted models, `magpie-tts-multilingual` speech in `api/_lib/tts-nvidia.js`, facial animation in `api/a2f.js` and `src/voice/a2f-player.js`), but a visitor can only hear an avatar in one language at a time and nothing shows the same line across languages. One avatar, one sentence, a language switcher, correct lips in each: that is a demo NVIDIA's own stack sets up and a real feature for anyone embedding an avatar on a multilingual site.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/version | head -c 320; echo
    curl -s https://three.ws/api/nvidia/stats | head -c 5000; echo
    grep -n "resolveMagpieLanguage" -A30 api/_lib/tts-nvidia.js | head -80
    grep -n "language\|locale" api/a2f.js api/tts*.js src/voice/*.js 2>/dev/null | head -40
    ls public/locales | head -40
    grep -rn -i "clip export\|talking-avatar\|avatar clip" docs/*.md api/*.js 2>/dev/null | head -10

Read `api/_lib/tts-nvidia.js` end to end and list exactly which languages and voices the speech lane supports today, from the code and one live probe per language (a short phrase each; record which answer). Read how the `<agent-3d>` component and the voice stack speak a line and animate the face, and what happens when facial animation is unavailable. Find the translation path the product already uses for text (the LLM chain or a translation helper) and reuse it. If a talking-avatar clip export already exists, note its entry point: task 5 reuses it. If a per-language speak feature already exists, extend it instead of adding a second one.

## Tasks

1. **A speak-in-language API.** One handler that takes a line of text, a source language and a target language, and returns the translated text plus speech in the target language, using the existing translation path and the existing speech lane with a voice that matches the language. Unsupported languages get a clear error naming the supported set, never a silent fall back to English audio. Results are cached by text, language and voice so a repeated line costs nothing. Test-first for the language-to-voice mapping, the unsupported-language error and the cache key.
2. **Face from each language's audio.** The returned speech drives the face through the existing path with no change to lane order. Verify in a browser that the mouth follows the translated audio and not the source text timing.
3. **A language switcher on the avatar.** In the existing avatar speaking surface (and as an attribute and method on the `<agent-3d>` embed), a visitor picks a language and the avatar repeats its last line in it. Loading, error and unsupported states are designed; every control has hover, active and focus states and works by keyboard; the switcher lists only languages the live probe confirmed. Language names are shown in their own script.
4. **Translation quality gate.** Each translation is checked by back-translation with a second model on the existing chain and a similarity threshold stated in code; a failed check retries once and then shows the visitor a plain message instead of speaking a wrong sentence. Unit-tested with real examples, including a name and a number that must survive untranslated.
5. **A demo page** at `/demos/multilingual-avatar` (registered in `data/pages.json`): one avatar, one editable line, a row of language buttons, and a caption with the translated text. If a clip export exists, add "export all languages" that produces one clip per language through it; if not, the page is the deliverable and you say so.
6. **Measure.** For every supported language: time from click to first audio, time to first face frame, and the back-translation score on 20 fixed sentences. Put the table in `docs/multilingual-avatar.md`.
7. **Docs.** That feature doc, the embed attribute in the `<agent-3d>` docs, `docs/api-reference.md`, a `STRUCTURE.md` row for the new page, `docs/nvidia-models.md`, and a `data/changelog.json` entry for users (then `npm run build:pages`). Anything already serving in production stays "used"; nothing new is claimed until the API deploy is live.

## Definition of done

- [ ] The supported language list comes from live probes and is recorded with dates.
- [ ] On the dev server the avatar speaks one line in at least five languages with the face following each, in a real browser, no console errors.
- [ ] Unsupported language, failed translation check and speech-lane failure each show a designed, actionable state.
- [ ] The embed attribute and method work on a plain HTML page outside the app.
- [ ] The measurement table covers every supported language.
- [ ] `git diff --stat` shows no change to lane order, to the speech lane's request, or under `workers/model-trellis/`. `npm test` passes; docs, pages entry and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The speech lane supports fewer languages than expected | Ship the ones it answers for, list the rest as unsupported with the probe result, and do not add another speech vendor in this order. |
| The hosted face lane is down | The feature still works on the stack's existing fallback lip-sync. Say which path your browser test used. |
| A language has no matching voice | Use the lane's multilingual voice for it if the probe shows it speaks that language intelligibly (confirm by transcribing the audio with the existing speech-recognition lane), otherwise mark it unsupported. |
| The translation model returns extra commentary | Use structured output, validate, retry once with the validation error, then fail with a clear message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, the `three-ws-api` deploy, the Inception portal edit, any forum or social post); one-line judgment calls. No trailing questions.
