# microsoft 17: the Power Platform connector, certification-ready, with flow templates and a Copilot Studio agent

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3117.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The connector exists with five actions and passes its own check, but an uncertified custom connector reaches nobody. Certification (a pull request to Microsoft's open `PowerPlatformConnectors` repository plus functional review) publishes it to every Power Platform tenant, and Microsoft reviewers and makers both judge a connector by what you can do with it in five minutes. Templates are that five minutes: ready flows ("new SharePoint item becomes a 3D model posted to Teams"), and a Copilot Studio agent that uses the actions.

## Step 0: re-derive the current state

    ls integrations/microsoft/power-platform-connector; cat integrations/microsoft/power-platform-connector/README.md
    npm run package:power-platform-connector -- --check
    node -e "const s=require('./integrations/microsoft/power-platform-connector/apiDefinition.swagger.json');console.log(Object.keys(s.paths), s.info)"
    gh api repos/microsoft/PowerPlatformConnectors/contents/README.md --jq .content | base64 -d | head -120
    gh api repos/microsoft/PowerPlatformConnectors/contents/certified-connectors --jq '.[].name' | head -20

Read the current certification requirements on learn.microsoft.com (connector metadata, `x-ms-connector-metadata`, summaries and descriptions on every operation and parameter, response schemas, the readme.md template, icon and brand colour rules, OAuth requirements, the submission checklist) and two recently certified connectors in that repository as format references only.

## Tasks

1. **Bring the definition to certification quality.** Every operation and parameter has summary, description and `x-ms-visibility`; dynamic values where useful (list my agents feeds the "agent" dropdown); proper response schemas so flow designers get typed outputs; a trigger if the API can support one honestly (webhook trigger on "model ready", only if the server side exists or you build it with tests); a policy template only if needed.
2. **Certified-connector folder** laid out exactly as the repository expects (`apiDefinition.swagger.json`, `apiProperties.json`, `readme.md` from their template, `icon.png`, any `script.csx`), generated from the in-repo source by the existing packaging script so it cannot drift. Validate with the open-source swagger validators the repository uses (and `paconn validate` if credentials allow).
3. **Flow templates** in `integrations/microsoft/power-platform-connector/templates/`: three to five flows as exported definitions in the Logic Apps workflow definition language, each with a README showing the trigger, steps and the import path. Examples: SharePoint list item to 3D model to Teams post; Forms response to avatar; daily digest of a team's new models to Outlook.
4. **Copilot Studio agent** sample: topics and the connector-action configuration documented step by step, with the agent's instructions text, in `templates/copilot-studio/`.
5. **Submission package.** `marketing/growth/submissions/programs/microsoft-power-platform-certification.md`: PR title and body, the certification checklist with each item's evidence, test account instructions for reviewers. Update docs/microsoft.md, changelog.

## Definition of done

- [ ] `npm run package:power-platform-connector -- --check` passes and also verifies the new metadata rules (summaries everywhere, response schemas present).
- [ ] The certified-connector folder validates with the repository's validators (output in the report).
- [ ] Each action the templates use is called against the real production API with the request shape the swagger declares, and the response matches the declared schema (a test, test-first where it fixes a mismatch).
- [ ] Templates, Copilot Studio sample, submission file, docs and changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `paconn` needs a Power Platform login | Validate with the open-source validators; put "`paconn validate` and import the templates in a dev environment" in the owner message. |
| A template needs an action the connector lacks | Add the action to the swagger and the API if the endpoint exists; otherwise drop that template. |
| Swagger and handler disagree | The handler is the truth; fix the swagger and add a contract test. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message (the certification PR); one-line judgment calls. No trailing questions.
