# microsoft 34: meet Microsoft's AI app requirements in the Teams bot: AI labels, feedback, content reporting, streaming and citations

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3134.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Microsoft holds apps that generate AI content to extra Store requirements: generated messages must be labelled as AI generated, users need a way to give feedback and to report inappropriate content, and Microsoft recommends streaming and citations for agent answers. The three.ws Teams bot ([api/_lib/teams-bot.js](../../api/_lib/teams-bot.js)) chats with agents and generates 3D models but does none of this, which is both a review risk and a trust gap for enterprise admins.

## Step 0: re-derive the current state

    grep -n -i "AIGeneratedContent\|feedbackLoop\|streaminfo\|citation\|report" api/_lib/teams-bot.js api/microsoft-teams/*.js
    grep -n "async function\|export" api/_lib/teams-bot.js | head -40
    ls api | grep -i -E "report|moderation|feedback"; grep -rln "content_reports\|moderation" api/_lib | head
    npx vitest run $(ls tests | grep -i teams | sed 's#^#tests/#')

Read Microsoft's current docs: Teams Store validation guidelines for apps with AI-generated content, the bot message entities for the AI label and citations, the feedback loop (`feedbackLoopEnabled` and the `message/submitAction` feedback invoke), and bot streaming (`streaminfo` entities, typing and informative updates).

## Tasks

1. **AI label.** Every bot message containing model-generated text or a generated asset carries the AI-generated entity per the current schema. Deterministic system messages (help, errors) do not.
2. **Feedback loop.** Enable thumbs up and down with the optional comment on agent replies; handle the feedback invoke, store it in an existing feedback table if one fits (search first; `api/forge-feedback.js` and similar) or a new migration (fresh UTC timestamp, `npm run db:status` first), linked to the agent, message and Teams tenant id, never storing message content beyond what the existing privacy docs allow.
3. **Report inappropriate content.** A "Report" action on generated replies and model cards that records a report into the existing moderation or report pipeline (find it first), notifies ops through the existing alert path, and confirms to the user.
4. **Streaming.** Agent replies stream to Teams using the documented streaming protocol in personal chat, with informative status updates while a Forge job runs, falling back to a single message where streaming is not supported (group chats per Microsoft docs).
5. **Citations** where an agent answer uses its knowledge documents: render citations per the schema with titles and links back to three.ws.
6. **Tests first** for each entity builder and the feedback and report handlers with real Teams activity payload shapes.
7. **Docs.** A "Responsible AI" section in [docs/microsoft-teams-forge.md](../../docs/microsoft-teams-forge.md) describing labels, feedback, reporting and what is stored; a `/trust` line if it lists Teams data handling. Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] Bot replies carry the AI label, feedback and report actions in tests built from real payload shapes (output in the report).
- [ ] A feedback invoke and a report invoke each create a real row on an isolated DB, and the report fires the ops alert path.
- [ ] Streaming produces the documented sequence of activities for a personal chat and a single message for a group chat (test output).
- [ ] `npm test`, `npm run audit:docs` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Teams tenant to see it render | Payload tests against Microsoft's documented shapes are the bar; live check goes in the owner message. |
| No moderation pipeline exists | Add a minimal `content_reports` table and an admin list in the existing admin area; no new external service. |
| Database | Isolated DB via `scripts/lib/isolated-db.mjs` for tests; apply the migration to production only after `npm run db:status`. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
