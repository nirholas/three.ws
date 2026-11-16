# microsoft 27: turn the owner's Entra and Azure click-work into one idempotent provisioning command

> Status 2026-11-16 (re-verified): code, tests and docs landed (91c978f5d, f9d78c79d, 0aa1b95d3, d9ba024c4; drift-test repair 5cd199afc). `npm run microsoft:provision` plans live with no login (27 creates, 5 owner steps). Remaining owner step: `az login` to the publisher tenant, then `npm run microsoft:provision -- --apply --subscription <id>`, the gcloud line it prints, and `--verify`.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3127.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Steps 4 to 8 of the owner checklist in [docs/microsoft-marketplace-offer-plan.md](../../docs/microsoft-marketplace-offer-plan.md#owner-checklist-in-order), plus the Graph permissions order 816 needs and the bot secret order 804 needs, are a long sequence of portal clicks with values copied between them. Every missed redirect URI or permission becomes a support loop. One command, run once by the owner with their own Azure login, should create or reconcile every Microsoft-side resource and hand back the exact env update.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/microsoft-marketplace/status
    curl -s https://three.ws/api/microsoft-365/status
    grep -rhn -o "process.env.MS_[A-Z_]*" api src scripts integrations | sed 's/.*process.env.//' | sort -u
    grep -rn "redirect\|callback" api/microsoft-marketplace api/microsoft-365 api/_lib/teams-bot.js api/scim 2>/dev/null | grep -i "uri\|url" | head -20
    which az; az version 2>/dev/null | head -5
    ls scripts | grep -i -E "microsoft|azure|entra"

Build the inventory of every Microsoft resource the repo needs: app registrations (single-tenant fulfillment app, multitenant SSO app, any public PKCE client the Power Platform connector needs), each redirect URI the code registers, each Graph permission (delegated and application) the code requests, the Azure Bot and its Teams and Microsoft 365 channels, the Key Vault and the secret names, and every resulting env var. Derive it from the code, not from docs.

## Tasks

1. **Manifest of resources** `integrations/microsoft/provisioning/resources.json`: every app, redirect URI, permission (with its Graph permission id, resolved from Microsoft Graph's published service principal), bot, channel, vault and env var, each pointing at the code that needs it. A test fails when the code requests a scope or redirect not listed here.
2. **Provisioner** `scripts/microsoft-provision.mjs` (`npm run microsoft:provision`): uses the owner's `az login` session (Azure CLI plus Microsoft Graph REST via `az account get-access-token`). Default mode is `--plan`: reads current state and prints a diff of what would be created or changed. `--apply` creates or reconciles idempotently (rerunning changes nothing), creates client secrets with a stated expiry, writes secrets only to the Key Vault and to a local file outside the repo with mode 600, and prints the exact `gcloud run services update three-ws-api --region us-central1 --update-env-vars ...` line (never `--set-env-vars`). It never prints a secret to stdout. It also prints the admin-consent URL for the multitenant app.
3. **Verify mode** `--verify`: checks each live resource against the manifest and checks production's `/api/microsoft-marketplace/status` and `/api/microsoft-365/status`, then prints what remains.
4. **Tests** for the diff engine and manifest-to-code drift check, using recorded Graph response shapes taken from Microsoft's documented schemas.
5. **Prove it live** as far as possible without the owner's tenant: run `--plan` with no login and show the actionable message; if any Azure login exists on this machine, run `--plan` and `--verify` against it read-only.
6. **Docs.** `integrations/microsoft/provisioning/README.md`; replace steps 4 to 8 in the owner checklist with the one command and keep the manual click path in a collapsed fallback section; a `STRUCTURE.md` row.

## Definition of done

- [ ] `npm run microsoft:provision -- --plan` runs and prints either the plan or a clear login instruction (output in the report).
- [ ] The drift test fails when a new scope is added to code without the manifest (demonstrated, then reverted).
- [ ] No code path prints a secret; secrets go only to Key Vault and a 600-mode local file (test output).
- [ ] Owner checklist updated; README and STRUCTURE row landed; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Azure CLI | Install it user-local (pip or the official tarball); the script also checks for it and explains. |
| No owner Azure login | Expected. Build and test everything; the owner runs `--apply`. |
| A permission id is unknown | Resolve it from Graph's `servicePrincipals(appId='00000003-0000-0000-c000-000000000000')` published roles and scopes and record the source. |
| Bot creation needs a subscription | The script takes `--subscription` and `--resource-group`, defaulting to creating a dedicated resource group. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
