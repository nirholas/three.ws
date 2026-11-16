# microsoft 32: run the three.ws Microsoft 365 app in Outlook and the Microsoft 365 app, not only Teams

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3132.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

With the unified app manifest, the same package that runs in Teams can run in Outlook (message extensions, link unfurling, personal tabs) and in the Microsoft 365 app (personal tabs). That roughly doubles the daily-use surface at no extra listing cost: a sales rep pasting a three.ws model link into an email gets a live card, and the agents tab is one click from Outlook. It requires host-aware code paths, Outlook-safe cards and the right bot channel, which the current package does not have.

## Step 0: re-derive the current state

    node -e "const m=require('./integrations/microsoft/copilot-teams/manifest.template.json');console.log(JSON.stringify({staticTabs:m.staticTabs,configurableTabs:m.configurableTabs,validDomains:m.validDomains},null,1))"
    grep -n "app.initialize\|getContext\|hostName\|HostName" src/microsoft-teams*.js pages/microsoft-teams*.html 2>/dev/null | head
    grep -n "version\|AdaptiveCard" api/_lib/glance-adaptive.js | head
    grep -n "channelId\|msteams\|outlook\|m365extensions" api/_lib/teams-bot.js | head
    grep -n "@microsoft/teams-js" package.json

Read Microsoft's current docs on extending Teams apps across Microsoft 365: which capabilities run in Outlook and the Microsoft 365 app, the TeamsJS v2 host detection and capability checks (`isSupported()`), the Adaptive Card version and feature limits for Outlook message extensions, and the Azure Bot channel Outlook needs for message extensions.

## Tasks

1. **Manifest.** Declare the hosts each capability supports per the current schema (anchored edit to the shared `manifest.template.json`, re-read first). Add every domain Outlook and the Microsoft 365 app load from.
2. **Host-aware tab.** The `/microsoft/teams-tab` personal tab detects the host through TeamsJS, gates every Teams-only call behind `isSupported()`, and degrades cleanly in Outlook and the Microsoft 365 app (no Teams-only buttons that fail). Theme follows the host (default, dark, high contrast).
3. **Outlook-safe cards.** The search and link-unfurl responses return cards valid in Outlook: pick the card version and features per Microsoft's Outlook limits (detect the channel from the bot activity), and keep the richer Teams card for Teams. Tests assert the card per channel against the Adaptive Cards schema and the Outlook feature limits.
4. **Bot channel handling.** The bot accepts activities from the Outlook or Microsoft 365 extensions channel, with the same auth verification as Teams. Test-first for channel detection.
5. **Package check.** `npm run package:microsoft-app -- --check` validates the host declarations; test the tab in a browser with TeamsJS outside a host (it must render its standalone fallback with no console errors).
6. **Docs.** A "Running in Outlook and the Microsoft 365 app" section in [docs/microsoft-teams-forge.md](../../docs/microsoft-teams-forge.md), including the Azure Bot channel the owner enables and sideload test steps for Outlook web. Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] Package check passes with the new hosts (output in the report).
- [ ] Per-channel card tests pass; Outlook cards stay within Outlook's limits.
- [ ] The tab renders standalone and under a simulated Outlook host context with no console errors (screenshot paths).
- [ ] `npm test`, `npm run audit:docs` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Microsoft 365 tenant to test in Outlook | Schema validation, channel-specific card tests and the standalone render are the bar; live Outlook sideload goes in the owner message. |
| Unsure of Outlook card limits | Use Microsoft's published Outlook Adaptive Card guidance and cite it in the doc; pick the conservative version. |
| `manifest.template.json` moved under you | Re-read and redo the anchored edit. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
