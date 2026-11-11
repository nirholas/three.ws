# microsoft 04: generate 3D from inside a Teams or Copilot chat with live-updating Adaptive Cards

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3104.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The Teams bot today answers search queries and link unfurls with static Glance cards. Adaptive Card Universal Actions (`Action.Execute`, the `refresh` property and `adaptiveCard/action` invokes) let a card become a small app: a user types a prompt, the card shows generation progress that updates in place for everyone in the channel, and the finished card carries a poster, the model page link and an "Open in 3D" stage view. That turns every Teams channel where the app is installed into a place where 3D gets made and seen, which is how a B2B app spreads inside a tenant.

## Step 0: re-derive the current state

    sed -n 1,260p api/_lib/teams-bot.js
    sed -n 1,80p api/microsoft-teams/messages.js
    sed -n 1,160p api/_lib/glance-adaptive.js
    grep -n -i "composeExtensions\|commands\|bots" -A12 integrations/microsoft/copilot-teams/manifest.template.json | head -80
    ls tests | grep -i -E "teams|glance"
    node scripts/read-service-env.mjs 2>/dev/null | grep -i -E "teams|bot|microsoft_app" | sed 's/=.*/=<set>/'

Read the current learn.microsoft.com pages for Universal Actions for Adaptive Cards (Action.Execute, refresh with `userIds`, invoke response shapes), message extension action commands, and the Bot Framework Connector `updateActivity` call.

## Tasks

1. **Action command.** A message-extension action command "Create a 3D model" (task module with prompt, quality tier) and a bot command (`forge <prompt>` in chat or channel). Both start a real job on the free lane through the same server code the MCP `forge_free` tool uses, keyed by an idempotency key derived from the activity id.
2. **Progress card.** The bot posts a card that shows the prompt, a progress state and who requested it. Progress updates use `refresh` (for the requester) plus a bot-side `updateActivity` when the job settles, so every channel member sees the finished card without clicking. Respect Teams' refresh limits (find and cite them).
3. **Finished card.** Poster image, model name, buttons: "Open in 3D" (stage view or deep link to the existing `/microsoft/teams-tab`), "Download GLB", "Make a variation" (`Action.Execute` that starts a new job with the same prompt and a new seed), and an error card with a "Try again" action that says what failed.
4. **Card builders** live beside `glance-adaptive.js` and pass the Adaptive Cards schema version Teams currently supports. The bot's token verification (`verifyBotToken`) covers the new invoke types.
5. **Manifest.** Add the action command to `manifest.template.json` with a small anchored edit (re-read first: sibling order 803 may also touch it); `npm run package:microsoft-app -- --check` validates it.
6. **Docs.** Update the Teams section of docs/microsoft.md and `docs/glance.md`, changelog entry.

## Definition of done

- [ ] Test-first unit tests feed real Bot Framework activity shapes (taken from Microsoft's documented examples, cited) through `handleActivity` and assert the invoke responses and card JSON for: action submit, refresh mid-job, refresh after success, variation, failure.
- [ ] One end-to-end run against the real production forge from a local bot process, driven by the open-source Bot Framework Emulator or a direct signed request, produces a real finished card; the GLB URL in it resolves.
- [ ] Card JSON validates against the Adaptive Cards schema version used.
- [ ] `npm run package:microsoft-app -- --check` and `npm test` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Bot app id or secret missing locally | `node scripts/read-service-env.mjs`; if absent everywhere, run the end-to-end check through the handler directly with the real forge job, and name the variable in the owner message. |
| No Teams tenant | Verify with tests and the Emulator, write the sideload path, put the live Teams check in the owner message. |
| Free lane is slow or queued | Show honest queue position in the card; never fake progress percentages. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
