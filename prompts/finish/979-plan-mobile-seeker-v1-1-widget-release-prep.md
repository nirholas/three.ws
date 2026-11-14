# The Seeker app 1.1.0 (Agent glance widget) is built, signed, verified and staged so the owner's only step is the portal upload

**Status (2026-11-14):** Re-verified: glance lane live (mine 200, token 401, /glance 200); build/three-ws-release.apk is versionCode 2 / 1.1.0, sha256 1afd05e9...03d4, signer 98:0A:...:D7 equals the live assetlinks.json, APPWIDGET_UPDATE receiver present; no keystore copies on disk. Fixed publish.sh so DAPP_STORE_DRYRUN no longer installs the CLI before printing the command (tests/solana-mobile-publish-dryrun.test.js). Remaining (owner): emulator and device checks, portal API key, funded publisher keypair, real publish (release NFT), Play upload, then the changelog entry.

**Status (2026-11-04):** Signed 1.1.0 (versionCode 2) APK built unattended from the Secret Manager key; signer SHA-256 matches the live assetlinks.json; widget receiver present; publish.sh dry run prints the 1.1.0 upload command and refuses a reused versionCode; README, listings, data-safety and CHECKLIST corrected; RELEASE-1.1.0.md holds the owner commands; bash -n test added. Remaining (owner): emulator and device checks (sandbox has no KVM), portal API key, funded publisher keypair, real publish, Play upload.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/979-plan-mobile-seeker-v1-1-widget-release-prep.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 40 of 100 inside the tier). **Area:** mobile. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`ws.three.app` 1.0 is the Solana Seeker (dApp Store) and Play build of the TWA. Version 1.1.0 (versionCode 2) adds the Agent glance home screen widget. The manifest, release notes and widget code are already in the repo, but the README still says the release "ships once its API lane is deployed", the 29-line release checklist has no recorded results, and no signed 1.1.0 APK has been produced and verified from the stored keystore. The agent-doable half (build, verify, dry-run publish, truthful docs) is unfinished; the owner's half (portal credentials, release NFT) cannot complete until it is.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `solana-mobile/twa/twa-manifest.json` has `appVersion` 1.1.0 and `appVersionCode` 2. `solana-mobile/publish/listing/new-in-version.txt` already describes the widget.
- Widget code lives under `solana-mobile/android-overlay/app/src/main/java/ws/three/` with a debug-only manifest at `android-overlay/app/src/debug/AndroidManifest.xml`. `solana-mobile/README.md` line 5 claims the API lane is not yet deployed.
- The API lane IS live: `api/glance/{mine,token,card,template}.js` exist, `GET https://three.ws/api/glance/mine?format=png` returns 200, `POST /api/glance/token` returns 401 unauthenticated (correct), and `https://three.ws/glance` returns 200. Tests exist: `tests/glance-png.test.js`, `glance-tokens.test.js`, `glance-card.test.js`, `glance-sw.test.js`.
- `https://three.ws/.well-known/assetlinks.json` is live for package `ws.three.app` with one SHA-256 fingerprint. `solana-mobile/twa/extra-fingerprints.json` holds extra signing keys (Play App Signing adds one later).
- `solana-mobile/docs/CHECKLIST.md` has 29 unchecked boxes: device checks (Seed Vault sheet, SIWS, resume, deep links, share target), portal prerequisites (publisher wallet funded, API key, release NFT), build/publish steps, and post-submit steps. None has a recorded result.
- Secret Manager holds `three-ws-seeker-release-keystore` and `three-ws-seeker-keystore-password`. `which java` works; `bubblewrap` and `apksigner` are not on the path in the sandbox.
- `scripts/publish.sh` supports `DAPP_STORE_DRYRUN=1` (prints the command without executing). It needs `SOLANA_KEYPAIR` and `DAPP_STORE_API_KEY`, neither of which an agent has.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n 'appVersion' solana-mobile/twa/twa-manifest.json
curl -s -o /dev/null -w '%{http_code}\n' 'https://three.ws/api/glance/mine?format=png'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://three.ws/api/glance/token
curl -s https://three.ws/.well-known/assetlinks.json | head -c 300
gcloud secrets list --project aerial-vehicle-466722-p5 --filter="name~seeker" --format="value(name)"
grep -n 'API lane\|ships once' solana-mobile/README.md
ls solana-mobile/build 2>/dev/null
npx vitest run tests/glance-png.test.js tests/glance-tokens.test.js tests/glance-card.test.js
```

Skip anything already done and verified.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `solana-mobile/scripts/build-apk.sh` and `scripts/setup-android-sdk.sh`. Install the Android SDK and Bubblewrap prerequisites the way those scripts prescribe (user-level, outside the repo). Fetch the keystore and password from Secret Manager into a temp directory with mode 0600 (`gcloud secrets versions access latest --secret three-ws-seeker-release-keystore`), never into the repo, and delete them at the end of the run.
2. Run `KEYSTORE_PASSWORD=... ./scripts/build-apk.sh` unattended and confirm it produces `build/three-ws-release.apk` with versionCode 2 (`aapt dump badging` or `apkanalyzer`). If it prompts interactively, fix the script so it cannot (CHECKLIST build section requires unattended runs). Add a small shell test or a vitest that runs `bash -n` on every script in `solana-mobile/scripts/`.
3. Verify the signing key matches the live Digital Asset Links file: `apksigner verify --print-certs build/three-ws-release.apk` and compare the SHA-256 against `https://three.ws/.well-known/assetlinks.json`. If they differ, update through `scripts/update-assetlinks.sh` (read it first; it edits the repo file, the deploy that ships it is the owner gate) and say so in the report.
4. Install on an emulator (the README documents the AVD flow and the debug variant for the widget loop). Run the five widget checks in `solana-mobile/README.md#The home screen widget` against the real production lane using a QA session token (the `self-unblock-playbook` skill has the QA login). Record pass/fail per check, including airplane-mode behaviour and force-stop persistence.
5. Walk `solana-mobile/docs/CHECKLIST.md`. For each item an agent can verify (emulator or script), tick it in the file with a one-line result and date. Leave device-only items (real Seeker Seed Vault sheet, Photos share target) unticked and move them to a short "Owner device checks" list at the top of the checklist so the owner sees exactly what remains. Never tick an item that was not observed.
6. Correct the stale docs: replace the "ships once its API lane is deployed" sentence in `solana-mobile/README.md` with the measured state; make sure `publish-play/listing/data-safety.md` discloses the widget's data flow (a revocable widget token stored on device, the card fetched every ~30 minutes, no extra data collected). Keep `publish/listing/*` and `publish-play/listing/*` consistent with each other.
7. Dry-run the release: `DAPP_STORE_DRYRUN=1 SOLANA_KEYPAIR=/dev/null DAPP_STORE_API_KEY=dry ./scripts/publish.sh` (read the script first so the dummy values are used only for the printed command, never sent). Confirm it refuses a reused versionCode and prints the exact upload command for APK 1.1.0.
8. Write `solana-mobile/RELEASE-1.1.0.md` only if no equivalent runbook exists: the exact owner commands (portal API key, keypair path, `./scripts/publish.sh`, then the Play Console upload steps from `publish-play/README.md`) in order, with the APK's SHA-256 and size. Add a `data/changelog.json` entry only after the owner confirms the store listing is live (the checklist's last item), not now.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `unzip -l solana-mobile/build/three-ws-release.apk | head` lists the file and `apkanalyzer manifest version-code` (or `aapt dump badging`) prints 2 and `ws.three.app`.
- [ ] The APK's signing SHA-256 equals the fingerprint in the live assetlinks.json (or the mismatch is documented and `update-assetlinks.sh` has been run).
- [ ] `grep -c '\- \[x\]' solana-mobile/docs/CHECKLIST.md` increased by the number of items verified, and each ticked line carries a result note; no tick without an observation.
- [ ] `grep -n 'ships once its API lane' solana-mobile/README.md` returns nothing.
- [ ] The DAPP_STORE_DRYRUN output is included in the report and shows the upload command with the 1.1.0 APK path.
- [ ] No keystore, password or API key exists anywhere under `/home/user/three.ws` (`git status` clean of such files; temp copies deleted).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Android SDK or emulator image in the sandbox | Use `scripts/setup-android-sdk.sh`; if KVM is unavailable, build and verify the APK statically (aapt, apksigner, assetlinks match) and record the emulator checks as owner device checks. |
| Keystore secret fetch is denied | Use the `self-unblock-playbook` GCP row (the standing project access covers Secret Manager reads); read, never rotate or recreate it. |
| Production QA session unavailable for the widget loop | Use the debug variant against a local `npm run dev` server as the README describes, with a real QA token from the local API. |
| Bubblewrap needs interactive Android SDK licence acceptance | Pass the licences non-interactively as `setup-android-sdk.sh` does (`sdkmanager --licenses` with `yes`). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Stops before the owner's actions: the dApp Store publisher wallet keypair and portal API key (`publish.sh` without `DAPP_STORE_DRYRUN`), minting the release NFT (an on-chain action, recipient and cost to be shown first), and the Play Console upload. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/979-plan-mobile-seeker-v1-1-widget-release-prep.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `979-plan-mobile-seeker-v1-1-widget-release-prep.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `solana-mobile/README.md`
- `solana-mobile/docs/CHECKLIST.md`
- `solana-mobile/publish-play/listing/data-safety.md`
- `solana-mobile/publish-play/README.md`
