# Restore the 85-language picker by closing the missing keys, draining the lint backlog and republishing the locale manifest

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/262-plan-i18n-restore-language-picker-manifest.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 78 of 100 inside the tier). **Area:** i18n. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`public/locales/manifest.json` (served at https://three.ws/locales/manifest.json) lists only English since commit `04e298db6` (2026-10-12), because `writeManifest()` in `scripts/i18n-translate.mjs` holds back any locale with missing keys (the dry-run says "1 locale(s) listed, 84 held back until complete"). Flattened, `en.json` has 25147 leaf keys (25139 by an earlier count) while the other locale files have about 24524, so roughly 623 newer keys are untranslated almost everywhere (es is behind by 379), and the language switcher shows nothing to switch to in production while the changelog advertises 69 and 85 languages. Separately, `node scripts/i18n-translate.mjs --lint` has been reported failing with 52,331 problems across the locale files (missing keys, markup and placeholder mismatches, untranslated copy), so users in those languages see English fallbacks or raw keys on partly translated pages, and the repo gate cannot be turned on while the lint is red, so every new page can add drift unnoticed. This is a shipped feature that is effectively off.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `public/locales/` holds 87 files (86 locales plus `manifest.json`); the source is `public/locales/en.json` (the script header and some docs say `locales/en.json`, but no such top-level directory exists). The manifest lists only `en`.
- Counting counts matters. `en.json` has 710 top-level sections, which is what a naive `Object.keys` count shows, but 25147 flattened leaf keys. A naive top-level comparison shows es/fr/ja/de with 0 empty values, 0 values identical to English and only 2 to 4 absent sections, which looks like the dry-run's 623 is a lint artefact. The flattened comparison (re-run 2026-11-03) shows fr/ja/de at 24524 leaf keys (623 missing) and es at 24768 (379 missing, plus 158 empty values per an earlier measurement). So the 623 are real missing leaf keys, not a lint false positive. Step 0 re-derives this so the executor does not repeat the confusion.
- `writeManifest()` at about line 1001 of `scripts/i18n-translate.mjs` withholds a locale when `missingKeys(source, locale).length > 0`; `untranslatedCount` lives in `scripts/lib/i18n-shared.mjs`.
- Provider default is Vertex (pre-approved GCP spend, `--concurrency=8`, `--split-token=3600`); alternatives are gemini, openai, anthropic and the `threews` proxy. Vertex was blocked by a billing hold (OWNER-ACTIONS row 20, `Lightning dunning decision is deny`) and OpenAI billing is inactive (docs/ops/ISSUES.md items 1 and 4); re-check, and pick a working backend at run time. A past incident: a revoked ADC wrote English passthrough into `ar.json`; the script now fails closed.
- Scripts: `i18n:translate`, `i18n:extract`, `i18n:lint`, `i18n:repair`, `i18n:prune`, `i18n:backfill`; queue helper `scripts/i18n-generate-queue.sh`.
- Tests exist: `tests/i18n-missing-key.test.js`, `i18n-backfill`, `i18n-idempotent-writes`, `i18n-markup`, `i18n-annotate`, `i18n-localized-pages`.
- `public/locales/localized-pages.json` may be modified in the working tree by another agent; do not clobber it.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
curl -s https://three.ws/locales/manifest.json | head -c 400
node -e "
const fs=require('fs');
const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,p+k+'.'):[[p+k,v]]);
const en=new Map(flat(JSON.parse(fs.readFileSync('public/locales/en.json'))));
console.log('en leaf keys',en.size,'top-level',Object.keys(JSON.parse(fs.readFileSync('public/locales/en.json'))).length);
for(const f of fs.readdirSync('public/locales').filter(f=>f.endsWith('.json')&&f!=='en.json'&&f!=='manifest.json'&&f!=='localized-pages.json')){const l=new Map(flat(JSON.parse(fs.readFileSync('public/locales/'+f))));const m=[...en.keys()].filter(k=>!l.has(k)||l.get(k)==='').length;if(m)console.log(f,m)}" | head -100
timeout 300 node scripts/i18n-translate.mjs --dry-run 2>&1 | tail -5
node scripts/i18n-translate.mjs --lint 2>&1 | tail -3
node scripts/i18n-translate.mjs --lint 2>&1 | grep -oE "^. \[[a-zA-Z_-]+\]" | sort | uniq -c | sort -rn | head -30
node scripts/i18n-translate.mjs --help 2>&1 | head -30
sed -n 960,1040p scripts/i18n-translate.mjs
gcloud auth print-access-token >/dev/null && echo gcp-auth-ok
```

Write the reconciliation (naive top-level count versus flattened leaf count versus dry-run 623 versus lint problem count) into the report. If the lint count differs from 52,331, use the measured one.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first: add `tests/i18n-manifest-publish.test.js` that builds a manifest from fixture locale dirs and asserts (a) complete locales are listed, (b) a locale with missing keys is held back, (c) a locale at or above a configurable threshold (default 100 percent) is listed. Confirm any threshold case you add fails on the current behavior.
2. Break the lint problems down by locale and key family; separate "missing key" from "markup mismatch", "placeholder mismatch" and "untranslated copy". Fix any lint rule false positives in the script first, test-first in `tests/i18n-missing-key.test.js` (for example locales the product deliberately does not ship, or keys that are intentionally English-only brand names); record the allowlist, with a reason per entry, in a data file, not inline.
3. Run `npm run i18n:extract` so `en.json` is the source of truth. Probe backends in turn with one real key (vertex first, then gemini, `threews`, anthropic; use `--provider=gemini` with `GOOGLE_API_KEY` from the service env if Vertex is billing-blocked) and run `npm run i18n:translate` in resumable shards (`--locales=es,fr,...`, `--concurrency=8`, lower on 429, backoff) to fill the missing keys and empty values. Never hand-write or machine-fake translations and never accept English passthrough. Keep proper nouns (three.ws, $THREE, product names) and placeholders intact per the lint rules.
4. Run `npm run i18n:repair` and `npm run i18n:lint` until `--lint` exits 0 with no problems; also run `--prune`. Never commit a locale whose lint fails. Commit locale JSON in topical batches, not one sweep.
5. Ensure the pipeline cannot silently regress: add a `check:i18n-parity` script (or extend `i18n:lint`) that fails when any shipped locale is more than N keys behind `en.json`. Add it to the gate list in `package.json` or `npm run check:rules`/the pre-push hook only if it runs in under 60 seconds; otherwise expose it as `npm run check:i18n` and note it in `docs/i18n.md`.
6. Regenerate `public/locales/manifest.json` and verify every previously advertised locale is present and no locale is held back. Spot check that RTL languages (ar, he, fa, ur) set `dir` correctly in the picker.
7. Verify in a real browser: open `/`, `/irl`, `/pricing` and `/workbench`, open the language switcher, confirm all locales listed, pick `es`, `ja`, `ar` (and use `?lang=`), confirm text and direction change, no raw `section.key` strings, no layout overflow, no console errors, and that a key added later falls back to English instead of showing the key.
8. Run `node --test tests/i18n-*.test.js`. Update `docs/i18n.md` (counts, parity check, repair workflow, backend probe order), add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The Step 0 leaf-key snippet prints nothing (no locale behind `en.json`).
- [ ] `node scripts/i18n-translate.mjs --dry-run` ends with 0 keys to translate and the manifest line has no held-back locales.
- [ ] `node -e "console.log(require('./public/locales/manifest.json').locales.length)"` prints a count equal to the number of locale files other than `manifest.json` and `localized-pages.json`.
- [ ] `node scripts/i18n-translate.mjs --lint` and `npm run i18n:lint` exit 0 and print no problems.
- [ ] `npx vitest run tests/i18n-manifest-publish.test.js` and `node --test tests/i18n-*.test.js` pass.
- [ ] Browser check recorded: the switcher lists all locales on a built page, `ar` renders RTL, and three locales (RTL, CJK, Latin) show no raw keys or overflow.
- [ ] The report states the reconciliation of 623 versus the top-level count versus the lint total.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex 403/429 or billing hold, OpenAI inactive | Lower `--concurrency`, retry with backoff; Vertex spend is pre-approved. Fall back to gemini (`GOOGLE_API_KEY` from the service env), `threews` or anthropic; probe each with one key first; report the hold |
| Rate limits mid-run | The script is resumable and re-runs only translate missing keys; shard with `--locales=` and continue per locale |
| A few keys fail lint after translation | Run `npm run i18n:repair`; hand-fix remaining placeholders only; never hand-edit around the glossary lock |
| A key is untranslatable (brand, code) | Add it to the data-file allowlist with a reason |
| Manifest only updates on deploy | Commit the regenerated file; production pickup is the routine deploy gate |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/262-plan-i18n-restore-language-picker-manifest.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `262-plan-i18n-restore-language-picker-manifest.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `scripts/i18n-translate.mjs`.

### `docs/i18n.md` (whole file)

~~~~markdown
# Internationalization (i18n)

three.ws localizes its UI the way [LobeHub](https://github.com/lobehub/lobe-cli-toolbox/tree/master/packages/lobe-i18n)
does: a single source-of-truth catalog is translated **incrementally by an LLM**,
the output is **committed as static JSON**, and the browser **swaps copy at
runtime** from those static files. There is no per-request translation call, no
runtime cost, and full SEO/caching of each locale's JSON.

The one difference from LobeHub: their copy was already keyed (greenfield
i18next). Ours lives inline in 600+ static HTML pages, so we add an **extraction**
step that derives the catalog from annotated markup.

```
i18n:annotate ──▶ i18n:extract ──▶ public/locales/en.json ──▶ i18n:translate ──▶ public/locales/<lang>.json
 (auto data-i18n)     (build)        (source of truth)        (LLM, glossary-locked)    (committed, static)
        │                                                                                      │
   or hand-annotate                                                              runtime: /i18n.js swaps the DOM
```

## 1. Annotate copy

You almost never do this by hand. `npm run i18n:annotate` scans static HTML and
injects the right `data-i18n*` attribute on every user-visible copy element, so
a whole page becomes translatable in one command.

```bash
npm run i18n:annotate -- --pages="pages/pricing.html"          # dry-run, preview keys
npm run i18n:annotate -- --pages="pages/pricing.html" --apply  # write attrs + wire /i18n.js
npm run i18n:annotate -- --apply                               # every htmlExtract entry
```

The annotator ([`scripts/i18n-annotate.mjs`](../scripts/i18n-annotate.mjs)) is
built to be safe on hand-authored HTML:

- **Byte-surgical.** It parses only to locate elements (via node-html-parser
  source offsets) and splices ` data-i18n="…"` into the original string.
  Untouched bytes are preserved exactly (no whole-file reserialization), so
  diffs are minimal and reviewable, and stripping the inserted attributes
  reproduces the original file byte-for-byte.
- **Idempotent.** An element that already carries an annotation is left alone;
  re-runs only pick up newly-added copy.
- **Conservative.** Only leaf copy elements with real letters are touched.
  `script`/`style`/`svg`/`pre`/`code`/`template`/`textarea`, dynamic
  `{{…}}`/`${…}` copy, `translate="no"` / `data-no-i18n` opt-outs, and anything
  nested inside an element it already chose are skipped. `<title>`, meta
  description, and og/twitter tags are annotated too.
- **Self-wiring.** With `--apply` it also injects `<script type="module"
  src="/i18n.js">` if the page lacks it, and the runtime then auto-mounts a
  floating `<lang-switcher>` on any page that doesn't place its own, so a
  freshly-annotated page gets a working language picker with zero layout edits.

Keys are namespaced by page (`pricing.plans_h`, `what_is.hero`). To annotate by
hand, or to understand what the tool emits, the attributes are:

| Attribute                     | Applies to                            | Example                                                                  |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `data-i18n="key"`             | `textContent`                         | `<span data-i18n="common.take_tour">Take the tour</span>`                |
| `data-i18n-html="key"`        | `innerHTML` (copy with inline markup) | `<li data-i18n-html="home.bullet_earn"><strong>Earn</strong> USDC…</li>` |
| `data-i18n-attr="attr:key;…"` | element attributes                    | `<meta data-i18n-attr="content:home.meta_desc" content="…">`             |

Keys are dot-namespaced (`home.hero_h`, `common.language`). Group by surface.

## 2. Extract the source catalog

```bash
npm run i18n:extract          # scan annotated HTML → public/locales/en.json
npm run i18n:extract -- --force   # overwrite values from current HTML (after copy edits)
npm run i18n:extract -- --prune   # drop keys no element references anymore
```

Existing values are preserved by default, so re-running never clobbers a reviewed
string. Collisions (same key, different English in two files) fail the command.

### Copy that JS builds, not markup

The extractor reads `data-i18n` attributes, so it sees every static page and none
of the copy a module assembles at runtime. That gap is real: the connected-home
lane renders its rooms, its devices, its refusals, its confirmation and every
spoken announcement from live data, and none of it has markup to annotate. Those
call sites go through a tiny bridge instead
([`src/home/i18n-home.js`](../src/home/i18n-home.js)), where the English argument
IS the source value, exactly as an element's own text is for an annotated tag:

```js
import { plural, t } from './i18n-home.js';

t('home_floorplan.saved_title', 'Floorplan saved');
plural('home_floorplan.loose_count', n, '{{count}} device not in a room', '{{count}} devices not in a room');
```

`npm run i18n:home` ([`scripts/i18n-home-keys.mjs`](../scripts/i18n-home-keys.mjs))
reads those call sites and reports the difference against `en.json`; `--write`
applies it. Run it after adding a string, before `i18n:translate`, or the key
never reaches a translator:

```bash
npm run i18n:home             # report drift, exit 1 if any
npm run i18n:home -- --write  # add and update keys in en.json
```

**User data is never part of a source string.** A room name, an area name, a
scene name, a device name, an address somebody pasted and a message their own
Home Assistant returned are their words, not ours. They are passed as
interpolated values, which the masker already protects byte for byte:

```js
t('home_floorplan.filed_title', '{{device}} is in {{room}} now', { device: entityId, room: nameOf(areaId) });
```

and never as `` t('...', `${entityId} is in ${nameOf(areaId)} now`) ``, which
would put somebody's "Nursery" into the source catalog and hand it back to them
machine-translated. `i18n:home` refuses any source value that interpolates a
template expression, so the rule is mechanical rather than remembered.

Two things do **not** belong in the catalog at all. Relative times
(`relativeAge` in the same bridge) go through `Intl.RelativeTimeFormat`, and
numbers through `Intl.NumberFormat`, because an English `s` appended in code is
the wrong plural in most of these languages and several need forms English has
no word for. The browser already ships every rule.

## 3. Translate

```bash
npm run i18n:translate                     # translate only missing keys, every locale (incremental)
npm run i18n:translate -- --locale=es      # one locale
npm run i18n:translate -- --force          # retranslate everything
npm run i18n:translate -- --dry-run        # show what would translate (also refreshes manifest)
npm run i18n:translate -- --concurrency=8  # widen the chunk pool for a bulk run
npm run i18n:translate -- --split-token=3600 # bigger chunks, fewer requests
npm run i18n                               # extract + translate
```

Configuration lives in [`.i18nrc.json`](../.i18nrc.json) (schema:
[`scripts/i18n-rc.schema.json`](../scripts/i18n-rc.schema.json)). Backend is
selected by `provider`, overridable per run with `--provider=` / `--model=`.
Env-var names match [`api/_lib/chat-models.js`](../api/_lib/chat-models.js), so a
key that already powers `/chat` works here too. `.env` and `.env.local` are read
automatically - an exported variable still wins, so a one-off
`GEMINI_API_KEY=… npm run i18n:translate` overrides the file.

`--split-token=` overrides the chunk budget for one run. It is the only lever
that changes the **request** count for a fixed amount of text, which matters
because the free lanes meter requests per day, not tokens: doubling the budget
halves the requests and leaves the token spend unchanged. A 668-key backlog
across 84 locales is ~840 requests at the committed budget and ~570 at
`--split-token=3600`, against a free-tier ceiling of 1000 requests/day. Raise it
on a lane whose model holds a long JSON reply together; leave it alone on the
weak free models, where small chunks truncate less.

| provider           | free?   | credentials                            | notes                                                       |
| ------------------ | ------- | -------------------------------------- | ----------------------------------------------------------- |
| `vertex` (default) | credits | `GOOGLE_CLOUD_PROJECT` + GCP auth      | billed to the platform's GCP credits; no free-tier quota wall |
| `gemini`           | ✅ free | `GEMINI_API_KEY` / `GOOGLE_API_KEY`    | <https://aistudio.google.com/apikey> - free tier, best CJK  |
| `groq`             | ✅ free | `GROQ_API_KEY`                         | <https://console.groq.com/keys> - fast; the script defaults to `qwen/qwen3.8-27b` (the model `/chat` uses on this lane since Groq retired `llama-3.3-70b-versatile` in August 2026); pass `--model=` to override |
| `openrouter`       | ✅ free | `OPENROUTER_API_KEY`                   | <https://openrouter.ai/keys> - use a `:free` model          |
| `nvidia`           | ✅ free | `NVIDIA_API_KEY`                       | <https://build.nvidia.com> - free NIM credits               |
| `openai`           | paid    | `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`) | any OpenAI-compatible endpoint                              |
| `anthropic`        | paid    | `ANTHROPIC_API_KEY`                    | Claude Messages API                                         |

Vertex takes GCP credentials three ways, in order: `GCP_SERVICE_ACCOUNT_JSON`,
the Cloud Run / GCE metadata server, then the `gcloud` CLI. On a developer
machine the first two are absent, so an authenticated `gcloud auth login` is all
it needs. If none of the three resolve, the run **aborts** rather than degrading
(see *Never silently English* below).

An `OPENROUTER_API_KEY` in the environment is automatically added as a failover
rung behind whichever provider is primary, so a single 429 wall does not end a run.

Leave `modelName` unset to use the provider's default model, or pin one (e.g.
`"modelName": "meta-llama/llama-3.3-70b-instruct:free"` for OpenRouter). Free
tiers rate-limit, so `concurrency` defaults to `2` and the translator backs off
and retries on HTTP 429 (honoring `Retry-After`). A Vertex run billed to our own
project has far more headroom - pass `--concurrency=8` for a bulk job like
generating a locale from scratch (~550 chunks) instead of editing the config
every other lane shares.

### Never silently English

When a translation call fails, the pipeline bakes the English source into the
key so the catalog stays complete and the runtime degrades gracefully. That is
right for the occasional value a model can't render as valid JSON, and very
wrong for a missing credential, which fails **identically on every key**: the run
would march through the whole catalog rewriting it into English and exit 0, with
lint green and the language still offered in the picker. So a credential/config
error is classified separately - it is never retried, never baked, and aborts the
run with the one line that says what to fix. Everything already translated is
kept (the pipeline persists after each chunk) and a re-run resumes.

A spent balance counts as one of these. HTTP **402** joins 401 and 403 in that
classifier because a funded key with no credits left answers `402 Insufficient
credits` to every single call: not a config error, not an auth rejection, and so
for a while not fatal either. The run treated it as a value the model could not
render, halved the chunk, halved it again, and baked English onto each lone key.
It cost 198 Spanish keys before anyone noticed, because the run exited 0. A
payment wall is a property of the account, never of the string, so splitting and
retrying cannot change the answer.

When a run does abort on credentials, read the status before assuming the key is
wrong. `vertex 403: Lightning dunning decision is deny for project` is Google
billing enforcement against the whole GCP project, so every Vertex model in every
region returns it and no amount of re-authenticating helps; the fix is on the
billing account. `402` is the balance. `401` really is the credential.

Two more failures abort rather than degrade, and both cost a catalog before they
did. A GCP credential that exists but no longer refreshes (this workspace's
Application Default Credentials, once its refresh token was revoked) used to
escape the Vertex token path as an ordinary error and route every key into the
English fallback; it is now a config error that names both the credential's
reason and `gcloud`'s. And a 5xx that outlives its whole backoff budget is
treated exactly like a 429 that does: a gateway that is down is a property of the
backend, not of the string being translated, and no amount of halving the chunk
brings it back. On 2026-09-09 the `threews` proxy answered
`502 {"error":"upstream_error","status":403}` and then
`503 {"error":"provider_unavailable"}` on every request because its own free-tier
chain was exhausted, and the run walked an entire Arabic catalog baking English
one key at a time, printing a warning per key, heading for exit 0.

`i18n:backfill` (below) exists to clean up catalogs damaged by this before the
guard existed.

> **Quality note:** the Groq lane is fast and solid for Latin-script languages. For
> CJK/Arabic/Hindi, Gemini (free tier or Vertex) is noticeably better - switch per
> run with no code change. Whatever you pick, `npm run i18n:lint` catches any model
> that drops a placeholder, a glossary term, or a tag.

### Glossary lock (the important part)

Terms in `doNotTranslate` (`$THREE`, the contract address, `x402`, `USDC`,
`Solana`, `IBM watsonx.ai`, the official handles and channels such as
`@trythreews`, `t.me/three_ws`, `support@three.ws`, and so on) plus every
`{{placeholder}}`, HTML tag, and
HTML entity are **masked to opaque sentinels before the text reaches the model
and restored after**. The model literally never sees them, so they come back
byte-for-byte and can never be translated, reordered, or hallucinated around.
`$THREE` is the only coin this platform references; this guarantees no machine
translation can change that.

Entities are masked for a reason that is easy to miss. A value harvested from a
`data-i18n-html` element is **raw markup**, and the runtime puts it back through
`innerHTML`. So `&lt;` is source syntax, not typography: a model that helpfully
decodes

```html
<code>&lt;agent-3d&gt;</code>     <!-- a printed code sample -->
```

into

```html
<code><agent-3d></code>          <!-- a live custom element -->
```

has just instantiated a 3D avatar in the middle of the SDK docs and swallowed the
copy that followed. Masking makes the round trip byte-exact; the lint rule below
catches any that predate it.

## 4. Lint

```bash
npm run i18n:lint
```

Validates every **committed** locale against the source: no missing/empty keys,
no `{{placeholder}}` drift, no dropped glossary terms, no stale keys, and no
**markup drift**. Locales not yet generated are skipped (not failures). Needs no
API key, so it is safe to run anywhere, but nothing runs it for you: it is not
wired into `npm run gate` or the build, so run it yourself after touching a
catalog.

Markup drift compares the set of HTML tags in the translation against the source.
It fires when a translation grows a tag the English never had (an escaped tag that
got decoded into a live element, or one the model invented) or loses one it should
have kept. It deliberately stays quiet on cosmetic entities: `&amp;`, `&mdash;`
and `&#39;` decode to the same glyph the reader sees either way, so flagging them
would bury the failures that actually break a page.

### Prune (drop keys the source retired)

```bash
npm run i18n:prune -- --dry-run   # report what would go, write nothing
npm run i18n:prune                # every locale
npm run i18n:prune -- --locale=de # one locale
```

Renaming or deleting a source key leaves its old translation behind in all 84
catalogs, and lint counts every copy, so one renamed key reads as 84 failures
(`stale key (not in source)`). A full `i18n:translate` run clears them as a side
effect, because `persist()` rebuilds each catalog from the source. That is the
wrong dependency for a purely subtractive fix: it puts a deletion behind a
working backend, so an exhausted quota or an expired credential leaves lint red
with no way forward. `i18n:prune` is that deletion on its own. No API key, no
network, and it only ever removes: a key the source no longer defines goes, a
namespace left empty goes with it, and everything else stays byte-identical.

It deliberately does **not** reuse `mergeOrdered`. That helper rebuilds the
catalog from the source, so it would materialize an empty string for every key
the locale has not been translated for yet. Those keys would stop reporting as
`missing` and start reporting as `empty`, and because `writeManifest` counts
empty values, every affected language would drop straight out of the picker.

### Repair (fix lint failures in place)

```bash
npm run i18n:repair                 # every locale
npm run i18n:repair -- --locale=he  # one locale
```

Glossary terms, `{{placeholders}}`, tags, and entities are masked to sentinels
the model must reproduce verbatim. A small model occasionally omits a sentinel
mid-sentence, so the term never gets restored and the key fails lint. `--repair`
re-translates **only** the lint-failing keys (dropped glossary term, placeholder
drift, or markup drift): first all of them together in normal-sized chunks, then
one at a time for whatever the batch got wrong, retrying each until it passes its
own integrity check. A key that never converges after four attempts is baked to
English (lint-clean, and the runtime already falls back to English for anything
missing). Idempotent: a clean catalog reports `nothing to repair`. Takes the same
`--provider=` / `--model=` overrides as `i18n:translate`.

The batched first pass is what makes repair finishable. One request per key is
fine for the stray sentinel drop repair was written for, but the failure that
actually fills the list is an **English string edited after the locales were
translated**: `i18n:translate` only fills keys that are missing, never keys whose
source changed under them, so the stale translation sits there until lint notices
the glossary term or the markup no longer matches. That fails the same key in
every locale at once, and 11 such keys is 924 single-key requests, more than a
free lane's entire daily budget.

### Backfill (find copy that silently stayed in English)

```bash
npm run i18n:backfill                    # report only
npm run i18n:backfill -- --apply         # re-translate every locale
npm run i18n:backfill -- --apply --locale=de
```

`i18n:translate` only fills keys that are **missing**. That interacts badly with
the English bake above: when the backend is unreachable (an expired credential, a
quota wall), whole runs bake English into the locale, and because those keys now
exist, every later run skips them. Nothing reports it. Lint stays green, the key
count is complete, and the language picker still offers the language while the
page reads as English. This is how Punjabi ended up 99.5% English while looking
fully generated.

`i18n:backfill` compares each locale against the source, clears the values that
are byte-identical to English, and re-runs the translator so they come back as
real copy. Matching English is not on its own proof of a failure, so it
only touches strings carrying **two or more real words** once glossary terms,
markup, URLs and numbers are discounted. A single word (`Avatar`, `3D`), a brand
string (`three.ws 3D API`), a version (`OpenAPI 3.1`), a copyright line, or a
fragment that is mostly markup stays identical in every language, correctly;
clearing those would burn a translation call per run to get the same bytes back. Locales are processed worst-first, and it refuses to
start while another translation run is live, since two runs rewriting the same
catalogs drop each other's keys. Only languages listed in `manifest.json` are
repaired, so a locale nobody can select yet never takes capacity from one
visitors are reading; pass `--all-locales` to include the rest.

Clearing a key is safe at every instant: the runtime resolves a missing **or**
empty value against the English catalog, so a locale mid-backfill renders exactly
what it rendered before. Progress is saved per chunk, so an interrupted run keeps
what it finished and re-running resumes.

Run it after any incident where the translation backend was down, and any time a
locale's word count looks right but the page still reads in English.

## 5. Runtime

[`src/i18n.js`](../src/i18n.js) (shipped at the stable URL `/i18n.js`) auto-runs
on any page that includes it:

```html
<script type="module" src="/i18n.js"></script>
<lang-switcher></lang-switcher>
<!-- accessible language picker -->
```

It detects the locale (`?lang=` → `localStorage` → `navigator.languages` →
default), fetches `/locales/<code>.json` once, rewrites the annotated DOM, sets
`<html lang>`/`dir` (RTL-aware), and persists the choice. Missing translations
fall back to English, so partial locales degrade gracefully. `window.threewsI18n`
exposes `{ t, setLocale, getLocale, initI18n }`.

An annotated element whose content becomes live data (a balance, a status, a
count) sets `data-i18n-owned="1"` the moment its script writes a real value into
it. The annotation still ships so the pre-render placeholder is translated, but
from then on the catalog pass skips the element: without that, the pass (which
lands after the async catalog fetch) reverted a freshly rendered value back to
its translated "Loading" placeholder.

Most writers never set that attribute, so the runtime also infers ownership on
its own (`primeOwnership` in `src/i18n.js`, run synchronously at boot). It
records what each annotated element held when it first saw it and what the
catalog pass last wrote there. If the element now holds anything else, and that
content is not its English catalog value either, the page wrote it, and the pass
leaves it alone. When the page puts the source text back (a Pause button
returning to "Play"), the next pass translates it again. Pinned by
`tests/i18n-script-ownership.test.js`.

Inference covers text a script writes into the annotated element itself. It does
not make a live value inside a `data-i18n-html` block safe: that pass rewrites
the block's innerHTML and detaches every child a script cached. Keep the label
in its own `data-i18n` element and the value as a sibling:

```html
<span class="stat"><span data-i18n="monitor.stat_agents_label">agents</span> <b id="t-agents">·</b></span>
```

The `<lang-switcher>` reads `public/locales/manifest.json`, which lists only
locales whose catalog is **complete**, so it never offers a language that would
fall back to English. Presence of the file is not enough: `writeManifest()` counts
untranslated (empty) values via `untranslatedCount()` and holds back any catalog
that still has them, reporting what it skipped:

```
• manifest: 48 locale(s) listed, 1 held back until complete: as (3 untranslated keys)
```

So a locale that is mid-translation is simply absent from the switcher until the
run finishes, instead of shipping as a half-translated page. `i18n:translate` writes the manifest twice, before the run and again after it, so the locales a run just completed are listed by the time it exits rather than one run later.

The switcher shrinks where space is tight. Below the 640px breakpoint, or on any
page that sets a `compact` attribute on `<lang-switcher>` (a narrow HUD rail),
the control shows the locale code (`shortLocaleLabel()`: `EN`, `PT`, `ZH`) in
place of the full language name, which otherwise makes a ~170px control. The
native `<select>` still owns the interaction and keeps the full names in its
options, so the picker, keyboard and screen readers behave exactly as before; the
host also accepts a `max-width` and follows it instead of pushing its siblings
off screen.

## Adding a language

Add the code (and display name) to `outputLocales` / `localeNames` in
`.i18nrc.json` (plus `rtlLocales` for a right-to-left script), run
`npm run i18n:translate -- --locale=<code>`, review the output, and commit
`public/locales/<code>.json`. The manifest and switcher pick it up
automatically.

**Only ship a locale once its catalog is complete.** A run that dies partway
(expired credentials, an exhausted provider) still leaves a catalog file with
the full key skeleton and *empty string values* for everything it never reached.
That file looks finished by key count, and because the runtime falls back to
English per key, the page renders as a half-translated mix rather than failing
loudly. Verify before committing:

```bash
npm run i18n:translate -- --lint --locale=<code>   # flags empty values + glossary drops
node -e "const f=require('./public/locales/<code>.json'),e=require('./public/locales/en.json');
const n=o=>Object.values(o).reduce((a,s)=>a+Object.keys(s).length,0);
let m=0;for(const s of Object.values(f))for(const v of Object.values(s))if(!String(v).trim())m++;
console.log('keys',n(f),'of',n(e),'| empty',m)"
```

Re-running `i18n:translate` is the fix: `missingKeys()` treats an empty string as
untranslated, so a resumed run tops up exactly the gaps and costs nothing for the
keys already done. For a catalog that is complete but trips the
glossary/placeholder/markup lint, `npm run i18n:repair -- --locale=<code>`
re-translates only the failing keys.

Shipping is gated on completeness rather than on your memory: every run rewrites
`public/locales/manifest.json` and **omits any locale with untranslated keys**, so
a half-built catalog is never offered in the switcher. That is what makes a
from-scratch locale safe to build incrementally across several sessions.

### Building the locales that have never been generated

`outputLocales` is deliberately longer than the shipped set. To work through the
backlog:

```bash
scripts/i18n-generate-queue.sh          # every incomplete locale, 5 at a time
scripts/i18n-generate-queue.sh 3        # narrower pool
scripts/i18n-generate-queue.sh 5 "ca sr my"   # a specific list, in order
```

Each locale is ~18k keys / ~550 chunks, so this is an hours-long job, not a
minutes-long one. It picks locales **most-complete-first** (closest to shipping
ships soonest), skips any locale another process is already translating (two
writers on one catalog would lose one set of writes), and is resumable: the
translator persists after every chunk, so a killed queue loses at most one chunk.

> **Concurrent agents share this worktree.** Before starting a bulk run, check
> `ps -eo args | grep i18n-` - a locale being written by someone else's backfill
> must not also be written by you.

## SEO: hreflang alternates

Copy swaps client-side (the LobeHub model), and each locale is reachable at a
distinct URL via `?lang=<code>`, which `detectLocale()` honors. Search engines
are told those translated URLs exist two ways, both driven off the manifest so
they track annotation automatically:

1. **Sitemap alternates.** `npm run build:pages` writes
   [`public/locales/localized-pages.json`](../public/locales/localized-pages.json)
   (every registered page whose HTML carries a `data-i18n` annotation). The
   dynamic core sitemap ([`api/sitemap/[type].js`](../api/sitemap/%5Btype%5D.js))
   reads it and emits an `<xhtml:link rel="alternate" hreflang>` per locale, plus
   `x-default`, for exactly those routes.
2. **On-page alternates.** The runtime injects `<link rel="alternate"
   hreflang>` tags into `<head>` for the current path (default locale and
   `x-default` at the bare URL, others at `?lang=xx`), so a page crawled
   directly advertises its translations even without the sitemap.

`<html lang>`/`dir` are set to the active locale on every swap. A build-time
prerender that bakes each locale into static HTML (eliminating the first-paint
English flash) is the natural next step; the catalogs are static and ready.

## Tests

[`tests/i18n.test.js`](../tests/i18n.test.js) covers extraction, glossary
round-trips, lint rules, runtime resolution/fallback, and catalog merge/prune.
[`tests/i18n-markup.test.js`](../tests/i18n-markup.test.js) pins the markup
guarantees: entities survive a round trip byte-for-byte, an escaped tag that got
decoded into a live element fails lint, and cosmetic entities do not.
[`tests/i18n-backfill.test.js`](../tests/i18n-backfill.test.js) pins the rules for
clearing silently-English values out of a shipped catalog.
~~~~

### `prompts/finish/_context/production-100-OWNER-ACTIONS.md` (section "Open rows")

~~~~markdown
## Open rows (2026-10-24 (triage-lane deep sweep): row 1 re-measured, the 535-commit gap shipped and `three-ws-api` is now fully current against `threews/main` (production `660b5ad97`); row 69 added for `remesh-service` running a revision from 2026-07-16 that predates the already-shipped Blender-teardown-crash fix (`59d9aa9cd`), causing live `signal 11` crashes; a previously-unclassified `/api/chat` 503 finding (21 occurrences in 6h, traced to the vertex-gemini anchor hitting the already-tracked GCP billing hold, row 20) given a new owner-class signature (`chat-fallback-chain-exhausted-503`) and documented, fixed on `evolve` (`f6f116552`); the `x402-ring-leak-scan` cron's 100%-failure 120s timeout (missing `maxDurationMs` wiring into `wrapCron`) root-caused and fixed on `evolve` (`5814b5585`); the `forge-finalize` cron's serial-sweep timeout fixed on `evolve` (`376f160be`); `model-triposg`'s logged tracebacks confirmed to be its existing by-design opaque-error handling for caller-supplied image URLs (an expired third-party presigned URL, not a code defect), no action needed; 2026-10-23 (triage-lane deep sweep): row 1 re-measured, deploy gap escalated to 535 commits against `threews/main` (up from 2 on 2026-10-14/15, production unchanged at `45c768d07`); the `/api/chat` 503 storm traced to deploy lag already fixed on HEAD, no new row; one `investigate` finding (`/api/pump/coin` 502, pump.fun Cloudflare anti-bot challenge) given a new self-healing signature (`pump-coin-lookup-upstream-502`) and fixed on `evolve` (`72b600f1c`); rows 2, 3, 4, 5, 6, 19, 23, 24, 36 and 47 re-confirmed unchanged; 2026-10-15 (triage-lane deep sweep, second pass): row 1 re-measured, deploy gap still 2 commits against `threews/main`, unchanged from 2026-10-14; two `investigate` findings reclassified into `KNOWN_SIGNATURES` and fixed on `evolve` (NVIDIA NVCF text-to-3d flakiness folded into the existing `three-ws-ai-providers-unavailable-5xx` signature, and a new self-healing `pump-trending-upstreams-502` signature for a confirmed transient double-upstream outage); row 63's duplicate number (PAY_VERDICT_HMAC_KEY, added same day by a concurrent agent) renumbered to 67; rows 24 and 36 re-confirmed unchanged against live `/api/healthz`; 2026-10-15 (order 522-integrate-23 close-out): row 66 added for the x402 outbound-receipts resolved-columns migration (`20261015110000_x402_outbound_resolved.sql`), not yet an active bug since zero outbound-spend rows exist today; 2026-10-15 (triage-lane deep sweep): row 65 added for the payment-session policy-upgrades migration (`20261015100000_payment_session_policy_upgrades.sql`), needed before the `655b5a491` code deploy to avoid a `42703 undefined_column` 500 on every payment-session create/execute call; row 1 re-measured, deploy gap still 2 commits against `threews/main`, unchanged from 2026-10-14; 2026-10-15 (order 518-integrate-19 close-out): row 63 added for setting a dedicated `PAY_VERDICT_HMAC_KEY` on the production Cloud Run service; not an active bug, the signed-verdict feature it covers already works today on a fallback secret, this just gives it its own rotatable key; 2026-10-14 (order 506-integrate-07 close-out): row 62 added for deploying the new `services/pump-claims` Cloud Run service and applying its `pump_fee_claims` migration to production; 2026-10-14 (order 503-integrate-04 close-out): row 61 added for pushing and archiving 7 retired repos (`three-ui`, `crypto-market-data`, `crypto-market-data-ts`, `crypto-data-aggregator`, `memescope-monday-directory`, `robinhood-chain-alert-bot`, `robinhood-chain-trading-bot`); 2026-10-14 (order 501-integrate-02 close-out): row 60 added for approving the `@nirholas/pump-sdk` bump to `^1.36.0` in `packages/avatar-agent-mcp/package.json`; 2026-10-14 (order 500-integrate-01 close-out): row 59 added for pushing every staged standalone mirror now that sync-standalone-repos.mjs stages instead of force-pushing; 2026-10-14 (order 404 second pass): correcting the 2026-10-11 entry below, the `x-mention-reply.js` `chainFor()` fix was not actually carried by merge commit `d77b89178`; checking out that commit's own `evolve` parent showed `chainFor()` still importing `resolveAgentBrain`/`modelChain` (the tool-calling chain shape, no `buildBody`), the exact bug row 34 flagged, still live. The real fix is this session's `evolve` commit `7ba9f9749` ("fix(x-mentions): give public replies a buildBody-shaped provider chain"), switching `chainFor()` to `llm.js`'s own `providerChain()` plus `loadOwnerGrokKey`/`agentDefaultModel`/`MODEL_CATALOG`; re-verified now genuinely passing with the same command the earlier entry cited (`RUN_LLM_TESTS=1 npx vitest run tests/x-mention-reply.llm.test.js`, 16/16 `source: 'model'`, no `buildBody` TypeError). Row 34's premise (the `evolve`/`main` divergence) is still correctly closed, just not for the reason originally stated; no row reopened. Order 060's matching status paragraph corrected the same way. 2026-10-13 (order 095 close-out): row 58 added for the Home Assistant integration's standalone repository, release, and the hacs/default and home-assistant/brands pull requests; 2026-10-13 (order 094 close-out): row 57 added for the WordPress.org/Framer/Webflow account signups and submissions for the three <agent-3d> site-builder embeds; 2026-10-13 (order 092 close-out): row 55 added for the VRoid Hub avatar-import OAuth app registration and migration; 2026-10-13 (triage-lane sweep, fifth pass): row 53 added for the Birdeye compute-units cap behind `pump-price-history-upstreams-502` (confirmed live, a billing/plan decision only); row 1 re-measured, deploy gap still 0 against the pushed `threews/main` ref and the 8 page-404/wrong-canonical findings this pass confirmed as deploy lag; row 47 re-measured, still a no-op (`COINGECKO_API_KEY` still absent); the previously-unclassified `/dist-lib/agent-3d.js` and `/agent-3d/latest/agent-3d.js` 500s ("Response size was too large") are the same bug row 48 already tracks, fixed on `evolve` in `f939d5ef1`, confirmed still green (`npx vitest run tests/lib-bundle-size.test.js tests/whisper-stt.test.js`, 16/16) and awaiting the pending deploy, no new row; 2026-10-13 (triage-lane sweep, fourth pass): row 1 re-measured, deploy gap still 0 against the pushed `threews/main` ref; the `ccv-ai-providers-unavailable-503` finding's Groq/OpenRouter/Vertex angles confirmed already covered by rows 6 and 20, no new row added; 2026-10-13 (order 087 close-out): row 51 added for the LiveKit and Pipecat avatar integrations, both built and verified end to end this session, with the PyPI publishes and the two upstream pull requests left as owner actions; 2026-10-13 (order 085 close-out): row 50 added for publishing the CC0 bulk animation library to production, and the Adobe Mixamo permission letter draft is ready to send as owner order 938; 2026-10-12 (order 084 close-out): row 49 added for the Tripo signed webhook's three linked steps (apply the `forge_webhook_deliveries` migration, set `TRIPO_WEBHOOK_SECRET`, register the dashboard webhook), not an active bug since the secret is unset and polling answers every Tripo job today; 2026-10-12 18:10 UTC (triage-lane sweep, third pass): row 48 added for the dist-lib CDN embed size fix (previously-unclassified `/dist-lib/agent-3d.js` 500s, root-caused and fixed on `evolve`, pure code change awaiting the next deploy); 2026-10-12 17:54 UTC (triage-lane sweep, second pass): row 1's same-day "11 behind" figure corrected to the real deploy gap of 0 (querying `/api/version` live, not `/api/healthz`, which has no commit field), row 47 added for CoinGecko's keyless tier being rate-limited (`COINGECKO_API_KEY` already absent from the service, so the finding's own pre-approved env fix is a no-op); 2026-10-12 (triage-lane sweep): row 1 re-measured against the canonical `threews` remote, 11 commits behind `main` (down from 28, local stale ref corrected), row 45 added for the HF image-provider (fal-ai/nscale) credit exhaustion, a separate pool from row 6; 2026-10-11 (best3d order 070 close-out): rows 43 and 44 added for the `model-partcrafter` and `model-holopart` first deploys; 2026-10-11 (triage-lane sweep): row 42 added for the MCP client-sessions nullable-column migration, an active production bug; row 1 re-measured, 28 commits behind `main` (up from 5); 2026-10-11 (best3d order 069 close-out): rows 40 and 41 added for the `model-rig-nonhuman` and `model-anigen` first deploys; 2026-10-11 (best3d order 068 close-out): row 39 added for the `model-pixal3d` first deploy; 2026-10-11 (best3d order 067 retry): row 38 added for the `model-trellis2` first deploy; 2026-10-11 (order 404 close-out): row 34 deleted, its premise cleared by merge commit `d77b89178` (the `evolve`/`main` reconciliation) which also carried the `x-mention-reply.js` `chainFor()` fix row 34 called out, verified live with `RUN_LLM_TESTS=1 npx vitest run tests/x-mention-reply.llm.test.js` (16/16 `source: 'model'`, no `buildBody` TypeError); 2026-10-11 (scout lane): row 36 added for the Cloudflare R2 flapping degraded/down pattern; 2026-10-11 (even later): row 24 re-measured again after order 400's ring-leak-scan tiering/lock fix shipped on `evolve`; 2026-10-11 (later): row 35 added for the agent mention-policy migration; 2026-10-11 04:16 UTC: rows 1 and 24 re-measured by the deep triage sweep; row 34 added for the evolve/main branch divergence; 2026-10-10: row 33 added for the xAI MCP e2e key; rows 1, 19 and 24 re-measured by the triage sweep; 2026-10-09: rows 1, 2 and 24 re-measured by the triage sweep, row 31 added for the GPU worker redeploy and row 32 for database table retention; row 30 added for the Grok Bot CLI setup rerun; 2026-10-08: row 26 added for the coin-gated MCP catalog regeneration; rows 1 and 2 re-measured by the triage sweep, row 24 added for the paid Solana RPC credits, row 25 added for the MCP connector OAuth deploy; 2026-09-30: row 23 added for the $THREE receiver wallets; 2026-09-29: row 19 re-measured after the agent-sniper deploy; 2026-09-09: row 19 added, and row 1 corrected because its outage premise no longer holds; rows 1, 2, 3, 9, 13, 15 and 16 re-measured 2026-09-04; the former row 18 was cleared that day and its number is not reused; the 2026-09-02 and 2026-08-09 passes are folded in below)

| # | Action | Size | Unblocks | Detail lives in |
|---|---|---|---|---|
| 1 | Approve the production deploy (or say "get production working", which is itself the approval). **The outage this row was written for is CLEARED.** Re-measured 2026-09-09 from the live origin: production serves `880bdcef8` on revision `three-ws-api-00420-ljh`, built 2026-09-08 19:05 UTC, and the `ERR_MODULE_NOT_FOUND` on `/app/services/home-relay/src/token.js` is gone: `/api/healthz` answers **HTTP 200** and `/api/home/status` and `/api/home/connections` answer 401 (auth required) rather than 500. What remains is ordinary staleness, 182 commits behind `main`, which is a routine cadence question and no longer a platform-health emergency. The 2026-09-04 text of this row, which described 96 commits and a 500ing healthz, is superseded. **Re-measured 2026-10-08 17:05 UTC:** production serves `fe2a8b24f` on `three-ws-api-00479-d7z`, **146 commits behind `main`, 90 of them fixes** (security, payouts, SSRF and XSS among them). Shipping them clears four live findings at once: the ring sweep's fee falls back to the treasury instead of the dry sponsor (`a9c996e72`, about 30 failed sweeps an hour since 2026-10-03), an EVM testnet identity-index cursor frozen since 2026-09-11 (`21fa42bb5`), two pages and their two docs pages advertised in the sitemap but answering 404 (added in `16f9d07f4`), and `/tty` holding its animation until the end for any client that accepts compression (`03b4f1189`). One migration must go with it: `20261008150000_revenue_direct_settle_backfill.sql` (pending; it matches 0 rows today, so applying it is safe, and the code half is what keeps the payout cron from paying a direct-to-seller sale twice). Commands, in order: `npm run db:status`, `npm run db:migrate`, `npm run deploy:gcp:full`. **Re-measured 2026-10-09 03:05 UTC by the triage sweep:** production still serves image `fe2a8b24f` (now on revision `three-ws-api-00480-mws`, an env-only roll that raised `DB_RETENTION_HIGH_WATER_MB` to 16384), **172 commits behind `main`**, and the `evolve` branch holds 85 more awaiting the runner's merge, six of them this sweep's production fixes: the leak scanner's lease and budget (`0abce6d69`, which ends about eight overlapping 600 to 900 s scans that were burning the Solana RPC quota), `-32020` RPC failover (`4b51a179c`), static 412/416 instead of 500 (`e01e43b3b`), the news knowledge write fix (`833407d4f`, 120 lost stories a day), and the reconstruct sweep's plan-limit close (`85d3b2034`). `20261008150000_revenue_direct_settle_backfill.sql` has since been applied; `npm run db:status` now lists two pending, `20261008190000_oauth_refresh_user_client_index.sql` and `20261008200000_mcp_client_analytics.sql` (rows 27 and 28). The 8 sitemap pages still answering 404 (`/grok`, `/grok-skill.md`, `/docs/grok`, `/docs/grok-bot`, `/dextools`, `/docs/dextools`, `/chart-companion`, `/docs/chart-companion`) are all deploy lag. **Re-measured 2026-10-10 20:06 UTC by the triage sweep:** production serves `5af439bc0` on `three-ws-api-00487-7mt`, built 2026-10-10 05:01 UTC, **45 commits behind `main`** (down from 172 on 2026-10-09; most of the gap already shipped), and the `evolve` branch holds 89 more. All 869 advertised pages, every cron (125) and the fleet (48 services) check out clean; the only pending migrations are rows 27 and 28's two files. **Re-measured 2026-10-11 04:16 UTC by the deep triage sweep:** production serves `3503381b1` on `three-ws-api-00491-fbl`, **112 commits behind `main`** (up from 45 on 2026-10-10). One new page-lag symptom from the gap: `/docs/tutorials/grok-bot-recipes` (added in `71c673f99`, after the running revision) answers 200 with `/docs`'s content instead of its own; this is deploy lag, not a routing bug (verified: `71c673f99` is not an ancestor of `3503381b1`). The fleet (48 services), 125 crons and DB are otherwise clean; the only pending migrations remain rows 27 and 28's two files. **Re-measured 2026-10-11 12:32 UTC by the triage-lane sweep:** production serves `66a5e93bd` on `three-ws-api-00494-wh5`, built 2026-10-11 07:22 UTC, **only 5 commits behind `main`** (down sharply from 112 on 2026-10-11 04:16; the earlier large gap has shipped). The 5 outstanding commits are the desktop OS/shell/widgets feature set and the campus world update (`e33f529d8`, `33b5490c5`, `a48caf816`, `9c47f3ceb`, `86366a55e`). Rows 27 and 28's migrations are now applied; `npm run db:status` shows 2 new pending files, `20261011220000_agent_mention_policy.sql` (tracked by row 35) and `20261011230000_x402_ring_scan_checked_at.sql` (tracked by row 24's narrative), both additive. This sweep also committed two root-cause fixes to `main`-bound code that are NOT yet in this 5-commit gap: `65d6c4be8` (clink-fun MCP stream timeout misclassified as investigate) and `2f2fedf99` (a Pollinations 402 was putting the paid Replicate/TRELLIS lane into cooldown, contributing to `forge_generation: down`); the second one fixes a live production defect, so it is worth prioritizing in the next deploy. **Re-measured 2026-10-11 21:12 UTC by the triage-lane sweep:** production still serves `66a5e93bd` on `three-ws-api-00494-wh5`, **28 commits behind `main`** (`main` now at `9eda7992d`), up from 5 at 12:32 UTC because the desktop OS/shell/widgets/campus set from that measurement has been joined by new work: the x-content partner-spotlight feature (registry, daily scheduler, published IBM and AWS partner articles, the `/partners/benefits` page) and five dependabot bumps (`js-yaml`/`markdownlint-cli2`, `nanoid`, `maplibre-gl`, `torch` in `workers/texture`, `brace-expansion`, `source-map-js`, `moment`, `fast-uri`). `2f2fedf99` (the forge-cooldown fix) is still only on `evolve`, not yet on `main`; it remains worth prioritizing. The deep sweep found exactly one new pending migration, now tracked as row 42; rows 24 and 35's migrations are applied. The `/docs/desktop-widgets` 404 and `/docs/tutorials/grok-bot-recipes` wrong-canonical findings are confirmed deploy lag again (their catalog commits are not ancestors of `66a5e93bd`), not new routing bugs. **Re-measured 2026-10-12 by the triage-lane sweep, against the canonical `threews` remote (the local `main` ref in the `evolve` worktree was stale):** production (`/api/healthz`'s own `commitShort`) serves `c266e2591`, **11 commits behind `threews/main`** at `80e5e35f7`, down sharply from 28. The outstanding set is the Dissolve feature (a GPU particle-storm viewer for any 3D model) with its docs and page-catalog regeneration, a security-hardening batch (`8a56a44ab`: auth, wallet policy, SDP, vault, skill sandbox, MCP bridge URL guard, all with regression tests), a worker fix (`315e96f96`: block internal-host navigation in the screen pool, load text2motion weights with `weights_only`), an accessibility fix (`f772c8708`: icon-only button tooltips, gallery/create/header name-to-text matching), the Grid desktop world (`762269248`, `f35d07d93`, `a60d72dad`) and a new UI-lint tool (`568162d8d`). None of this sweep's own fixes (the Vertex/HF image-lane circuit breaker, the `forge-image-ladder-exhausted-502` and widened `r2-downstream-5xx` triage signatures) are in this 11-commit gap either; they are further back on `evolve`, behind the runner's usual fast-forward-to-`main` cadence. **Corrected 2026-10-12 17:54 UTC by the triage-lane sweep: the same-day "11 commits behind" figure above was a misread.** Querying the live `/api/version` endpoint directly (not `/api/healthz`, which carries no commit field) shows production still serves `771cfef01` on `three-ws-api-00496-78g`, built 2026-10-12 07:08 UTC. A fresh `git fetch threews` puts `threews/main` at `80e5e35f7`, and `git merge-base --is-ancestor threews/main 771cfef01` succeeds with exactly 1 commit between them, so the deployed revision is 1 commit AHEAD of the canonical remote `main`, not behind it. **The real deploy gap (commits on `main` not yet in production) is 0.** The 242 commits the deep sweep reports as "ahead" are `evolve`-branch commits (this worktree's local `main`, one commit ahead of pushed `threews/main`) not yet pushed, including this sweep's own `5afb045cf` (widened the `r2-downstream-5xx` triage signature to cover `/api/render/animate`, `/api/render/glb`, `/api/render/avatar-clip` and `/api/animations/clips/<id>`, all previously-unmatched symptoms of the same R2 flap row 36 already tracks); they are not a production staleness problem. **Re-measured 2026-10-13 by the triage-lane sweep:** production still serves `771cfef01` on `three-ws-api-00496-78g`. A fresh `git fetch threews` puts `threews/main` at `80e5e35f74302c85138bf6cabdad4f2db65b9ecf`, and `git merge-base --is-ancestor threews/main 771cfef01` succeeds, so the deployed revision is still exactly 1 commit AHEAD of the canonical remote `main`. **The real deploy gap remains 0.** The deep sweep's "283 commits ahead" figure is `evolve`-branch backlog (unpushed local commits, including `f939d5ef1`, the dist-lib CDN embed size fix documented in row 48) awaiting the runner's fast-forward, not a production staleness problem. This sweep found no new code-level defect to fix: the dist-lib bug is already root-caused, fixed and tested on `evolve`; the Solana-adjacent degraded subsystems (`agent_index`, `rpc_lanes`, `helius`, `sniper`, `three_token_rail`) and the `ccv-ai-providers-unavailable-503` finding (Groq's 200k tokens/day cap, the GCP billing hold, and the revoked OpenRouter key) are all pre-existing owner items already tracked in rows 23, 24, 19, 2, 20 and 6; none needed a new row. **Re-measured 2026-10-13 (triage-lane sweep, fifth pass):** production still serves `771cfef01` on `three-ws-api-00497-2ss`. `git fetch threews` puts `threews/main` at `80e5e35f74302c85138bf6cabdad4f2db65b9ecf`, and `git merge-base --is-ancestor threews/main 771cfef01` still succeeds, so the deployed revision remains exactly 1 commit AHEAD of `main`. **The real deploy gap stays 0.** The deep sweep's "291 commits ahead" figure is `evolve`-branch backlog (unpushed, includes `f939d5ef1` / row 48 and this pass's new row 53) awaiting the runner's fast-forward, not production staleness. The 8 sitemap-advertised pages answering 404 or wrong-canonical this pass (`/discord-activity`, `/docs/discord-activity`, `/docs/engine-bridges`, `/docs/engine-qa`, `/docs/open-source-credits`, `/docs/voice-framework-integrations`, `/open-source`, `/docs/tutorials/grok-bot-recipes`) are all confirmed deploy lag (`git merge-base --is-ancestor <add-commit> 771cfef01` fails for each); no routing bug. **Re-measured 2026-10-14 by the triage-lane sweep (production health sweep order):** production serves `45c768d07` on `three-ws-api-00500-b8q`. A fresh `git fetch threews` puts `threews/main` at `43a5dba21`, and `git log --oneline 45c768d07..threews/main` lists exactly 2 commits (`43a5dba21`, an x-content proofs refresh, and `3480497ed`, the R2-NotEntitled storage-outage failover fix): **the real deploy gap is 2 commits, both routine, neither urgent.** The deep sweep's 16 failing-page findings (`/discord-activity`, `/docs/engine-bridges`, `/docs/engine-qa`, `/docs/google-adk`, `/docs/open-source-credits`, `/docs/shopify-app`, `/docs/video-to-motion`, `/docs/voice-framework-integrations`, `/docs/vroid-hub-import`, `/docs/wordpress-embed`, `/import/vroid`, `/open-source`, `/video-to-motion` and their docs pages, plus the `/docs/tutorials/grok-bot-recipes` wrong-canonical) are confirmed NOT part of this 2-commit gap: none of their routes exist in `threews/main`'s `data/pages.json` at all (checked directly), so they are unpushed `evolve`-branch backlog (334 commits ahead of `threews/main` in this worktree), the same already-tracked rows 49, 52, 54 and 55 cover (Tripo webhook, Discord Activity, Shopify app, VRoid Hub import). The 5 pending migrations `npm run db:status` lists (`mcp_client_sessions_client_nullable`, `forge_webhook_deliveries`, `discord_activity_rooms`, `shopify_app`, `vroid_hub_source`) are the same set tracked by rows 42, 49, 52, 54 and 55; none applied, consistent with those rows' guidance. The lone unclassified `investigate` finding, a single `HTTP 502 GET /api/v1/coins` on `cryptocurrency-cv` with no matching app-level error, has no isolated root cause distinguishable from the 300-plus already-tracked `ccv-ai-providers-unavailable-503` hits on the same service in the same window; not elevated to a new row. This sweep's one code-level fix, a missing diagnostic log on `/api/agents/:id/alpha/read`'s generic LLM-failure 502 branch (not in the deep sweep's own findings list, found by log analysis; test-first, committed on `evolve`), is orthogonal to this row and does not change the gap count. **Re-measured 2026-10-15 by the triage-lane deep sweep:** production still serves `45c768d07` on `three-ws-api-00500-b8q`. A fresh `git fetch threews` puts `threews/main` at `43a5dba21`, and `git log --oneline 45c768d07..threews/main` still lists exactly the same 2 commits (`43a5dba21`, `3480497ed`): **the real deploy gap remains 2 commits, unchanged from 2026-10-14.** The deep sweep's own "422 commits ahead" figure is `evolve`-branch backlog in this worktree, not production staleness; the same caveat row 1 has carried since 2026-10-12. This pass's 9 failing-page findings (`/docs/vroid-hub-import`, `/docs/wordpress-embed`, `/import/vroid`, `/open-source`, `/video-to-motion`, `/docs/forge-workflows`, `/docs/standalone-repos`, `/docs/team-chat`, `/docs/tutorials/grok-bot-recipes`) are confirmed deploy lag the same way (none of their `data/pages.json` entries predate the deployed build; `git merge-base --is-ancestor` fails for each against `45c768d07`), consistent with rows 49/52/54/55/58. The `deep-db-migrations` probe's 8 pending files match rows already open above; none applied this pass, per the self-unblock playbook's no-dry-run warning on `npm run db:migrate`. Two `investigate` findings got code fixes instead of new rows: `/api/v1/ai/text-to-3d` 502s are the same NVIDIA NVCF free-tier capacity flakiness `three-ws-ai-providers-unavailable-5xx` already covers (rows 6/20), its matcher widened to include that route; `/api/pump/trending` and `/api/v1/pump/trending` 502s are a genuine but self-healing double-upstream outage (Birdeye and the pump.fun board both down in the same window, stale-cache fallback also exhausted), given a new self-healing signature so the monitor stops flagging it as `investigate`. Both fixes are committed on `evolve` (`90628d426`) with passing tests, pending the normal fast-forward to `main`. Rows 24 (`rpc_lanes: degraded, both paid lanes exhausted`) and 36 (`object_storage: down`, R2 "Please enable R2 through the Cloudflare Dashboard") re-confirmed unchanged against live `/api/healthz`; no new rows, no edits needed to either. **Re-measured 2026-10-23 by the triage-lane deep sweep:** production still serves `45c768d07` on `three-ws-api-00500-b8q`. A fresh `git fetch threews main` followed by `git log --oneline 45c768d07..threews/main | wc -l` returns **535**, a sharp escalation from the 2-commit gap recorded 2026-10-14/15: the deploy window simply widened while nothing shipped, not a new regression. The `deep-db-migrations` probe lists 11 pending files (`20261011220000_agent_mention_policy.sql`, `20261011230000_x402_ring_scan_checked_at.sql`, `20261015010000_mcp_client_sessions_client_nullable.sql`, `20261015040000_forge_webhook_deliveries.sql`, `20261015050000_discord_activity_rooms.sql`, `20261015060000_shopify_app.sql`, `20261015070000_vroid_hub_source.sql`, `20261015080000_pump_fee_claims.sql`, `20261015090000_agent_coin_earnings_timeline.sql`, `20261015100000_payment_session_policy_upgrades.sql`, `20261015110000_x402_outbound_resolved.sql`), none applied, per the self-unblock playbook's no-dry-run warning on `npm run db:migrate`. This pass's `/api/chat` 503 storm (groq's `FALLBACK_SIBLINGS` pointing at the dead model id `llama-3.3-70b-versatile`) is the same deploy-lag story, confirmed by `git show 45c768d07:api/chat.js`: HEAD already carries the fix (`groq: ['openai/gpt-oss-20b']`), so no new code change is needed, it ships with this row. One `investigate` finding got a code fix instead of a new row: a lone `/api/pump/coin` 502 traced via app logs to pump.fun's own Cloudflare anti-bot challenge page for that mint, with no last-good cache yet for it, same shape as the existing `pump-trending-upstreams-502` signature; given its own self-healing signature (`pump-coin-lookup-upstream-502`) so the monitor stops flagging it, committed on `evolve` (`72b600f1c`) with a passing test. The `deep-pages` probe now lists 20 failing pages, not the 9 from 2026-10-14/15: the original 9 (`/docs/vroid-hub-import`, `/docs/wordpress-embed`, `/import/vroid`, `/open-source`, `/video-to-motion`, `/docs/forge-workflows`, `/docs/standalone-repos`, `/docs/team-chat`, `/docs/tutorials/grok-bot-recipes`) plus 11 newly-advertised pages added to `data/pages.json` since then (`/.well-known/skill.md`, `/apps/shopify`, `/discord-activity`, `/docs/discord-activity`, `/docs/engine-bridges`, `/docs/engine-qa`, `/docs/google-adk`, `/docs/open-source-credits`, `/docs/shopify-app`, `/docs/video-to-motion`, `/docs/voice-framework-integrations`). Checked all 20 individually with `git merge-base --is-ancestor <adding-commit> 45c768d07`: every one of the 20 fails the check, confirming all 20 are deploy lag from the growing gap, zero are a routing bug. Rows 2, 3, 4, 5, 6, 19, 23, 24, 36 and 47 re-confirmed unchanged against live `/api/healthz` and service env; no new rows, no edits needed to any of them. **Re-measured 2026-10-24 by the triage-lane deep sweep:** the 535-commit gap recorded 2026-10-23 has shipped. Production now serves `660b5ad973e1fae8d70479c0cef4c02b6223ba2b` on `three-ws-api-00504-xnh`, built 2026-10-24T05:10:44Z. `git fetch threews main` followed by `git rev-list --count 660b5ad97..threews/main` returns **0**: `three-ws-api` is fully current. Note this covers only `three-ws-api`; the other 19 Cloud Run services deploy independently and can lag far behind it (see row 69, `remesh-service` found running a revision from 2026-07-16, three months stale). **Re-measured 2026-10-25 by the triage-lane deep sweep:** production still serves `660b5ad97` on `three-ws-api-00504-xnh`. A fresh `git fetch threews main` followed by `git log --oneline 660b5ad97..threews/main | wc -l` returns **46**: the deploy gap widened again while nothing shipped, the same cadence pattern as 2026-10-23. The 46 commits include two root-cause fixes this sweep confirmed already landed on `main` but not yet deployed: `5814b5585` (x402-ring-leak-scan's `maxDuration` wiring) and `2e7c0f555` (the `[name]` cron dispatcher's 300s budget, covering `run-buyback` and `solana-agents-crawl`), plus `5bcf53e17` (model-trellis VRAM recycle guard) and `10b5d26dc` (the `/docs/simready-assets` page-catalog registration this sweep's `deep-pages` probe flagged as wrong-canonical, confirmed deploy lag via `git merge-base --is-ancestor 10b5d26dc 660b5ad97` failing). `npm run db:status` lists exactly one pending migration, `20261024193900_fix_account_link_codes_collision.sql`, already tracked by row 72. This sweep's own code fix (`/api/avatar/render` and `/api/avatar/capabilities` 502s folded into the `r2-downstream-5xx` signature, committed `dcf947d9b`) is further back on `evolve`, not yet in this 46-commit gap either. | one yes | Shipping whatever has landed on `main` since 2026-09-08, now including the security-hardening batch and the forge image-lane breaker fix | [01-ship-readiness.md](../901-production-100-01-ship-readiness.md) |
| 2 | Fund the settle sponsor wallet `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`. Healthz reports `x402_settle` down with `cause: sponsor_floor` (settle 5.9%, 3 of 51 paid attempts over 3 hours, 329 `no_solana_accept`) and the sniper worker out of capital (0.2307 SOL to refill its wallets, funding master holds 0.0250 SOL); no config change moves either. Re-read 2026-09-04 08:21 UTC against mainnet: the sponsor holds **0.001507661 SOL** (1,507,661 lamports), still below the settle floor, so the Solana accept stays withdrawn from every 402 challenge. Two months of re-measurement have only ever moved this number down; nothing on this machine can move it up. **Re-measured 2026-10-08 17:05 UTC:** the sponsor holds **651,828 lamports (0.000652 SOL)**, below rent-exempt (890,880), and healthz reads `x402_settle` down at 0.0% (0 of 32 paid attempts in 3 hours, 58 settles refused at the fee-wallet floor). Because the sponsor cannot co-sign, every 402 challenge advertises the Solana accept without `feePayer`, and the ring skips it: 151 `missing_fee_payer` skips in 24 hours on the MCP streaming health probe alone. Last successful settle: 2026-10-03 19:24 UTC. **Row 1's deploy alone restores the ring, no funding needed** (diagnosed 2026-10-08 by read-only simulation): the treasury pays its own sweep fee (5,001 lamports; it holds 0.060 SOL, about 11,800 sweeps) and moves its stranded 2.587 USDC back to the ring payer, which holds 341 atomics today, and ring settles are self-pay. What still needs this wallet: the sponsor-mode callers (the loop's inline entries and the MCP streaming health probe) and the facilitator's `sponsor_fee_unfunded` verify rejects. Clearing the 2,000,000-lamport floor takes at least **1,348,172 lamports**. **Re-measured 2026-10-09 03:05 UTC:** still **651,828 lamports**, unchanged; healthz reads `x402_settle` down at 0.0% (0 of 39 paid attempts in 3 hours, 37 `sweep_broadcast_failed`, 53 settles refused at the fee-wallet floor). The sweep failures are the ones row 1's deploy clears (`a9c996e72`). **Re-measured 2026-10-14 by the triage-lane sweep (production health sweep order):** sponsor still holds **651,828 lamports**, unchanged in five days; nothing on this machine moves it. But `x402_settle` itself is no longer down: healthz now reads `degraded` at **89.8% (149/166 paid attempts, 3 hours)**, and the 17 failures are `http_503×12, rpc_error×4, rpc_preflight_failed×1`, not `sponsor_floor` or `missing_fee_payer`. Row 1's self-pay fix did restore the ring as diagnosed above; the remaining ~10% rail faults trace to row 24's exhausted paid RPC lanes (`rpc_lanes: degraded, all 2 paid lanes exhausted`), a separate billing decision, not this wallet. This wallet is still needed for the sponsor-mode callers row 1's self-pay fix does not cover, so the funding ask stands, just smaller in blast radius than it was. | ~1 SOL | x402 settle recovery, backlog 01 retirement, sniper | [../backlog/PROGRESS.md](backlog-PROGRESS.md), 2026-08-02 and 2026-09-01 entries |
| 3 | Decide the stranded customer funds: customers hold about 0.35 SOL behind the retired encryption key and cannot withdraw. Credit (recommended), contact first, or write off. The brief now exists with the measurement, the impossibility argument, the cost of each option and the exact commands: **[docs/ops/stranded-wallets.md](../../docs/ops/stranded-wallets.md)**. Measured 2026-09-02 from production's own records: the platform side is exactly two bot wallets holding 0.142875505 SOL (the reclaim cron has failed on them ~35,700 times each, most recently today), and one customer agent is confirmed by a `wallet_key_retired` withdraw failure (`GemVS5fT958FKRe5fpgizohUYUKE8cUDueEdmB1bmXnm`, 0.250001 SOL). **Both customer wallets are now named** (2026-09-04): the keyed audit was run against production, so this row no longer waits on anything. `GemVS5fT958FKRe5fpgizohUYUKE8cUDueEdmB1bmXnm` holds 0.250001 SOL and `HPL1LfuTdYDwtzJDzsnrmR2ngrrQwLTQyxJszCC4DHsN` holds 0.100001 SOL, 0.350002 SOL across exactly two wallet-auth accounts. Nine of 735 custodial wallets are sealed; the other five customer ones hold nothing. The brief carries the full table. Every input the decision needs is measured. | decision | Closing the support obligation | [docs/ops/stranded-wallets.md](../../docs/ops/stranded-wallets.md), [../backlog/PROGRESS.md](backlog-PROGRESS.md) |
| 4 | Rotate or explicitly accept three credentials, now that the storage half is done. **The config work shipped 2026-09-02**: the economy master key and 58 other plaintext credentials are Secret Manager references on `three-ws-api-00407-m7c`, zero plaintext credentials remain, healthz verified no worse and the master's signing path verified live. What is left is a judgment only the owner can make. (a) The master key was readable in the service config for some window, so decide whether to rotate it or accept that exposure, knowing who held project viewer access in that period; the exact owner-gated commands are in the runbook. (b) `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` hold the SAME value on production, which passes the dedicated-key guard in `secret-box.js` while defeating what it guards; changing it is a re-key with real stranding risk, so it is not an agent's call. (c) `X402_SEED_SOLANA_SECRET_BASE58` holds the same value as `LAUNCHER_MASTER_SECRET_KEY_B64` though `scripts/wire-master-wallet.mjs` assigns those slots to different wallets; decide which is correct. | decision (+ one fund move if rotating) | 03 is otherwise closed | [docs/ops/wallet-key-migration.md](../../docs/ops/wallet-key-migration.md), 2026-09-02 section |
| 5 | Accept the Anthropic terms in Vertex Model Garden for `aerial-vehicle-466722-p5`, then an agent flips `VERTEX_CLAUDE_ENABLED=1` after a live probe. | minutes | First-party Claude lane | `docs/ops/llm-lanes.md` |
| 6 | Either reactivate OpenAI billing or approve dropping the key; every OpenAI rung is a dead attempt in the chain. Also: OpenRouter fallback key #1 is revoked and still burns a rung; fund the OpenRouter platform key or stay `:free`-only. | minutes | LLM chain latency | `docs/ops/llm-lanes.md` |
| 7 | Mint an R2 "Admin Read and Write" token scoped to the storage bucket, put it in `.env.local`, so `scripts/set-r2-cors.mjs` can apply the CORS policy at the origin. | minutes | backlog 05 retirement, `ISSUES.md` item 9 | [../backlog/05-r2-bucket-cors.md](../906-backlog-05-r2-bucket-cors.md) |
| 8 | Sign in at the third-party indexer with the platform wallet and register origin `https://three.ws`. Re-checked 2026-09-02: the PAT this row used to ask for is no longer needed (the upstream pull request it would have commented on merged 2026-08-11, and the live discovery endpoint still answers with 100 resources), and the row was attributed to backlog 09, which needs nothing. Origin registration is a signature, not a spend, but it binds an identity, so it is the owner's. | minutes + one signature | backlog 10 retirement | [../backlog/10-x402scan-listing.md](../909-backlog-10-x402scan-listing.md), step 3 |
| 9 | Fund `0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871` from the public faucet (reCAPTCHA-gated, so no agent path), then say yes to the broadcast. This row's old premise is retired: a deployer key **does** exist in the gitignored `contracts/.env`, re-verified 2026-09-02 at balance 0 and nonce 0, both dry runs simulate green against the live RPC, and the broadcast path is proven end to end on a local node. Roughly 0.0003 tBNB of gas covers both deploys. Do not fund the retired 2026-08-02 address. | minutes + one yes | backlog 07 retirement | [../backlog/00-INDEX.md](backlog-00-INDEX.md), order 07 |
| 10 | The marketplace-listing pack needs its email OTP as `claude@three.ws` for two reads (the approval status of the listing resubmitted on chain 2026-08-27, and the chat-bot session), plus buyer-wallet funding for the real-payment gauntlet and an AI-provider key on the chat-bot service, whose Cloud Run deploy is also owner-gated (it has never reported a heartbeat). | minutes + funding | The pack's orders 04, 07, 08 and backlog 08 | that pack's `RUNBOOK.md` and `e2e-evidence/FUNDING-REQUEST.md` |
| 11 | Clear the commit gate for the backlog orders whose diffs reference third-party projects (07 through 10), per the CLAUDE.md coin rule, if that work should land in history. | one yes each | backlog 07 to 10 commits | [../backlog/00-INDEX.md](backlog-00-INDEX.md) |
| 12 | Multiplayer scale decision: the world service is a pinned single instance with a measured 400-concurrent ceiling and no autoscale (room affinity needs Redis first). Decide whether to fund or approve the Redis-backed scale-out. | decision | quality-bar 03 scope | [../event/PROGRESS.md](event-PROGRESS.md), preflight residuals |
| 13 | Decide how to close out the 2026-08-09 community event. Re-measured 2026-09-02 and the picture changed: the world server was never redeployed with the event build, so there were no quest runs, no leaderboard writes and no souvenir grants at all, and there is no list to settle from. The countdown, the `/event` page and the in-world meetup layer did run. Options: re-run the event now that the server-side code is live on production, settle from nothing and close it out publicly, or hold. Two reads that would overturn this finding are in row 15. | decision | event 08 closeout | [PROGRESS.md](event-PROGRESS.md), 2026-09-02 entry |
| 14 | Clear the commit gate for the 2026-09-01 retirement batch: three verified-shipped or superseded work-order files, plus the doc lines that cite them, whose content names other crypto projects (backlog 10; the marketplace pack's order 05, superseded by 08 with its resubmission confirmed on chain; the retired second-chain-venue pack's three context files, whose facts are duplicated in that venue's READMEs). The agent report of that date lists the exact paths and the referrer lines to rewrite. | one yes | Those deletions and the stale doc lines | [PROGRESS.md](production-100-PROGRESS.md), 2026-09-01 entry |
| 15 | Re-authenticate `gcloud` in this workspace (`gcloud auth login`) **only if it stops answering**. This row is a standing warning, not a standing blocker, and 2026-09-04 is the clearest proof yet: `gcloud` answered every call this session with no intervention, and the backlog it had been holding was drained in one sitting. Cleared by that session: row 18 (`MULTIPLAYER_INTERNAL_URL` set, `/api/play/population` now `ok:true`), row 3's keyed audit (both stranded customer wallets named), and the event closeout's log read (`textPayload:"souvenir laurel-meetup"` over 30d returned **zero** lines against a control proving the stream is intact, corroborating the zero-grant finding before the window ages out). **Retry a real call before treating this row as a blocker, and never park work on it.** One dependent genuinely remains and is NOT a gcloud problem: the durable Upstash `player:*` scan needs to execute inside the VPC (the store is at a private `10.128.15.228` SRH proxy, unreachable from this Codespace), and creating the Cloud Run job to do that was refused by the tool policy here. That scan is confirmation only; the log read plus the code argument already settle it. Still gated on a live token when it lapses: the Cloud Scheduler comparison (fix-queue 03) and the fleet checks in quality-bar 03. | minutes, when it lapses | fix-queue 03, quality-bar 03 | CLAUDE.md self-unblock playbook, [PROGRESS.md](event-PROGRESS.md) |
| 16 | Create the `three-ws` GitHub organization and `three-ws/examples` (public), then run the push command `npm run export:satellites` prints. The export now stages 72 files and passes all four smoke stages online (registry, install, links); re-probed 2026-09-03, both the organization and the repository still answer 404. | minutes | roadmap developer-resources retirement | [docs/ops/examples-repo-export.md](../../docs/ops/examples-repo-export.md) |
| 17 | Apple Developer account. The WidgetKit extension, the Mac menu bar app and the iOS target are written and guarded (`npm run check:apple-widget`); the account is what signs them, for a Developer ID Mac build and an App Store iOS build alike. Separately, publish the Android 1.1.0 build (versionCode 2) to Play. | account + minutes | roadmap native-widgets task 4 and its release | [../roadmap/native-widgets.md](../916-roadmap-native-widgets.md) |
| 19 | Arm the agent-sniper Risk Officer once shadow evidence justifies it, and refill the sniper fleet's trading capital. **The deploy half of this row is DONE (2026-09-29, owner approval "finish them all").** Measured: the old revision `agent-sniper-00033-rg6` ran an image uploaded 2026-08-09 09:47 UTC, 15 commits behind on `workers/agent-sniper/` (9 files, +996/-66, incl. the new `risk-officer.js`; `amm-exit.js` was already in it, only its SDK-2 pool fields were behind). The first roll (`agent-sniper-00034-7zp`) was refused by Cloud Run because the image lacked `data/plans.json`, read at load by `api/payments/_config.js` since 2026-09-25; traffic never left 00033. Fixed in `b17456355`, which also makes `npm run deploy:sniper` boot the worker from the exact Dockerfile COPY set before building. `agent-sniper-00035-krc` (commit `b17456355`) now serves 100% with a byte-identical env (`SNIPER_MODE=live`, `SNIPER_RISK_OFFICER` unset, so `shadow`), no new ERROR logs, and the fleet trading through it: one live buy at 07:14:35 UTC got its shadow review 1.6 s later (severity `none`, joined by `position_id`), and that position exited at 07:30:01 UTC (`liquidity_decay`). `sniper_risk_reviews` now has 8 rows, the first 1 from the fleet. **Remaining, both owner-only:** (a) arming `enforce` is gate 1 (it changes what real SOL buys): `SNIPER_RISK_OFFICER=enforce` via `--update-env-vars` (never `--set-env-vars`) or per strategy via `risk_officer_level`, only after the shadow-P&L query in `workers/agent-sniper/README.md` shows `block`/`caution` calls losing more than `none` across enough closed positions (one row is not evidence). (b) a SOL spend: `/api/healthz` reports 7/11 armed wallets tradeable (4 starved, 1 shrunk), 0.2397 SOL needed, funding master holds 0.0250 SOL; the buy rate, and so the evidence rate for (a), scales with that refill. **Re-measured 2026-10-10 20:06 UTC by the triage sweep:** 6/11 armed wallets tradeable now (5 starved, 1 shrunk), 0.2827 SOL needed to refill them, funding master still holds only 0.0250 SOL. The gap is widening, not closing, on its own. | one spend now, one decision later | The rate of shadow evidence for the Risk Officer, and 4 starved fleet wallets | [../918-roadmap-pumpfun-trading-arena.md](../918-roadmap-pumpfun-trading-arena.md), [workers/agent-sniper/README.md](../../workers/agent-sniper/README.md) |
| 20 | **Clear the GCP billing hold on `aerial-vehicle-466722-p5`.** Every Vertex surface answers `403 Lightning dunning decision is deny for project: projects/93741856042`, confirmed 2026-09-09 both locally and in production's own logs (Vertex Imagen falling back at 05:33 UTC). This is not IAM and nothing in code routes around it: it takes out the Vertex Gemini anchor, Imagen, and `groundedSearch`, which is the fact-checker's ONLY working search rung (no Brave/Tavily/Exa/Serper key exists). With it down the chain falls to Wikipedia alone: a benchmark run that day saw 190 sources, 100% Wikipedia, and 15 of 38 claims had zero stance-bearing evidence. It is a billing/payment state on the account, so only the owner can clear it. | minutes, at the billing console | Grounded search, Vertex Gemini, Imagen, and publishing the fact-check accuracy run (04b) | [PROGRESS.md](production-100-PROGRESS.md), 2026-09-09 entry | **Re-confirmed 2026-09-10, and the blast radius is wider than this row said.** The denial covers the Generative Language API (`generativelanguage.googleapis.com`, the `GOOGLE_API_KEY` path) as well as Vertex, so there is no Google lane of any kind. It is also the real blocker behind **order 311's i18n translation**: that order names `gcloud auth login` as its owner action, but gcloud auth WORKS in this workspace, and the actual constraint is that every reachable free lane is throttled per key (NVIDIA about 27 keys/min per process and `429`s under parallelism, Groq capped at 200k tokens/day, OpenAI `billing_not_active`). Vertex is the only lane billed to the credit pool with no free-tier quota, so it is the only one that finishes 84 locales in one pass. Clearing this hold therefore unblocks **three** orders at once: 903, 907 and 311.
| 21 | **Decide whether to rotate the lane credentials read on 2026-09-09.** Resolving the LLM chain for the fact-check benchmark printed secret material into an agent session transcript: the `vercel-inference@aerial-vehicle-466722-p5` service-account **private key** (`GCP_SERVICE_ACCOUNT_JSON`, key id `93be907a...`), plus `GROQ_API_KEY`, all five OpenRouter keys, `NVIDIA_API_KEY` and `OPENAI_API_KEY`. `INTERNAL_API_KEY` was used but never printed. Nothing indicates misuse and all of them remain valid; the exposure surface is whoever can read that transcript. Rotate or accept, and note that the OpenAI key is dead anyway (row 6) and OpenRouter key #1 is already revoked. | decision (+ minutes if rotating) | Closing out the exposure | [PROGRESS.md](production-100-PROGRESS.md), 2026-09-09 entry |
| 22 | **Decide whether to arm the three trading growth programs** (added 2026-09-29). Built, tested and disarmed: the big-win X poster (`BIG_WIN_X_ENABLED`, posts to @trythreews), the first-rug softener (`RUG_SOFTENER_ENABLED`, pays $THREE, default cap $25 per claim and $100 per day) and the early-leader bonus (`EARLY_LEADER_ENABLED`, pays $THREE, default 20 slots at $50 and $250 per week). Each is armed on its own. Steps: (1) `npm run db:status`, then `npm run db:migrate` for `20260929120000_growth_program_payouts.sql` (payout programs only); (2) set `THREE_PRIZE_PAYOUT_KEY` (unset on production as of 2026-09-29; the programs deliberately refuse the club treasury fallback, which is the economy master wallet) to a dedicated wallet holding the $THREE to cover the caps (payout programs only); (3) deploy; (4) read the dry run at `/api/ops/growth-programs`; (5) `gcloud run services update three-ws-api --region us-central1 --update-env-vars <FLAG>=1`. Measured 2026-09-29 against production data: nothing would be posted or paid today (no live win cleared the 0.1 SOL size gate, no first trade met the softener bar, no leader has a profitable 30-day record with followers). | one yes per program | Roadmap 917 items 3.8, 12.15, 13.4 | [docs/growth-programs.md](../../docs/growth-programs.md) |
| 23 | **Name the two $THREE receiver wallets** (added 2026-09-30). `/api/healthz` reports `three_token_rail` down and signed-in `POST /api/token/quote` answers `503 treasury_unavailable`, so no $THREE-priced purchase can be priced (Forge paid tiers, spins, scarcity mints, token marketplace sales, copy-trading fees). The quote signing key is done (`three-quote-secret`, wired on `three-ws-api-00466-85g`); only `THREE_TREASURY_WALLET` and `THREE_REWARDS_WALLET` remain. No revision ever held them, so there is nothing to restore. Candidates: treasury `wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU` (x402 receiver, already holds a $THREE account), rewards `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` (the economy master, which `REWARDS_DISTRIBUTOR_SECRET` signs as). The rewards candidate is also the buyback signer, so arming `THREE_BUYBACK_ENABLED` or `THREE_MICROBUY_ENABLED` would sweep the whole rewards pool into the treasury; decide that before arming either lane. Setting the two vars moves no funds by itself: `gcloud run services update three-ws-api --region us-central1 --update-env-vars THREE_TREASURY_WALLET=<treasury>,THREE_REWARDS_WALLET=<rewards>`. | two addresses | The whole $THREE purchase rail | [docs/money-map.md](../../docs/money-map.md#three-split-receivers-inbound-three) |
| 24 | **Top up the paid Solana RPC plans** (added 2026-10-08). Helius answers `429: max usage reached` on every call: 45,461 such lines on `three-ws-api` in the 24 hours to 2026-10-08 17:10 UTC, the oldest retained one from 2026-09-08. healthz reads `helius` degraded and `rpc_lanes` "all 2 paid lanes exhausted", so Solana traffic runs on throttled free nodes. That is the whole cause of `agent_index` reading down: 172 of the 176 erroring Solana cursors carry `solana rpc 429 @ public.rpc.solanavibestation.com`, the last free lane, and the rest are a free provider's own errors. No config change adds credits, and promoting the reserve lane is the documented wrong fix. Upgrade or top up the Helius plan (and the second paid lane), then confirm `helius` and `rpc_lanes` read ok on `curl -s https://three.ws/api/healthz`. **Re-measured 2026-10-09 03:05 UTC:** `rpc_lanes` still reads "all 2 paid lanes exhausted", and `agent_index` reads down at a 36m median Solana lag with 135 of 1,663 cursors erroring. One cause of the burn was ours and is fixed on `evolve` pending row 1's deploy: the ring leak scanner ran about eight overlapping copies at all times (213 runs in 6 hours, average 788 s, each walking 2,006 registry wallets), now one leased, 200 s-budgeted run per 10 minutes (`0abce6d69`). That cuts the platform's own RPC demand; it does not add credits, so this row stands. **Re-measured 2026-10-10 20:06 UTC, after row 1's leak-scanner fix is live in production:** `rpc_lanes` still reads "all 2 paid lanes exhausted; serving from 0 free lanes" (all 8 lanes cooling at once, both paid ones on a 6h cooldown), and `agent_index` reads a 1h7m median Solana lag with 172 of 1,665 cursors erroring (10.3%). The scanner fix alone was not enough to clear this; the lanes need the owner's top-up. **Re-measured 2026-10-11 04:16 UTC:** `rpc_lanes` still reads "all 2 paid lanes exhausted; serving from 0 free lanes" (8 lanes cooling, each back in about 8 minutes), but `agent_index` has improved to a 45m median Solana lag with 37 of 1,665 cursors erroring (2.2%, down from 10.3%). Cooldowns are now short enough that the fleet mostly catches up between them; the lanes themselves are still exhausted and still need the owner's top-up to stop cycling into cooldown at all. **Re-measured 2026-10-11 (later), order 400 shipped on `evolve`:** the 2026-10-09 fix only covered the lease and wall-clock budget; the scanner was still rescanning its whole 2,006-wallet registry on every budget-fitting run. It now scans three tiers per run (role wallets, then registry wallets the ring's own pool ledger shows claimed a payer since last check, then an oldest-`checked_at`-first rotation slice), was removed from `economy-tick.js`'s every-2-minute `TARGETS` (its own `*/10` Cloud Scheduler job already owns it), and `wallets-leak-scan` got the same single-flight lock. Call volume this cuts, measured against the 2026-10-08 baseline above (about 46,000 `getSignaturesForAddress` calls/hour, 1.1M/day from this one monitor): a never-active wallet now costs one call per full rotation instead of one per run. Separately, found and fixed while investigating why `x402_ring_fee_observed` had never recorded a row: `accountKeyStrings()` returned a live `PublicKey` object instead of its base58 string whenever the RPC client returned `accountKeys` as `{pubkey, signer, writable}` (the real shape from `@solana/web3.js`'s own parsed-transaction response), so every wallet-identity comparison silently failed on real mainnet data, every real transaction classified with zero leak/delegation events, the fee cross-check never accumulated anything. Fixed and covered by new tests; this also means leak/delegation detection itself starts actually firing on real traffic for the first time once this ships, not just faster and cheaper. Ship command: `npm run db:migrate` (applies the new `checked_at` column migration), then `npm run deploy:gcp:full`. Post-deploy check, 3 hours after: the log query above shows p50 under 60s and zero 504s on `x402-ring-leak-scan`, and no `threews-economy-tick/1.0` caller in it; `SELECT count(*) FROM x402_ring_fee_observed` is greater than 0. This row still stands: fixing the platform's own demand does not add credits, and the lanes stay exhausted until the owner tops them up. | billing | Solana agent index freshness, balance reads, every on-chain route's latency | [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md), "Every paid Solana RPC lane exhausted at once" |
| 25 | **Deploy so cloud MCP connectors can sign in to four hosted servers** (added 2026-10-08 by the evolve loop, x-grok order 023). Production (`fe2a8b24f`, revision `three-ws-api-00479-d7z`) still points every OAuth 401 at the root protected-resource document naming `/api/mcp`, so a stock MCP SDK client (Grok Bot, claude.ai connectors) refuses to start sign-in on `/api/mcp-3d`, `/api/mcp-agent`, `/api/mcp-bazaar` and `/api/ibm-mcp`. The fix is on `main` (`7985f1cce`, `59bdf5707`) and the probe passes all seven servers against local code. The submit gate also needs the pending `20261008150000_revenue_direct_settle_backfill.sql` applied first (`npm run db:status`, then `npm run db:migrate`), which is another session's payout backfill, so read it before applying. Then `npm run deploy:gcp:full`, then `npm run probe:mcp-clients -- --json prompts/x-grok/_generated/connector-probe.json`, which must print `all 7 servers passed`. | one deploy | Grok Bot and every OAuth connector on four servers; closes x-grok order 023 | [docs/mcp.md](../../../docs/mcp.md#client-compatibility), [prompts/x-grok/_generated/connector-probe.json](../../x-grok/_generated/connector-probe.json) |
| 26 | **Approve committing the regenerated MCP catalog** (added 2026-10-08 by the evolve loop, x-grok order 024 and order 401). `npm test` is green on the evolve working tree (vitest 2194 files / 31,910 tests, Playwright 262 passed with `E2E_PORT=3107`), but three files stay uncommitted under the coin commit gate because their regenerated text names other crypto projects already named in committed source: `public/mcp-catalog.json` (fills the missing input schemas of `agora_quote_register` and `preview_agent_identity` and adds `pay_quote`; without it `tests/mcp-schema.test.js` fails 3 tests at HEAD), `tests/fixtures/mcp-golden-tools.json` (the `audit:mcp-golden` contract refresh) and a one-line dash fix in `packages/agora-mcp/src/tools/register.js`. They are held as an `evolve held:` stash. To approve, on `main`: `git stash list | grep 'evolve held'`, review with `git stash show -p <ref>`, then `git stash apply <ref>` and commit those three paths; or regenerate instead with `npm run build:mcp-catalog && node scripts/audit-mcp-golden.mjs --update` and commit `public/mcp-catalog.json tests/fixtures/mcp-golden-tools.json`. Then `E2E_PORT=3107 npm test` should exit 0 at HEAD and orders 024 and 401 can retire. | one yes | Orders 024 and 401 | [x-grok-PROGRESS.md](x-grok-PROGRESS.md), 2026-10-08 order 024 retry entry |
| 27 | **Apply the OAuth refresh-token index, then ship instant revocation with the next deploy** (added 2026-10-08 by the evolve loop, x-grok order 025, which is otherwise complete and retired). `cf30be269` makes every OAuth access token check its grant on each request, so Revoke in Settings, Connected apps cuts a cloud connector such as Grok Bot off on its next call instead of up to an hour later. That lookup filters `oauth_refresh_tokens` on `(user_id, client_id)` including revoked rows, which the existing partial index cannot serve; at 4,228 rows today it is fast without one, but the table gains a row per refresh. The code is correct without the index. Apply it with `node scripts/apply-migrations.mjs --apply --file 20261008190000_oauth_refresh_user_client_index.sql` (or `npm run db:status`, then `npm run db:migrate`, which also applies row 25's backfill, so read that one first). It is pending until then and `npm run db:check` blocks a deploy on it. The behavior itself ships with the deploy in row 25. | one command | Fast grant checks on every OAuth MCP call; the deploy gate | [docs/mcp.md](../../../docs/mcp.md#cloud-connectors-and-revocation) |
| 28 | **Apply the MCP client analytics migration, then ship it with the next deploy** (added 2026-10-08 by the evolve loop, x-grok order 030, which is otherwise complete and retired). `e8381ce9c` makes every hosted MCP server issue an `Mcp-Session-Id` on initialize and record which AI client (Claude, ChatGPT, Cursor, Grok Bot, ...) opened each session and which tools it calls, read by the admin board at `/mcp-clients`. The tables do not exist in production yet: `npm run db:status` on 2026-10-08 lists `20261008200000_mcp_client_analytics.sql` pending beside rows 25 and 27's migrations. Until it is applied the servers keep working (each flush logs `[mcp-clients] session write failed` and drops the batch) and the board shows "The analytics tables are not there yet". Apply it alone with `node scripts/apply-migrations.mjs --apply --file 20261008200000_mcp_client_analytics.sql`, or with the rest via `npm run db:status` then `npm run db:migrate` (read row 25's backfill first). `npm run db:check` blocks the deploy on it until then. One more change is held for you as an evolve stash (`git stash list`, "evolve held"), not committed: the same hook on the eighth server in `/.well-known/mcp.json`, held only by the coin commit gate because that server is built around another project; approve it and that surface is counted too (it was verified locally with the rest). | one command, one approval | Per-client MCP usage on `/mcp-clients` | [docs/ops/mcp-clients.md](../../../docs/ops/mcp-clients.md) |
| 29 | **After the row 25 deploy, rerun the Grok Bot doc samples against production** (added 2026-10-09 by the evolve loop, x-grok order 035, which is otherwise complete and retired). `docs/grok-bot.md` (`ae20babcd`) documents `/api/mcp-grok`, install tokens, `get_job` and `idempotency_key`, none of which production (`fe2a8b24f`) serves yet, so its ten samples were run against a server built from this tree (all passed, `npm run probe:mcp-clients -- --only mcp-grok` included) and against production, where they answer 404. Once the deploy lands, run `set -a; . ./.env; set +a; node scripts/run-doc-samples.mjs docs/grok-bot.md` and expect `0 of 10 samples failed` with real JSON in every output (it makes one free `forge_free` generation). Nothing to approve beyond the deploy itself. | one command after the deploy | Proof that every Grok Bot doc sample runs on production as written | [docs/grok-bot.md](../../../docs/grok-bot.md#keeping-this-page-true) |
| 30 | **After the row 25 deploy, rerun `npx three-ws setup --client grok-bot` against production** (added 2026-10-09 by the evolve loop, x-grok order 037, which is otherwise complete and retired). The CLI (`cd9b7f5be`) reads the live directory, so on production today (`fe2a8b24f`) it connects the free studio `three-ws-studio` and its live check passes; `--auth install` answers that the deployment cannot mint install tokens yet, and `--auth key` without `--connector-key` answers that it cannot mint connector keys from the CLI yet, because the bearer `preset: "connector"` on `POST /api/api-keys` (`3350e513c`) is not deployed. All four modes were verified against a server built from this tree, including a real connector-key mint (scope capped to the connector set, then revoked). Once the deploy lands, run `node packages/three-ws-cli/src/cli.js setup --client grok-bot --yes`, then the same with `--auth install` and `--auth oauth`; each must name `three-ws-grok` and exit 0. Nothing to approve beyond the deploy itself. | three commands after the deploy | Proof the Grok Bot CLI setup reaches `/api/mcp-grok`, install tokens and connector keys on production | [docs/cli.md](../../../docs/cli.md#grok-bot) |
| 31 | **Redeploy the GPU workers that fetch caller images, so a Wikimedia reference photo stops failing** (added 2026-10-09 by the evolve loop triage sweep). `upload.wikimedia.org` answers httpx's default `python-httpx` agent with 403, so `model-triposg` failed every job whose reference photo was a Wikimedia link before inference (4 logged 403 failures in the 24 hours to 2026-10-09 03:00 UTC). `d886d09e1` sends a descriptive User-Agent from the shared `worker_security.py`, mirrored to all 17 vendored copies, but a worker only picks it up when its image is rebuilt. Start with the one that failed: `gcloud builds submit --config workers/model-triposg/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .` (the command in `workers/model-triposg/README.md`); the other image-fetching workers (`model-trellis`, `model-hunyuan3d`, `rig`, `texture`, `stylize`, `segment`, `remesh`) inherit it on their next routine deploy. Separately worth a look: `model-trellis` was killed by its own liveness probe (`/health` timing out during inference, then signal 9) three times in the 24 hours to 2026-10-09, which left 147 task polls answering 503; not root-caused this session. | one build | Image-to-3D jobs whose reference photo is a Wikimedia link | [workers/model-triposg/README.md](../../../workers/model-triposg/README.md) |
| 32 | **Decide retention for the six large tables the database retention cron never prunes** (added 2026-10-09 by the evolve loop triage sweep). The Neon footprint reached 11,606 MB, past the 8192 MB high-water mark since 2026-09-09, so five write-heavy crons (`launcher-tick`, `coin-intel-observe`, `smart-money-rollup`, `recompute-reputation`, `intel-learn`) skipped every tick for a month. The sweep raised `DB_RETENTION_HIGH_WATER_MB` to 16384 (config-only, pre-approved; real cap `neon.max_cluster_size` is 16TB), which buys about six weeks at the measured ~114 MB a day. The growth is in tables outside the retention set, and pruning them deletes history, so it is not an agent's call: `oracle_training_set` 1.8 GB (1.37M rows), `x402_self_facilitator_log` 1.4 GB (3.0M rows; the code already names it a product decision about lifetime revenue totals), `firewall_decisions` 1.2 GB, `usage_events` 0.7 GB, `club_tips` 0.6 GB (1.2M rows), `ops_alerts` 0.5 GB (693k one-off `503 settlement_unavailable` rows from July to October). Name a window per table (or keep forever and accept the storage bill); an agent then adds each to `TIME_SERIES_TABLES` in `api/cron/db-retention.js`. | decision | Keeping the write crons running past mid-November without raising the mark again | [docs/ops/db-retention.md](../../../docs/ops/db-retention.md) |
| 33 | **Create a production xAI API key so a Grok model's live MCP calls against three.ws can be proven** (added 2026-10-10 by the evolve loop, x-grok order 039, which already owns this exact gate as order 927: `prompts/finish/927-x-grok-46-owner-grok-api-key.md`). Step 0 re-derivation this session found no `GROK_API_KEY`/`XAI_API_KEY` anywhere: not in `process.env`, not in `.env`/`.env.local`, not on the `three-ws-api` Cloud Run service (`node scripts/read-service-env.mjs '^(GROK\|XAI)_API_KEY$' --names` returned nothing). `scripts/xai-mcp-e2e.mjs` (npm script `e2e:xai-mcp`) is built and verified end to end in dry-run mode: it matches xAI's current Responses API remote-MCP schema field for field and names this gate when no key is found. Create a key at console.x.ai, then either set it directly (`gcloud run services update three-ws-api --region us-central1 --update-env-vars GROK_API_KEY=<key>`) or hand it to order 927 to wire through Secret Manager; afterward `npm run e2e:xai-mcp` should exit 0 against production. | minutes, console only | Closes x-grok order 039's one remaining Definition of Done line, and order 927 | [_context/x-grok-PROGRESS.md](x-grok-PROGRESS.md), 2026-10-10 entry |
| 35 | **Apply the agent mention-policy migration, then ship it with the next deploy** (added 2026-10-11 by the evolve loop, x-grok order 061, which is otherwise complete and retired). `api/_lib/migrations/20261011220000_agent_mention_policy.sql` adds `mention_replies_enabled`, `mention_replies_dry_run`, `mention_replies_daily_cap` and `mention_replies_allowed_intents` to `agent_x_policies`, the four fields the new "Answer mentions" panel on `pages/agent-edit.html` (Social tab) reads and writes. `npm run db:status` on 2026-10-11 lists it as the only pending migration. The read path (`GET /api/x/agents`) already works without it, since the query is `select *` and `rowToPolicy()` defaults the missing columns; only the write path breaks: `saveAgentPolicy`'s `INSERT` names the four columns explicitly, so a save attempt against the unmigrated table answers 500 with Postgres `42703 undefined_column`, verified live in a local run of the full UI against the real dev database on 2026-10-11 (every other state, no-connection/missing-scope/connected/populated-decisions, was verified working by temporarily granting `X_OAUTH_CLIENT_ID`/`SECRET` in `.env.local` only, never in production). Apply it with `node scripts/apply-migrations.mjs --apply --file 20261011220000_agent_mention_policy.sql`, or `npm run db:status` then `npm run db:migrate` (nothing else is pending as of this writing). `npm run db:check` blocks the next deploy on it until then. Separately, and not blocking this row: production has never set `X_OAUTH_CLIENT_ID`/`X_OAUTH_CLIENT_SECRET` at all (`node scripts/read-service-env.mjs '^X_OAUTH_CLIENT'` finds nothing), so the whole per-agent "connect this agent's own X account" flow (distinct from the company bot account's `X_API_KEY`/`X_ACCESS_TOKEN` posting credentials, which are set) answers "X connections are not enabled on this deployment" for every agent today; that is a pre-existing gap this order did not create and its settings UI already degrades to that state correctly. | one command | The "Answer mentions" save button in the agent settings UI | [x-grok-PROGRESS.md](x-grok-PROGRESS.md), 2026-10-11 entry for order 061 |
| 36 | **Check Cloudflare R2's own status/dashboard for the bucket behind `S3_BUCKET`: it flaps between healthy and unreachable without any corresponding change on our side** (added 2026-10-11 by the evolve scout lane). Queried `ops_alerts` directly (columns: `signature, title, detail, severity, count, environment, first_seen, last_seen`): since 2026-09-08 the `object_storage` sensor (`api/_lib/ops/object-storage-health.js`) has logged roughly 167 "DEGRADED: Object storage (Cloudflare R2)" events (`bucket reachable but slow, signed list ~1095ms` against a 1000ms threshold) and about 18 "DOWN" events, interleaved with many "RESOLVED" events minutes apart showing a healthy 150 to 300ms. Reproduced live with production's own `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET`/`S3_ENDPOINT` (pulled via `node scripts/read-service-env.mjs` one variable at a time, used in-process, then deleted from disk immediately): `gatherObjectStorageHealth()` returned `{"status":"down","detail":"bucket unreachable: Please enable R2 through the Cloudflare Dashboard.","metrics":{"latencyMs":135,"credentialFault":false}}`, a 135ms response, i.e. the bucket answered fast but Cloudflare's own API told us R2 was not enabled, which cannot be true most of the time this account is clearly serving reads. Ruled out as a code cause: the credential is not rejected (`credentialFault:false`, no `SignatureDoesNotMatch`), and the AWS SDK's Node HTTP handler already defaults to keep-alive on (`keepAlive:true, maxSockets:50` in `@smithy/node-http-handler`), so this is not the classic missing-keep-alive latency bug. The probe itself is a single signed `ListObjectsV2Command` with no retry (`api/_lib/ops/object-storage-health.js:76-92`), so a genuinely transient one-off Cloudflare hiccup is indistinguishable from a sustained outage in this sensor today, which may be inflating the DOWN/DEGRADED counts above a one-retry version would show. Two independent things to do, neither owned by this reconciliation order: (a) check Cloudflare's own R2 dashboard/status page for the account behind `S3_BUCKET` for incidents correlated with the alert timestamps above (owner/dashboard access this agent does not have); (b) if the pattern looks like a true transient flap rather than sustained Cloudflare-side degradation, a future order could add one immediate retry before `gatherObjectStorageHealth()` classifies `down`/`degraded`, with a test proving a single synthetic failure followed by a synthetic success no longer pages. Not attempted here because the current evidence does not confidently distinguish "add a retry" from "mute a real recurring problem", and CLAUDE.md is explicit that a check does not get weakened without a dated, measured reason; this row exists so neither path gets silently skipped. 2026-10-13 (evolve scout lane, re-measured before considering it as a work order): queried `ops_alerts` again, grouped by failure text. The `"bucket unreachable: Please enable R2 through the Cloudflare Dashboard"` DOWN signature (the one live healthz reports right now) spans `first_seen` 2026-09-08T19:35Z to `last_seen` 2026-10-13T19:10Z (this instant), 58 alert rows, i.e. it has been recurring continuously for over a month and is still firing as this note is written: a sustained, ongoing condition, not a one-off transient blip. The retry idea in option (b) above does not apply to this dominant failure mode: retrying a single probe cannot paper over something that has been reproducing for 30-plus days, and doing so would be exactly the "mute a real recurring problem" case CLAUDE.md warns against, so no work order was written for it this pass. The narrower "DEGRADED: bucket reachable but slow" variant (option (b)'s original target) is a separate, lower-severity code path from this DOWN/unreachable one and was not re-measured this pass; a future pass that wants to pursue the retry idea should scope it to that DEGRADED signature specifically and re-confirm its flap pattern first, never the DOWN/unreachable signature above. 2026-10-13 (order 400, evolve loop, severity escalation): re-measured again, 18:10-18:30 UTC. The "flaps between healthy and unreachable" framing at the top of this row is now stale and understates the severity: the last `RESOLVED: Object storage (Cloudflare R2)` row is 2026-10-11T06:55:05Z, and every hourly sensor tick since then has been `DOWN` with zero resolves, a 35-plus-hour unbroken streak at measurement time (now 60-plus hours as this note is written, still ongoing). Two things that were working as designed have also failed: the public `*.r2.dev` domain itself now answers a Cloudflare-branded 403 (an edge-level block on the whole R2 product for this account, not a bucket-level 404/403), and `/cdn/<key>` (`api/cdn-object.js`), whose job is to fail over from the signed read to that same public domain, now 502s because both of its legs are down simultaneously. The "reads fail over to the public bucket domain meanwhile" hint text in `api/_lib/ops/object-storage-health.js` is temporarily false while this persists. Enabling R2 in the Cloudflare dashboard for the account behind `S3_BUCKET` is now urgent, not routine; this row's classification stays owner/Cloudflare-dashboard-only, unchanged. Separately, order 400 implemented the retry this row had deferred, but scoped narrowly: one extra attempt after a 200-500ms backoff, inside a single `gatherObjectStorageHealth()` invocation (`api/_lib/ops/object-storage-health.js`, tests in `tests/object-storage-health.test.js`). This does not contradict the 2026-10-13 re-measurement above that ruled out retry for the dominant DOWN signature: one retry a few hundred milliseconds later mathematically cannot turn 60-plus hours of genuine downtime into `ok`, so it cannot mute this sustained outage. It only absorbs a single transient network blip inside one invocation, which is the DEGRADED-flap case this row originally proposed it for, scoped exactly as the warning above required. 2026-10-14 (triage-lane sweep, production health sweep order): re-measured via live `/api/healthz`: `object_storage` still reports `down`, `"bucket unreachable: Please enable R2 through the Cloudflare Dashboard."`, and `forge_generation` is now also `down` ("no generation has STARTED in 196m") as a direct downstream symptom. The last `RESOLVED` row remains 2026-10-11T06:55:05Z, so this is now an unbroken streak of roughly 66 hours with zero resolves, up from the 60-plus hours measured in the order 400 note above. Still owner/Cloudflare-dashboard-only; no new row, no code change (the retry already shipped in order 400 cannot and should not mute a multi-day outage). 2026-10-24 (order 402, evolve loop, console-error sweep): a full `npm run audit:web` sweep (1130 route/viewport entries) traced the overwhelming majority of console-error findings across the site, not just the 9 WebGL-heavy pages the order named, to this same outage. Two new symptoms found: (a) a sitewide "walk companion" widget whose default/featured avatar (id `81a076b6-55ff-49a2-b007-1d88e7dce2aa`) lives in R2, so `/api/avatars/<id>/glb` 502s on dozens of unrelated pages that embed the widget (`/docs/widgets`, `/tutorials`, `/walkthroughs`, `/walkthroughs/forge-your-first-3d-model`, and others); it never crashes the page because `walk-sdk/src/internal/load-avatar.js` catches the failure and falls back to the embedded local "robot" avatar, logging only a console warning. (b) `/cdn/thumb|forge/*` 502s broadly across `/rankings`, `/launches`, `/avatars`, `/marketplace`, `/render-lab`, `/trade-rooms`, `/spotlight`, `/monitor` and more, same two-leg failure this row already documents. Separately, order 402 found and fixed a real code bug riding alongside this outage: several read paths (`api/pulse.js`'s money-pulse feed, and six `api/_lib/forge-store.js` listing functions behind `/api/forge-gallery`) were building avatar/forge thumbnail URLs from the raw `*.r2.dev` domain instead of the same-origin `/cdn/` proxy, which fails Chrome's Opaque Response Blocking even once R2 is healthy again. That fix does not change this row's classification or urgency; it only means fewer pages will show console errors once R2 comes back. 2026-10-24 (triage-lane deep sweep, same day, later pass): a third new symptom, a single `HTTP 502 GET /api/erc8004/metadata?uri=https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/erc8004/...json` in the 24h log window; confirmed against live `/api/healthz` at measurement time, `object_storage` still `down` with the same "Please enable R2 through the Cloudflare Dashboard" detail, so this is the same outage reaching a third route (`api/erc8004/[action].js`'s metadata proxy fetching a registrant's own R2-hosted registration JSON), not a new bug; the handler already answers the correct `502 upstream_error` instead of crashing. No code change, no new row. | Cloudflare dashboard check (owner): this is the one for the account behind `S3_BUCKET`. The retry idea is ruled out for the dominant failure mode; do not file it as a work order without re-scoping to the DEGRADED-only signature | Every avatar, thumbnail and generated GLB reads through this bucket; `/cdn/*` and the forge both degrade when it flaps | `ops_alerts` table, queried 2026-10-11, 2026-10-13, 2026-10-14 and 2026-10-24; `reports/page-audit-2026-10-24T01-31-13-697Z.md` |
| 37 | **Ship the cron time-budget fix with the next deploy** (added 2026-10-11 by the evolve loop, order 403, otherwise complete and retired). `wrapCron()` in `api/_lib/http.js` now races every cron handler against a real time budget (`maxDurationMs`, wired from each handler's own `export const maxDuration * 1000`, defaulting to 120000ms) and answers a clean `503 { reason: 'cron_timeout' }` instead of hanging until Cloud Run's blind 900s ingress kill, which is what `/api/cron/x402-ring-leak-scan` was hitting repeatedly before order 400 landed its own fix. Verified locally: a real `http.createServer` hosting `wrapCron` with an 800ms budget and a never-resolving handler answered `503 cron_timeout` at 0.809s (not 900s, not instantly); the new `tests/http-cron-timeout.test.js` (4 tests) and the added `wrapCron` case in `tests/http-db-unavailable-boundary.test.js` pass 10/10, and the timeout test was proven red (indefinite hang) against the pre-fix code via a path-scoped `git stash` before the fix landed. No migration, no env var, nothing else needed; this is a pure code fix sitting on `evolve` waiting for row 1's routine deploy cadence to carry it to `main` and production. Ship with `npm run deploy:gcp:full` (row 1 already tracks the general "approve the next deploy" gate; this row exists only so the new behavior is named for verification). Post-deploy verification: re-run the step 0 query from `prompts/finish/403-auto-cron-timeout-enforcement.md` (`gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"maximum request timeout"' --freshness=24h --project aerial-vehicle-466722-p5`) after the deploy window; a healthy rollout shows that query going quiet (or near-quiet) while `textPayload:"exceeded its"` picks up any genuine stuck cron with its name attached, cross-referenced against order 400's `x402-ring-leak-scan` fix so a recurrence is distinguished from a different handler entirely. | one deploy (already covered by row 1's cadence) | Clean, diagnosable cron timeouts platform-wide instead of a blank "maximum request timeout" | `docs/ops/production-log-triage.md`, "HTTP timeout with no cron context" section |
| 38 | **Deploy `model-trellis2` (the TRELLIS.2 GPU worker), then point `MODEL_TRELLIS2_URL` at it** (re-measured 2026-10-11 by the evolve loop, best3d order 067, built and tested on 2026-10-09, not yet deployed). `workers/model-trellis2/` is complete (Dockerfile, `cloudbuild.yaml` pinned to `three-ws-build@`, 64 of 65 local tests passing, 1 skipped), the Forge lane registry already makes `trellis2` the default image-to-3D backend with the old chain (`trellis_selfhost`, `hunyuan3d`, `trellis`, `modly`, `triposg`) as failover, and the territory router already keeps the EU, the UK and South Korea off every Tencent lane regardless. Confirmed live today: `gcloud run services describe model-trellis2 --region us-central1` answers "Cannot find service", and `three-ws-api`'s env has no `MODEL_TRELLIS2_URL`, so the registry's default lane is currently unreachable and every image-to-3D request falls through to the next lane in the chain, same as the 2026-10-09 measurement. This is a production deploy (new Cloud Run GPU service, gate 2), so no agent runs it. Commands, in order: `gcloud builds submit --config workers/model-trellis2/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 .` from the repo root, then `gcloud run services update three-ws-api --region us-central1 --update-env-vars=MODEL_TRELLIS2_URL=<service-url>` (never `--set-env-vars`, which replaces the whole set). After that, run one real image-to-3D generation and confirm the `forge_creations` row for it shows `backend: 'trellis2'`, and validate the returned GLB with `packages/glb-tools`; both are the two remaining Definition of done lines in the order file. | one build + one env update + one test generation | Closes best3d order 067; makes TRELLIS.2 (MIT, EU/UK/KR-safe) the live default instead of the untested fallback chain | [067-best3d-01-trellis2-default-lane.md](../067-best3d-01-trellis2-default-lane.md), [best3d-PROGRESS.md](best3d-PROGRESS.md) |
| 39 | **Deploy `model-pixal3d` (the Pixal3D fidelity-lane GPU worker), then point `MODEL_PIXAL3D_URL` at it** (added 2026-10-11 by the evolve loop, best3d order 068, built and tested same day). `workers/model-pixal3d/` is complete (Dockerfile, `cloudbuild.yaml` pinned to `three-ws-build@`, 81 of 82 local tests passing, 1 skipped), `api/forge.js`/`api/_lib/forge-tiers.js`/`api/_providers/gcp.js` already register and wire the `pixal3d` backend (1-4 photos, `view_labels`, `fill_other_sides`, opt-in only: never a named default or a failover target), and `src/forge.js`/`pages/forge.html` already ship the "Match my photo" engine button and panel. Confirmed live today: `gcloud run services describe model-pixal3d --region us-central1` answers "Cannot find service", and `three-ws-api`'s env has no `MODEL_PIXAL3D_URL`, so the lane reports `backend_unconfigured` today and the engine button does not render in the catalog (verified against a synthetic catalog entry in a local browser session, since the real worker isn't deployed yet). This is a production deploy (new Cloud Run GPU service, gate 2), so no agent runs it. Commands, in order (from `workers/model-pixal3d/README.md`): `workers/model-pixal3d/stage_weights.sh` (one time, idempotent weight mirror), then `gcloud builds submit --config workers/model-pixal3d/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .` from the repo root, then `gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_PIXAL3D_URL=$(gcloud run services describe model-pixal3d --region us-central1 --format='value(status.url)')` (never `--set-env-vars`, which replaces the whole set). After that, run one real 3-image generation with `backend: "pixal3d"` and confirm the `forge_creations` row records all three input URLs and the returned GLB is valid; that is the order's last unverified Definition of done line. | one weight stage + one build + one env update + one test generation | Closes best3d order 068; makes "Match my photo" (pixel-aligned fidelity to the caller's own photos, MIT + Apache-2.0) live in the Forge engine grid | [068-best3d-02-pixal3d-multiview.md](../068-best3d-02-pixal3d-multiview.md), [best3d-PROGRESS.md](best3d-PROGRESS.md) |
| 40 | **Deploy `model-rig-nonhuman` (the UniRig+SkinTokens non-humanoid rigging worker), then point `RIG_NONHUMAN_URL` at it from `model-rig`** (added 2026-10-11 by the evolve loop, best3d order 069, built and tested same day). `workers/rig-nonhuman/` is complete (Dockerfile, `cloudbuild.yaml` pinned to `three-ws-build@`, its own test suite passing locally with no GPU). This is an additional GPU service alongside the existing `model-rig`, not a replacement, so budget it against the per-region L4 quota in `docs/ops/gcp-credits-plan.md` before deploying. This is a production deploy (new Cloud Run GPU service, gate 2), so no agent runs it. Commands, in order (from `workers/rig-nonhuman/README.md`): `bash workers/rig-nonhuman/stage-assets.sh` (one time, stages UniRig's skeleton checkpoint, SkinTokens' two checkpoints, and the Qwen3-0.6B config/tokenizer SkinTokens was fine-tuned from), then `gcloud builds submit --config workers/rig-nonhuman/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .` from the repo root, then `gcloud run services update model-rig --region us-central1 --update-env-vars RIG_NONHUMAN_URL=$(gcloud run services describe model-rig-nonhuman --region us-central1 --format='value(status.url)')` (never `--set-env-vars`, which replaces the whole set). `RIG_NONHUMAN_URL` is unset by default, so until that last command runs, 100% of `model-rig` traffic stays on the pre-existing humanoid-only path; deploying the new service alone changes nothing. After wiring, run one real non-humanoid mesh (a creature or prop) through `POST /api/forge?action=rig` and confirm the response GLB is skinned with a valid skeleton. | one weight stage + one build + one env update + one test generation | Closes best3d order 069 task 1; lets `model-rig` rig creatures, props and vehicles instead of leaving them unrigged | [069-best3d-03-rig-anything.md](../069-best3d-03-rig-anything.md), [best3d-PROGRESS.md](best3d-PROGRESS.md) |
| 41 | **Deploy `model-anigen` (the AniGen rig-on-generation GPU worker), then point `MODEL_ANIGEN_URL` at it** (added 2026-10-11 by the evolve loop, best3d order 069, built and tested same day). `workers/model-anigen/` is complete (Dockerfile, `cloudbuild.yaml` pinned to `three-ws-build@`, its own test suite passing locally with no GPU), and `api/forge.js`/`api/gpt-forge.js`/`api/_lib/forge-tiers.js`/`api/_providers/gcp.js`/`src/forge.js` already register and wire the `anigen` backend end to end (single reference image, opt-in only: never a named default or a failover target, catalog `rigged: true` flag, poll response `rigged`/`joint_count` fields, "Rig on generate" engine-grid label). Confirmed live today: `gcloud run services describe model-anigen --region us-central1` answers "Cannot find service", and `three-ws-api`'s env has no `MODEL_ANIGEN_URL`, so the lane reports `backend_unconfigured` today. This is a production deploy (new Cloud Run GPU service, gate 2), so no agent runs it. Commands, in order (from `workers/model-anigen/README.md`): `bash workers/model-anigen/stage-assets.sh` (one time, stages the AniGen checkpoints under `gs://three-ws-model-weights/anigen/`), then `gcloud builds submit --config workers/model-anigen/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .` from the repo root, then `gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_ANIGEN_URL=$(gcloud run services describe model-anigen --region us-central1 --format='value(status.url)')` (never `--set-env-vars`). After that, run one real single-image generation with `backend: "anigen"` and confirm the `forge_creations` row's result reports `rigged: true` and a `joint_count`, and that the returned GLB is a valid, already-skinned asset. | one weight stage + one build + one env update + one test generation | Closes best3d order 069 task 2; makes the "Rig on generate" lane (mesh, skeleton and skin weights in one pass, no vendor cost) live in the Forge engine grid | [069-best3d-03-rig-anything.md](../069-best3d-03-rig-anything.md), [best3d-PROGRESS.md](best3d-PROGRESS.md) |

| 43 | **Deploy `model-partcrafter` (the PartCrafter image-to-parts GPU worker), then point `MODEL_PARTCRAFTER_URL` at it** (added 2026-10-11 by the evolve loop, best3d order 070, built and tested same day). `workers/model-partcrafter/` is complete (Dockerfile, `cloudbuild.yaml` pinned to `three-ws-build@`, its own test suite passing locally with no GPU), and `api/forge.js`/`api/gpt-forge.js`/`api/_lib/forge-tiers.js`/`api/_lib/forge-options.js`/`api/_providers/gcp.js`/`src/forge.js` already register and wire the `partcrafter` backend end to end (single reference image, `num_parts` 2-16 range option, catalog `editable_parts: true` flag, poll response `parts`/`part_count`/`manifest_url` fields, opt-in only: never a named default or a failover target in either direction). Confirmed live today: `gcloud run services describe model-partcrafter --region us-central1` answers "Cannot find service", and `three-ws-api`'s env has no `MODEL_PARTCRAFTER_URL`, so the lane reports `backend_unconfigured` today. This is a production deploy (new Cloud Run GPU service, gate 2), so no agent runs it. Commands, in order (from `workers/model-partcrafter/README.md`): `bash workers/model-partcrafter/stage-assets.sh` (one time, stages the PartCrafter checkpoints), then `gcloud builds submit --config workers/model-partcrafter/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .` from the repo root, then `gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_PARTCRAFTER_URL=$(gcloud run services describe model-partcrafter --region us-central1 --format='value(status.url)')` (never `--set-env-vars`). After that, run one real single-image generation with `backend: "partcrafter"` and confirm the result reports ≥2 named parts and the GLB's top-level nodes match them. | one weight stage + one build + one env update + one test generation | Closes best3d order 070 task 1 (image lane half); lets Restyle Studio's part picker work against real self-hosted output instead of only the segment lane | [070-best3d-04-editable-parts.md](../070-best3d-04-editable-parts.md), [best3d-PROGRESS.md](best3d-PROGRESS.md) |
| 44 | **Deploy `model-holopart` (the HoloPart occluded-part completion GPU worker), then point `MODEL_HOLOPART_URL` at it** (added 2026-10-11 by the evolve loop, best3d order 070, built and tested same day). `workers/model-holopart/` is complete (Dockerfile now stages the `gltfpack` binary gltf_meshopt.py's decode path needs, fixed this same pass; `cloudbuild.yaml` pinned to `three-ws-build@`; its own test suite passing locally with no GPU), and `api/forge-holopart.js`/`api/_providers/gcp.js`/`src/restyle.js` already register and wire the `holopart` mode end to end (SSRF-checked `mesh_url`, FBX rejected, seed validated, Restyle Studio's "Regenerate part" action polls it and reassembles the result under the original node name). Confirmed live today: `gcloud run services describe model-holopart --region us-central1` answers "Cannot find service", and `three-ws-api`'s env has no `MODEL_HOLOPART_URL`, so `/api/forge-holopart` answers 503 `unconfigured` today. This is a production deploy (new Cloud Run GPU service, gate 2), so no agent runs it. Commands, in order (from `workers/model-holopart/README.md`): `bash workers/model-holopart/stage-assets.sh` (one time, stages the HoloPart checkpoints), then `gcloud builds submit --config workers/model-holopart/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .` from the repo root, then `gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_HOLOPART_URL=$(gcloud run services describe model-holopart --region us-central1 --format='value(status.url)')` (never `--set-env-vars`). After that, POST a real part-segmented `mesh_url` (e.g. the segment worker's own output) to `/api/forge-holopart` and confirm the polled result's `part_count` matches the input and each part's occluded geometry is filled in. | one weight stage + one build + one env update + one test generation | Closes best3d order 070 task 1 (completion lane half); lets Restyle Studio's "Regenerate part" button produce a real filled-in part instead of only supporting manual swap | [070-best3d-04-editable-parts.md](../070-best3d-04-editable-parts.md), [best3d-PROGRESS.md](best3d-PROGRESS.md) |
| 42 | **Apply the MCP client-sessions nullable-column migration** (added 2026-10-11 by the evolve triage-lane sweep). `api/_lib/migrations/20261015010000_mcp_client_sessions_client_nullable.sql` drops the `NOT NULL` constraint on `mcp_client_sessions.client` and `mcp_client_daily.client`. This is an ACTIVE production bug, not routine deploy lag: `git merge-base --is-ancestor <mcp-clients.js commit> 66a5e93bd` confirms `api/_lib/mcp-clients.js` (the code that inserts session/day rows and can leave `client` unset for some call shapes) is already deployed and running today, so every write that violates the constraint is silently failing right now (lost MCP session/day analytics rows, not a user-facing error since the insert is best-effort). `npm run db:status` lists it as the one pending migration. Command: `node scripts/apply-migrations.mjs --apply --file 20261015010000_mcp_client_sessions_client_nullable.sql` (or `npm run db:migrate`, which applies every pending migration immediately with no dry run). | one migration apply | Stops silent MCP analytics data loss | [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md) |
| 45 | **Top up the HF Inference Providers credit balance for fal-ai and nscale (image generation), a separate pool from row 6's LLM-lane `HF_TOKEN` usage** (added 2026-10-12 by the evolve triage-lane sweep). Root-caused the `/api/3d/generate` 502 storm: both HF-routed image providers answer `402 "You have no remaining credits"` on every call (`api/_mcp3d/text-to-image.js`), alongside the already-tracked Vertex billing hold (row 20) on the image lane. The amplification bug (every request re-paying the full timeout of both known-dead lanes before ever reaching keyless Pollinations, often blowing the shared ladder budget) is fixed in code this sweep: a 401/402/403 now parks the lane for 5 minutes (`AUTH_COOLDOWN_SECONDS`), same breaker already used for Vertex elsewhere. That stops the 502 storm either way, but the ladder is still down two rungs (Vertex, HF) until the owner funds one or both; Pollinations alone is a lower-quality free-tier fallback with no paid Replicate backstop configured. Fix: top up the HF Inference Providers billing for the account behind `HF_TOKEN`, or fund the Vertex billing hold (row 20); either clears most image generations, both together clear all of it. | billing | `/api/3d/generate` image quality and the 502 rate | `scripts/gcp-triage.mjs` `forge-image-ladder-exhausted-502`, [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md) §forge-image-ladder-exhausted |

| 46 | **Build and deploy `model-text2motion` with its new MoMask backend, then benchmark it against MDM** (added 2026-10-12 by the evolve loop, best3d order 077 task 1). `workers/model-text2motion/` now carries a second generation backend, MoMask (EricGuo5513/momask-codes, MIT, published FID 0.045 on HumanML3D vs. MDM-era T2M-GPT's 0.141), selectable per request via `model: "mdm" | "momask"` on `/infer`, alongside the existing default MDM backend. `main.py`'s model selector, the new `momask_sampler.py` and shared `motion_decode.py`, the updated `Dockerfile` (clones momask-codes, installs its one missing pip dependency `einops`), and the updated `cloudbuild.yaml` (adds `MOMASK_MODEL_DIR=/weights/momask` to both the primary and standby deploy steps) are all written and locally tested (49/49 passing in `workers/model-text2motion`'s own suite, including a new 12-case `test_model_selector.py`). The real checkpoints are already staged to `gs://three-ws-model-weights/momask/t2m/` (four checkpoint dirs: `length_estimator`, `rvq_nq6_dc512_nc512_noshare_qdp0.2`, `t2m_nlayer8_nhead6_ld384_ff1024_cdp0.1_rvq6ns`, `tres_nlayer8_ld384_ff1024_rvq6ns_cdp0.2_sw`), matching momask-codes' own HumanML3D checkpoint layout, so a deploy has real weights to mount the moment it lands. This is a production deploy (rebuilds and redeploys an existing Cloud Run GPU service, gate 2), so no agent runs it. Command, from the repo root: `gcloud builds submit --config workers/model-text2motion/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .`. After it lands, run the same prompt through both backends and time the second call to each (post cold-load) for a real warm-vs-warm comparison: `curl -s -X POST "$MOTION_URL/infer" -H "authorization: Bearer $GCP_RECONSTRUCTION_KEY" -H 'content-type: application/json' -d '{"prompt":"a slow tai-chi sweep","duration_seconds":3,"fps":20,"model":"mdm"}'` and the same body with `"model":"momask"`, each followed by polling `GET $MOTION_URL/tasks/<task_id>` until `status:"done"`. That reproduced, in-house FID/latency comparison is task 1's own "benchmarked" requirement, not one of order 077's three Definition of done lines (all three passed and were reconfirmed live on 2026-10-12 against the already-deployed MDM backend, so the order retired without waiting on this deploy); the published 0.045 FID in the README is momask-codes' own number, not yet confirmed against this worker's own output. | one build + one deploy + two benchmark calls | Gives the Animation Studio and `/api/forge-motion` a second, stronger text-to-motion backend selectable per request (best3d order 077 is retired; see its 2026-10-12 entries in [best3d-PROGRESS.md](best3d-PROGRESS.md)) | [workers/model-text2motion/README.md](../../workers/model-text2motion/README.md) |
| 47 | **Buy a paid CoinGecko plan (or confirm a free monthly reset) for `/api/coin/*`.** Added 2026-10-12 by the triage-lane sweep: the deep sweep's `coingecko-quota-exhausted-502` finding (`/api/coin/detail`, `/api/coin/exchange`, 3 occurrences in the last 24h) names its own fix as `gcloud run services update three-ws-api --region us-central1 --remove-env-vars COINGECKO_API_KEY`, config-only and pre-approved. Checked live before running it: `gcloud run services describe three-ws-api --region us-central1` shows no `COINGECKO_API_KEY` env var on the service at all, so that fix is already in effect and there is nothing to remove. Every `/api/coin/*` call is already keyless; the 502s are the keyless CoinGecko tier itself being rate-limited (the Cloud Run egress IP is shared across every request this service makes), which only a paid CoinGecko API plan or a wait for next month's free-tier reset resolves. No in-repo code or config change can fix this. **Re-measured 2026-10-13 (triage-lane sweep, fifth pass):** still no `COINGECKO_API_KEY` on `three-ws-api` (`gcloud run services describe`); 20 occurrences in the last 24h across `/api/coin/exchange`, `/api/coin/detail`, `/api/coin/tickers`, `/api/coin/ohlc`. No change. | one purchase decision | Stops the intermittent 502s on coin detail/exchange pages | [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md) |
| 48 | **Ship the dist-lib CDN embed size fix with the next deploy** (added 2026-10-12 by the triage-lane sweep, pure code fix, no migration, no env var). Root-caused the previously-unclassified `/dist-lib/agent-3d.js` and `/agent-3d/latest/agent-3d.js` 500s: `src/runtime/whisper-stt.js`'s on-device speech recognizer did a bare `import('@huggingface/transformers')`, which `vite.config.js`'s `inlineDynamicImports` lib-build setting inlines (it has to, so the CDN embed stays one file), dragging in onnxruntime-web's WebGPU runtime and bloating `agent-3d.js`/`agent-3d.umd.cjs` from the documented ~600-900KB gzipped to 76MB raw each, past Cloud Run/GFE's response-size handling for HTTP/1.1 or identity-encoding clients (confirmed live via curl with varying `Accept-Encoding`; gzip+HTTP/2 at 21MB succeeds, identity/HTTP/1.1 at 76MB 500s with an empty body). Fixed on `evolve` (commit `f939d5ef1`): the import now goes through the existing `loadModule()` CDN mirror loader instead of a bundler-visible specifier, the same pattern already used for WalletConnect and Leaflet. Local rebuild (`npm run build:lib:full`) drops both files to 4.1MB; `tests/lib-bundle-size.test.js` (new) proved red against the unfixed build and green after; `whisper-stt.test.js`'s 14 tests still pass. Sitting on `evolve` waiting for the usual fast-forward-to-`main` and row 1's deploy cadence; no separate action beyond that deploy. Post-deploy verification: `curl -sI -H "Accept-Encoding: identity" --http1.1 https://three.ws/dist-lib/agent-3d.js` should answer 200, not 500. | one deploy (already covered by row 1's cadence) | Fixes the `<agent-3d>` CDN embed for every third-party site that drops it in over plain HTTP/1.1 or without gzip | `tests/lib-bundle-size.test.js`, [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md) |
| 49 | **Finish wiring the Tripo signed webhook (work order 084-partners-01), three linked steps.** (added 2026-10-12 by the evolve loop closing out order 084). Not an active bug today: `TRIPO_WEBHOOK_SECRET` is unset in production, so `verifySignature` in `api/forge/webhook/tripo.js` rejects before it ever touches the database, and polling (`pollJob` in `api/forge.js`) answers every Tripo job either way. But all three steps are needed together before the webhook path can turn on for real: (a) apply the pending idempotency-ledger migration, `node scripts/apply-migrations.mjs --apply --file 20261015040000_forge_webhook_deliveries.sql` (or `npm run db:migrate`, which applies every pending migration immediately with no dry run; `npm run db:status` shows it as the only one left from this order), since `claimForgeWebhookDelivery`/`markForgeWebhookApplied` in `api/_lib/forge-store.js` would otherwise hit `relation forge_webhook_deliveries does not exist` the first time a verified delivery arrives; (b) set `TRIPO_WEBHOOK_SECRET` (`gcloud run services update three-ws-api --region us-central1 --update-env-vars TRIPO_WEBHOOK_SECRET=...`, never `--set-env-vars`) to whatever Tripo's dashboard issues; (c) register the production webhook URL (`https://three.ws/api/forge/webhook/tripo`) in Tripo's own dashboard, which only exists once a Tripo account is set up, the same account gate order 936 tracks for `TRIPO_API_KEY`. Putting a platform-paid `TRIPO_API_KEY` on the service is tracked separately in **order 936** (`936-partners-13-tripo-reply-and-house-key.md`), not duplicated here, since that order is itself gated on the owner's reply and call with Tripo. | one migration apply + one env var + one dashboard step | Lets a Tripo generation complete by webhook instead of only by poll, once a Tripo account exists | [084-partners-01-tripo-v3-house-lane.md](../084-partners-01-tripo-v3-house-lane.md), [936-partners-13-tripo-reply-and-house-key.md](../936-partners-13-tripo-reply-and-house-key.md) |

| 50 | **Publish the CC0 bulk animation library to production** (added 2026-10-13 by the evolve loop closing out order 085-partners-02). `GET /api/animations/library` currently answers `total: 0` in production: the bulk motion library (previously baked from Mixamo, which Adobe's own Mixamo FAQ says may not be redistributed as raw files) has been rebuilt from two CC0 1.0 Universal sources, Quaternius's Universal Animation Library 2 and Mesh2Motion's human animation packs, 219 clips retargeted and verified locally (0 failures, every entry carries `source`/`license`). The only remaining step is to run `node scripts/cc0-animation-library.mjs --upload` with the production R2 credentials (`node scripts/read-service-env.mjs` to read them from the `three-ws-api` Cloud Run service if not already in `.env.local`), which publishes the staged manifest to the live bucket the endpoint reads at request time, no code deploy required. This was deliberately not run this session: it is a production-publish action (CLAUDE.md gate 2) that makes 219 clips reachable to real users and third-party mirrors immediately. Separately, and not blocking this row: the Adobe Mixamo redistribution-permission letter is drafted and ready at [`marketing/growth/submissions/adobe-mixamo-permission.md`](../../marketing/growth/submissions/adobe-mixamo-permission.md); sending it is owner order 938. | one upload command | Makes the openly-licensed bulk animation library live on `/animations` and `GET /api/animations/library` | [085-partners-02-animation-library-license.md](../085-partners-02-animation-library-license.md) |
| 51 | **Publish and submit the LiveKit and Pipecat avatar integrations** (added 2026-10-13 by the evolve loop closing out order 087-partners-04). Both packages (`integrations/livekit/livekit-plugins-threews/`, `integrations/pipecat/pipecat-threews/`) are built, tested (unit tests, ruff lint/format), and verified end to end against a real local `livekit-server` with real browser automation driving the actual avatar lipsync and gesture off a live agent/bot in both frameworks (Playwright specs, both passing; the Pipecat run also captured the 30-60s demo video `COMMUNITY_INTEGRATIONS.md` asks for, saved locally and gitignored). Three remaining steps are all owner actions (CLAUDE.md gate 2, external posting/publishing): (a) `python -m build && twine upload` (or equivalent) to publish each package to PyPI as `livekit-plugins-threews` and `pipecat-threews`; (b) open the LiveKit plugin pull request against `livekit/agents` using the title, description and verification packet in [`marketing/growth/submissions/livekit-avatar-plugin.md`](../../marketing/growth/submissions/livekit-avatar-plugin.md), then apply to the LiveKit Startups program; (c) open the Pipecat documentation pull request against `pipecat-ai/pipecat` using the three files in `integrations/pipecat/pipecat-threews/docs-submission/` and the text in [`marketing/growth/submissions/pipecat-integration.md`](../../marketing/growth/submissions/pipecat-integration.md), attaching the local demo video. | two PyPI publishes + two pull requests + one program application | LiveKit plugin PR 938/Startups 939, Pipecat community-integration listing | [087-partners-04-livekit-pipecat-avatar.md](../087-partners-04-livekit-pipecat-avatar.md) |
| 52 | **Register the Discord application and verify the Activity in a real Discord client** (added 2026-10-13 by the evolve loop closing out order 088-partners-05). The shared Forge room Activity ([`src/discord-activity/app.js`](../../src/discord-activity/app.js), [`api/gateway/discord-activity-*`](../../api/gateway/), migration [`20261015050000_discord_activity_rooms.sql`](../../api/_lib/migrations/20261015050000_discord_activity_rooms.sql)) is built and unit-tested (`tests/discord-activity-store.test.js`, `tests/discord-activity-auth.test.js`, 13/13 passing), and the OAuth2 token-exchange path was proven live against Discord's real endpoint (`curl` to `https://discord.com/api/oauth2/token` with a placeholder client returned Discord's real, documented `invalid_client` 400, matching the error path the code already surfaces). No Discord application has ever been registered in this production project (`node scripts/read-service-env.mjs '^DISCORD' --names` returns zero matches), so nothing past that point is testable from this workspace. Full step-by-step with exact Developer Portal settings and the Discovery listing copy: [`marketing/growth/submissions/discord-activity.md`](../../marketing/growth/submissions/discord-activity.md). Summary: (a) create the Discord application and enable Activities, pointing the root URL Mapping at `/discord-activity` and adding a `cdn` URL Mapping for the R2 host; (b) set the OAuth2 redirect and `identify` scope; (c) `gcloud run services update three-ws-api --region us-central1 --update-env-vars DISCORD_CLIENT_ID=...,DISCORD_CLIENT_SECRET=...,DISCORD_PUBLIC_KEY=...` (never `--set-env-vars`); (d) `npm run db:status` then `npm run db:migrate` to create the `discord_activity_rooms`/`discord_activity_events` tables (applies immediately, no dry run); (e) create a test Discord server, invite two accounts, open the Activity in a voice channel on both, and confirm both see the same prompt/generation/vote state (screenshots); (f) submit the Discovery listing using the exact copy in the submission file. | one Developer Portal app + one env update + one migration apply + one live two-account verification + one Discovery submission | Turns on the Discord Activity for real users; completes order 088's two-accounts-in-Discord Definition of Done line | [088-partners-05-discord-activity.md](../088-partners-05-discord-activity.md), [marketing/growth/submissions/discord-activity.md](../../marketing/growth/submissions/discord-activity.md) |
| 53 | **Reset or upgrade the Birdeye API plan (`birdeye-api-key` Secret Manager secret, used by `three-ws-api`).** Added 2026-10-13 by the triage-lane sweep (fifth pass): the deep sweep's `pump-price-history-upstreams-502` finding on `/api/pump/price-history` traced to Birdeye's OHLCV rung. Confirmed live: `curl -H "X-API-KEY: $BIRDEYE_API_KEY" -H "x-chain: solana" "https://public-api.birdeye.so/defi/ohlcv?..."` answers `{"success":false,"message":"Compute units usage limit exceeded"}` (HTTP 400). 5 occurrences of this exact message in the service logs over the last 24h, spaced roughly every 6 hours, meaning the plan's compute-unit allowance is exhausted well before each period rolls over. While Birdeye is out, affected mints fall back to GeckoTerminal alone (`api/_lib/birdeye.js`, `api/pump/price-history.js`); a mint with no cache yet on both rungs 502s cleanly rather than guessing. No in-repo code or config change raises a third-party compute-unit cap. | one plan upgrade decision | Keeps the pump.fun price-history chart populated from Birdeye instead of occasionally falling through to a 502 | [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md) |
| 54 | **Register the Shopify Partner app, run its migration, and verify the photo-to-3D flow on a development store** (added 2026-10-13 by the evolve loop closing out order 091-partners-08). The embedded app ([`api/shopify/`](../../api/shopify/), [`api/_lib/shopify/`](../../api/_lib/shopify/), [`pages/shopify-app.html`](../../pages/shopify-app.html), [`src/shopify-app/app.js`](../../src/shopify-app/app.js), migration [`20261015060000_shopify_app.sql`](../../api/_lib/migrations/20261015060000_shopify_app.sql)) is built and unit-tested (`tests/shopify-hmac.test.js`, `tests/shopify-session-token.test.js`, `tests/shopify-store.test.js`, `tests/shopify-graphql.test.js`, `tests/shopify-webhooks.test.js`, 42/42 passing, real HMAC/JWT round trips and a real PGlite-backed store, no mocked SQL semantics). No Shopify Partner app exists in production yet (`node scripts/read-service-env.mjs '^SHOPIFY' --names` returns zero matches), so nothing past OAuth is testable from this workspace, and the migration is deliberately left unapplied (`npm run db:status` lists it `[pending]`): this evolve session is denied every owner-gated action, applying migrations to the production database included. Full step-by-step with exact Partner Dashboard settings and the App Store listing copy: [`marketing/growth/submissions/shopify-app.md`](../../marketing/growth/submissions/shopify-app.md). Summary: (a) create the Shopify Partner account and app, App URL `https://three.ws/apps/shopify`, redirect `https://three.ws/api/shopify/callback`; (b) set scopes to `read_products,write_products` and enable embedding; (c) `gcloud run services update three-ws-api --region us-central1 --update-env-vars SHOPIFY_API_KEY=...,SHOPIFY_API_SECRET=...,SHOPIFY_APP_URL=https://three.ws` (never `--set-env-vars`), plus `VITE_SHOPIFY_API_KEY` as a build-time variable before the next frontend build; (d) `npm run db:status` then `npm run db:migrate` to create the four `shopify_*` tables (applies immediately, no dry run); (e) create a development store, install the app, generate and attach a model, confirm it renders on the live storefront product page, approve a test-mode Billing charge, and send test webhook deliveries for the three mandatory topics plus `app/uninstalled` from the Partner Dashboard (screenshots); (f) submit the App Store listing using the exact copy in the submission file. | one Partner Dashboard app + one env update + one migration apply + one live development-store verification + one App Store submission | Turns on the Shopify app for real merchants; completes order 091's three live-verification Definition of Done lines | [091-partners-08-shopify-product-media.md](../091-partners-08-shopify-product-media.md), [marketing/growth/submissions/shopify-app.md](../../marketing/growth/submissions/shopify-app.md) |
| 55 | **Register the VRoid Hub developer application, set its client credentials, run its migration, and verify the avatar import on a real VRoid Hub account** (added 2026-10-13 by the evolve loop closing out order 092-partners-09). The OAuth connect flow, license evaluator, listing endpoint, and import endpoint ([`api/auth/vroid/[action].js`](../../api/auth/vroid/%5Baction%5D.js), [`api/_lib/vroid/`](../../api/_lib/vroid/), [`api/vroid/`](../../api/vroid/), [`pages/import-vroid.html`](../../pages/import-vroid.html), migration [`20261015070000_vroid_hub_source.sql`](../../api/_lib/migrations/20261015070000_vroid_hub_source.sql)) are built and unit-tested (`tests/vroid-license.test.js`, 9/9 passing). Every endpoint shape (PKCE requirement on `/oauth/authorize`, the Doorkeeper `/oauth/token` grant-type requirement, the `{data,error,_links,rand}` envelope, the real `CharacterModelLicenseSerializer` fields, and the two-step `download_licenses` flow) was confirmed live against `hub.vroid.com` and `developer.vroid.com`'s published API reference this session, not guessed. No VRoid Hub application exists in production yet (`node scripts/read-service-env.mjs '^VROID' --names` returns zero matches), so nothing past OAuth is testable from this workspace, and the migration is deliberately left unapplied (`npm run db:status` lists it `[pending]`): this evolve session is denied every owner-gated action, applying migrations to the production database included. Full step-by-step with exact hub.vroid.com/oauth/applications settings: [`marketing/growth/submissions/vroid-hub-app.md`](../../marketing/growth/submissions/vroid-hub-app.md). Summary: (a) create the application at `hub.vroid.com/oauth/applications` (confirmed live 2026-10-13, a real pixiv-account "Application management" sign-in screen), redirect URI `https://three.ws/api/auth/vroid/callback`, and submit for approval if the dashboard requires it; (b) no scope changes needed beyond VRoid Hub's own `default` scope; (c) `gcloud run services update three-ws-api --region us-central1 --update-env-vars VROID_HUB_CLIENT_ID=...,VROID_HUB_CLIENT_SECRET=...` (never `--set-env-vars`); (d) `npm run db:status` then `npm run db:migrate` to widen the `avatars.source` check constraint (applies immediately, no dry run); (e) connect a real VRoid Hub account at `/import/vroid`, import a character, confirm it lands on `/avatars/{id}/edit` with idle/walk playing, confirm the creator credit line renders, and confirm a license that disallows an action actually blocks it (screenshots). | one hub.vroid.com app + one env update + one migration apply + one live account verification | Turns on the VRoid Hub avatar import for real users; completes order 092's live-verification Definition of Done lines | [092-partners-09-vroid-hub-import.md](../092-partners-09-vroid-hub-import.md), [marketing/growth/submissions/vroid-hub-app.md](../../marketing/growth/submissions/vroid-hub-app.md) |

| 56 | **Publish the AI SDK/LangChain packages and submit the six agent-registry entries plus the LangChain integration issue** (added 2026-10-13 by the evolve loop closing out order 093-partners-10). `packages/ai-sdk/` (`@three-ws/ai-sdk`) and `packages/langchain/` (`@three-ws/langchain`) are both built, real-API-tested (`npm test` in each: 5/5 passing, live calls against production forge/rig/render/agent-chat/animate), and `npm pack --dry-run` clean. Neither has ever been published (new package names, no npm publish has run from this workspace). The six registry entries for Hermes, Kilo, OpenHands, OpenCode, Dify and cursor.directory are written in `marketing/growth/submissions/agent-registries/` in each registry's confirmed real format, and the LangChain integration-package issue text is at [`packages/langchain/INTEGRATION_ISSUE.md`](../../packages/langchain/INTEGRATION_ISSUE.md). Summary: (a) `cd packages/ai-sdk && npm publish --access public`, then the same in `packages/langchain/`; (b) open the LangChain integration issue against `langchain-ai/langchainjs` using `packages/langchain/INTEGRATION_ISSUE.md`'s text; (c) submit each of the six registry entries per its own file's "Owner steps" section in `marketing/growth/submissions/agent-registries/`. | two npm publishes + one GitHub issue + six registry submissions | Lists three.ws in the Vercel AI SDK and LangChain JS tool ecosystems and in six agent-framework registries | [093-partners-10-agent-tool-packages.md](../093-partners-10-agent-tool-packages.md), [packages/langchain/INTEGRATION_ISSUE.md](../../packages/langchain/INTEGRATION_ISSUE.md), [marketing/growth/submissions/agent-registries/](../../marketing/growth/submissions/agent-registries/) |
| 57 | **Create a WordPress.org account and submit the plugin; create a Framer account and submit the Marketplace listing; create a Webflow account, run `webflow devlink import`, and submit the Apps marketplace listing** (added 2026-10-13 by the evolve loop closing out order 094-partners-11). All three embeds for `<agent-3d>` are built and verified: the WordPress plugin ([`integrations/wordpress/three-ws-agent/`](../../integrations/wordpress/three-ws-agent)) passes the official Plugin Check tool against a real local WordPress 7.1.3 in Docker ("Checks complete. No errors found.", reproduced in [`docs/wordpress-embed.md`](../../docs/wordpress-embed.md)); the Framer code component ([`integrations/framer/`](../../integrations/framer)) and the Webflow Code Component ([`integrations/webflow/`](../../integrations/webflow)) each boot a live WebGL canvas against the real pinned production CDN release in a real-React Playwright harness (`tests/e2e/agent-3d-framer-component.spec.js`, `tests/e2e/agent-3d-webflow-component.spec.js`, both passing), and the Webflow component additionally compiles through the real, unmodified `@webflow/webflow-cli`'s `devlink bundle` ("Code Library bundled successfully!"). No WordPress.org, Framer, or Webflow account exists in this workspace, so nothing past this point is testable here. Full step-by-step with exact settings and listing copy for all three: [`marketing/growth/submissions/site-builders.md`](../../marketing/growth/submissions/site-builders.md). Summary: (a) create a WordPress.org account, submit the plugin zip for review, and commit to the assigned SVN repo once approved; (b) create a Framer account, paste the three component files into a project, confirm it renders in Framer's own canvas, and submit to the Marketplace; (c) create a Webflow account, run `webflow auth login` then `webflow devlink import` from `integrations/webflow/`, confirm the component drags into the Designer, and submit to the Apps marketplace. | three account signups + two submissions + one SVN commit + one devlink import | Lists three.ws's `<agent-3d>` embed in the WordPress.org plugin directory, the Framer Marketplace, and the Webflow Apps marketplace | [094-partners-11-site-builder-embeds.md](../094-partners-11-site-builder-embeds.md), [marketing/growth/submissions/site-builders.md](../../marketing/growth/submissions/site-builders.md) |
| 58 | **Create `github.com/nirholas/three-ws-home-assistant` from the exported tree, confirm its two CI workflows pass, cut a `v1.0.1` release, then open the `hacs/default` and `home-assistant/brands` pull requests** (added 2026-10-13 by the evolve loop closing out order 095-partners-12). `home-assistant-integration/` now validates clean: `manifest.json`'s broken `documentation` link fixed to the live `/docs/home-relay`, `version` bumped to `1.0.1`, `hacs.json`'s minimum Home Assistant version corrected to `2024.12.0` (the first release bundling the `aiohttp.ClientWSTimeout` the integration's relay client uses, confirmed against HA's own `package_constraints.txt` history), and real local brand icons added at `custom_components/three_ws/brand/{icon,icon@2x,dark_icon,dark_icon@2x}.png`. `node scripts/export-hacs-repo.mjs` builds the exact standalone-repository tree (the integration, README, LICENSE, `hacs.json`, and the two validation workflows, which live only in that exported tree since this monorepo runs no GitHub Actions of its own) under `dist/hacs-export/`. Verified this session with the real tools HACS's own CI runs: the real `ghcr.io/home-assistant/hassfest` Docker image against the exported tree ("Invalid integrations: 0"), the real upstream HACS schema/brand/readme validators from `hacs/integration`'s own source (all pass; the GitHub-settings-dependent checks are architecturally impossible to run before the repository exists), and a full real end-to-end install: a real `ghcr.io/home-assistant/home-assistant:stable` container onboarded via its own REST API, paired through the real config flow against a real `services/home-relay` server, 18 real entities read back, and a confirmed auto-reconnect after a relay restart. Full step-by-step with exact settings and PR text for both targets: [`marketing/growth/submissions/home-assistant.md`](../../marketing/growth/submissions/home-assistant.md). Summary: (a) push `dist/hacs-export/` (rebuild with `node scripts/export-hacs-repo.mjs` first) to a new public personal repository at `github.com/nirholas/three-ws-home-assistant`, set its description/topics/issues, confirm `hassfest.yml` and `hacs.yml` both pass on `main`, and cut a `v1.0.1` release; (b) add it to HACS as a custom repository in a real Home Assistant instance and confirm it installs; (c) fork `hacs/default`, add `"nirholas/three-ws-home-assistant"` to the `integration` file between `nimroddolev/chime_tts` and `nishithdev/wled-taskmap`, and open the PR with the title/description already written in the submission file; (d) fork `home-assistant/brands`, copy the four PNGs already sitting in this repository into `custom_integrations/three_ws/`, and open that PR with its own title/description. | one repository creation + one release cut + two pull requests | Lists three.ws's Home Assistant integration in the HACS default store and gives it an official brand icon | [095-partners-12-home-assistant-hacs.md](../095-partners-12-home-assistant-hacs.md), [marketing/growth/submissions/home-assistant.md](../../marketing/growth/submissions/home-assistant.md) |
| 59 | **Push every staged standalone mirror** (added 2026-10-14 by the evolve loop closing out order 500-integrate-01). `npm run sync:repos` now stages a one-commit snapshot per mirror under `dist/standalone-mirrors/<repo>/` instead of force-pushing, reading `data/standalone-mirrors.json` as the single source of truth for which monorepo directory maps to which public repo (this also fixes the eleven mirrors already renamed on GitHub, so no duplicate repo gets created for them). It never calls `gh`, never pushes, and makes no network writes; the script's own output after staging is the exact push line for each mirror, in the form `git -C dist/standalone-mirrors/<repo> push --force https://github.com/nirholas/<repo>.git HEAD:main`. Run `npm run sync:repos` (optionally `-- --only <repo>` for a single mirror), review a staged tree if you want to, then run the printed push command for each mirror you want to publish. `npm run sync:repos:check` reports drift against each mirror's live tree without writing anything, useful to see which mirrors are stale before deciding which pushes to run. | one `npm run sync:repos` run plus N `git push --force` commands (one per mirror, printed by the tool) | Publishes the Apache-2.0 license-footer fix and the renamed-mirror corrections to every public GitHub mirror | [500-integrate-01-mirror-manifest.md](../500-integrate-01-mirror-manifest.md) (retired this session; see `_context/integrate-PROGRESS.md`), [data/standalone-mirrors.json](../../data/standalone-mirrors.json) |
| 60 | **Approve bumping `@nirholas/pump-sdk` from `^1.30.0` to `^1.36.0`** in `packages/avatar-agent-mcp/package.json` (added 2026-10-14 by the evolve loop closing out order 501-integrate-02). The `avatar-agent-mcp` GitHub mirror moved to this range on its own; `npm run mirrors:drift` flagged the drift. This names another project's SDK, so the commit gate applies: the edit is made and verified (`npm install`, `npm ls @nirholas/pump-sdk` → `1.36.0`, `npm test` → 26/26 green) but held staged, uncommitted, in the worktree rather than committed. The order's own text also named a "2.x move with holder-reward launches"; that claim is stale, the real current GitHub range is `^1.36.0` (still 1.x) and no holder-reward code exists in the mirror (checked, no match for `holder.reward`/`holder_reward`/`holderReward`). To approve: review the staged diff (`git diff packages/avatar-agent-mcp/package.json package-lock.json`), then `git add packages/avatar-agent-mcp/package.json package-lock.json && git commit`. | one `git add` + `git commit` | Keeps `packages/avatar-agent-mcp` on the pump-sdk range its own GitHub mirror and `npm test` already validate | [501-integrate-02-mirror-drift-report.md](../501-integrate-02-mirror-drift-report.md) (retired this session; see `_context/integrate-PROGRESS.md`) |
| 62 | **Deploy `services/pump-claims` (new Cloud Run service) and apply its migration** (added 2026-10-14 by the evolve loop closing out order 506-integrate-07). The service is a standalone real-time listener: it subscribes to PumpFees program logs, decodes and attributes every GitHub social-fee-PDA claim (`claim_social_fee_pda`), and writes it to a new `pump_fee_claims` table, so `api/_lib/pump-claims.js`'s claims feed can read a persisted real-time source instead of re-scanning RPC history on every request (it still falls back to the RPC scan whenever the table has nothing for the requested window). Built and verified this session: 21/21 `node --test` passing (decode, attribution, idempotent insert, reconnect/gap-fill, a 429-backoff helper for the free RPC lane), a Docker image built AND run (not just built) confirming every transitively-imported module resolves, a new transitive-import-aware vitest guard (`tests/pump-claims-worker-image.test.js`) so a future drift fails the build instead of crashing the container on boot, and the actual migration file applied and verified with the real `npm run db:migrate -- --apply --file 20261015080000_pump_fee_claims.sql` / `npm run db:check` tooling against a local throwaway Postgres (`scripts/use-local-neon.mjs`), never against production. Two things only the owner can do: (a) apply the migration to the real production database, exactly `npm run db:migrate -- --apply --file 20261015080000_pump_fee_claims.sql` (read `npm run db:status` first; this applies immediately, no dry run, and the shared worktree may have other agents' unrelated pending migrations queued, so review the full pending list before running); (b) deploy the service, exactly `gcloud builds submit --config services/pump-claims/cloudbuild.yaml .` from the repo root (pinned to the `three-ws-build@`/`three-ws@` service accounts, `--no-cpu-throttling --min-instances=1`, defaults `SOLANA_RPC_URL` to the free `api.mainnet-beta.solana.com` lane, one of only two lanes measured to serve `logsSubscribe`; see `docs/ops/solana-rpc-lanes.md`). After both land, run `node services/pump-claims/backfill.js --days=7` once (or let the live listener's cold-start gap-fill do it) so the table isn't empty on day one, then confirm with `select count(*) from pump_fee_claims;`. One real finding from this session worth knowing before that backfill runs: the PumpFees program is extremely busy overall (measured ~500 signatures/second across ALL its traffic, not just GitHub claims), so `backfill.js`'s `MAX_SIGNATURES_SCANNED` safety cap (20,000) will be reached within roughly the most recent minute of chain activity regardless of the `--days` flag; a true 7-day backfill of this specific claim type is not reachable by walking raw signature history on any RPC lane and would need a dedicated indexer if ever required, the live listener (real-time, no scan) is the real source of ongoing coverage. | one migration apply + one `gcloud builds submit` + one backfill run | Makes the claims feed's GitHub-attribution path real-time and self-hosted, ending its implicit dependence on RPC-scan freshness per request | [506-integrate-07-pump-claims-listener.md](../506-integrate-07-pump-claims-listener.md), [services/pump-claims/README.md](../../services/pump-claims/README.md) |
| 67 | **Set a dedicated `PAY_VERDICT_HMAC_KEY` on the production Cloud Run service** (added 2026-10-15 by the evolve loop closing out order 518-integrate-19; renumbered from a collided row 63 by the 2026-10-15 triage-lane sweep, two concurrent agents having picked the same number in this shared worktree; row 63 stays with the per-coin earnings migration below). Not an active bug: `api/_lib/env.js` falls back from `PAY_VERDICT_HMAC_KEY` through `PAYMENT_SESSION_SECRET`, `WALLET_CAPABILITY_SECRET`, `WALLET_ENCRYPTION_KEY`, to `JWT_SECRET`, so every payment-session verdict (allow, reject, or `requires_approval`) is already signed and tamper-evident in production today on whichever of those is set. Setting a dedicated key only gives verdict signatures their own rotatable secret, so rotating `PAYMENT_SESSION_SECRET` (which also mints the `pss_` bearer tokens) stops also invalidating every historical verdict signature. Generate a fresh random value and set it with `gcloud run services update three-ws-api --region us-central1 --update-env-vars PAY_VERDICT_HMAC_KEY=<fresh random value>` (this is a config-only env-var change, pre-approved by CLAUDE.md; no code change or deploy is needed for it to take effect). A dev value already exists in this worktree's gitignored `.env.local`, generated and verified locally this session; it was deliberately not reused for production so the owner can mint production's own secret rather than inherit one that ever existed in a session transcript. | minutes | Gives payment-session verdict signatures their own rotatable secret, independent of `PAYMENT_SESSION_SECRET` | [docs/payment-sessions.md](../../docs/payment-sessions.md), [integrate-PROGRESS.md](integrate-PROGRESS.md), 2026-10-15 entry |
| 61 | **Push and archive 7 retired repos** (added 2026-10-14 by the evolve loop closing out order 503-integrate-04). `data/retired-repos.json` lists `three-ui`, `crypto-market-data`, `crypto-market-data-ts`, and `crypto-data-aggregator` (all superseded by the `/markets` page or `src/` in this monorepo), `memescope-monday-directory` (duplicate of `memescope-monday`), and one repo from each of the two Robinhood Chain duplicate pairs (`robinhood-chain-alert-bot`, duplicate of `robinhood-chain-alerts`; `robinhood-chain-trading-bot`, duplicate of `robinhood-chain-traders`). `npm run retire:repos` staged a one-commit pointer README under `dist/retired-repos/<repo>/` for each, explaining the retirement and linking to the replacement; it never calls `gh` and never pushes. To approve, run these 14 commands (7 pushes, 7 archives): `git -C dist/retired-repos/three-ui push --force https://github.com/nirholas/three-ui.git HEAD:main && gh repo archive nirholas/three-ui --yes`, `git -C dist/retired-repos/crypto-market-data push --force https://github.com/nirholas/crypto-market-data.git HEAD:main && gh repo archive nirholas/crypto-market-data --yes`, `git -C dist/retired-repos/crypto-market-data-ts push --force https://github.com/nirholas/crypto-market-data-ts.git HEAD:main && gh repo archive nirholas/crypto-market-data-ts --yes`, `git -C dist/retired-repos/crypto-data-aggregator push --force https://github.com/nirholas/crypto-data-aggregator.git HEAD:main && gh repo archive nirholas/crypto-data-aggregator --yes`, `git -C dist/retired-repos/memescope-monday-directory push --force https://github.com/nirholas/memescope-monday-directory.git HEAD:main && gh repo archive nirholas/memescope-monday-directory --yes`, `git -C dist/retired-repos/robinhood-chain-alert-bot push --force https://github.com/nirholas/robinhood-chain-alert-bot.git HEAD:main && gh repo archive nirholas/robinhood-chain-alert-bot --yes`, `git -C dist/retired-repos/robinhood-chain-trading-bot push --force https://github.com/nirholas/robinhood-chain-trading-bot.git HEAD:main && gh repo archive nirholas/robinhood-chain-trading-bot --yes`. `dist/` is gitignored, so re-run `npm run retire:repos` first if the staged trees were cleaned since this session. | 7 pushes + 7 archives | Removes 7 stale/duplicate public repos from the owner's GitHub without losing their history (each gets a pointer commit first) | [503-integrate-04-robinhood-copies-and-retired-repos.md](../503-integrate-04-robinhood-copies-and-retired-repos.md) (retired this session; see `_context/integrate-PROGRESS.md`) |

| 64 | **Create the mainnet native-launchpad curve config and pin it, activating the lane** (added 2026-10-14 by the evolve loop closing out order 512-integrate-13). `api/_lib/native-launch/config.js`'s curve now opens every pool at a 50% anti-snipe trading fee that decays exponentially to the steady-state 1% over the first 100 slots (Meteora DBC's own fee scheduler, verified by `tests/native-launch-curve.test.js`, a devnet e2e run against a local validator cloning the real DBC/Token-2022/ATA/Metaplex programs, and a zero-cost `--simulate` run against the live mainnet DBC program). Production currently has zero `NATIVE_LAUNCH_*` env vars set (`gcloud run services describe three-ws-api --region us-central1` env list checked), so this is first-time lane activation, not a change to a live config; no existing launch is affected. Exact command: `node scripts/native-launchpad-create-config.mjs --network mainnet`, needing `NATIVE_LAUNCH_PARTNER_SECRET_BASE58` (or `X402_TREASURY_SECRET_BASE58` as a fallback signer) funded with at least 0.05 SOL in that wallet (the script's own balance floor for rent + fees headroom); the on-chain spend itself is about 0.006 SOL (this order's own estimate for the `createConfig` transaction's rent and fee). Optionally set `NATIVE_LAUNCH_FEE_WALLET` first if the platform's fee claimer should be a wallet other than the signer. The script prints the created config pubkey and the exact env line to pin; run `gcloud run services update three-ws-api --region us-central1 --update-env-vars NATIVE_LAUNCH_CONFIG_KEY=<printed pubkey>` (config-only, pre-approved) to put the lane live. | one `node scripts/native-launchpad-create-config.mjs --network mainnet` run (~0.006 SOL) + one `gcloud run services update --update-env-vars` pin | Activates the native $THREE launchpad lane on mainnet with the decaying anti-snipe fee baked into the curve from the very first launch | [512-integrate-13-anti-snipe-native-lane.md](../512-integrate-13-anti-snipe-native-lane.md) |
| 65 | **Apply the payment-session policy-upgrades migration, then ship it with the next deploy** (added 2026-10-15 by the triage-lane deep sweep, order 518-integrate-19 close-out). `api/_lib/migrations/20261015100000_payment_session_policy_upgrades.sql` adds `approval_threshold_usdc`, `blocked_hosts` and `per_rail_daily_usdc` to `payment_sessions`, the signed-verdict columns (`policy_digest`, `verdict_code`, `verdict_signature`, `verdict_signed_at`) to `payment_session_executions`, and the new `payment_session_rail_reservations` table backing the rolling-window per-rail cap. `npm run db:status` lists it as one of the pending migrations today. Not yet an active production bug (the code half, `api/_lib/pay/spend-governor.js` and `api/pay/simulate.js`'s shared `policy.js`, is still only on `evolve`/this worktree, not deployed), but it must be applied in the same window as that code deploys: the governor's atomic enforcement and the simulator's parity check both read and write these columns unconditionally, so deploying the code first against the unmigrated table would 500 every payment-session create/execute call with Postgres `42703 undefined_column`. Apply with `node scripts/apply-migrations.mjs --apply --file 20261015100000_payment_session_policy_upgrades.sql` (or `npm run db:migrate`, which applies every pending migration immediately with no dry run) before or together with the deploy that ships `655b5a491`. Row 63 (above) covers the separate `PAY_VERDICT_HMAC_KEY` env var this same feature uses for signing; that row is independent of this migration and already works on a fallback secret. | one migration apply, timed with the deploy | Lets the new payment-session governance knobs (blocked hosts, approval threshold, per-rail daily caps) and tamper-evident signed verdicts go live without a schema mismatch | [docs/payment-sessions.md](../../docs/payment-sessions.md) |
| 66 | **DONE 2026-10-23, applied by the order 522 close-out.** **Apply the x402 outbound-receipts resolved-columns migration** (added 2026-10-15, order 522-integrate-23 close-out). `api/_lib/migrations/20261015110000_x402_outbound_resolved.sql` adds `resolved_payer`, `resolved_payee`, `resolved_mint`, `resolved_amount_atomics`, `resolved_decimals`, `resolved_fee_lamports`, `resolved_slot`, `resolved_block_time`, `resolved_at` and `resolve_error` to `payment_session_executions`, plus a partial index (`pse_user_settled_resolved`) for the settled-and-unresolved lookup. `npm run db:status` lists it as pending today. Not an active production bug yet: zero outbound-spend rows exist in `payment_session_executions` right now, so nothing has tried to resolve one. It becomes load-bearing the moment the new `GET /api/x402/outbound-receipts` endpoint (`api/x402/outbound-receipts.js`, `api/_lib/x402/outbound-receipts.js`) is deployed and a real agent spend lands: `resolveAndCacheRow()`'s UPDATE would fail with Postgres `42703 undefined_column` the first time anyone views that row. Apply with `node scripts/apply-migrations.mjs --apply --file 20261015110000_x402_outbound_resolved.sql` (or `npm run db:migrate`) before or together with the deploy that ships this feature. Independent of row 65's migration; both are currently pending in the same `npm run db:status` list and can be applied in the same pass. | one migration apply, timed with the deploy | Lets the Receipt Vault's new Outbound tab cache chain-verified settlement data instead of erroring the first time it resolves a real row | [docs/payment-sessions.md](../../docs/payment-sessions.md) |
| 67 | Deploy `workers/model-triposplat` (`gcloud builds submit --config workers/model-triposplat/cloudbuild.yaml`, stage weights with `stage-assets.sh`), set `MODEL_TRIPOSPLAT_URL` on `three-ws-api` with `--update-env-vars`, then run `POST /api/forge-splat` on a real photo and open the returned splat in `/splat`. Added 2026-10-23, order 081 close-out. | minutes | Image-to-splat Forge lane live (order 081 DoD line 2) | `workers/model-triposplat/README.md` |
| 68 | world.three.ws has been unreachable since the backing Cloud Run service `hyperfy-world` was deleted via the Cloud Run API by `nich@sperax.io` at 2026-10-23T02:48:38Z (confirmed via `gcloud logging read 'protoPayload.methodName="google.cloud.run.v1.Services.DeleteService"'`), a deliberate recent action, not drift. The `world.three.ws` domain mapping is itself still healthy and provisioned; it now points at a service that no longer exists, which is why it answers a generic 404 instead of a branded error. Decide: redeploy (`bash deploy/world/apply-hardening.sh`, fully scripted and idempotent, documented in `deploy/world/README.md`) or formally retire the surface (remove the domain mapping and any in-product links to it). `/api/healthz` now correctly reports this as `world: down` instead of masking it as `unknown` (order 413). | decision | world.three.ws restoration or retirement | `deploy/world/README.md` |
| 69 | **Redeploy `remesh-service`.** Added 2026-10-24 by the triage-lane deep sweep: production logs show `remesh-service` segfaulting ("Uncaught signal: 11") twice in 24h inside `_convert_to_fbx_preserving_rig` → `_blender_convert`, the exact "Blender dies in its own interpreter teardown after a fully written export" failure that commit `59d9aa9cd` (2026-08-11, "stop discarding a finished FBX because Blender crashed on the way out") already fixed by judging completion on the FACE_COUNT marker and a non-empty output file rather than the child's exit code. `gcloud run revisions describe remesh-service-00005-8rr --region us-central1` shows that revision was created 2026-07-16, five weeks before the fix landed: this is pure deploy lag on a service three.ws's own deploy cadence does not currently cover (row 1 tracks `three-ws-api`, which is current at `660b5ad97`, 0 commits behind `threews/main`; the 20-service Cloud Run fleet deploys independently per service). No code change needed, the fix already exists; only a rebuild and redeploy of this one GPU worker is owner-gated. Command: `gcloud builds submit --config workers/remesh/cloudbuild.yaml .` from the repo root, then confirm no new "Uncaught signal: 11" lines appear for `remesh-service` over the following 24h. | one build + one deploy | Stops rig-preserving FBX exports from occasionally crashing the whole `remesh-service` instance mid-request | `workers/remesh/main.py` (`_blender_convert`), [docs/ops/production-log-triage.md](../../docs/ops/production-log-triage.md) |
| 70 | **Set `GITHUB_TOKEN` on `three-ws-api`.** Added 2026-10-24, order 412 close-out. Production runs every `api.github.com` call (ship feed, commit-feed-push cron) unauthenticated, sharing one 60-requests/hour budget per egress IP across both features; `gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5` confirms no `GITHUB_TOKEN`/`GH_TOKEN` is configured. Order 412 already made exhaustion a non-event (`/api/ship/feed` now serves the last-known-good feed marked stale instead of throwing; `pushTelegramLane()` now returns `{ skipped: 'github_rate_limited' }` instead of throwing), so this is optional, not a blocker. Setting the token raises the shared ceiling from 60 to 5,000 requests/hour, which reduces how often those stale/skip paths are ever exercised. Command: `gcloud run services update three-ws-api --region us-central1 --update-env-vars GITHUB_TOKEN=<a GitHub personal access token with no special scopes; read-only public access is enough>`. | minutes | Fewer stale ship-feed reads and skipped commit-feed-push ticks under shared-IP GitHub traffic | this order's commit, `api/ship/feed.js`, `api/_lib/commit-feed-push.js` |
| 71 | **Redeploy `model-trellis`.** Added 2026-10-25, order 428 close-out. `main.py`/`instance_health.py` now carry a VRAM recycle guard (commit `9bbea4c095c55d9ca104fba0c657af3712df3538`) that restarts an instance cleanly between jobs once GPU memory has ratcheted toward its ceiling, the same way the existing host-RAM guard already does; this closes the gap that let the instance's own `/health` liveness probe kill it mid-inference twice in the 168h to 2026-10-25 (`LIVENESS HTTP probe failed` at `2026-10-24T09:35:02Z` and `2026-10-24T14:49:19Z`). The fix is code-only and fully tested (52/52 passing, including the new VRAM cases); only the GPU Cloud Run build/deploy is owner-gated. Command: `gcloud builds submit --config workers/model-trellis/cloudbuild.yaml .` from the repo root (or the NGC variant, `cloudbuild.ngc.yaml`, if that is the active build lane), then confirm no new `LIVENESS HTTP probe failed` lines appear for `model-trellis` over the following 24h. | one build + one deploy | Stops the trellis image-to-3D lane from crashing or getting killed mid-job once VRAM ratchets up | `workers/model-trellis/instance_health.py`, `workers/model-trellis/main.py` |

Deleted 2026-09-01: the former row 5 (`WALLET_ENCRYPTION_KEY_PREVIOUS` policy), which
declared itself "delete on reading" and had outlived that by three weeks.

Re-measured 2026-09-02, and three premises had rotted. Row 8 asked for a credential that
nothing needs any more and pointed at the wrong work order. Row 9 asked the owner to
generate a key that already exists, and named no address to fund. Row 3's brief turned out
to be unwritable from this workspace at all, which makes row 15 the gate on four rows
rather than three. Nothing was cleared by the owner; the corrections are all measurement.
Evidence is in [PROGRESS.md](production-100-PROGRESS.md) under 2026-09-02.
~~~~

### `docs/ops/site-health-audit-2026-09-15.md` (whole file)

~~~~markdown
# Production site health audit: 2026-09-15

This record captures the production audit requested on 2026-09-15, the fixes
shipped from it, and the work that still depends on an external provider or an
account balance. It deliberately contains no credentials, private keys, access
tokens, wallet secrets, or complete private endpoint values.

## Scope and method

- Ran the Cloud Run deep triage sweep over the production fleet, including
  health, revision, TLS, public pages, logs, scheduled jobs, migrations, wallet
  readiness, Forge, LLM providers, object storage, and x402 settlement.
- Drove Chromium against all 908 selected public and dynamically discovered
  HTML routes in both desktop and mobile viewports. The audit records browser
  exceptions, console errors, failed requests, HTTP failures, layout overflow,
  accessibility basics, and dead controls.
- Rechecked every initially failing route/viewport pair in isolation. This is
  necessary because a full two-viewport WebGL crawl can exhaust a shared
  renderer and turn healthy pages into false navigation or network failures.
- Performed focused live checks against the affected API endpoints and asset
  URLs. Authenticated-only flows were not considered cleared by the anonymous
  browser pass.

The initial browser report is retained outside Git under
`reports/page-audit-2026-09-15T07-23-53-110Z.{json,md}`. Reports are ignored by
design because they contain volatile production data and screenshots.

## Findings and resolution

| Area | Evidence | Resolution |
| --- | --- | --- |
| Cloud Run fleet | Health endpoint, TLS, public pages, revision readiness, schedulers, and migrations were healthy. | No fleet or schema change required. |
| R2 object storage | Production used the correct account endpoint and bucket, but authenticated storage calls rejected the deployed key pair. Several historical showcase thumbnails also resolve to missing objects. | Added the new secret as a Secret Manager version and updated only the access-key environment variable with `--update-env-vars`. Future writes use the repaired credentials. Showcase images now pass through `/api/img`, which provides gateway retry and a valid deterministic fallback for missing historical objects. |
| Auto-rig demo | `/demos/agents/auto-rig.html` threw before boot because its bare `three` imports had no import map. | Added a pinned Three.js import map for core and addons. |
| Deploy preview | The bundled avatar is Meshopt-compressed; model-viewer 4.0 could parse it before attaching its decoder and emitted a hard exception. | Upgraded the hosted model-viewer runtime to 4.3.1, whose loader waits for the bundled Meshopt decoder. |
| Voice state gallery | The browser audit treated the gallery's intentionally rendered ERROR example as a live failure banner. | Added a narrowly scoped `data-audit-intentional-error` annotation and taught the auditor to ignore only annotated example content. |
| Solana price pages | `$THREE` curve calls returned 502 during the loaded sweep. Both affected pages passed an isolated rerun. | Classified as transient RPC-lane exhaustion, not a deterministic frontend failure. Provider reliability remains monitored by deep triage. |
| Agent and metadata deep links | Seeded dynamic links included deleted/missing agent records and an unavailable Arweave metadata document. | Retained as upstream/data-lifecycle findings; the route shells render their designed not-found/degraded states. No replacement data was invented. |
| Agent Galaxy | `/api/galaxy` returned `watsonx_unavailable`. | Requires valid watsonx credentials to construct real embeddings. The API correctly refuses to fabricate a galaxy. |
| Coin Clash | `/api/clash/state` returned `cc_unconfigured`. | Requires a CoinCommunities read API key. The page already stops polling and renders a designed unavailable state. |
| Forge and LLM lanes | The deep sweep found low Forge success and unavailable LLM providers. | Provider credentials/capacity must be restored; no mock generation lane was introduced. |
| x402 settlement and sniper fleet | Settlement was not succeeding, the Solana fee payer was below its operating floor, and four sniper wallets were starved. The treasury-topup dry run produced an empty transfer plan: the master had no spendable SOL, no spare USDC, and two otherwise funded agent wallets had undecryptable secrets. | Requires an explicitly approved funding action plus recovery or rotation of the two unreadable wallet secrets. The empty plan was not applied and no funds were moved during this audit. |
| OKX bot and alerts | The OKX bot's AI credential was rejected; production Telegram push alerts were disabled. | Requires valid provider credentials and an alerts chat configuration. |

## Coverage notes

The crawler found 115 linked HTML routes absent from `data/pages.json`, plus
1,770 additional URLs excluded by dynamic-family sampling limits. Most are
content instances (agent, avatar, market, category, profile, and protocol URLs),
not separate static surfaces. The canonical route families remain the right
manifest unit; instance sampling should be expanded only where it adds a new
template or failure mode.

The loaded audit initially recorded 100 errors, 232 warnings, and 5,188
informational findings. Those totals include 57 route/viewport pairs that the
first process could not reverify before its browser recycle cap, so they are not
a release verdict. A second concurrency-one isolation pass was used for final
classification. The large majority of WebGL and navigation errors disappeared
when isolated.

## Operating and security follow-up

- Rotate every GitHub, Cloudflare, R2, npm, and other credential that was pasted
  into a chat or terminal transcript, even if it was not committed. Treat chat
  exposure as credential exposure.
- Keep R2 credentials in Secret Manager. Never add them to `.env`, shell
  history, reports, documentation, or Git.
- Restore watsonx, CoinCommunities, OKX AI, and Telegram alert credentials using
  Secret Manager references, then rerun `npm run triage:gcp -- --json --deep
  --since 6h`.
- Funding the fee payer or sniper wallets is an irreversible money-moving action
  and must be separately confirmed with the exact wallets, amounts, token, and
  network before execution.
~~~~

### `docs/ops/production-sweep-2026-09-15.md` (whole file)

~~~~markdown
# Production sweep: 2026-09-15

Internal operations record for the NVIDIA follow-up, credential validation,
repository build, and Google Cloud production sweep performed on 2026-09-15.
This document deliberately records outcomes and secret locations, never secret
values.

## NVIDIA response

- The NVIDIA reply is transcribed and actioned in
  [`nvidia-inception-response-2026-09-14.md`](nvidia-inception-response-2026-09-14.md).
- The public-facing catalog and application copy live in
  [`../nvidia-apps-catalog-listing.md`](../nvidia-apps-catalog-listing.md),
  [`../nvidia-apps-catalog-request.md`](../nvidia-apps-catalog-request.md), and
  [`../nvidia-inception.md`](../nvidia-inception.md).
- The source screenshot remains evidence only. It is not published by the docs
  build, and this `docs/ops/` record is also excluded from the public docs bundle.

## Credential handling and authentication

The credentials supplied during the incident were used only in ephemeral,
non-echoing processes. None were written to the repository, Git remotes, npm
configuration, shell profiles, or this document.

| System | Verification result | Durable production location |
| --- | --- | --- |
| GitHub | Both supplied tokens authenticated as `nirholas` | Not stored locally |
| npm | Token authenticated as `nirholas` | Not stored locally |
| Cloudflare API | Token active | Not stored locally |
| Cloudflare R2 | Supplied keypair exactly matches the production pair | `S3_SECRET_ACCESS_KEY` is a Secret Manager reference; non-secret storage settings remain Cloud Run environment values |
| Google Cloud | CLI authenticated; project and region resolved successfully | Existing gcloud configuration |

`npm run check:secrets` found no credential material in tracked or changed
repository files. Because the values were nevertheless pasted into a chat, they
must be treated as disclosed and rotated after this work is complete.

## Production findings

The deep sweep covered public health, version identity, TLS, all Cloud Run
services, schedulers, recent application errors, and the live NVIDIA page.

| Area | Evidence | Classification / action |
| --- | --- | --- |
| Site and TLS | `/api/healthz`, `/api/version`, and `/nvidia` returned `200`; TLS 1.3 negotiated successfully | Healthy. The first probe's timeouts were transient from the probe environment. |
| Cloud Run fleet | All 47 services reported Ready | Healthy |
| Schedulers | All 117 jobs matched the repository schedule and had recent successful liveness | Healthy |
| Object storage / Forge upload | Health reported signed object access; a valid `POST /api/forge-upload` returned `200` and a short-lived presigned PUT | Healthy. The earlier 503 samples were not reproducible; no credential rotation was needed. |
| Pump curve | Identical live calls split between fast `502` responses and correct responses depending on the Cloud Run instance | Code defect fixed: the outer RPC wrapper now forces a recovery probe when stale cooldown state excludes every lane. |
| Cryptocurrency narrative service | `/api/narratives` continues to return `503`. Production requests the unavailable Groq model `llama-3.3-70b-versatile`, which the provider rejects with `model_not_found`. Its separate Cloud Run service also logs repeated facilitator discovery failures because `x402.sperax.io` currently resolves to a missing Railway application (`404 Application not found`). | External-service / separate-repository issue. Select a model available to the production Groq account, restore the Sperax facilitator deployment, and then redeploy and verify `cryptocurrency-cv`. Do not point production at an incompatible facilitator or silently disable paid routes. |
| CoinCommunities integration | `/api/clash/state` intentionally returns `503` while its production credential is absent | Owner configuration required |
| watsonx integration | `/api/galaxy` intentionally returns `503` while watsonx credentials are absent | Owner configuration required |
| x402 settlement | Health showed the sponsor fee wallet below its configured floor; the treasury-topup scheduler is enabled every 30 minutes. A non-mutating dry-run confirmed that there is nothing reclaimable and no spare USDC for the revenue-funded refill path. | Owner funding required for the economy master wallet. Never lower the floor or fund per-agent wallets directly. |

Database, wallet, and custodial deep checks that require local secret material
were skipped by the generic sweep; the deployed health endpoint and scheduler
checks still covered their public operational signals.

## Repository fixes

- `fix(chat): declare noble hashes dependency`: the chat bundle imported
  `@noble/hashes/sha3` without declaring the package, making builds depend on an
  accidental root-level hoist.
- `fix(solana): probe RPC recovery after full cooldown`: prevents warm
  instances from returning an immediate pump-curve outage solely because every
  endpoint is marked cooling. A regression test pins the forced recovery pass.

## Safe follow-up

1. Rotate all credentials disclosed in chat, then update only their proper
   secret stores. Do not put replacement values in Git.
2. Fund the economy master wallet sufficiently for the existing treasury-topup
   job to refill the under-floor targets. Do not bypass the master wallet or
   lower the configured floor.
3. Replace the unavailable Groq model in `cryptocurrency-cv`, restore the
   external `x402.sperax.io` Railway deployment (or deploy the facilitator from
   its own repository with its existing settlement secrets), and verify
   `/health`, `/supported`, and `/api/narratives`.
4. Add the owner-held CoinCommunities and watsonx credentials if those optional
   integrations should be live.
5. Re-run the deep production sweep after those owner actions.
~~~~

### `docs/ops/swarm-100-audit.md` (whole file)

~~~~markdown
# swarm-100 audit: what is finished and what is still open

Audited 2026-09-01 against `prompts/swarm-100/` at commit `94ae967ca`.

`prompts/swarm-100/` has no progress file by design. The pack's own rule is
that an agent deletes its work order in the commit that lands the work, so the
directory itself is the ledger: what is gone is done, what remains is open.
This document reconciles that ledger against git history, then measures the
open orders against their own Definition of done so the remaining work is a
list rather than a guess.

## Headline

- 696 work orders shipped in the pack (`bad907b27`, 2026-08-10).
- **540 closed (77.6%).** Every deletion is accounted for in git history.
- **156 open:** 151 route audits, 4 sweeps, 1 roadmap slice.
- Of the 151 open route audits, **125 already pass every mechanical line of
  their Definition of done** and 26 carry at least one measured defect.
- Two open orders are effectively finished and only need closing out; one
  (`sweep-i18n`) has not been started.

## Ledger by category

| Prefix | Orders | Closed | Open | Closed |
|---|--:|--:|--:|--:|
| route- | 284 | 133 | 151 | 47% |
| api- | 224 | 224 | 0 | 100% |
| docs-batch- | 44 | 44 | 0 | 100% |
| worker- | 33 | 33 | 0 | 100% |
| sweep- | 30 | 26 | 4 | 87% |
| roadmap- | 23 | 22 | 1 | 96% |
| sdk- | 23 | 23 | 0 | 100% |
| cron-batch- | 13 | 13 | 0 | 100% |
| packages-batch- | 11 | 11 | 0 | 100% |
| blog-batch- | 4 | 4 | 0 | 100% |
| service- | 4 | 4 | 0 | 100% |
| machine- | 2 | 2 | 0 | 100% |
| legal-pages | 1 | 1 | 0 | 100% |
| **Total** | **696** | **540** | **156** | **77.6%** |

Every non-route category except the sweeps and one roadmap slice is fully
closed. The whole remaining campaign is route audits.

## Closure timeline

| Date | Orders closed |
|---|--:|
| 2026-08-10 | 48 |
| 2026-08-11 | 44 |
| 2026-08-12 | 25 |
| 2026-08-13 | 93 |
| 2026-08-14 | 77 |
| 2026-08-15 | 106 |
| 2026-08-16 | 83 |
| 2026-08-17 | 42 |
| 2026-08-25 | 10 |
| 2026-09-01 | 16 |

The campaign ran hard for eight days, went quiet for a week, and has picked up
again in two short bursts.

## Are the closures trustworthy?

489 commits carry the 540 deletions. 201 of them are prompt-only `chore(swarm-100): retire the ... audit`
follow-ups, which is a deviation from "delete in the same commit as the work"
but a legible one: each names the fix that had already landed. One closure is
not legible:

- `api-pump-bounties-01.md` was deleted inside `5ed01e8d3`, a 63-file commit
  titled "Pending changes exported from your codespace". That is exactly the
  generic sweep the CLAUDE.md commit-message rule now bans. The commit touched
  `api/pump/helius-stats.js` and `api/pump/price-history.js` but nothing named
  `bounties`, so that order's work is unevidenced. Treat it as the one closure
  worth re-opening.

Every other deletion sits in a commit whose subject asserts what was fixed.

## The 156 open orders

### 1 roadmap slice: finished, just not closed

`roadmap-p2-memory-seed-x.md` asks for consent-first agent memory seeding from
X. That feature is built and shipped: `api/agents/[id]/memory-seed-x.js`,
`api/_lib/x-memory-seed.js`, `api/_lib/x-seed-consent.js` (revocation deletes
the seeded rows), migration `20260811140000_x_memory_consent.sql`,
`docs/x-memory-seeding.md`, and multiple `data/changelog.json` entries covering
the consent screen, the seeding lane and the revoke path. The order file was
simply never deleted. **Closeable after one end-to-end run on a real account.**

### 4 sweeps

| Order | State |
|---|---|
| `sweep-perf` | Work landed. The 2026-09-01 performance sweep covers exactly this order's page list (home, Create, Forge, Marketplace, Play, Docs, Discover, Chat), with a changelog entry naming the fixes. What is unverified is the order's numeric gate: Lighthouse >= 80 desktop measured against production. |
| `sweep-authed-audit` | Premise is stale. The order opens "the QA credentials are absent from .env"; `AUDIT_EMAIL` and `AUDIT_PASSWORD` are present today and `.auth/audit-state.json` was written 2026-09-01, so the authed sweep runs. The open half is fixing what it reports. |
| `sweep-console` | Not verified. `npm run audit:console` sweeps every route at two viewports; the run started here was stopped so it would not contend with this audit's own probe. The route-level console data below covers the 151 open routes. |
| `sweep-i18n` | **Not started.** `npm run i18n:lint` reports 43,768 problems (missing keys, stale keys, dropped glossary terms across locales). This is the single largest piece of open work in the pack. |

### 151 route audits

Every one of the 151 still targets a live entry in `data/pages.json`; none are
moot. Each was driven in headless Chromium against a local dev server and
measured on the mechanical lines of its own Definition of done: HTTP status,
console errors, failed first-party requests, title and meta description, a
single `h1`, and horizontal overflow at 320px. Vite HMR websocket noise and
Codespace-only artifacts are excluded.

**125 of 151 pass every mechanical line.** They are not automatically done:
the orders also require exercising the primary flow, proving data comes from a
live endpoint, and reaching the empty, loading and error states, none of which
a sweep can assert. But they carry no measurable defect, so they are cheap to
close.

**26 carry a measured defect:**

| Route | Measured | Note |
|---|---|---|
| `/dashboard` | no meta description; h1 count = 0 |  |
| `/dashboard/settings` | no meta description; h1 count = 0 |  |
| `/demo` | h1 count = 0 |  |
| `/guardian` | h1 count = 0 |  |
| `/ibm/hello` | horizontal scroll at 320px |  |
| `/ibm/x402-demo` | 4 console error(s); no meta description; h1 count = -1 | the page hardcodes absolute https://three.ws asset and API URLs, so it cannot load against a local origin at all |
| `/launch` | 1 console error(s) | vite serves /public through the module transform, so /launch/launch.js 500s locally only; production serves it as a static file |
| `/launch-studio` | 1 console error(s) | same vite /public transform artifact as /launch |
| `/launcher` | h1 count = 0 |  |
| `/launchpad` | was: uncaught TypeError killed the whole landing script (h1 0, page fell back to the noscript block) | FIXED in this audit (see below); re-probed clean |
| `/live` | h1 count = 0 |  |
| `/markets/news/article` | h1 count = 0 |  |
| `/mocap-studio` | h1 count = 0 |  |
| `/pitch` | h1 count = 2 |  |
| `/play/agent-wallet` | 2 console error(s); h1 count = 0 | the page calls a local x402 wallet daemon on 127.0.0.1:4402 that is not running here; the connection refusal reaches the console instead of a designed offline state |
| `/play/arena` | h1 count = 0 |  |
| `/play/war` | h1 count = 2 |  |
| `/playground` | h1 count = 0 |  |
| `/pose` | h1 count = 0 |  |
| `/profile` | h1 count = 0 |  |
| `/pump-visualizer` | h1 count = 0 |  |
| `/reputation` | h1 count = 2 |  |
| `/scene` | h1 count = 0 |  |
| `/showcase` | h1 count = 2; horizontal scroll at 320px |  |
| `/temporary` | 2 console error(s) | the multiplayer room server on localhost:2567 is not running here; the refusal reaches the console |
| `/three-live` | h1 count = 0 |  |
The dominant finding is the heading structure: 20 of the 26 have either no
`h1` or two, which fails the accessibility line in every route order. Nothing
in the open set is broken beyond that except the one bug below.

## Fixed during this audit

`/launchpad` was dead. `src/launchpad/landing.js` wrapped `.more` in backticks
inside a CSS comment that sits inside a backtick template literal, which closed
the string early and turned the rest into a tagged template on it. The page
threw `TypeError: "...".more is not a function` before rendering anything, so
every visitor got the "Launchpad Studio needs JavaScript" fallback instead of
the landing page. Fixed in `963a24fe1`; re-probed clean (HTTP 200, one `h1`,
meta description present, no 320px overflow). Production needs a deploy to pick
it up. `route-launchpad.md` still needs its interactive pass before it closes.

## Recommended order of work

1. `sweep-i18n` (43,768 findings, nothing else in the pack is this large).
2. Close `roadmap-p2-memory-seed-x` with one end-to-end consent-and-revoke run.
3. The 20 heading-structure route defects: one pass, one pattern, 20 orders closeable.
4. Re-open `api-pump-bounties-01`, whose closure has no evidence behind it.
5. The 125 mechanically-clean route orders: interactive pass only.
6. `sweep-perf` production Lighthouse numbers, `sweep-console`, `sweep-authed-audit`.

## How to re-run this audit

The ledger half is pure git:

    git log --diff-filter=D --name-only --format='%h %ad %s' --date=short -- prompts/swarm-100

The route half is `npm run audit:console` (every route, two viewports, console
and network only) or `npm run audit:web` / `npm run audit:web:login` for the
production sweep documented in `docs/ops/page-audit.md`.
~~~~

