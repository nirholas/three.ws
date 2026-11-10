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

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/education-pilot-bucharest.md`
- `docs/sign-language.md`
