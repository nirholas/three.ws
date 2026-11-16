# microsoft 43: PR-ready three.ws samples for the Microsoft PnP community galleries

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3143.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Microsoft's Patterns and Practices (PnP) community runs the sample galleries Microsoft 365 developers browse on adoption.microsoft.com and GitHub: `pnp/copilot-pro-dev-samples` (Copilot extensibility), `pnp/teams-dev-samples` (Teams apps) and `pnp/sp-dev-fx-webparts` (SharePoint web parts). Samples merged there get featured in community calls and the Microsoft 365 developer blog roundups, which is free reach into exactly the audience that builds on Microsoft 365. Each gallery has strict contribution rules (folder naming, README template, `assets/sample.json` metadata, screenshots, license). This order builds the samples to those rules, verifies they run, and stages them so the owner opens the PRs.

## Step 0: re-derive the current state

    ls integrations/microsoft integrations/microsoft/copilot-teams
    ls docs | grep -i -E "microsoft|teams|sharepoint|copilot"
    curl -s https://three.ws/.well-known/mcp.json 2>/dev/null | head -c 400; echo
    ls samples examples 2>/dev/null | head

Read each gallery's current CONTRIBUTING guide, README template, `sample.json` schema, required screenshots, naming conventions, supported toolchain versions (Teams Toolkit or Microsoft 365 Agents Toolkit, SPFx version) and PR checklist, straight from the GitHub repositories. Record the rules in the staging README below before writing a sample.

## Tasks

1. **Staging area** `integrations/microsoft/pnp-samples/` with a README that lists each sample, the target gallery, the gallery's rules and their source URLs, and the exact steps for the owner to fork, copy the folder and open the PR.
2. **Copilot sample** for `pnp/copilot-pro-dev-samples`: a declarative agent that uses the three.ws remote MCP server (or the API plugin, whichever the gallery's current format supports) to search agents and generate a 3D model, built with the current Microsoft 365 Agents Toolkit project layout. Self-contained: a builder needs only a free three.ws account and the documented key.
3. **Teams sample** for `pnp/teams-dev-samples`: a Teams message extension plus link unfurl that renders a three.ws model as an Adaptive Card with a stage view, using the current Teams AI library or Agents SDK and Toolkit layout.
4. **SharePoint sample** for `pnp/sp-dev-fx-webparts`: an SPFx web part that embeds a three.ws 3D viewer (the `<agent-3d>` web component or the public viewer URL) with a property pane for the model URL, on the SPFx version the gallery currently requires.
5. **Gallery compliance for each sample**: folder name per convention, README from the template (summary, compatibility table, contributors set to the owner's GitHub handle, version history, prerequisites, minimal path to awesome, features, disclaimer), `assets/sample.json` valid against the gallery schema, real screenshots captured from the running sample, MIT license where required, no secrets or tenant ids.
6. **Verification.** Each sample builds with its own toolchain in a scratch copy (`npm ci && npm run build` or the toolkit's package command), lints clean, and its three.ws calls succeed against production with a real key from the env (never committed). Validate each `sample.json` against the gallery's schema with a script.
7. **Docs.** Link the staging README from [docs/microsoft.md](../../docs/microsoft.md) (anchored edit, last).

## Definition of done

- [ ] Three samples, each passing its gallery's checklist line by line (checklist with ticks in the staging README).
- [ ] Each builds and packages with its own toolchain (output in the report); `sample.json` files validate.
- [ ] Real screenshots exist for each, captured from the running sample.
- [ ] No secrets in any sample (scan output); `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Microsoft 365 tenant to screenshot inside Teams or SharePoint | Use the toolkit's local workbench, Teams App Test Tool or the SPFx hosted workbench where it runs without a tenant; where a tenant screenshot is mandatory, the owner captures it and that goes in the owner message. |
| A gallery's toolchain needs a different Node version | Install it in the scratch directory with the repo's version manager or a portable Node; never change the repo's engine. |
| A gallery requires a contributor identity | Use the owner's GitHub handle from `git config user.name` and repo metadata; the owner opens the PR. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
