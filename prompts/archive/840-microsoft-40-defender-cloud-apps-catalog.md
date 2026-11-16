# microsoft 40: earn a strong risk score in the Microsoft Defender for Cloud Apps catalog that enterprise IT checks before allowing three.ws

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3140.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Microsoft Defender for Cloud Apps keeps a catalog of SaaS apps, each with a 0 to 10 risk score built from roughly ninety attributes across general, security, compliance and legal categories (HTTP security headers, encryption at rest, MFA support, audit trail, data retention policy, SAML or OIDC support, user-roles support, pen testing, GDPR statements and more). Security teams in Microsoft shops use that score to sanction or block apps; an unknown or low score quietly blocks adoption. Vendors can request an update to their entry with evidence. Each attribute is something three.ws either has, can build, or can document.

## Step 0: re-derive the current state

    curl -sI https://three.ws | sed -n 1,40p
    curl -s https://three.ws/.well-known/security.txt; curl -sI https://three.ws/.well-known/security.txt | head -3
    ls pages | grep -i -E "trust|privacy|terms|security|dpa|gdpr"
    grep -rln -i "audit_log\|auditLog\|audit-log" api/_lib | head; grep -rln -i "totp\|webauthn\|passkey\|mfa" api src | head
    grep -n -i "scim\|oidc\|saml" docs/enterprise-sso.md | head

Read Microsoft's current documentation on the Cloud App Catalog: the attribute list with each attribute's definition, how scores are computed, and how a vendor requests a score update (the form or in-portal path and the evidence each attribute needs). Record every attribute in the matrix below.

## Tasks

1. **Attribute matrix** `docs/compliance/defender-cloud-apps.md`: every catalog attribute, three.ws's true value, the public evidence URL, and whether it is met, buildable, or a policy item.
2. **Close the buildable gaps**, each as its own tested change: complete HTTP security headers on every response (HSTS with preload eligibility, CSP that the site actually works under, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame protection except where embedding is intended); `/.well-known/security.txt` per RFC 9116 with a real contact and expiry; MFA for accounts if absent (passkeys or TOTP, reusing existing auth modules); a user-visible audit trail of account and team admin actions with export; data retention and deletion statements on `/trust` matching what the code does; role support documentation for teams.
3. **Public evidence pages.** Make sure each attribute's evidence is at a stable public URL on `/trust` or its subpages (not in docs only), written for a security reviewer.
4. **Header regression check** `npm run audit:security-headers` against production and the dev server, failing on any missing or weakened header, and a test for the header middleware.
5. **Owner pack** in the matrix doc: the score-update request text with each attribute's evidence URL, ready for the owner to submit through Microsoft's vendor path.
6. **Docs and changelog.** Changelog entry for user-visible security features (MFA, audit trail), `npm run build:pages`.

## Definition of done

- [ ] Every attribute in Microsoft's current list has a row (count in the report).
- [ ] `npm run audit:security-headers` passes on the dev server and reports the production delta that ships with the next deploy.
- [ ] security.txt validates; each built feature has tests; `npm test` passes.
- [ ] Evidence URLs return 200; `/trust` updated; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A strict CSP breaks pages | Build the CSP from the real origins the site loads (scan production pages with Playwright), roll it out as report-only first with a reporting endpoint, then enforce for routes that are clean. |
| A compliance certification is not held | State it truthfully as not held; never imply it. |
| MFA touches every login path | Ship it as opt-in with enforcement available to team owners; document both. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
