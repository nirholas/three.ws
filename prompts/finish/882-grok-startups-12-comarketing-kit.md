# grok-startups 12: the co-marketing kit that earns amplification from xAI, SpaceXSI and X

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3282.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Sending email and posting on X are owner steps (gate 2). Batch every owner step into ONE message at the end. Never contact xAI, X or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Grok for Startups lists credits and a direct line to the startups team. It lists no co-marketing benefit. Amplification is therefore earned, not granted: xAI's developer relations, the Grok product accounts and individual staff reshare builds that make their product look good, and the startups team spotlights members who give them a concrete story. This order writes every piece that converts our builds into that story, so each time a sibling order ships, the owner has paste-ready text and the right person to send it to. The plan's thesis and routes D1 to D6 are in [docs/partners/xai-grok-startups-plan.md](../../docs/partners/xai-grok-startups-plan.md). Order 930 owns the Grok Bot and mention-bot launch posts; do not duplicate them, reference them.

## Step 0: re-derive the current state

    sed -n '/Map 2\|co-marketing\|Co-marketing/,+60p' docs/partners/xai-grok-startups-plan.md | head -90
    sed -n 1,60p docs/x-content-pipeline.md
    node -e "const q=require('./data/x-content/queue.json'); const a=Array.isArray(q)?q:q.items||q.posts||[]; console.log(a.length, Object.keys(a[0]||{}))"
    grep -n "grok\|xai" data/x-content/queue.json | head -20
    ls docs/partners/ | head -40
    grep -n "xai" data/partner-programs.json

Collect the real numbers the case study will use, from production, read-only: models generated through Grok-facing MCP servers, connected clients, generation latency, plugin installs if measurable, with the exact query or command for each (via an existing `--prod-env` CLI; never write to production). Read how earlier partner kits were written (any `docs/partners/*-comarketing*` or `*-kit*` file) and match their structure.

## Tasks

1. **The kit.** `docs/partners/xai-comarketing-kit.md` with these sections:
   - **Who reshares what.** The public accounts that amplify developer builds (the xAI corporate account, the Grok product account, xAI developer relations, the X developer platform account, and individual staff who publicly announced the products we build on, by public handle only, each with the link to the public post that shows they amplify third-party builds). No email addresses for any xAI person (context file rule). For each, the kind of content they reshare, based on their last public posts you can read.
   - **The startups-team email.** A short, specific update to send through the direct line the program gives (the owner holds the address): what we built on Grok in the first month, with links, the real numbers, and one ask (a spotlight or a reshare of a named post). Token-free. Two versions: after the first build ships, and after the marketplace listings go live.
   - **Case study.** A 400 to 600 word write-up computed from the real numbers in step 0: the problem (text to usable 3D for agents and developers), what runs on Grok, measured outcomes, and a quote. The quote is the owner's words, so leave it out of the committed file and put a proposed quote in the owner message for approval. Every number traces to a query in an appendix.
   - **Post drafts per build.** One X post and one reply thread per sibling order outcome (Cursor listing, Grok Build listing, official Grok Bot marketplace listing, Imagine reference-image eval result, hero clips, voice avatar, examples pack, rocket engine anatomy, Share to X with @grok), written for the account voice in `docs/x-content-pipeline.md`, each tagged with the account to mention and why, each token-free, no dashes. Each states which order's evidence it needs before it can go out.
   - **Timing and rules.** X automation and platform rules that apply to the owner's account (no bulk tagging, no automated replies to staff, rate of posting), and the approved membership wording.
2. **Queue entries.** Add the post drafts to `data/x-content/queue.json` in its existing schema with a status that means "draft, needs evidence" (read the schema and the pipeline doc; use the existing status value, never invent one), each linked to its order number. Validate the file with whatever validator the pipeline uses.
3. **Asset checklist.** For each post, the image or clip it needs and the exact command that produces it from real data (for example `/api/render/glb` for a still, order 875's endpoint for a clip, order 883's anatomy page for a card). Never produce a mockup; a post without its asset stays a draft.
4. **Tracking.** Each link in the drafts carries a `utm_source=x&utm_campaign=grok-startups&utm_content=<order>` tag, and the kit explains how to read the results with the existing `fetch-x-metrics` cron and the site analytics the repo uses (find both; do not add a new analytics vendor).
5. **Wire it.** Link the kit from the plan doc's co-marketing section and from `docs/partners.md` or the partner index if one exists (small anchored edits). No changelog entry (internal docs).

## Definition of done

- [ ] `docs/partners/xai-comarketing-kit.md` exists with every section, every public handle linked to a public post, every number traced to a query you ran.
- [ ] `grep -nE "@x\.ai|@spacex" docs/partners/xai-comarketing-kit.md` returns nothing (no staff email addresses).
- [ ] `grep -niE "\\\$THREE|token|coin|price" docs/partners/xai-comarketing-kit.md` returns nothing that is xAI-facing copy (internal notes that say "token-free" are fine; list any hit and why).
- [ ] The queue validates and holds the new drafts with the draft status and order numbers.
- [ ] `npm run check:rules -- --paths <your files>` exits 0 and `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| X pages do not render to curl | Use the public post URLs already cited in the plan doc and the repo's X tooling if it has read access (find it; read-only). A handle you cannot verify from a public post is left out. |
| Production numbers are small | Use them honestly. Small and real beats large and invented; the case study can lead with speed and quality instead of volume. |
| The queue schema has no field for the order number | Put it in the existing notes or meta field the schema has; never change the schema in this order. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. The last steps are the owner's (send the email, approve and post drafts as their evidence lands): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (the headline number the case study leads with).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message (the first email, ready to paste, and the first post to approve); one-line judgment calls. No trailing questions.
