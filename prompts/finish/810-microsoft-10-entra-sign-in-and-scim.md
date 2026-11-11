# microsoft 10: "Sign in with Microsoft" for everyone, tenant-based team join, and SCIM provisioning from Entra ID

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3110.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Microsoft sign-in on `/login` today only signs in an identity that a Marketplace purchase already linked. Every enterprise evaluator who arrives from the Marketplace listing, Teams or Copilot expects "Sign in with Microsoft" to just work, and their IT team expects Entra ID to provision and deprovision users automatically (SCIM 2.0) before they approve a Team plan. Without that, the enterprise motion the Marketplace offer opens stalls at the security review.

## Step 0: re-derive the current state

    ls api/auth; sed -n 1,80p api/auth/google/*.js 2>/dev/null | head -120
    grep -n -i "entra\|microsoft" api/_lib/microsoft-marketplace.js | head -40
    grep -rn -i "MS_ENTRA_SSO" api src | head
    ls api/teams; sed -n 1,80p api/teams/index.js
    ls api/auth/saml; sed -n 1,40p api/_lib/saml.js
    grep -rn -i "scim" api | head

Read how Google and GitHub sign-in create and link accounts, and how teams and membership work. Read Microsoft's current docs for multitenant OIDC (the `common` and `organizations` authorities, `tid` and `oid` claims, issuer validation for multitenant apps) and Entra's SCIM provisioning requirements (endpoints, filters such as `userName eq`, PATCH operation shapes Entra sends, soft delete through `active=false`).

## Tasks

1. **Open Microsoft sign-in.** "Continue with Microsoft" on `/login` for work, school and personal accounts through the existing multitenant Entra app (`MS_ENTRA_SSO_CLIENT_ID`). Authorization code with PKCE, nonce, strict issuer validation per tenant, subject `tid:oid`. New identities create an account; an existing account is linked only through the same verified-email rules Google sign-in uses (match them exactly, tested). Marketplace-linked identities keep working unchanged.
2. **Tenant-based team join.** A team owner can claim their Entra tenant (proof: they signed in with an admin of that tenant, or an existing verification method the repo has). Members who sign in from a claimed tenant are offered to join the team (or auto-join, as the owner configures). Unclaim and audit log included.
3. **SCIM 2.0 endpoint.** `/scim/v2/Users` and `/scim/v2/Groups` (plus `ServiceProviderConfig`, `ResourceTypes`, `Schemas`) per RFC 7643/7644, scoped to one team by a per-team bearer token the team owner generates and can rotate in team settings. Create, get, list with filter, PATCH (including Entra's add, replace and remove shapes), and deactivate. Deactivation removes team access and revokes the member's sessions for that team. Rate limited and audited.
4. **Team settings UI.** Sections for Microsoft tenant claim and SCIM (token generate, rotate, copy, last sync time, recent provisioning events), with loading, empty and error states.
5. **Docs.** `docs/enterprise-sso.md` (Microsoft sign-in, tenant join, SCIM setup in the Entra admin centre step by step), link from docs/microsoft.md, STRUCTURE.md row, changelog entry. Migration for any new tables (fresh timestamp; `npm run db:status` before `npm run db:migrate`).

## Definition of done

- [ ] Test-first tests: issuer validation rejects a token from the wrong tenant; email-link rules match Google's; SCIM create, filter, PATCH (each Entra shape), deactivate and token rotation; a deactivated member loses access.
- [ ] An end-to-end sign-in against the real Microsoft authority on port 3110 reaches Microsoft's login page with correct parameters, and the callback rejects a tampered state (evidence in report). A full sign-in completes if the redirect URI is registered; otherwise it is in the owner message.
- [ ] A SCIM conformance run with `curl` against the local server covers every endpoint with RFC-correct responses.
- [ ] Settings UI verified in a browser; no console errors; docs, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The Entra app lacks the `/login` redirect URI | Build and test everything else; put "add redirect URI X to app Y" in the owner message with the exact value. |
| Entra's hosted SCIM validator needs a tenant | Run your own RFC conformance suite; put "run Microsoft's SCIM validator against URL X with a test token" in the owner message. |
| Team model lacks something SCIM needs | Extend it with a migration and tests; keep existing team behaviour intact. |
| Missing credential or env var | `node scripts/read-service-env.mjs`; if absent everywhere, wire behind the variable and name it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
