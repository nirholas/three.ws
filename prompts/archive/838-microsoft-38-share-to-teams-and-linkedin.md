# microsoft 38: Share to Teams and Share on LinkedIn for every creation and agent, with link previews that render correctly in both

Status 2026-11-16: code, tests, docs and changelog landed (7e0da777b, 3eee5d850). Remaining: owner deploy, then `npm run audit:share-previews` against production and a LinkedIn Post Inspector visual check.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3138.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

LinkedIn (a Microsoft company) is where enterprise buyers and the partnership audience are, and Teams is where they work. three.ws share menus today target crypto-native channels. Adding Share to Teams and Share on LinkedIn, and making sure both render a correct preview card (LinkedIn caches previews aggressively and is strict about image size and tags), turns every generated model into a shareable artifact in exactly the channels the Microsoft partnership reaches.

## Step 0: re-derive the current state

    grep -rln -i "share" src | grep -i -E "share|menu" | head
    grep -rn -i "twitter.com/intent\|x.com/intent\|t.me/share\|navigator.share" src | head -10
    grep -rn -i "linkedin\|teams.microsoft.com/share" src api | head
    grep -n "og:image\|og:title\|twitter:card" api/page-og.js api/forge-og.js 2>/dev/null | head
    curl -s https://three.ws/forge | grep -o '<meta property="og:[^>]*>' | head

Read the current docs for the Share to Teams web launcher (`teams.microsoft.com/share` parameters and the launcher script), LinkedIn's share-offsite URL and its Open Graph requirements (image size and aspect, title and description lengths, caching and the Post Inspector), and how Teams unfurls links without an app (Open Graph).

## Tasks

1. **Share targets.** Add "Teams" and "LinkedIn" to the existing share menu component used by creations, agents, avatars and the Forge result (find the shared component; do not duplicate per page). Teams uses the documented share URL with the preview text; LinkedIn uses share-offsite. Both open in a correctly sized popup with a new-tab fallback, are keyboard operable, and record a share event through the existing analytics path.
2. **Preview correctness.** Audit the OG and Twitter meta for creation, agent, avatar and profile pages against LinkedIn's and Teams' rules: absolute HTTPS image URLs, 1200x627-class images under the size limit, `og:image:width` and `height`, `og:type`, canonical URL, title and description length. Fix the generators (`api/page-og.js`, `api/forge-og.js` and siblings) test-first where a value is wrong.
3. **Automated check** `npm run audit:share-previews`: fetches a sample of real production URLs per page type, validates each against the rule set, and fails with the exact offending tag.
4. **Docs.** A share section in the relevant doc (find the share or OG doc; else `docs/sharing.md`) with the rule set and how to refresh a stale LinkedIn preview with Post Inspector. Changelog entry, `npm run build:pages`.

## Definition of done

- [ ] Both share targets appear in the shared menu on every page that uses it and open the right URLs (screenshot paths, generated URLs in the report).
- [ ] `npm run audit:share-previews` passes against production or lists the fixes that land with the next deploy, and it passes against the dev server on 3138 with those fixes.
- [ ] No console errors; `npm test` and `npm run audit:docs` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| LinkedIn Post Inspector needs a login | Owner step for a final visual check; the automated rule check is the bar here. |
| Share menu differs per page | Consolidate into the shared component only where the pages already share it; add the targets to each remaining menu with one helper. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
