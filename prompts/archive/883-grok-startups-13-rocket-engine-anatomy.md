# grok-startups 13: interactive rocket engine and launch stack cutaways on /anatomy, narrated by Grok

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3283.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, posting) into ONE message at the end. Never contact xAI, SpaceX or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill and the `anatomy` skill (`.claude/skills/anatomy/SKILL.md` and its `reference.md`) before building, and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

xAI is now part of SpaceX (SpaceXSI). The audience that reshares SpaceX engineering content on X is enormous, and it loves explanations of how the hardware works. `/anatomy` already turns a machine into an interactive isometric cutaway with moving parts, flows, a section cut, an exploded view and a guided tour. A precise, beautiful cutaway of a full-flow staged-combustion methane-oxygen engine and of a fully reusable two-stage super-heavy launch stack, narrated by Grok, is the most reshareable thing we can make for that audience. It must be accurate enough that engineers share it rather than correct it.

## Step 0: re-derive the current state

    sed -n 1,80p .claude/skills/anatomy/SKILL.md
    grep -n "^#\|^##" .claude/skills/anatomy/reference.md | head -40
    sed -n 1,60p api/anatomy.js
    grep -n "export\|function" src/anatomy/spec.js | head -30
    grep -n "featured\|gallery" src/anatomy/page.js | head
    curl -s "https://three.ws/api/anatomy?limit=5" | head -c 600; echo

Read the spec format end to end (`src/anatomy/spec.js`, `src/anatomy/shapes.js`, `src/anatomy/effects.js`) and open two existing featured designs on your dev server to see the quality bar. Find how a design is stored, how the gallery features designs, and how each design's OG card is made.

## Tasks

1. **Facts from public primary sources only.** `docs/anatomy/rocket-engines-sources.md`: for the engine cycle, cite public sources for each fact you will show: cycle (full-flow staged combustion: fuel-rich and oxidizer-rich preburners, two turbopumps, all propellant passes through the turbines, gas-gas injection), propellants (liquid methane and liquid oxygen), approximate chamber pressure and thrust as publicly stated by the manufacturer or reported by reputable outlets, with the date of the statement. For the launch stack: two fully reusable stages, booster engine count and upper stage engine split (sea-level and vacuum-optimized), hot staging, catch by the launch tower's arms. Mark each number as "publicly reported" with its source and date. No leaked, internal or speculative data.
2. **Naming.** Title the designs generically and accurately ("Full-flow staged-combustion methalox rocket engine", "Fully reusable two-stage super-heavy launch system"), and in the description name the real vehicles only as nominative reference ("the cycle used by SpaceX's Raptor engine"). No SpaceX, Starship, xAI or X logos or trade dress in the model (context file, marks rule).
3. **The engine cutaway.** Author the spec by hand (or by the anatomy generator, then hand-correct it) with: both preburners, both turbopumps with spinning turbines and impellers, the main injector, combustion chamber, regeneratively cooled nozzle with coolant flow, propellant flows colored by species (methane, oxygen, fuel-rich gas, oxidizer-rich gas), a shader exhaust plume with shock diamonds, a section cut along the axis, an exploded view, and a guided tour of 8 to 12 steps that walks the full flow path. Every label matches a source.
4. **The launch stack.** A second design at stack scale: booster with its engine ring, interstage and hot-staging vents, upper stage with sea-level and vacuum engines, header and main tanks, grid fins and flaps, and a tour from liftoff through hot staging, boostback, and catch. Keep the geometry abstract and proportionally faithful; do not copy any company render.
5. **Grok narration.** Add an optional narrated tour mode to `/anatomy` that sends each tour step's verified facts to Grok 4.7 (model id from `api/_lib/chat-models.js`) through a server endpoint and plays the answer through the repo's TTS lane, constrained by a system prompt that forbids adding facts beyond the step's sources. The narration text is cached per design and step after first generation. Without `GROK_API_KEY`, the tour plays the authored step text through the same TTS lane, with no message pretending Grok wrote it. Usage recorded with `client_id` `xai-anatomy`.
6. **Feature and share.** Feature both designs in the gallery, give each a 1200 x 630 OG card rendered from the real cutaway, and add Share to X on the design page using `src/shared/share.js` (reuse; do not write a second share UI) with a draft text that credits the cycle accurately and is token-free.
7. **Accuracy review.** Write `docs/anatomy/rocket-engines-review.md`: each label and number, its source, and your confidence. Anything you cannot source is removed from the design, not hedged.
8. **Docs.** A section in the anatomy docs (find them), a changelog entry, and an X post draft for order 882's kit only if 882's kit file exists (otherwise add the draft text to the review doc's last section for the owner).

## Definition of done

- [ ] Both designs load at their `/anatomy/<id>` URLs on your dev server with moving parts, flows, section cut, exploded view and the full tour; Playwright screenshots of each state, no console errors, smooth on the repo's mobile breakpoint.
- [ ] Every label and number in both designs appears in the sources doc with a public source.
- [ ] Narrated tour works with the authored-text fallback (no key) and, with a key, Grok narration (one step's audio URL in the report). The live Grok call without a key returns the documented 401 (output in the report).
- [ ] OG cards render from the real cutaway and the share panel opens with the right text.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The anatomy generator produces a weak spec | Hand-author or hand-correct it; the spec format is plain data. |
| A public number conflicts between sources | Show the manufacturer's latest public statement with its date and note the range in the sources doc. |
| WebGL is slow in headless Chromium | Use the memory note on verifying without the full world: screenshot with swiftshader at reduced resolution, and test motion logic in unit tests. |
| No TTS lane available | Ship the tour as text and captions; voice is a progressive enhancement. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (deploy, posting, Grok narration after order 927): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (time to interactive of the engine design on a mid-range mobile profile).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
