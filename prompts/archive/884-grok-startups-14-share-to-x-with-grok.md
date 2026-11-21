# grok-startups 14: "Ask @grok about this" share intents on every model, avatar and anatomy page

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3284.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy) into ONE message at the end. Never contact xAI, X or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

On X, people tag @grok under posts to ask what they are looking at, and Grok answers publicly in the thread. A share that ends with a natural question to @grok ("@grok how would this rocket engine's turbopumps fail?") puts our link in front of Grok's answer and everyone who reads the thread, without any automation on our side. It is the user's own post, written by them, sent from their account through X's standard web intent. Today our share panel offers X but with generic text; this order makes the X share the best version of itself on the three page types that travel: models, avatars and anatomy designs.

## Step 0: re-derive the current state

    sed -n 1,120p src/shared/share.js
    cat src/shared/share-targets.js | head -60
    grep -rn "showSharePanel\|x.com/intent" src --include=*.js | grep -v "shared/share" | cut -c1-140
    grep -n "player\|twitter:card" pages/*.html | head -20
    sed -n 1,40p prompts/finish/931-x-grok-50-player-card-approval.md

List every page that calls the share panel or builds its own X intent (step 0 grep), with the entity kind each passes. Read X's web intent documentation for the `text`, `url`, `hashtags` and `via` parameters and their length rules (weighted character counting with URLs as 23). Check what each page's OG and Twitter card meta looks like today for a real model, a real avatar and a real anatomy design (fetch the production HTML and read the meta).

## Tasks

1. **One intent builder.** In `src/shared/share-targets.js` add `xIntentUrl({ text, url, via })` with X's weighted length rule implemented and tested (URLs count 23, emoji and CJK count 2), truncating the text, never the URL. Replace every hand-built X intent found in step 0 with it, test-first where behavior changes.
2. **Ask @grok mode.** In the share panel add a second X action, "Ask @grok about it", that opens the intent with text the user can edit in X's composer: a short description of the entity plus one question generated for that entity, ending with `@grok`. Questions come from a small template set per kind (model, avatar, anatomy) chosen by the entity's real metadata (prompt, category, machine name), written by you, no dashes, token-free. The user always sees and sends the post themselves; nothing auto-posts.
3. **Card quality.** The link must unfurl as a large image card. For each of the three page types confirm `twitter:card` is `summary_large_image` (or `player` where order 931 approved it; read 931's status line) with a real rendered image of that entity (`/api/render/glb` for models and avatars, the design's OG card for anatomy). Fix any page whose card is missing or generic, test-first with a test that fetches the page's HTML from the dev server and asserts the meta.
4. **Attribution.** Add `utm_source=x&utm_medium=share&utm_campaign=grok-ask` (and `grok-share` for the plain X action) to shared URLs, and record a click event through the repo's existing analytics path (find it; no new vendor) with the entity kind and action. Add the two labels to whatever report the owner reads for share traffic, or document the query in the docs.
5. **States.** The new action has hover, active, focus and disabled states, works by keyboard, and has an accessible label. On a page with no entity metadata yet (still generating), the action is disabled with a tooltip saying why.
6. **Docs.** `docs/share-to-x.md` (how the intents are built, the question templates, how to read attribution), a changelog entry.

## Definition of done

- [ ] `npx vitest run tests/x-intent.test.js tests/share-cards.test.js` passes, including weighted length edge cases.
- [ ] No hand-built `x.com/intent` or `twitter.com/intent` URL remains outside `share-targets.js` (`grep` evidence in the report).
- [ ] On your dev server, a real model, a real avatar and a real anatomy design each open the share panel, and both X actions open a correct intent URL (Playwright captures the popup URL; screenshots in the report).
- [ ] The three page types carry large image cards with real rendered images (meta dump in the report).
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| X's card validator is not public anymore | Assert the meta tags directly and fetch the image URL to check size and type. |
| A page builds its share UI outside the shared panel for a reason | Keep its UI, route its X link through `xIntentUrl`, and note it. |
| Popups are blocked in headless Chromium | Capture the intended URL from the click handler via Playwright's `page.on('popup')` or by intercepting `window.open`. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (deploy): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (pages converted to the shared intent builder).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
