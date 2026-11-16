# microsoft 47: approve or deny agent actions from a Teams card with Universal Actions

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3147.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Agents on three.ws pause and ask before actions their owner gated ([docs/approvals.md](../../docs/approvals.md)): the request goes out by push, email and the `/approvals` inbox. Teams is where enterprise owners live during the workday, and "approve from chat" is the workflow Microsoft promotes with Adaptive Card Universal Actions (`Action.Execute`): the card updates in place for everyone, shows who decided, and refreshes to the current state when opened later. Adding Teams as an approval channel makes three.ws agents feel native in Microsoft 365 and cuts the time an agent waits for a human.

## Step 0: re-derive the current state

    sed -n 1,120p docs/approvals.md
    grep -n "export async function\|export function" api/_lib/approvals.js
    grep -rn "channel\|push\|email" api/_lib/approvals.js | head -20
    grep -n "invoke\|adaptiveCard/action\|conversationReference\|continueConversation" api/_lib/teams-bot.js | head

Read Microsoft's current docs on Universal Actions for Adaptive Cards (`Action.Execute`, the `adaptiveCard/action` invoke, `refresh` with `userIds`, card versions and fallbacks), proactive messaging from a bot (conversation references, creating a 1:1 conversation with an installed user), and the Bot Framework auth rules for incoming invokes.

## Tasks

1. **Conversation references.** Store the 1:1 conversation reference per linked Teams user from bot install and message events (reuse an existing store if one exists; migration through the documented path, `npm run db:status` first). Uninstall clears it. Tests first.
2. **Approval channel.** Add Teams to the approval fan-out in [api/_lib/approvals.js](../../api/_lib/approvals.js) alongside push and email, using the same request content, expiry and action hash, behind the owner's channel preference. A failure to deliver to Teams never blocks the other channels.
3. **The card.** A Universal Actions card showing exactly what the agent will do (agent, action, the amounts and destination formatted as the inbox shows them, expiry), Approve and Deny as `Action.Execute`, with `refresh` scoped to the owner so it always shows current state (pending, approved by, denied by, expired, executed with result link).
4. **Invoke handler.** Handle `adaptiveCard/action` in the bot: verify the Bot Framework token, map the Teams user to the three.ws owner, check the requester is the owner, then call the same approve or deny path the inbox uses (single execution, idempotent on retry, hash check unchanged). Return the updated card. Unauthorized users get a read-only card with a clear message. Tests first for tamper, wrong user, expired, double click and replay.
5. **Preferences.** A Teams toggle in the approvals channel settings, shown when a Teams identity is linked, with a real test approval that does nothing when approved (a no-op request type clearly labelled as a test).
6. **Docs.** A Teams section in [docs/approvals.md](../../docs/approvals.md) and [docs/microsoft-teams-forge.md](../../docs/microsoft-teams-forge.md). Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] Invoke handler tests pass for approve, deny, wrong user, expired, replay and double submit (output in the report).
- [ ] Cards validate against the Adaptive Cards schema for every state.
- [ ] An approval created on the dev server is delivered to the Teams channel code path with the right card (captured request; real delivery when a tenant with the app installed exists).
- [ ] Approving through the handler executes exactly once via the existing path, and push and email still work; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No tenant to receive a real card | Drive the invoke handler with signed test activities through the Bot Framework emulator or a test using the real auth verification with test keys; the live click-through goes in the owner message. |
| A real spend would be needed to test | Never. Use the labelled no-op test request type; real spend approvals are owner actions (CLAUDE.md gate 1). |
| `api/_lib/approvals.js` changed under you | Re-read and redo the anchored edit. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
