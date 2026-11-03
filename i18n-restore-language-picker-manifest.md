---
slug: i18n-restore-language-picker-manifest
title: Restore the 85-language picker by closing the 623 missing keys and republishing the locale manifest
tier: P1
score: 78
area: i18n
sources: docs/i18n.md
---

## Why this matters

`public/locales/manifest.json` (served at https://three.ws/locales/manifest.json) lists only English since commit `04e298db6` (2026-10-12), because `writeManifest()` in `scripts/i18n-translate.mjs` holds back any locale with missing keys. `en.json` has 25139 keys while every one of the 86 other locale files has 24516, so all 623 newer keys are untranslated everywhere, and the language switcher shows nothing to switch to in production while the changelog advertises 69 and 85 languages. This is a shipped feature that is effectively off.

## Current state (measured by the reviewer on 2026-11-03)

- `public/locales/en.json`: 25139 keys. Other locales: 24516 keys (623 missing). `es.json` additionally has 158 empty values and 379 missing keys.
- `writeManifest()` at about line 1001 of `scripts/i18n-translate.mjs` withholds a locale when `missingKeys(source, locale).length > 0`; `untranslatedCount` lives in `scripts/lib/i18n-shared.mjs`.
- Provider default is Vertex (pre-approved GCP spend), `--concurrency=8`, `--split-token=3600`. Scripts: `i18n:translate`, `i18n:lint`, `i18n:repair`, `i18n:prune`, `i18n:backfill`; queue helper `scripts/i18n-generate-queue.sh`.

## Step 0: re-derive the current state

```
curl -s https://three.ws/locales/manifest.json | head -c 400
node -e "const fs=require('fs');const en=Object.keys(JSON.parse(fs.readFileSync('public/locales/en.json')));for(const f of fs.readdirSync('public/locales').filter(f=>f.endsWith('.json')&&f!=='en.json'&&f!=='manifest.json')){const l=JSON.parse(fs.readFileSync('public/locales/'+f));const m=en.filter(k=>!(k in l)||l[k]==='').length;if(m)console.log(f,m)}" | head -100
npm run i18n:lint
sed -n 960,1040p scripts/i18n-translate.mjs
```

## Tasks

1. Test first: add `tests/i18n-manifest-publish.test.js` that builds a manifest from fixture locale dirs and asserts (a) complete locales are listed, (b) a locale with missing keys is held back, (c) a locale at or above a configurable threshold (default 100 percent) is listed. Confirm the current behavior fails any threshold case you add.
2. Run `npm run i18n:extract` so en.json is the source of truth, then `npm run i18n:translate` (Vertex) for all locales to fill the 623 missing keys and the empty values, with the concurrency flags above. Re-run `npm run i18n:repair` and `npm run i18n:lint` until clean. Keep proper nouns (three.ws, $THREE, product names) and placeholders intact per the lint rules.
3. Ensure the pipeline cannot silently regress: add a `check:i18n-parity` script (or extend `i18n:lint`) that fails when any shipped locale is more than N keys behind en.json, and add it to the gate list in `package.json` only if it passes in under a minute.
4. Regenerate `public/locales/manifest.json` and verify every previously advertised locale is present. Spot check that RTL languages (ar, he, fa, ur) set `dir` correctly in the picker.
5. Verify in a real browser: open `/` and `/irl`, open the language switcher, confirm all locales listed, pick `es`, `ja`, `ar`, confirm text and direction change, no console errors, and that a key added later falls back to English instead of showing the key.
6. Update `docs/i18n.md` (counts, parity check) and add a `data/changelog.json` entry.

## Definition of done

- [ ] The Step 0 node snippet prints nothing (no locale behind en.json).
- [ ] `node -e "console.log(require('./public/locales/manifest.json').locales.length)"` prints a count equal to the number of locale files other than manifest.json (`ls public/locales/*.json | grep -vc manifest`).
- [ ] `npm run i18n:lint` exits 0.
- [ ] `npx vitest run tests/i18n-manifest-publish.test.js` passes.
- [ ] Browser check recorded: the switcher lists all locales on a built page.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex quota or 429 | Lower `--concurrency`, retry with backoff; Vertex spend is pre-approved. Fall back to the next provider in the script's chain |
| A few keys fail lint after translation | Run `npm run i18n:repair`; hand-fix remaining placeholders |
| Manifest only updates on deploy | Commit the regenerated file; production pickup is the routine deploy gate |
