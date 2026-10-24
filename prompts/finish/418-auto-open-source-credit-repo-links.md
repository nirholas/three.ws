# 418. Fix 17 "Source" links on /open-source that point at three.ws 404s instead of GitHub

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: the failure is reproduced below. Confirm it fails for the stated reason, fix it, confirm green, commit test and fix together.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- No em-dash/en-dash anywhere you write.

## Step 0: re-derive the current state

    node -e "
    const { buildCredits } = require('./scripts/lib/open-source-credits.mjs');
    " 2>&1 | head -5

That direct require fails because the module is ESM; use the project's own test instead, which already re-derives the same data:

    npx vitest run tests/open-source-credits.test.js

Then confirm the live bug with a one-off script:

    node -e "
    import('./scripts/lib/open-source-credits.mjs').then(({ buildCredits }) => {
      const bad = buildCredits().entries.filter(e => e.repo && !/^https?:\/\//.test(e.repo));
      console.log(bad.length, 'entries with a non-http(s) repo field');
      for (const b of bad) console.log(' ', b.id, '->', JSON.stringify(b.repo));
    });
    "

As measured 2026-10-24, this prints 17 entries, including:

    npm:ajv -> "ajv-validator/ajv"
    npm:express -> "expressjs/express"
    npm:jose -> "panva/jose"
    npm:p-limit -> "sindresorhus/p-limit"
    npm:@sparkjsdev/spark -> "sparkjsdev/spark"
    npm:nanoid -> "ai/nanoid"
    npm:@upstash/redis -> "git@github.com:upstash/redis-js"
    npm:glob -> "git@github.com:isaacs/node-glob"
    npm:@kamino-finance/klend-sdk -> "github.com:Kamino-Finance/klend-sdk"
    npm:lru-cache -> "ssh://git@github.com/isaacs/node-lru-cache"

`src/open-source.js` line 25 renders this field verbatim: `<a href="${escapeHtml(entry.repo)}" rel="noopener" target="_blank">Source</a>`. A browser resolves `"ajv-validator/ajv"` as relative to the current page (`https://three.ws/open-source` + `ajv-validator/ajv` -> `https://three.ws/ajv-validator/ajv`, which 404s on three.ws) instead of opening the GitHub repo; `git@github.com:...` and `ssh://git@github.com/...` are not `http(s)` URLs at all and a browser click does nothing or errors. This is exactly the set of paths the 2026-10-24 authenticated page-audit crawler found and listed under "Crawl-discovered routes (linked on the site, missing from data/pages.json)" in `reports/page-audit-2026-10-24T01-31-13-697Z.md` (e.g. `/ajv-validator/ajv`, `/expressjs/express`, `/expressjs/compression`, `/panva/jose`, `/sindresorhus/p-limit`, `/sparkjsdev/spark`, `/ai/nanoid`, `/git@github.com:isaacs/node-glob`, and five more `git@github.com:...` entries). **Do not "fix" this by adding those paths to `data/pages.json`**; they were never meant to be three.ws routes, they are supposed to leave the site entirely and land on GitHub. The crawler surfacing them as "missing routes" is a side effect of the real bug, not the bug itself.

If step 0's count is 0 by the time you run this (another agent already shipped a fix), run `git log --oneline -5 -- scripts/lib/open-source-credits.mjs` to find it, confirm `normalizeRepoUrl()` now handles the shapes below, and retire this order per the "Never blocked" table.

## Root cause

`normalizeRepoUrl()` in `scripts/lib/open-source-credits.mjs` (lines 569-576) normalizes a `package.json` `repository` field's `git+https://`, trailing `.git`, `git://`, and `github:` shorthand forms, but misses four shapes real npm packages in this dependency tree actually use:

1. Bare `"owner/repo"` shorthand, no scheme at all (the npm `repository` field spec explicitly allows this): `ajv-validator/ajv`, `expressjs/express`, `expressjs/compression`, `panva/jose`, `sindresorhus/p-limit`, `sparkjsdev/spark`, `ai/nanoid`.
2. SSH shorthand `git@github.com:owner/repo`: `isaacs/node-glob`, `upstash/redis-js`, `rvagg/cborg`, `livekit/client-sdk-js`, `solana-foundation/solana-attestation-service`, `ethereum-attestation-service/eas-sdk`, `indutny/bn.js`.
3. Scheme-less host form `github.com:owner/repo` (no `git@`, no `https://`): `Kamino-Finance/klend-sdk`.
4. Explicit `ssh://git@github.com/owner/repo`: `isaacs/node-lru-cache`.

`buildCredits()`'s npm-entry path (`npmEntries()`, line 535) calls `normalizeRepoUrl(repo)` on every dependency's raw `package.json` `repository` field, so any shape it does not handle flows straight through to the committed `data/open-source-credits.json` and then to the rendered `<a href>` unchanged.

## Task

1. Open `scripts/lib/open-source-credits.mjs` and extend `normalizeRepoUrl()` (lines 569-576) to also handle the four shapes above, converting each to a canonical `https://github.com/<owner>/<repo>` (or the correct host for a non-GitHub case, if one ever appears; everything found 2026-10-24 is GitHub). Suggested order of transforms, applied before the existing ones so they compose:
   - Strip a leading `git+` and a trailing `.git` (already done).
   - `git@github.com:owner/repo` -> `https://github.com/owner/repo` (match `^git@([^:]+):(.+)$` -> `https://$1/$2`, generalizes past GitHub for free).
   - `ssh://git@host/owner/repo` -> `https://host/owner/repo` (match `^ssh:\/\/git@([^/]+)\/(.+)$` -> `https://$1/$2`).
   - `host:owner/repo` with no scheme and a `.`-containing host (e.g. `github.com:Kamino-Finance/klend-sdk`) -> `https://host/owner/repo`. Be careful not to misfire on an already-bare `owner/repo` shorthand (no dot in the first segment): only treat the part before the first `:` as a host if it contains a `.`.
   - Bare `owner/repo` (no scheme, no colon, exactly one `/`, no spaces) -> `https://github.com/owner/repo`. This is the npm-spec shorthand and always means GitHub.
   - Run the existing `github:` shorthand and `git://` transforms last (unchanged).
2. Also defensively guard the renderer, since a future dependency could ship a repository field in some fifth shape nobody has hit yet, and a renderer should never emit a link it knows cannot work: in `src/open-source.js`, before pushing the "Source" link (line 25), confirm `entry.repo` matches `/^https?:\/\//`; if a value somehow still does not (future-proofing, not expected to trigger today once step 1 lands), omit the link rather than render a broken one, mirroring how line 26's `funding` link is already conditionally omitted when absent.
3. Add unit tests in `tests/open-source-credits.test.js` (or a new `tests/open-source-credits-repo-url.test.js` if cleaner, following the existing file's import style: `import { buildCredits, AREAS, ROOT } from '../scripts/lib/open-source-credits.mjs'`) covering all four input shapes from Root cause, each asserting the exact expected `https://github.com/owner/repo` output. If `normalizeRepoUrl` is not currently exported, export it (additive change, no behavior change) so it can be tested directly instead of only indirectly through `buildCredits()`.
4. Regenerate the committed data file so it matches the fixed generator (the existing test deep-equals `buildCredits()` against this file, so it must be regenerated, not hand-edited):

       node scripts/build-open-source-credits.mjs

5. Re-run the step-0 one-off script; confirm it now prints `0 entries with a non-http(s) repo field`.

## Done when

- The step-0 one-off script prints `0 entries with a non-http(s) repo field`.
- `npx vitest run tests/open-source-credits.test.js` passes (including new coverage for all four shapes).
- `npm run test:core` shows no new failures versus the pre-change baseline.
- `git diff` touches only: `scripts/lib/open-source-credits.mjs`, `src/open-source.js`, `data/open-source-credits.json` (regenerated), and the test file(s).
- Committed on `evolve` with an explicit-path commit naming the fix.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Tempted to fix this by adding `/ajv-validator/ajv` etc. to `data/pages.json` since the audit report lists them under "crawl-discovered routes" | Those paths are not supposed to exist on three.ws at all; they are a symptom of the broken link, not a missing page | Fix `normalizeRepoUrl()` so the link never points at three.ws in the first place; do not touch `data/pages.json` for this order |
| Count is already 0 when you check | Another agent may have shipped this | Confirm via `git log --oneline -5 -- scripts/lib/open-source-credits.mjs`, verify `normalizeRepoUrl()` now covers all four shapes, retire this order without further changes |
| `data/open-source-credits.json` is described as "never hand-edited" | That is about avoiding drift between the generator and the committed file, not a reason to skip regenerating it after a real generator fix | Run `node scripts/build-open-source-credits.mjs` after fixing the generator, same as any dependency-version bump would require |
| New dependencies show up in `package.json` between when this order was written and run, changing the exact 17-entry list | The list is illustrative, not load-bearing; the fix is generic (handles the shape, not the specific package names) | Re-run step 0 fresh and fix whatever non-http(s) shapes the current dependency tree actually has |

## Report format

State: the step-0 "before" count and entries, the diff for `normalizeRepoUrl()` and `src/open-source.js`, the new test file/cases and their passing output, the regenerated `data/open-source-credits.json` diff summary (entry count changed, if any), the step-0 "after" count (must be 0), the `npm run test:core` before/after failure counts, and the commit SHA.
