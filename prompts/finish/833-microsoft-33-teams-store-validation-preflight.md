# microsoft 33: pass Microsoft's Teams Store and Microsoft 365 app validation on the first submission

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3133.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Microsoft reviews every Teams and Microsoft 365 app against its published Store validation guidelines, and a rejection costs one to two weeks per round. The current `--check` validates the manifest schema only. The guidelines go much further: icon rules, name and description rules, working links, tab behaviour inside the iframe, bot responses to unknown commands, sign-in and sign-out flows, mobile rendering, theme support, a test account and test notes for the reviewer. Each one is checkable before submission.

## Step 0: re-derive the current state

    npm run package:microsoft-app -- --check
    ls integrations/microsoft/copilot-teams; cat integrations/microsoft/copilot-teams/intro.md | head -40
    grep -n "check\|validate" scripts/*microsoft-app* 2>/dev/null | head -20; ls scripts | grep -i microsoft
    ls marketing/growth/submissions/programs | grep -i -E "teams|copilot|microsoft"

Read Microsoft's current Teams Store validation guidelines and the Microsoft 365 app submission checklist in full, plus the documented validation the Teams Developer Portal and the Microsoft 365 Agents Toolkit CLI run (`atk validate` or its current name). Turn every rule into a row in a checklist file with its source URL.

## Tasks

1. **Rule catalogue** `integrations/microsoft/copilot-teams/validation/rules.json`: each guideline as an id, the source section, and how it is checked (automated, browser, or manual with evidence).
2. **Automated preflight** extending `npm run package:microsoft-app -- --check`: run Microsoft's own CLI validator against the built zip when installable (install it into a scratch directory with npx), plus checks for everything the CLI does not cover: icon dimensions, transparency and outline color rules; name, short and full description lengths and forbidden wording; every URL in the manifest and intro returns 200 over HTTPS; valid domains cover every loaded origin; privacy and terms links resolve; the developer name matches the Partner Center publisher name variable.
3. **Behavioural checks** with Playwright against the dev server on 3133 and production: the tab renders inside an iframe with TeamsJS absent, at mobile width, in dark and high-contrast themes, with no console errors; the bot answers a welcome, a help command and an unknown command with useful replies (exercise `api/microsoft-teams/messages.js` with real Bot Framework activity payloads against the handler); sign-in and sign-out paths work. Fix every failure in the product, test-first for logic bugs.
4. **Reviewer pack** `marketing/growth/submissions/programs/microsoft-teams-store-review.md`: test notes per capability with exact steps, the expected result and where to see it, the demo account the owner creates (named fields, no credentials in the repo), and the answers to the submission questionnaire.
5. **Docs.** A "Store validation" section in the package README or [docs/microsoft-teams-forge.md](../../docs/microsoft-teams-forge.md). Changelog entry only if user-visible fixes landed.

## Definition of done

- [ ] Every rule in `rules.json` is automated or has recorded evidence; the preflight passes (output in the report).
- [ ] Microsoft's CLI validator passes against the built package, or its exact failure is documented with the reason it cannot run here.
- [ ] Playwright behavioural checks pass; screenshots at desktop and mobile width in the report.
- [ ] Reviewer pack landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Microsoft's CLI needs a login | Use the offline validate mode if it has one; otherwise implement the documented rules locally and note it. |
| Bot auth blocks local activity tests | Call the handler's processing function directly with real activity payloads in tests; never disable production auth. |
| Package needs owner ids | Build with the documented placeholder-free test ids the package script already supports for `--check`. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
