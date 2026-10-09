# partners 08: A Shopify app that turns product photos into 3D product media

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

Shopify product pages accept 3D models as product media (GLB for the web viewer, USDZ for iOS AR) through the Admin GraphQL API's `productCreateMedia`, yet most merchants have no 3D files. The Forge turns a photo into a textured GLB, and the export path can produce USDZ. A Shopify app that does "pick a product, get a 3D model on the page" is a direct line to merchants, and Shopify's Billing API means the app charges through Shopify with no extra payment integration.

## Step 0: re-derive the current state

    grep -rn -i "usdz" src api --include=*.js | head
    grep -rn -i "shopify" api src --include=*.js | head
    npm view @shopify/shopify-app-remix version 2>/dev/null; npm view @shopify/shopify-api version

Read Shopify's current docs for: app scaffolding and the recommended template, OAuth and session tokens for embedded apps, the `productCreateMedia` mutation and the staged-upload flow for 3D models, mandatory privacy webhooks, the Billing API, and the App Store requirements checklist.

## Tasks

1. **The app** in `integrations/shopify/`, built on Shopify's official app template and libraries: install, OAuth, embedded admin UI listing the shop's products with their current media.
2. **The flow.** Pick a product, pick its best image, run a Forge job through the public API, preview the model in the embedded admin, then attach GLB and USDZ to the product with staged uploads and `productCreateMedia`. Bulk mode for many products, with real per-item status.
3. **Billing** through the Billing API, priced from our Forge credit cost. Prove it against a development store in test mode, which charges nothing.
4. **Compliance**: the three mandatory privacy webhooks, scopes kept to what the flow needs, and every App Store checklist item that can be met in code.
5. **Submission package** in `marketing/growth/submissions/shopify-app.md`: listing copy, screenshots from a real development store, the test credentials Shopify review needs, and the steps for owner order 939 (Partner account, App Store submission).
6. **Docs.** README in `integrations/shopify/`, a doc page, `STRUCTURE.md` row, changelog entry.

## Definition of done

- [ ] On a Shopify development store, a product photo becomes 3D media on the live storefront product page, viewable in the web viewer (screenshot).
- [ ] A test-mode charge completes through the Billing API.
- [ ] Privacy webhooks respond correctly to Shopify's test deliveries.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] Submission file, README, docs, `STRUCTURE.md` and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| No Shopify Partner account yet | Creating one is free but it is an external account in the owner's name: put it first in the owner message, build everything that does not need it, and verify the rest the moment it exists. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/091-partners-08-shopify-product-media.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
