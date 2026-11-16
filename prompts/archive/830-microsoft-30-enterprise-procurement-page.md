# microsoft 30: an enterprise procurement page that lets a buyer purchase three.ws through Microsoft Marketplace and clear vendor review in one visit

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3130.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Enterprise buyers do not pay with a card on a pricing page. They ask: can we buy it through our Microsoft agreement, is it on our approved vendor list, where is the security documentation, does it support our SSO and provisioning, and who signs the DPA. Each answer exists somewhere on three.ws (the `/microsoft` hub, `/trust`, [docs/enterprise-sso.md](../../docs/enterprise-sso.md), the Marketplace profile) but there is no single page that walks a procurement or IT reviewer through them, and `/pricing` has no "buy through Microsoft" path.

## Step 0: re-derive the current state

    ls pages | grep -i -E "enterprise|procure|pricing|trust|microsoft|security"
    grep -n "/enterprise\|/procurement\|/microsoft\b\|/trust" vercel.json data/pages.json | head -20
    grep -n -i "marketplace\|microsoft\|enterprise\|contact" pages/pricing.html | head -20
    curl -s https://three.ws/api/microsoft-marketplace/status
    ls marketing/growth/submissions/programs | grep -i -E "microsoft|attestation|security"

Read `/trust`, `/microsoft`, `/pricing` and [docs/microsoft.md](../../docs/microsoft.md) (approved wording). Note what each says so the new page links to them instead of duplicating.

## Tasks

1. **Page** `/enterprise` (or extend an existing enterprise page if step 0 finds one), styled with the site's design tokens: how to buy (Microsoft Marketplace with the publisher profile link and, once live, the offer link from config; card checkout; invoice and PO via the contact path), identity (Sign in with Microsoft, Entra tenant claim, SCIM provisioning, linked to [docs/enterprise-sso.md](../../docs/enterprise-sso.md)), security and compliance (links into `/trust`, subprocessors, data handling, the attestation status stated truthfully as "submitted" or "in preparation" from a config value, never "certified" until true), deployment surfaces (Teams, Copilot, Power Platform, Edge, Windows, each with its real status), support and SLA (only what is actually offered), and a contact form that posts into the existing lead or contact pipeline (reuse the Marketplace leads receiver or contact API; do not invent a new inbox).
2. **Status from data.** Every surface status comes from one JSON file (for example `data/enterprise-surfaces.json`) that the page renders, so updating a listing status is a one-line data change. A test fails if any status string claims certification, co-sell or a partner tier.
3. **Pricing page CTA.** A "Buying for a company? Purchase through Microsoft Marketplace" row on `/pricing` that links to the offer when the offer URL is configured and to `/enterprise` otherwise.
4. **Procurement packet.** A one-click printable summary (print stylesheet, no PDF service) with the facts a vendor-risk form asks for: legal entity, hosting regions (Google Cloud, us-central1), subprocessors, encryption, SSO and SCIM, data retention, contact.
5. **SEO and nav.** Title, description, OG card, structured data (`Organization` plus `Offer` only where real), footer and `/microsoft` hub links, `data/pages.json` entry.
6. **Docs and changelog.** `STRUCTURE.md` row, changelog entry, `npm run build:pages`.

## Definition of done

- [ ] `/enterprise` renders at 1280px and 400px, light and dark, with no console errors (screenshot paths).
- [ ] The contact form stores a real lead through the existing pipeline on the dev server (row id in the report, test row removed after).
- [ ] The forbidden-claims test passes and fails when a forbidden phrase is added (demonstrated, then reverted).
- [ ] `/pricing` shows the new row; `npm test`, `npm run audit:docs` pass; pages.json, STRUCTURE, changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| SaaS offer URL not live yet | The config value is empty and the page links the publisher profile; the owner fills the URL later. |
| No contact endpoint fits | Reuse `api/microsoft-marketplace/leads.js` storage through a small authenticated-free form handler with rate limiting and a honeypot. |
| Unsure whether a claim is approved | Use only the two approved claims in the context file. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
