# three.ws 3D extension verified and staged so publishing to the VS Code Marketplace and Open VSX is one command

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/983-plan-vscode-3d-marketplace-publish-ready.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 26 of 100 inside the tier). **Area:** vscode. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`threews.vscode-3d` 0.2.0 is built, tested (71 tests), packaged and installed into a real VS Code server, but it is not on the Marketplace: the gallery query for `threews.vscode-3d` returns zero results. The only missing pieces are a Marketplace token for the `threews` publisher and an Open VSX token for the `threews` namespace, both held by the owner. The agent-doable work is to re-prove the package is publishable and wrap the release so the owner supplies two tokens and nothing else.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `packages/vscode-3d/package.json`: name `vscode-3d`, publisher `threews`, version `0.2.0`, scripts `package`, `publish:marketplace`, `publish:openvsx`, `vscode:prepublish`.
- Gallery query (`POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery`, filterType 7, value `threews.vscode-3d`) returned `TotalCount 0` on 2026-11-03.
- `packages/vscode-3d/PUBLISHING.md` has the manual runbook, the expected `.vsix` file list and the verification query. `packages/vscode-3d/CHANGELOG.md` exists.
- No script automates preflight plus both publishes, and nothing verifies the post-publish listing.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd packages/vscode-3d && npm ci && npm test && npm run package
npx --yes @vscode/vsce ls --no-dependencies
curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=3.0-preview.1' -d '{"filters":[{"criteria":[{"filterType":7,"value":"threews.vscode-3d"}]}],"flags":103}' | head -c 300
echo "VSCE_PAT set: ${VSCE_PAT:+yes}  OVSX_PAT set: ${OVSX_PAT:+yes}"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Re-run the full preflight from `PUBLISHING.md` section 0 and confirm the `vsce ls` file list matches the documented list exactly (no sources, tests, maps or `node_modules`). Fix `.vscodeignore` if it drifted. Delete the `.vsix` afterwards.
2. Add `packages/vscode-3d/scripts/release.mjs` (and `npm run release`) that: runs the preflight (tests, package, exact file-list assertion, version greater than any already published as read from the gallery query, CHANGELOG section for the current version present), then publishes to the Marketplace when `VSCE_PAT` is set and to Open VSX when `OVSX_PAT` is set (each independent, each skipped with a clear message when its token is absent), then polls the gallery query until the new version appears or a bounded timeout, printing the listing URL. Never print token values.
3. Test the non-publishing parts: `packages/vscode-3d/test/release-preflight.test.mjs` (`node --test`) covering the file-list assertion, version comparison and CHANGELOG check against fixtures built in the test's temp dir.
4. Update `PUBLISHING.md` "Where things stand" and add a one-line `npm run release` section; keep the manual steps as the fallback.
5. Do not publish. Report the exact remaining owner step: set `VSCE_PAT` and `OVSX_PAT`, then run `npm run release` in `packages/vscode-3d`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test packages/vscode-3d/test/` passes, including `release-preflight.test.mjs`.
- [ ] `cd packages/vscode-3d && npm run release` with no tokens set runs the preflight, skips both publishes with explicit messages and exits 0.
- [ ] The packaged file list equals the documented list.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Marketplace or Open VSX token | That is the single owner step; everything else is finished and the release script skips cleanly |
| `vsce`/`ovsx` need network via `npx` | Run them with `npx --yes`; if the sandbox is offline, still ship the script and the offline-testable preflight |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Publishing to the Marketplace and Open VSX is external publishing. The agent never publishes; the owner runs `npm run release` with tokens set.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/983-plan-vscode-3d-marketplace-publish-ready.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `983-plan-vscode-3d-marketplace-publish-ready.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `packages/vscode-3d/PUBLISHING.md` (whole file)

~~~~markdown
# Publishing three.ws 3D

How to release `threews.vscode-3d` to the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode) and to
[Open VSX](https://open-vsx.org) (the registry VSCodium, Cursor, Windsurf,
Gitpod and other VS Code forks install from). Official references:
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
and the [Open VSX publishing guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

This file is excluded from the `.vsix` by `.vscodeignore`.

## Where things stand

- **Publisher identity is resolved.** `package.json` declares
  `"publisher": "threews"`. That publisher already exists on the Visual Studio
  Marketplace (display name "three.ws", verified, with another three.ws
  extension live under it), so no new publisher has to be created. The
  `threews` namespace also already exists on Open VSX.
- **The package is ready.** `npm run package` builds a production bundle and
  writes `vscode-3d-0.2.0.vsix`: 15 files, about 694 KB. It has been installed
  into a real VS Code 1.138.0 server build with
  `code-server --install-extension`, and `--list-extensions` reports
  `threews.vscode-3d@0.2.0`.
- **What only the owner has:** a Marketplace token for the `threews` publisher
  and an Open VSX token for the `threews` namespace. Neither is stored on this
  machine.

## 0. Preflight (one minute)

```bash
cd packages/vscode-3d
npm ci
npm test                      # 71 tests, must all pass
npm run package               # builds and writes vscode-3d-<version>.vsix
npx --yes @vscode/vsce ls --no-dependencies   # the exact file list that ships
```

The list must be `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`,
`dist/extension.cjs`, `media/icon.png`, `media/cube.svg`, `media/viewer.css`,
`media/viewer.js`, and the four decoder files under `media/vendor/`. Anything
else (sources, tests, source maps, `node_modules`) means `.vscodeignore` has
regressed. Delete the `.vsix` afterwards; it is gitignored and never committed.

Marketplace rules the package already satisfies, worth keeping when editing:
the icon is a 128x128 PNG (SVG icons are rejected), the README uses only
absolute `https` links and no SVG images, `repository`, `bugs`, `homepage`,
`license`, `pricing`, `galleryBanner`, `categories` and `keywords` are set, and
`engines.vscode` matches `@types/vscode`. A version can be published only once:
bump `version` in `package.json` and add a `CHANGELOG.md` section for every
release after 0.2.0.

## 1. Visual Studio Marketplace

### 1a. Get access to the `threews` publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with the Microsoft
   account that owns the `threews` publisher. If you are a different account,
   the owner adds you under **threews > Members** with the **Contributor** role.
2. Only if the publisher were ever missing: **Create publisher** on the same
   page, ID `threews`, name `three.ws`. The ID must equal the `publisher` field.

### 1b. Create a Personal Access Token

1. Open <https://dev.azure.com>. Any Azure DevOps organization under the same
   Microsoft account works; create one if the account has none.
2. User settings (top right) > **Personal access tokens** > **New Token**.
3. **Organization: All accessible organizations.** A token scoped to one
   organization fails with a 401 at publish time.
4. **Scopes: Custom defined > Show all scopes > Marketplace > Manage.**
5. Pick an expiry, create, and copy the token.

### 1c. Log in and publish

```bash
cd packages/vscode-3d
npx --yes @vscode/vsce login threews        # paste the token when prompted
npx --yes @vscode/vsce verify-pat threews   # optional sanity check
npm run publish:marketplace
```

`publish:marketplace` runs `vsce publish --no-dependencies`, which runs the
production build (`vscode:prepublish`), packages, and uploads. The bundles
already contain every runtime dependency, so `--no-dependencies` is correct.

Non-interactive alternative: `VSCE_PAT=<token> npm run publish:marketplace`.
If the account signs in through Microsoft Entra ID instead of a token:
`az login`, then `npx --yes @vscode/vsce publish --no-dependencies --azure-credential`.

## 2. Open VSX (free second listing)

1. Sign in at <https://open-vsx.org> with the GitHub account that is a member of
   the `threews` namespace (the account that published the existing three.ws
   extension there). The Eclipse Foundation publisher agreement must be signed
   under **Settings**; it already is if that account published before.
2. **Settings > Access Tokens > Generate New Token**, copy it.
3. Publish:

```bash
cd packages/vscode-3d
OVSX_PAT=<token> npm run publish:openvsx
```

`publish:openvsx` runs `ovsx publish --no-dependencies`, which builds and
packages the same way. To upload the exact file already published to the
Marketplace instead: `npx --yes ovsx publish vscode-3d-0.2.0.vsix -p <token>`.

The namespace is currently unverified on Open VSX, so the listing shows a
warning badge. To remove it, claim the namespace by opening an issue at
<https://github.com/EclipseFdn/open-vsx.org/issues> (template "Claim namespace
ownership"). This is optional and does not block publishing.

## 3. Verify the release

Marketplace listings pass an automated scan first, usually within a few
minutes, before the page and install work.

```bash
# Marketplace: the gallery API returns the published version
curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json;api-version=7.2-preview.1' \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"threews.vscode-3d"}]}],"flags":1}' \
  | grep -o '"version":"[^"]*"' | head -1

# Open VSX: the registry API returns the published version
curl -s https://open-vsx.org/api/threews/vscode-3d | grep -o '"version":"[^"]*"'

# A real install into a clean profile
code --user-data-dir /tmp/vsc3d-profile --extensions-dir /tmp/vsc3d-ext \
  --install-extension threews.vscode-3d
code --user-data-dir /tmp/vsc3d-profile --extensions-dir /tmp/vsc3d-ext \
  --list-extensions --show-versions
```

Then check by hand:

1. <https://marketplace.visualstudio.com/items?itemName=threews.vscode-3d>
   shows the icon, the dark banner, the README with working links, and the
   changelog tab.
2. <https://open-vsx.org/extension/threews/vscode-3d> shows the same.
3. In VS Code, open any `.glb` (for example a model from
   <https://three.ws>): it renders in the **three.ws 3D Viewer** tab, the
   **three.ws 3D** activity bar icon lists workspace models, and
   **3D: Generate a Model from Text** returns a model.

## 4. After the first publish

- In `docs/vscode.md`, replace the "not on the Marketplace yet" install section
  with the Marketplace and Open VSX install, matching this package's README.
- Add a `data/changelog.json` entry announcing the listing (tags `feature`,
  `sdk`) and run `npm run build:pages` from the repository root.
- Set the "VS Code Marketplace: three.ws 3D" row in
  `marketing/growth/opportunities.csv` to `live`, with the listing URL as
  evidence.
~~~~

