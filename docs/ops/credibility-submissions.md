# Credibility submissions: the owner steps

Everything the repo can do for project credibility is built and tested. What remains needs an account only the owner holds, so each step is one action with the values ready to paste.

What is already in the repo:

| Item | File | Checked by |
| --- | --- | --- |
| FLOSS/fund manifest v1.1.0 | [public/funding.json](../../public/funding.json), listed in [public/.well-known/funding-manifest-urls](../../public/.well-known/funding-manifest-urls) | [tests/funding-manifest.test.js](../../tests/funding-manifest.test.js) |
| Zenodo metadata | [.zenodo.json](../../.zenodo.json), agrees with `CITATION.cff` | [tests/funding-manifest.test.js](../../tests/funding-manifest.test.js) |
| Citation file | `CITATION.cff` | GitHub "Cite this repository" |
| Translated READMEs (es, pt-BR, hi, ru, plus zh-CN, ja, ko) | [docs/readme/](../readme) | [tests/readme-translations.test.js](../../tests/readme-translations.test.js) |
| Crawlable locales (`?lang=` sets `<html lang>`, hreflang, clean canonical) | [server/locale-head.mjs](../../server/locale-head.mjs) | [tests/locale-head.test.js](../../tests/locale-head.test.js) |
| OpenSSF Scorecard run | [docs/security/openssf-scorecard.md](../security/openssf-scorecard.md) | recorded result |

## 1. Zenodo DOI (about 3 minutes)

1. Sign in at https://zenodo.org with the GitHub account that owns the repo.
2. Open https://zenodo.org/account/settings/github/ and switch on `nirholas/three.ws`.
3. Cut a GitHub release (a tag such as `v1.0.0`). Zenodo archives it and reads `.zenodo.json` for the metadata.
4. Copy the DOI badge Zenodo issues into the README and add the DOI to `CITATION.cff` under `identifiers`.

## 2. Software Heritage archive (about 1 minute)

1. Open https://archive.softwareheritage.org/save/.
2. Origin type `git`, origin URL `https://github.com/nirholas/three.ws`, submit.
3. Keep the resulting `swh:1:` identifier for the README.

## 3. OpenSSF Best Practices badge (about 20 minutes)

1. Sign in at https://www.bestpractices.dev with GitHub and add `https://github.com/nirholas/three.ws`.
2. Values that are true today: license Apache-2.0, repo URL `https://github.com/nirholas/three.ws`, site `https://three.ws`, public issue tracker on GitHub, security policy `SECURITY.md`, automated tests `npm test` (vitest), CI is Cloud Build (not GitHub Actions).
3. Add the badge it issues to the README.

## 4. FLOSS/fund submission (about 2 minutes)

1. Confirm the manifest is live after the next deploy: `curl -fsS https://three.ws/funding.json | head` and `curl -fsS https://three.ws/.well-known/funding-manifest-urls`.
2. Submit `https://three.ws/funding.json` at https://dir.floss.fund/submit.

Nothing here posts anything on the owner's behalf. Steps 1 to 4 depend on a deploy only for the live `funding.json` check in step 4.
