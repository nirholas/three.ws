# microsoft 16: a Microsoft 365 Copilot connector that puts a team's three.ws agents and models into Microsoft Search and Copilot

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3116.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The declarative agent lets Copilot call three.ws tools. A Copilot connector (formerly Graph connector) does something different and stickier: it indexes a customer's own three.ws content (their team's agents, models, and asset library) into their Microsoft 365 tenant, so a question in Copilot or a search in Microsoft 365 ("the forklift model marketing made last month") returns three.ws results with the right permissions. Content that lives in a tenant's search index is content that does not churn.

## Step 0: re-derive the current state

    ls api/teams; sed -n 1,80p api/teams/index.js
    grep -rn -i "externalConnection\|graph.microsoft.com" api src | head
    sed -n 1,80p api/_lib/microsoft-marketplace.js | grep -n -i "token\|tenant\|entra"
    grep -n -i "plan\|team" api/subscriptions/plans.js | head -20

Read the current learn.microsoft.com docs for Copilot connectors built on the Microsoft Graph connectors API: creating an `externalConnection`, registering a schema (searchable, queryable, retrievable properties, semantic labels such as `title`, `url`, `iconUrl`, `lastModifiedDateTime`, `createdBy`), writing `externalItem`s with ACLs (Entra users and groups, `everyone`), `activities`, URL-to-item resolvers, connection limits, and the app permissions (`ExternalConnection.ReadWrite.OwnedBy`, `ExternalItem.ReadWrite.OwnedBy`) with admin consent in the customer tenant.

## Tasks

1. **Admin connect flow.** In team settings, a tenant admin clicks "Connect to Microsoft 365", grants admin consent to the existing multitenant Entra app (`/adminconsent` endpoint), and three.ws stores the tenant id per team. Disconnect deletes the connection in their tenant and the stored tenant link.
2. **Connection and schema.** On connect, create the external connection with a stable id, register the schema (models and agents as item types distinguished by a property), set the URL resolver so pasted three.ws links resolve, and poll the schema operation to completion.
3. **Sync.** A cron (vercel.json `crons`, synced to Cloud Scheduler) that pushes created and updated items incrementally and deletes removed ones, with ACLs from team membership mapped to Entra identities where the member signed in with Microsoft (see how identities are stored), else the team's tenant group configured by the admin. Backoff on Graph throttling (429 with `Retry-After`). A full re-sync button.
4. **Item content.** Title, description, tags, creator, created and modified times, a poster `iconUrl`, and the public or signed URL; a text body that makes Copilot answers useful (for agents: persona summary and skills; for models: prompt and tags).
5. **Status UI.** Connection state, items indexed, last sync, last error with what to do. Docs: `docs/microsoft-365-copilot-connector.md` with the admin steps and data handling; link from docs/microsoft.md and `/trust` if it exists; STRUCTURE.md row; changelog entry; migration for the tenant link and sync cursor tables.

## Definition of done

- [ ] Test-first tests: schema payload validity against Microsoft's documented constraints, ACL mapping, incremental cursor, delete propagation, throttling backoff.
- [ ] Real calls to `https://graph.microsoft.com/v1.0/external/connections` from the sync code return Microsoft's documented response for the credentials available (success in a developer tenant, or the documented 401 or 403 without consent); evidence in the report.
- [ ] Settings UI verified in a browser on port 3116; no console errors.
- [ ] Docs, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The Entra app lacks the Graph permissions | Build everything; put "add these two application permissions to app X" in the owner message with exact names. |
| No Microsoft 365 tenant to test in | Prove the code against live Graph error responses; put "connect a Microsoft 365 developer tenant and run a sync" in the owner message. |
| Team members without Microsoft identities | Map them through the admin-chosen tenant group ACL and document the behaviour. |
| Migration ordering with siblings | Fresh timestamp; `npm run db:status` before `npm run db:migrate`. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
