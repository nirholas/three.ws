# microsoft 46: Teams activity feed notifications when Forge jobs finish and agents need attention

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3146.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

A 3D generation takes minutes. Teams users who start one from the message extension or bot should get a native Teams notification (the bell, the activity feed, the mobile push) when it finishes, not have to come back and check. The same channel serves agent events: an agent finishing a long task, a mention, a new message on its page. Microsoft Graph's `sendActivityNotification` delivers these into the Teams activity feed, linking straight to the three.ws tab, and is a strong engagement driver Microsoft highlights for store apps. It needs `activities.activityTypes` and `webApplicationInfo` in the manifest, the `TeamsActivity.Send` application permission, and a mapping from three.ws users to their Teams identity.

## Step 0: re-derive the current state

    node -e "const m=require('./integrations/microsoft/copilot-teams/manifest.template.json');console.log(JSON.stringify({activities:m.activities,webApplicationInfo:m.webApplicationInfo,authorization:m.authorization},null,1))"
    grep -rn "aadObjectId\|tenantId\|conversationReference" api/_lib/teams-bot.js | head
    grep -rln "notify\|notification" api/_lib | head -20
    grep -rn "forge.*complete\|job.*succeeded\|status = 'done'" api/_lib api/forge* 2>/dev/null | head

Read Microsoft's current docs on Teams activity feed notifications: `sendActivityNotification` for user, chat and team targets, the manifest `activities` section, required permissions (application `TeamsActivity.Send`, and the resource-specific consent alternative), the app must be installed for the recipient, templateText parameters, `topic` and deep links (`entityUrl` vs `text` with `webUrl`), throttling limits, and the newer customizable activity icons if the current schema supports them.

## Tasks

1. **Identity mapping.** Persist, per three.ws user, the Teams `aadObjectId`, `tenantId` and install state captured from bot and tab activity (installation update events, SSO in the tab). Migration through the documented path (`npm run db:status` first). Uninstall clears the mapping. Tests first.
2. **Manifest.** Add `webApplicationInfo` (if absent) and `activities.activityTypes` for: `forgeJobCompleted`, `forgeJobFailed`, `agentTaskCompleted`, `agentMentioned`, `agentMessageReceived`, each with a clear `templateText` (anchored edit to the shared `manifest.template.json`, re-read first).
3. **Graph sender** `api/_lib/teams-activity.js`: app-only token for the target tenant (client credentials against that tenant, cached until expiry), `sendActivityNotification` to the user, deep link into the three.ws personal tab with a subEntityId that opens the exact job or agent, retries with backoff on 429 and 5xx honouring `Retry-After`, permanent failures recorded and surfaced, never blocking the originating job.
4. **Event wiring.** Hook the sender into the real completion points for Forge jobs and agent events through the existing notification fan-out (reuse it, do not add a parallel path), behind a per-user preference.
5. **Preferences UI.** A Teams row in the existing notification settings: on or off per event type, shown only when a Teams identity is linked, with a "Send a test notification" button that sends a real one. Loading, empty (not linked, with how to link) and error states.
6. **Deep link handling.** The personal tab reads the subEntityId and routes to the job or agent view; test in the standalone tab with a simulated context.
7. **Docs.** A section in [docs/microsoft-teams-forge.md](../../docs/microsoft-teams-forge.md) covering the permission the owner grants (admin consent for `TeamsActivity.Send`), the event list and troubleshooting. Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] Package check passes with the new manifest sections (output in the report).
- [ ] Sender tests cover token caching, deep link building, 429 retry and permanent failure; mapping tests cover install and uninstall.
- [ ] A Forge job completion on the dev server reaches the sender with the right payload (log line or captured request, Graph call real when credentials and an installed tenant exist).
- [ ] Preferences UI verified in a browser, no console errors; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No tenant with the app installed to receive a real notification | Verify everything up to the Graph request with a request-capture test against Graph's documented contract; the live test in a tenant goes in the owner message. |
| Admin consent for `TeamsActivity.Send` not granted | Owner step; the sender detects the 403, records it once, and the settings UI shows the admin consent link. |
| The Entra app secret is not in local env | Follow the credential row of the `self-unblock-playbook` skill; read it from Cloud Run env with the documented tooling. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
