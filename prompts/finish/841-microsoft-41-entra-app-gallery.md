# microsoft 41: get three.ws into the Microsoft Entra app gallery with SSO and SCIM provisioning preconfigured

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3141.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

When an Entra admin clicks "New application" they search the Entra app gallery, which lists thousands of SaaS apps with single sign-on and user provisioning preconfigured. A gallery listing is another Microsoft catalog presence, and it cuts enterprise onboarding from a custom app registration plus a SCIM setup guide to a few clicks. three.ws already has multitenant Entra sign-in and SCIM 2.0 ([docs/enterprise-sso.md](../../docs/enterprise-sso.md)); the gallery request needs those to pass Microsoft's checks and a submission package.

## Step 0: re-derive the current state

    sed -n 1,80p docs/enterprise-sso.md
    ls api/scim; grep -rn "scim" vercel.json | head
    grep -rn "openid\|id_token\|tid\b" api/auth/*microsoft* api/_lib/*entra* 2>/dev/null | head
    curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/scim/v2/ServiceProviderConfig

Read Microsoft's current docs on publishing to the Entra app gallery: the request process (the Microsoft Application Network portal), the requirements for OIDC multitenant apps and for SCIM provisioning listings, the SCIM validator Microsoft provides, and the documentation Microsoft publishes for each gallery app (the tutorial format the vendor supplies).

## Tasks

1. **SCIM conformance.** Run Microsoft's SCIM validator (or reproduce its documented test cases in `tests/scim-entra-conformance.test.js` against the real handlers on an isolated DB) covering users and groups: create, get, filter by `userName` and `externalId`, patch with the operations Entra sends (including the Entra-specific casing and `active` as string), replace, delete, pagination, and error formats. Fix every non-conformance test-first.
2. **OIDC checks.** Verify the multitenant sign-in meets the gallery's OIDC rules: works for any tenant, honours admin consent, handles `tid` correctly, supports the documented sign-in URL for IdP-initiated launch from My Apps, and returns clear errors for blocked tenants. Fix gaps test-first.
3. **My Apps launch.** A stable sign-in URL that My Apps can launch, which starts the Entra flow and lands the user in the app.
4. **Admin tutorial** `docs/entra-gallery-tutorial.md` in the structure Microsoft uses for gallery app tutorials: prerequisites, adding from the gallery, configuring SSO, configuring automatic provisioning with attribute mappings, testing, and troubleshooting.
5. **Submission package** `marketing/growth/submissions/programs/microsoft-entra-app-gallery.md`: every field the request form asks for, logo specs, the test tenant and test user instructions the owner prepares, the SCIM endpoint and token instructions, and the evidence from tasks 1 and 2.
6. **Docs and changelog** for any user-visible fix; `npm run build:pages`.

## Definition of done

- [ ] SCIM conformance tests (or Microsoft's validator run) pass with every documented case covered (output in the report).
- [ ] OIDC checks pass; the My Apps launch URL works on the dev server (screenshot or HTTP trace).
- [ ] Tutorial and submission package landed; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Microsoft's SCIM validator needs a public endpoint | Run it against production for read-only checks with a dedicated test team token if the QA path allows, else reproduce its cases locally. |
| No Entra test tenant | Owner item for the final gallery test; local and protocol-level verification is the bar here. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
