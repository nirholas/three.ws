# microsoft 44: an IT admin deployment kit so an organization can roll three.ws out to every seat through Intune, Edge and Teams admin

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3144.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Enterprise buyers do not ask each employee to install an app. Their IT admin pushes it: the Teams app pinned for a group through a Teams setup policy, the web app installed on every managed Edge through `WebAppInstallForceList`, browser extensions through `ExtensionInstallForcelist`, and admin consent granted once for the tenant. A vendor that hands the admin a ready kit (exact policy values, Intune steps, consent URL, a verification checklist) gets deployed in an afternoon; one that does not stalls in a ticket queue. three.ws has the pieces (Teams package, web app manifest, Edge extensions in [extensions/](../../extensions), Entra multitenant app) but no kit.

## Step 0: re-derive the current state

    cat public/site.webmanifest | head -40
    ls extensions; sed -n 1,40p extensions/EDGE.md
    node -e "const m=require('./integrations/microsoft/copilot-teams/manifest.template.json');console.log(m.id, m.webApplicationInfo||'no webApplicationInfo')"
    grep -n -i "admin consent\|adminconsent" docs/enterprise-sso.md | head

Read Microsoft's current docs for: Edge `WebAppInstallForceList` and `ExtensionInstallForcelist` (value formats, Edge Add-ons update URL), configuring them through Intune settings catalog and through Group Policy ADMX, Teams app setup policies and app permission policies (pinning and installing for users), the tenant-wide admin consent URL format, and Intune's web link and Microsoft Store app types.

## Tasks

1. **PWA readiness for force install.** Verify the web app manifest has everything Edge needs to install it as an app (id, start_url, scope, icons at required sizes including maskable, display, a service worker if the install criteria require it). Fix gaps test-first with a manifest test.
2. **Policy pack** `integrations/microsoft/admin-kit/`: generated, never hand-copied, by `scripts/microsoft-admin-kit.mjs` from the real manifest and extension ids: the Edge policy JSON values, an Intune settings catalog import (or exact settings and values where import is not supported), a `.reg` file and ADMX-based GPO steps for non-Intune shops, and a PowerShell script using the documented Teams PowerShell cmdlets to create a setup policy that installs and pins three.ws for a group. Every script supports a what-if or dry-run mode.
3. **Admin consent.** A page `/enterprise/admin-consent` (or a section on the existing enterprise surface) that explains the permissions the Entra app requests in plain language, links the tenant-wide consent URL built from the real client id, and handles the consent redirect with success and error states.
4. **Admin guide** `docs/microsoft-admin-deployment.md`: decision table (Teams only, browser app, extensions, all), step-by-step for each with screenshots of the policy values, verification checklist, rollback steps, and FAQ (data residency, permissions, network allowlist of domains). Add a public page from it, registered in `data/pages.json`, and link it from `/trust` and the enterprise page.
5. **Verification.** Lint the PowerShell (PSScriptAnalyzer in a scratch container), validate JSON outputs, test the generator, and load the consent page in a browser with the redirect success and error cases.
6. **Changelog** entry and `npm run build:pages`.

## Definition of done

- [ ] `node scripts/microsoft-admin-kit.mjs` regenerates the kit deterministically from real ids (diff clean on rerun).
- [ ] Manifest test and generator tests pass; PowerShell passes PSScriptAnalyzer with no errors.
- [ ] Consent page verified in a browser for success and error redirects, no console errors (screenshot paths).
- [ ] Guide page live in dev and linked from `/trust`; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| An extension is not yet on Edge Add-ons, so it has no store id | Generate the policy entry from the id when present; for unpublished ones, the kit documents the self-hosted update manifest path or marks the extension as pending store publication in the owner message. |
| No Intune tenant to test | Validate the formats against Microsoft's documented schema and test the Edge policy on a local Edge or Chromium with a policy file in a scratch profile. |
| The Entra client id lives only in env | Read it from the env at generate time; never hardcode a tenant-specific value. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
