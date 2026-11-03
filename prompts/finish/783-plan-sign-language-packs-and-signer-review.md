# Sign vocabulary packs per language with a native-signer review flow, so a second sign language can ship only when reviewed

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/783-plan-sign-language-packs-and-signer-review.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 24 of 100 inside the tier). **Area:** sign-language. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The signing avatars speak ASL only. `src/sign-dictionary.js` is one hard-coded ASL vocabulary and the engine (IK solver in `src/sign-rig.js`, timeline in `src/sign-clip.js`) is language-agnostic, but there is no pack format, no language dimension in `GET /api/sign`, and no way for a fluent signer to review a sign. The Bucharest education pilot draft commits to Romanian Sign Language (LSR) as Phase 2 "only with native signer review of every sign", and flags the groundwork ("scope an LSR vocabulary format and a signer review flow") as the open item. This order builds exactly that groundwork and authors zero LSR signs: the platform must never ship, or imply, a sign language no fluent signer has approved. Sending the outreach reply and scheduling the school call are owner actions and are not part of this order.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/sign-dictionary.js` (408 lines) exports `SIGNS` (frozen ASL map), `SIGNABLE_WORDS`, `lookupSign`, `buildSignClip`, `signLookup`, `signGloss`. Words without an entry fall back to fingerspelling in `src/sign-speech.js` (which is the ASL manual alphabet from `src/sign-handshapes.js`).
- Consumers: `src/sign-language-page.js`, `src/sign-speech.js`, `api/sign.js` (`GET/POST /api/sign`, params `text`, `hand`, `speed`, `max_seconds`, `format`), `api/_mcp/tools/sign.js` (`SIGNABLE_WORDS`), plus pages `/sign-language`, `/asl-alphabet`, `/sign-mirror` and the recognition lane.
- Tests: `tests/sign-dictionary.test.js`, `tests/sign-goldens.test.js` (fixtures `tests/fixtures/sign-poses.json`, rebuilt by `scripts/build-sign-goldens.mjs`), `tests/sign-linguistics.test.js` (Battison constraints), `tests/api-sign.test.js`, `tests/sign-speech.test.js`.
- No `language`/`lang` concept exists in the sign code (`grep -rn "lang" src/sign-*.js api/sign.js` finds only UI strings). No review table or page exists.
- `docs/sign-language.md` "Adding a sign" documents data-only authoring; `docs/education-pilot-bucharest.md` states the honest position: ASL is not LSR and must never be pitched as such.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -rn "language\|lang" src/sign-dictionary.js src/sign-speech.js api/sign.js | head
ls src | grep -i sign; ls tests | grep -i sign
ls api/_lib/migrations | tail -5
npm run db:status
grep -n "sign" data/pages.json | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Pack format. Create `src/sign-packs/index.js` and move the current table to `src/sign-packs/asl.js` as the pack `{ id: 'ase', name: 'American Sign Language', bcp47: 'ase', signs, aliases, alphabet: 'asl-manual', status: 'native' }` (ISO 639-3 codes: `ase` ASL, `rms` Romanian Sign Language). `src/sign-dictionary.js` keeps its exports and behaviour for the default pack so every existing import and the goldens are untouched (run the goldens before and after; they must be byte-identical). Add `getPack(id)`, `listPacks()`, and parametrise `lookupSign`, `buildSignClip`, `signLookup`, `SIGNABLE_WORDS` with an optional pack argument defaulting to ASL.
2. Review model. Each sign in a non-native pack is addressed by `(pack, key)` and carries a content hash computed from its canonical JSON (write `signContentHash(sign)` in `src/sign-packs/hash.js`, deterministic key order). A sign is `approved` only when at least `REQUIRED_APPROVALS` (default 2, per pack, in the pack file) distinct reviewers approved that exact hash; any edit to the sign changes the hash and drops it back to `unreviewed`. A pack with `status: 'native'` is exempt only for ASL as today. Add a migration `api/_lib/migrations/<timestamp>_sign_reviews.sql` (`npm run db:status` first; `npm run db:migrate` applies immediately) with `sign_reviewers (user_id, pack, display_name, credential_note, granted_by, created_at)` and `sign_reviews (id, pack, sign_key, content_hash, reviewer_id, verdict check in ('approve','reject','needs_change'), note, created_at, unique (pack, sign_key, content_hash, reviewer_id))`.
3. Serving rules (test first in `tests/sign-packs.test.js`): `GET/POST /api/sign` gains `lang` (default `ase`). For a non-native pack: only approved signs are signed; any other word is returned in the timeline as `signed:false, unsupported:true` and is never fingerspelled with the ASL manual alphabet unless the pack declares its own `alphabet`; an unknown or zero-approved pack answers `400 unsupported_language` listing available packs; `GET /api/sign?lang=...` response gains `lang` and `review: { approved, total }`. The MCP tool in `api/_mcp/tools/sign.js` and `SIGNABLE_WORDS` follow the same pack argument. Every existing request without `lang` returns exactly what it returns today (assert against recorded fixtures).
4. Review API: `api/sign-review/[action].js` (follow the conventions of `api/drops/[action].js`): `GET packs` and `GET queue?pack=` (unreviewed or changed signs for a granted reviewer), `POST review` (verdict + note, reviewer only, CSRF/session rules as the other session-gated routes), `GET status?pack=` public aggregate counts. Admin-only `POST reviewer` to grant or revoke a reviewer (use the existing admin check helper; `grep -rn "requireAdmin\|isAdmin" api/_lib | head`). Add the routes to `vercel.json` if the catch-all pattern does not already cover them.
5. Reviewer page `pages/sign-review.html` + `src/sign-review-page.js` (add to `data/pages.json`, `vercel.json` route, `npm run build:pages`): a signed-in granted reviewer sees the queue, plays each sign on the avatar (reuse `src/sign-avatars.js` and `buildSignClip`), at 0.5x and 1x, left and right dominant hand, with the gloss text, then approves, rejects, or asks for a change with a note. States: skeleton queue, empty ("Nothing waiting for review in this language"), error with retry, not-a-reviewer (explains how to request access), focus/hover/active on every control, keyboard shortcuts for approve/reject. The page must say plainly that a sign never goes live without the required approvals.
6. Language selector on `/sign-language` (`src/sign-language-page.js`): lists only packs with at least one approved sign; ASL remains default; a non-ASL pack shows its review coverage ("42 of 300 signs reviewed") and signs only approved words. With only ASL available the selector is hidden, so production UI is unchanged today.
7. Authoring guard: add `scripts/validate-sign-pack.mjs` (and `npm run sign:validate-pack -- <pack>`) that lints a pack file (schema, anchors exist, Battison constraints reused from `tests/sign-linguistics.test.js` logic extracted to a shared helper, duplicate keys) and prints the review coverage. Add a template pack file `src/sign-packs/_template.js` that is excluded from `listPacks()`. Do NOT author any LSR signs or fingerspelling in this order, and add a test that fails if a pack with `status` other than `native` ships any sign without an `approved` row-equivalent in the committed review fixtures.
8. Docs: new "Languages and review" section in `docs/sign-language.md` (pack format, review rules, API `lang`, reviewer onboarding), a short note in `docs/education-pilot-bucharest.md` pointing to it so Phase 2 groundwork is checked off, a `STRUCTURE.md` row for `src/sign-packs/` and the review page, and a `data/changelog.json` entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/sign-packs.test.js tests/sign-dictionary.test.js tests/sign-goldens.test.js tests/sign-linguistics.test.js tests/api-sign.test.js tests/sign-speech.test.js` passes with the goldens fixture file unchanged (`git diff --stat tests/fixtures/sign-poses.json` is empty).
- [ ] `curl -s 'http://localhost:3000/api/sign?text=hello&format=timeline'` is identical to the pre-change response; `curl -s 'http://localhost:3000/api/sign?text=hello&lang=rms'` returns `400 unsupported_language`.
- [ ] Test shows: a sign with one approval stays unapproved when two are required; editing a sign invalidates its approvals; a rejected sign is never served.
- [ ] Browser: `/sign-review` as a granted reviewer plays a sign, records a verdict, and the queue updates; as a non-reviewer it shows the access explanation; zero console errors. `/sign-language` looks and behaves exactly as before with only ASL present.
- [ ] `node scripts/validate-sign-pack.mjs asl` exits 0.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No native LSR (or any non-ASL) signer is available to review | That is the design: the order ships the machinery with zero non-ASL signs live. Prove the flow with a test-only fixture pack (clearly named, never listed in production `listPacks()`), not with invented sign content. |
| Existing goldens shift after refactoring the dictionary | Treat as a regression: the refactor must be behaviour-preserving. Fix the refactor, never regenerate the goldens. |
| Need an admin helper that does not exist | Reuse the platform admin check already used by other admin pages (`grep -rn "admin" api/_lib/auth*.js`); do not hand-roll auth. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/783-plan-sign-language-packs-and-signer-review.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `783-plan-sign-language-packs-and-signer-review.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/education-pilot-bucharest.md` (whole file)

~~~~markdown
# Education Pilot: Sector 1 Bucharest (Draft)

Status: exploratory. A contact has offered a local connection to the office of the deputy mayor of Sector 1, Bucharest (education and schools portfolio). This doc holds the outbound reply and the one-page pilot brief to forward once there is interest.

## The honest position (read before pitching)

- Our signing avatars speak **ASL (American Sign Language)**, not **LSR (Limba Semnelor Române / Romanian Sign Language)**. These are different languages. Never pitch the current feature as an accessibility tool for Romanian deaf students.
- What we can honestly pitch today: 3D learning assistants for regular classes, plus a unique English-learning loop (avatar signs and fingerspells English words; students practice back at a webcam that grades their handshape on-device).
- The signing engine is language-agnostic: signs are authored as data ([src/sign-dictionary.js](../src/sign-dictionary.js)), so LSR is content work, not an engine rewrite. Building LSR credibly requires native LSR signers and educators reviewing every sign; a school partnership is exactly how to get that review.
- Privacy story is strong and real: the practice loop ([/sign-mirror](https://three.ws/sign-mirror)) runs fully on-device with no network call, and the recognition lane uploads hand landmarks only, never video. No accounts are required for any of the learning surfaces.

## Reply draft (send to the contact)

> Hey, thanks for bringing this to me. Yes, we're open to it, and I'd like to explore it seriously.
>
> One thing I want to be upfront about so we set the right expectations with the school: our signing avatars currently speak ASL (American Sign Language), not LSR (Romanian Sign Language). Those are different languages, so I don't want to walk in promising an accessibility tool for deaf students that isn't there yet.
>
> That said, here's what we can do today, and what I'd propose:
>
> **Phase 1 (ready now): a regular-class pilot.** 3D agents as learning assistants, plus an English-learning angle that's genuinely unique: kids type an English word, a 3D avatar signs and fingerspells it, and they can practice signing back at the webcam, which grades their handshape in real time. Privacy-wise it's built for exactly this setting: the camera video never leaves the device, only hand landmark points are processed, and the practice loop runs fully on-device. No accounts needed.
>
> **Phase 2 (co-development): true LSR support for the special-needs group.** Our signing engine is language-agnostic, so adding Romanian Sign Language is content work, not a rebuild. But we won't do it without native LSR signers and educators reviewing every sign. If the school can connect us with LSR-fluent staff or interpreters, we'd build the LSR vocabulary with them. That makes the pilot a real partnership rather than us dropping software on them.
>
> If your contact is open to it, a 30-minute call with whoever runs the education programs would be the right next step. I can put together a one-page brief in advance. And happy to have you make the local connection, that would help a lot.

## One-page pilot brief (forward after interest)

### three.ws education pilot: 3D learning assistants and signing avatars

**What three.ws is.** A web platform for 3D AI agents: animated avatars that talk, teach, and sign, running in any browser with nothing to install. Free to use for the surfaces in this pilot; no student accounts required.

**What we propose.**

*Phase 1: one or two regular classes (4-6 weeks).*

- **3D learning assistants.** A teacher-configured 3D avatar embedded in class materials that students can ask questions in natural language.
- **English + sign language practice.** Students type an English word and a 3D avatar fingerspells and signs it ([three.ws/sign-language](https://three.ws/sign-language), [three.ws/asl-alphabet](https://three.ws/asl-alphabet)). In the mirror room ([three.ws/sign-mirror](https://three.ws/sign-mirror)), the webcam watches the student's hand and grades the handshape live, naming the finger that is wrong. Works on ordinary school laptops.
- **What we measure.** Engagement (voluntary practice time, alphabet completion), teacher-reported usefulness, and a before/after fingerspelling reading test.

*Phase 2: co-developing Romanian Sign Language (LSR) support with the special-needs group.*

- Our signing engine is not tied to any one sign language; vocabularies are authored as data and reviewed by fluent signers.
- With LSR-fluent staff or interpreters from the school, we would author and review an initial LSR vocabulary, giving Romania its first browser-native LSR signing avatar, built with the community that uses it.
- The special-needs group and its educators define the vocabulary priorities; we ship review tools and iterate weekly.

**Privacy and safeguarding.**

- The handshape practice loop runs entirely in the browser: no video frame, landmark, or score is ever uploaded, and there is no network call in the practice loop.
- The optional sign-reading feature uploads anonymous hand landmark coordinates only, never video or images.
- No student accounts, no personal data collection, no ads, no tracking of minors. GDPR posture available on request.

**What we need from the school.**

- 1-2 participating teachers and a 30-minute onboarding call.
- Ordinary laptops or tablets with a webcam and a browser.
- For Phase 2: access to LSR-fluent staff or interpreters for sign review sessions.

**Cost.** The pilot is free. We fund the infrastructure; the school contributes feedback and, in Phase 2, sign-language expertise.

## Next steps checklist

- [ ] Send the reply above to the contact.
- [ ] If interest: schedule the 30-minute call, forward the brief.
- [ ] Phase 2 groundwork: scope an LSR vocabulary format and a signer review flow on top of [src/sign-dictionary.js](../src/sign-dictionary.js) (do not start authoring signs without native signer review lined up).
~~~~

### `docs/sign-language.md` (whole file)

~~~~markdown
# Sign language: avatars that sign

three.ws avatars communicate in American Sign Language. Words that have a sign are signed, on one or both hands; everything else is fingerspelled letter by letter, in the same continuous clip. It runs everywhere an avatar performs: the signing page, the Animation Studio, agent chat, and any embedded avatar on your own site. You can also sign back at it with your webcam.

New here? The step-by-step walkthrough is [Tutorial: make your avatar sign](https://three.ws/tutorials/sign-with-your-avatar). This page is the reference: every surface, the developer API, and how the engine works.

[![A rigged 3D avatar mid-sign on the three.ws sign-language page, beside the phrase input and the speed and signing-hand controls](/docs/img/sign-language-hero.webp)](/sign-language)

*Type anything: the avatar signs the words it has signs for and spells the rest.*

## Start here

| I want to | Go here | What happens |
|---|---|---|
| Watch an avatar sign something | [/sign-language](https://three.ws/sign-language) | Type a phrase, press **🤟 Sign it**. Known words sign, the rest spell |
| Send someone a signed phrase | `https://three.ws/sign-language?say=happy+to+meet+you` | The page signs it on arrival. The **🔗 Share this phrase** chip copies this link for whatever was just signed |
| See the whole vocabulary | [/sign-language](https://three.ws/sign-language#sl-vocab) | Every word with a real sign, as a chip you can click to watch |
| Learn the manual alphabet | [/asl-alphabet](https://three.ws/asl-alphabet) | Every letter and number on a live hand, with what to look for, the look-alikes, and a drill for reading it |
| Practice making the letters myself | [/sign-mirror](https://three.ws/sign-mirror) | Your camera watches your hand and grades the handshape live, finger by finger, entirely on-device |
| Spell a word and download it | [/pose](https://three.ws/pose) | The Spell box builds an animation clip you can scrub, slow down, and export as an animated GLB |
| Share a spelled word | `https://three.ws/pose?spell=HELLO` | The Studio spells it on arrival, on whatever avatar is loaded |
| Get signed answers from an AI agent | [/app](https://three.ws/app) | The **🤟** button in the chat header signs every assistant reply |
| Sign to the AI instead of typing | [/app](https://three.ws/app) | The **🎥** button reads your fingerspelling from the webcam into the message box |
| Put a signing avatar on my own site | [Web component](#in-your-own-site-or-app) | One `sign-language` attribute on `<agent-3d>` |

Nothing here needs an account, a plugin, or a download. It is 3D in the browser.

---

# Part 1: Using it

## Sign anything on /sign-language

[/sign-language](https://three.ws/sign-language) is the front door. A live avatar signs a rotating set of phrases on arrival; type your own in the box and press **🤟 Sign it** (or hit Enter). Press `/` anywhere on the page to jump straight to that box.

The status line under the avatar tells you what it just did, for example `signed happy, meet, you · spelled to`, so you always know which words were real signs and which were spelled.

The avatar is a multi-megabyte model, so it arrives a beat after the page. You do not have to wait for it: type and press **🤟 Sign it** while the silhouette is still breathing, and the phrase is queued and performed the moment the avatar lands. If the model fails to download, the stage says so and offers **Retry the avatar**; the [sign API](#the-sign-api) further down runs on the server and keeps working either way.

Three settings sit under the input, and all three are remembered on your next visit:

| Setting | Options | Why it exists |
|---|---|---|
| **Speed** | 0.5×, 0.75×, 1× | Signing is content, not decoration. Learners and many viewers want it slower, and slowing it must not mean losing it |
| **Signing hand** | Right-handed, Left-handed | About one signer in ten is left-dominant. The whole sign mirrors, not just the hand |
| **Avatar** | Classic, Expressive face, your own | The classic rig is light and animates smoothly everywhere but carries no face blendshapes. The expressive rig shows the [non-manual markers](#the-face-is-grammar) a signed question needs. The third pill opens the avatar gallery: see [Sign with your own avatar](#sign-with-your-own-avatar) |

If you have `prefers-reduced-motion` turned on, the page never auto-plays: signing starts only when you ask for it.

### Sign with your own avatar

The **Avatar** setting's third pill (`Your avatar…`) opens the three.ws avatar gallery: your own avatars and every public one. Pick one and it takes the hero's place immediately, keeping the speed and signing hand you already set.

It works because signs are anatomy, not coordinates. A sign says "index fingertip on the chin", and the solver measures your avatar's skeleton to find where its chin is, so the same entry lands correctly on a tall rig, a short one, long fingers or small hands. Nothing about the vocabulary is per-avatar, which is also why the [clips retarget](#part-3-how-it-works) instead of being rebuilt.

Once picked, the avatar is remembered on that device and is already on stage on [/asl-alphabet](https://three.ws/asl-alphabet) too. Click its pill again to swap to a different one; the built-in pills switch back without a trip through the gallery.

Some avatars cannot sign. A model with no skeleton, or a humanoid rig with no finger bones, has nothing to form a handshape with. Rather than leave a mute avatar on stage, the page says so and puts the rig that was working back:

> Nova can't sign: it has no usable skeleton. Classic is back on stage.

Anything created by the [Avatar Studio](https://three.ws/create) or by [/forge](https://three.ws/forge) with a humanoid rig signs. If your own model does not, run it through [rig repair](https://three.ws/rig-doctor) first.

## What it signs, and what it spells

A signer spells names and loanwords and *signs* everything else. The avatar does the same. These 32 words have a real sign, with a handshape, a place on the body, and a movement:

| Word | The sign |
|---|---|
| `HELLO` | Flat hand salutes out from the temple |
| `THANK` | Flat hand moves out and down from the chin |
| `PLEASE` | Flat hand circles on the chest |
| `SORRY` | A-hand circles over the heart |
| `YES` | S-hand nods at the wrist, like a head saying yes |
| `NO` | Index and middle finger snap shut against the thumb |
| `HAPPY` | Both flat hands brush up the chest in circles |
| `FALL` | Two legs stand on the flat palm, then tip over onto their back |
| `YALL` | Flat palm-up hand sweeps an arc across the group |
| `YOU` | Index finger points at the person addressed |
| `ME` | Index finger points to the signer's own chest |
| `NAME` | Two H-hands tap across each other |
| `HELP` | A-hand rides the flat palm upward |
| `GOOD` | Flat hand comes down from the chin onto the other palm |
| `BAD` | Flat hand leaves the chin and turns palm-down |
| `LOVE` | Both arms cross over the heart |
| `LEARN` | Fingers lift knowledge off the palm to the forehead |
| `KNOW` | Fingertips tap the forehead |
| `THINK` | Index finger touches the temple |
| `SEE` | V-hand moves out from the eyes |
| `WANT` | Both claw hands draw in toward the body |
| `MORE` | Both flat-O hands tap fingertips together |
| `STOP` | Flat hand chops down onto the other palm |
| `WORK` | One fist taps the back of the other wrist twice |
| `FRIEND` | Hooked index fingers link, then swap |
| `MEET` | Two upright index fingers come together |
| `NICE` | Flat hand slides cleanly across the other palm |
| `WELCOME` | Open palm sweeps in toward the body, inviting |
| `WHAT` | Both palms turn up and shake, with a questioning brow |
| `FINISH` | Both open hands flick out and down: done |
| `AGAIN` | Bent hand arcs over and taps into the flat palm |
| `THREE` | The number three, held up clearly |

Another 41 everyday spellings route to those same signs, so ordinary sentences work without you thinking about it: `hi` and `hey` sign HELLO, `thanks` and `thank you` sign THANK, `i` and `im` sign ME, `everyone` and `everybody` sign YALL, `done` and `finished` sign FINISH, plus plurals and third-person forms (`helps`, `working`, `knows`). The full list is [`src/sign-dictionary.js`](../src/sign-dictionary.js).

**Everything else fingerspells.** All 26 letter handshapes, the numbers 0-9, the traced J and Z motions, and the small bounce signers use for a double letter. A sentence that mixes both is one clip with no seam: the hands come up once at the start and settle once at the end, exactly as a signer does, rather than resetting between words.

## Learn the alphabet on /asl-alphabet

[/asl-alphabet](https://three.ws/asl-alphabet) is the reference for the manual alphabet itself. Every letter A-Z and digit 0-9 is formed by a live rig you can orbit, so you see the handshape from any angle rather than from one photographed side.

[![A rigged 3D avatar forming a letter of the American manual alphabet, beside that letter's description and the speed and signing-hand controls](/docs/img/asl-alphabet-hero.webp)](/asl-alphabet)

*Every letter of the manual alphabet on a hand you can turn around.*

- **Click a key, or press it.** Typing `q` signs a Q. A single letter holds its pose so you can study it; a word settles back to rest the way a signer finishes.
- **Every letter is described**, with the letters it is confused with named explicitly (F against 9, M against N, K against V, G against Q). Look-alikes are where reading breaks down, so they are called out rather than left to be discovered.
- **Spell any word** and each key lights up as the hand reaches it. The word is also laid out under the input, one cell per letter, lit in the same cadence, so a long word can be followed without scrolling back to the A-to-Z grid. The highlight comes from the clip builder itself, not from a timer guessed alongside it, so it stays in step at any speed.
- **Practice reading it**, which is the harder half. The avatar spells a letter or a word, you type what you read, and your streak is kept on the device.
- Deep links: `?letter=W` opens a letter, `?spell=HELLO` spells a word. The link is read before the page builds anything, so the letter's description, its look-alike note and its pressed key are on screen immediately and the avatar catches up when the rig finishes loading.

Speed, signing hand, and avatar are the same settings as /sign-language, stored under the same key, so a left-handed signer sets that once for both pages. That includes [your own avatar](#sign-with-your-own-avatar): pick it on either page and it forms the letters on both.

## Practice making the letters on /sign-mirror

[/sign-mirror](https://three.ws/sign-mirror) is the other direction: instead of reading the avatar's hand, you form the letter with your own. The avatar shows the target, a skeleton diagram of the ideal hand sits beside it, and your camera feed is graded live against the same handshape spec the avatar is wearing (`src/sign-handshapes.js` via [`src/sign-grader.js`](../src/sign-grader.js)), so what is taught and what is graded cannot drift apart.

- **Hold the shape to pass.** The score has to sit above the pass line for a moment, not just spike through it, which is what holding a letter actually feels like.
- **Wrong is named, not just scored.** Each finger gets its own bar, and the hint says what to change ("straighten your ring finger"). When your hand is a long way off but cleanly forms a different letter, the page says which letter it sees.
- **Letters that share a handshape are flagged, not failed.** G and Q, K and P differ only by which way the hand points, which a handshape score cannot see; the page explains the difference instead of marking you wrong.
- **A course, not a list.** The alphabet is ordered easiest-first: closed fists, open hands, pointing fingers, then the confusable pairs. Passed letters turn green and progress is kept on the device.
- **Your best on every letter is visible.** Each letter square carries a thin bar showing the best score that letter has reached, so the grid reads as a map of where your practice actually is rather than 26 identical buttons. Screen readers get the same number in the button's label. **Reset progress** clears both the passes and the best scores.
- **Entirely on-device.** MediaPipe's hand landmarker runs in the tab, the grading is arithmetic, and there is no network call in the practice loop: no frame, landmark, or score is ever uploaded. No camera? The target diagram and the avatar still work.
- **A camera that will not start says why.** Permission refused, no camera on the device, the camera held by another app, an insecure origin, and a hand tracker that failed to download are each named separately with the step that fixes them. The one-off tracker download (about 8 MB, cached afterwards) shows its own state in the camera panel rather than leaving it reading "the camera is off".

Deep link: `?letter=W` opens a letter. The signing hand and avatar are the same stored preferences as /sign-language and /asl-alphabet.

## Fingerspell and export in the Animation Studio

The [Animation Studio](https://three.ws/pose) treats a spelled word as an animation clip like any other. Load a rigged avatar, find the **Spell** box in the Animation panel, type a word, press **🤟 Spell**.

- The clip is built in your browser (`src/fingerspelling.js`), so it is instant, deterministic, and works offline. Nothing is sent to a server.
- It plays through the same transport as a preset: scrub, speed, stop.
- **Export animated GLB** bakes the spelling onto your avatar's skeleton. The download opens in any glTF viewer.
- `https://three.ws/pose?spell=HELLO` spells that word on arrival, which makes any spelled word a shareable link.

The Studio's Spell box is spelling only. For the lexical vocabulary (words that are *signed*, not spelled) use [/sign-language](https://three.ws/sign-language) or the [`SignSpeaker` API](#drive-it-from-javascript).

A rig with no finger bones cannot form handshapes, so the Studio refuses it with an explanation instead of playing a wrong result. See [Troubleshooting](#troubleshooting).

## Signed chat replies

In the [/app](https://three.ws/app) agent chat, the **🤟** button in the chat header turns on sign-language mode. From then on the avatar signs every assistant reply, using library signs where they exist and fingerspelling the rest. Press it again to turn it off.

Embedded avatars get the same behavior with one attribute:

```html
<agent-3d agent-id="your-agent" chat sign-language></agent-3d>
```

## Sign back with your camera

The **🎥** button in the agent chat opens your webcam with a mirrored self-view. Fingerspell at the camera, click again, and the transcription lands in the message box for you to review before sending. The same demo runs on [/sign-language](https://three.ws/sign-language#sl-webcam) without an agent.

Two things worth knowing before you use it:

- **Your video never leaves your device.** Landmarks are extracted in your browser with MediaPipe Holistic; only pose coordinates (numbers, not pixels) go to the recognizer.
- **Expect a 10% to 20% character error rate** on webcam fingerspelling. That is the honest number for this model on real cameras. The chat model downstream is robust to it, and the transcription lands in the message box, not straight into the conversation, so you always get to fix it first.

Best results: good light, hand in frame, one letter at a time, and hold the last letter for a beat. Capture stops itself after 20 seconds.

---

# Part 2: Building with it

## In your own site or app

The [web component](./web-component.md) exposes signing as an attribute. Present at boot, or toggled at runtime, it does the same thing:

```html
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"></script>
<agent-3d agent-id="your-agent" chat sign-language></agent-3d>
```

```js
// Toggle it later from your own UI.
const el = document.querySelector('agent-3d');
el.setAttribute('sign-language', '');   // on
el.removeAttribute('sign-language');    // off
```

Any value except `off` or `false` enables it.

## Drive it from JavaScript

`SignSpeaker` is the signed counterpart of text-to-speech. It compiles text into one continuous clip and plays it on an avatar's `AnimationManager`:

```js
import { SignSpeaker } from './sign-speech.js';

// The built-in vocabulary is the default: known words sign, the rest spell.
const speaker = new SignSpeaker({ manager: viewer.animationManager });
const { signed, spelled } = await speaker.speak('happy to meet you');
// signed  → ['HAPPY', 'MEET', 'YOU']
// spelled → ['TO']
```

Pass `signs: null` for spelling only, or your own lookup to override the vocabulary. Every clip is upper-body: signing never writes the root translation, so it can never move the avatar off the floor.

On a running agent, `AgentAvatar.setSignLanguage(true)` is the switch the chat surfaces use. The avatar layer already receives every assistant reply (the protocol `SPEAK` event), so signing rides the same event with no per-surface plumbing:

```js
const on = await agentAvatar.setSignLanguage(true);
// → false if this rig has no finger bones; the avatar says so rather than signing wrong.
```

Need only the alphabet? `buildFingerspellingClip('HELLO')` in [`src/fingerspelling.js`](../src/fingerspelling.js) returns the same `AnimationClip` JSON document the animation library serves, with no avatar attached.

Pass a `marks` array to collect `{ letter, start, end }` for every letter as it is placed, which is how /asl-alphabet keeps its keyboard in step with the hand:

```js
const marks = [];
const clip = buildFingerspellingClip('HELLO', { marks });
// marks → [{ letter: 'H', start: 0.35, end: 1.07 }, …]
```

## Install it as a package

The whole engine is packaged as `@three-ws/sign-language` with **zero runtime dependencies**: no three.js, no DOM, no network. It compiles signing in a browser, in Node, or in a worker.

The registry publish is still queued, so `npm install @three-ws/sign-language` resolves to nothing today. Until it lands, install the package directory out of a clone of this repository; the import path and every export below are already the published ones:

```bash
git clone https://github.com/nirholas/three.ws
npm install ./three.ws/packages/sign-language
```

```js
import { compileUtterance, signLookup } from '@three-ws/sign-language';

const { clip, signed, spelled } = compileUtterance('happy to meet you', { signs: signLookup() });
// signed → ['HAPPY', 'MEET', 'YOU']   spelled → ['TO']
```

The package README covers every export, the authoring format, and a runnable Node example: [packages/sign-language](../packages/sign-language/README.md).

## The sign API

`GET /api/sign` compiles text into a signed utterance on the server and hands back both halves of it: the animation, and the timeline it performs on. No account, no API key, no SDK, and CORS is open, so a browser, a worker, a Unity build, a Python script or an agent can all call it directly.

![The sign API console on three.ws, showing the phrase "happy to meet you" compiled into four timeline blocks with the spelled word broken into its letters](/docs/img/sign-api-console.webp)

The console on [/sign-language](https://three.ws/sign-language#sl-api) is this endpoint, live: it calls the real URL, draws the response, and plays the same utterance on the avatar so you can see that the JSON and the hands agree.

```bash
curl -s "https://three.ws/api/sign?text=happy+to+meet+you" | jq '.timeline'
```

```json
[
  { "word": "HAPPY", "signed": true,  "gloss": "Both flat hands brush up the chest in circles.",
    "start": 0, "end": 1.46, "letters": null },
  { "word": "TO",    "signed": false, "gloss": null,
    "start": 1.64, "end": 2.64,
    "letters": [ { "letter": "T", "start": 1.64, "end": 2.14 },
                 { "letter": "O", "start": 2.14, "end": 2.64 } ] },
  { "word": "MEET",  "signed": true,  "gloss": "Two upright index fingers come together.",
    "start": 2.82, "end": 3.58, "letters": null },
  { "word": "YOU",   "signed": true,  "gloss": "Index finger points at the person addressed.",
    "start": 3.76, "end": 4.64, "letters": null }
]
```

### Parameters

| Parameter | Values | What it does |
|---|---|---|
| `text` | up to 600 characters | The text to sign. A-Z, 0-9 and spaces are performed; punctuation is dropped. Required to compile |
| `hand` | `right` (default), `left` | Dominant hand. The whole sign mirrors, not just the hand |
| `speed` | `0.25`-`1.5`, default `1` | Below 1 is a signer taking longer over the same signs, not a clip played back slowly |
| `max_seconds` | `1`-`60`, default `45` | Cap the utterance. Longer text truncates at a word boundary and comes back with `truncated: true` |
| `format` | `clip` (default), `timeline` | `timeline` omits the clip: a few hundred bytes instead of tens of kilobytes, when all you need is what would be signed |

`POST` takes the same fields as a JSON body (`max_seconds` may also be written `maxSeconds`).

### The response

| Field | What it is |
|---|---|
| `duration` | Seconds the whole utterance takes |
| `words`, `signed`, `spelled` | The utterance as words, and which of them had a real sign vs were fingerspelled |
| `timeline` | One entry per word in performance order: `start`, `end`, `signed`, the `gloss` of the sign, and for a spelled word the `start`/`end` of every letter |
| `clip` | A three.js `AnimationClip` document keyed to the canonical humanoid skeleton, rotation lanes only |
| `truncated` | Whether `max_seconds` cut the utterance short |
| `viewer` | A `/sign-language?say=…` link that performs the same text on a live avatar |

`GET /api/sign` with no `text` returns the descriptor: every parameter, and the whole vocabulary with each sign's description. That is the call to make first if you want to know what will sign and what will spell.

### Playing what comes back

The clip is the same document the animation library ships, so it retargets onto any rigged humanoid through [`@three-ws/retarget`](https://www.npmjs.com/package/@three-ws/retarget) and plays like any other clip:

```js
const res = await fetch('https://three.ws/api/sign?text=hello+friend');
const { clip, timeline, duration } = await res.json();

const action = mixer.clipAction(THREE.AnimationClip.parse(retargetClip(clip, rig)));
action.setLoop(THREE.LoopOnce, 1).play();

// Caption it in sync: the timeline is in the same seconds as the clip.
const at = (t) => timeline.find((s) => t >= s.start && t < s.end)?.word ?? '';
```

Responses are deterministic (the same text, hand and speed always compile to the same clip), so they cache hard at the edge and are cheap to call repeatedly. It is rate-limited per IP; a 429 comes back with the standard headers.

### From an agent

The same compiler is on the [three.ws MCP server](https://three.ws/mcp-tools) as two free tools:

| Tool | What it does |
|---|---|
| `list_sign_vocabulary` | Every word with a real sign, and what the sign does. Optional `search` filter |
| `sign_text` | Compiles text and returns the timeline, a link that plays it, and the clip URL. Pass `include_clip: true` to inline the clip document itself |

`sign_text` withholds the clip by default on purpose: a sentence is tens of thousands of numbers, which is worth fetching over HTTP and worthless inside a chat transcript.

## Reading signing: the recognition API

`/api/asl-recognition` is the endpoint behind the webcam input. No API key, no account; it is rate-limited per IP.

```
GET  /api/asl-recognition   → { columns: [390 landmark column names], max_frames, min_frames }
POST /api/asl-recognition   { frames: [[390 numbers|null] …] }
                            → { text, raw, cleaned, confidence, frames, ms }
```

`GET` returns the feature schema: the exact MediaPipe Holistic landmark columns, in order, that a frame row must contain (`x_face_0` … `z_pose_21`). `POST` takes one row per video frame and returns the transcription. `null` marks a missing landmark. `text` is the decode after the LLM cleanup pass, `raw` is the recognizer's untouched output, and `confidence` (0 to 1) is its mean per-character certainty, which the UI uses to warn on a poor read instead of inserting the text silently. Full field reference: [docs/api-reference.md](./api-reference.md#transcribe).

The browser class that does all of this for you is [`src/sign-input.js`](../src/sign-input.js):

```js
import { SignInput } from './sign-input.js';

const input = new SignInput({ onState: (s) => console.log(s) });
await input.start();                    // camera on, capturing landmarks
// … user fingerspells …
const { text, raw, cleaned, confidence, frames, ms } = await input.stop();   // camera off, transcribed
```

`input.videoElement` is the live preview to attach to your page (mirror it with `transform: scaleX(-1)`, which is what signers expect). `input.cancel()` abandons a capture without transcribing.

Errors are plain: fewer than `min_frames` captured throws "Not enough signing captured", and an unconfigured deployment returns `503 unconfigured` rather than a hang. The model behind it is documented in [workers/model-asl-recognition](../workers/model-asl-recognition/README.md).

## What a rig needs

| Capability | Requirement | Without it |
|---|---|---|
| Fingerspelling and signs | Finger bones on the humanoid skeleton | Signing is refused with an explanation, never faked |
| [Non-manual markers](#the-face-is-grammar) | ARKit face blendshapes (most generated avatars have them) | The avatar still signs; it just loses the facial grammar |
| Left-handed signing | Nothing extra | Works on any rig that can sign |

There is no rig allowlist. Any humanoid whose bone names the canonicalizer recognizes can sign; see [docs/animations.md](./animations.md) for how that mapping works.

---

# Part 3: How it works

Signing is a spatial language. A sign is a handshape, a place on or in front of the body, and a movement between places: never a list of joint angles. The stack is built that way, as dependency-free JavaScript modules.

| Module | What it does |
|---|---|
| [`src/sign-rig.js`](../src/sign-rig.js) | Kinematics for the canonical skeleton. **Measures** the reference rig (bone axes and lengths, each hand's palm and thumb-side directions, fingertip positions, the parent chain) from the generated bind pose in `src/animation-canonical-rest.js` rather than assuming a convention, then offers forward kinematics (`Pose`), a two-bone arm IK (`solveArm`) that puts a wrist at a point with a natural elbow, and the hand geometry (`handPoint`, `handPartOffset`) contact is solved from |
| [`src/sign-handshapes.js`](../src/sign-handshapes.js) | The handshape catalogue: A-Z, 0-9, and the named shapes with no letter (`CLAW`, `FLAT_O`, `BENT_B`, `OPEN_8`, `ILY`). Each is per-finger curl, splay, and a thumb preset |
| [`src/sign-clip.js`](../src/sign-clip.js) | The authoring layer: a resting signer to start and end from, `posePhase()` to solve one phase of a sign, and `SignTimeline` to string phases together with eased transitions, a breathing idle, and clip output |
| [`src/sign-dictionary.js`](../src/sign-dictionary.js) | The vocabulary. Each sign lists its phases; `both:` poses two hands from one description because places and directions are body-relative, so the non-dominant hand mirrors for free |
| [`src/fingerspelling.js`](../src/fingerspelling.js) | The manual alphabet. The hand sits in front of the dominant shoulder at jaw height, palm to the reader, and only the handshape changes between letters, which is what makes fingerspelling readable |
| [`src/sign-speech.js`](../src/sign-speech.js) | Text in, one continuous clip out. `compileUtterance(text, { signs })` splits text into words, resolves each against the dictionary, fingerspells the misses, and concatenates. `SignSpeaker` drives an avatar like a TTS engine |
| [`src/sign-input.js`](../src/sign-input.js) | The reverse direction: webcam landmarks to text |

Measuring the rig instead of assuming its convention is not a detail. Assuming it is what once left the signing arm pointing behind the avatar's back.

## Adding a sign

Adding a sign is a data change. Describe its phases and where the hands land:

```js
// src/sign-dictionary.js
WELCOME: {
  gloss: 'Open palm sweeps in toward the body, inviting.',
  phases: [
    { t: 0.32, right: { shape: 'FLAT', at: { anchor: 'sternum', out: 0.22, up: -0.04, forward: 0.30 },
                        fingers: ['forward', 'out'], palm: 'up' }, head: { turn: -4 } },
    { t: 0.34, right: { shape: 'FLAT', at: { anchor: 'sternum', out: 0.02, up: -0.06, forward: 0.22 },
                        fingers: ['forward', 'in'], palm: 'up' }, head: { nod: 4 }, hold: 0.18 },
  ],
},
```

Anchors (`forehead`, `nose`, `chin`, `mouth`, `sternum`, `belly`, `shoulder`, `hip`) are measured off the reference skeleton and follow the body, so a place on the chin stays on the chin when the head turns. Offsets are metres: `out` away from the midline, `in` toward it, `forward` toward the person reading. Directions take the same words. Because a sign is described anatomically, the same entry reads correctly on a tall avatar, a short one, and either hand.

## Contact that actually touches

Signs like FALL, HELP, GOOD and KNOW are defined by contact: two fingers stand *on* the flat palm, the fingertips touch the *forehead*. A sign defined by contact says so instead of guessing a coordinate. `touch` names the part of the acting hand, and what it meets: the other hand, or a place on the body:

```js
FALL: {
  gloss: 'Two legs stand on the flat palm, then tip over onto their back.',
  phases: [
    { t: 0.32, left: BASE_PALM,
      right: { shape: 'V', touch: { part: 'fingertips', on: 'palm' }, fingers: 'down', palm: 'back' }, hold: 0.16 },
    { t: 0.3, left: BASE_PALM,
      right: { shape: 'V', touch: { part: 'edge', on: 'palm', out: 0.09, up: 0.02 },
               fingers: ['out', 'forward'], palm: 'up' }, head: { turn: -4, tilt: 4 }, hold: 0.2 },
  ],
},
```

The solver works backwards: the hand's orientation is known from `fingers`/`palm`, so the offset from the wrist to the touching part is known, and the wrist goes wherever puts that part on the target. Hand parts are `wrist`, `palm`, `back`, `knuckles`, `fingers`, `edge`, `fingertips`, `indextip`, `middletip`, `thumbtip`; `gap` holds a clearance instead of touching. Because contact is solved from the posed geometry rather than a fixed wrist coordinate, it still lands on an avatar with longer fingers or a bigger head.

## The face is grammar

In ASL the face carries grammar: raised brows mark a yes/no question, furrowed brows a wh-question. Signs carry those as blendshape lanes through a `face:` key, naming a marker (`question`, `wh`, `negate`, `topic`, `pleasant`, `concern`, `intense`) or explicit blendshape weights:

```js
{ face: 'wh', t: 0.3, both: { shape: '5', at: NEUTRAL, fingers: ['forward', 'out'], palm: 'up' },
  head: { tilt: 3, nod: -3 } },
```

Markers apply on any avatar shipping ARKit face shapes, including [one of your own](#sign-with-your-own-avatar). An avatar without them still signs; it just loses the marker. On [/sign-language](https://three.ws/sign-language) the **Avatar** setting switches the hero between the light classic rig and an expressive rig whose face actually shows them.

## Motion capture with hands

The video-to-motion worker tracks 21 landmarks per hand and solves all 30 finger joints, so a video of a real signer becomes a retargetable animation clip. That is the path for growing the vocabulary from real signers rather than from authored descriptions. See [Motion Swap](https://three.ws/motion-swap).

## Checking a sign

Two tools, because signing fails in two different ways.

**Positional goldens** catch a sign drifting. `tests/sign-goldens.test.js` compares every sign's wrists, elbows and fingertips at four moments against `tests/fixtures/sign-poses.json`, with an 8 mm tolerance. A change to the IK, an anchor, or a shared handshape moves many signs at once, and no property assertion notices five centimetres. After an intended change, re-record and read the diff:

```bash
node scripts/build-sign-goldens.mjs
```

**A contact sheet** catches a sign being illegible, which is a judgement made by looking. With the dev server running:

```bash
npm run sign:sheet                             # every sign, one frame each
npm run sign:sheet -- --letters                # the manual alphabet
npm run sign:sheet -- --sign FALL --frames 8   # one sign over time
npm run sign:sheet -- --dominant Left          # left-handed signer
```

`tests/sign-linguistics.test.js` additionally lints the vocabulary against Battison's constraints: when both hands move they must share a handshape, and a passive hand of a different handshape must be one of the unmarked set. A new entry is checked against the language, not just against whether it renders.

---

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| A breathing silhouette where the avatar should be | The avatar GLB is still downloading | Nothing to do. Anything you type or click meanwhile is queued and signed the moment it lands |
| "The 3D preview did not load" on the stage | The avatar GLB request failed, usually the network | Click **Retry the avatar**. The [sign API](#the-sign-api) runs server-side and works without the preview |
| "Load a rigged avatar to fingerspell" in the Studio | You are on the built-in mannequin, which has no skinned skeleton | Click **Load avatar**, or open `/pose?avatar=<id>` |
| The avatar refuses to sign, saying the rig cannot | The skeleton has no finger bones, so handshapes are impossible | Use a rig with fingers. Most generated and Mixamo-style avatars have them |
| It signs, but the face never changes | The rig carries no ARKit blendshapes | Switch the **Avatar** setting to Expressive face on /sign-language, or use an avatar exported with ARKit shapes |
| Nothing signs until I click | `prefers-reduced-motion` is on, and signing is never auto-played under it | Click **🤟 Sign it** or a vocabulary chip |
| Webcam transcription is wrong or empty | Fingerspelling recognition runs at a 10% to 20% character error rate, and needs enough frames | Better light, hand fully in frame, slower letters, hold the last one. Under `min_frames` it says "Not enough signing captured" |
| "Sign recognition is not configured" (503) | The deployment has no recognizer URL or key set | Set `GCP_ASL_RECOGNITION_URL` and `GCP_RECONSTRUCTION_KEY` on the API service. Everything else on the page still works |
| A word I expected to be signed got spelled | It has no dictionary entry, or the form differs (`ran` vs `run`) | Check the [vocabulary](#what-it-signs-and-what-it-spells). Spelling is the correct fallback, not a failure |
| Signing looks too fast to read | Default is full speed | Use the **Speed** setting (0.5×, 0.75×, 1×). It persists |

## Common questions

**Is this ASL or signed English?** Signed English. The vocabulary is a core set of citation-form signs strung together in English word order. Real ASL reorders sentences, inflects verbs through space, and carries grammar on the face. See [Honest scope](#honest-scope).

**Does the webcam send video anywhere?** No. Landmarks are extracted in your browser and only coordinates are sent for recognition.

**Can it read signs, not just spelling?** Not yet. The current recognizer reads continuous fingerspelling. Word-level recognition is item 2 on the [roadmap](#roadmap).

**Can a left-handed avatar sign?** Yes, and the whole sign mirrors, not just the hand. The choice persists across visits.

**Does it need an account or a GPU?** Neither. Signing is compiled in the browser and plays on the same renderer as any other avatar animation.

**Can I use my own vocabulary?** Yes. Pass your own lookup to `SignSpeaker` via `signs:`, or add entries to [`src/sign-dictionary.js`](../src/sign-dictionary.js) as described in [Adding a sign](#adding-a-sign).

## Glossary

| Term | Meaning |
|---|---|
| **Fingerspelling** | Spelling a word letter by letter with the manual alphabet. Used for names, loanwords, and anything with no sign |
| **Lexical sign** | A word that has its own sign: a handshape, a place, and a movement, rather than being spelled |
| **Gloss** | The written label for a sign, by convention in capitals (`HELLO`). Not a translation, just a name |
| **Citation form** | The dictionary form of a sign, as taught in isolation, before a sentence inflects it |
| **Non-manual marker** | Grammar carried on the face and head: raised brows for a yes/no question, furrowed brows for a wh-question, a headshake for negation |
| **Signing space** | The area in front of the signer where signing happens. Hands rise into it once per sentence and settle once at the end |
| **Dominant hand** | The hand that leads a one-handed sign. Right for most signers, left for about one in ten |

---

## Honest scope

The vocabulary is a core set of citation-form signs, strung together in English word order. That is signed English, not ASL grammar: real ASL reorders sentences, inflects verbs through space, and carries grammar on the face. The signs here are authored from standard descriptions, not captured from a specific signer, so they read as clear citation forms rather than as any individual's signing. Words with no entry are fingerspelled letter by letter.

Non-manual markers cover brows, eyes and mouth on avatars that carry ARKit blendshapes; the default classic rig on /sign-language has none (switch the Avatar setting to the expressive rig to see them). Marker coverage is also a fraction of what the face does in real ASL, which includes mouth morphemes, eye gaze, and body shift that this does not model.

None of this replaces a human interpreter. It makes an avatar legible to signers instead of silent.

## Roadmap

1. **Captured signs**: clips from real signers (commissioned, community capture through [Motion Swap](https://three.ws/motion-swap), permissively licensed video) replacing authored entries word by word, through the same dictionary interface.
2. **Word-level sign recognition**: the current recognizer reads fingerspelling; a 250-sign vocabulary model (MIT architecture retrained on the CC BY 4.0 PopSign corpus) will let common signs be recognized directly.
3. **Review by Deaf signers**: the vocabulary is authored, not validated. Growing it past a core set should follow review and capture, not more authoring.
4. **Standalone package on npm**: the engine is already packaged and installable from a clone ([Install it as a package](#install-it-as-a-package)); publishing `@three-ws/sign-language` to the public registry is what remains.

## Related

- [Tutorial: make your avatar sign](https://three.ws/tutorials/sign-with-your-avatar), the guided walkthrough of everything on this page
- [/asl-alphabet](https://three.ws/asl-alphabet), the manual alphabet on a live hand, with a practice drill
- [/sign-mirror](https://three.ws/sign-mirror), camera-graded handshape practice, entirely on-device
- [`@three-ws/sign-language`](../packages/sign-language/README.md), the engine as an npm package
- [examples/sign-language.html](../examples/sign-language.html), a runnable page with both integration paths
- [Animation Studio](./animation-studio.md), the Spell box, exports, and share links
- [docs/animations.md](./animations.md), clip formats and the retarget engine
- [docs/web-component.md](./web-component.md), every `<agent-3d>` attribute including `sign-language`
- [workers/model-asl-recognition](../workers/model-asl-recognition/README.md), the recognition model and its licensing
- [Motion Swap](https://three.ws/motion-swap), video motion capture, including hands
~~~~

