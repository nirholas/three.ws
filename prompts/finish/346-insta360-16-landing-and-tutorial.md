# insta360 16: the `/insta360` landing page and the "360 footage to 3D" tutorial

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3346.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (trademark wording section is binding for every word you write; page paths in C6). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Posting about the launch on any channel is an owner step owned by order 347 (you draft the posts in `docs/`). Never contact Insta360 or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Insta360 owners search for "insta360 to 3d", "insta360 gaussian splatting" and "360 video to 3d model". A clear page that shows real results and sends them to the right tool captures that intent, and a step-by-step tutorial answers the real question: how do I shoot so it works?

## Step 0: re-derive the current state

    sed -n 1,80p data/pages.json; grep -n "\"/capture\"\|\"/splat\"" data/pages.json vercel.json
    ls pages | head -80; sed -n 1,120p pages/capture.html
    ls docs/tutorials 2>/dev/null | head; grep -rln "sitemap\|og:image" scripts/*.mjs | head
    ls pages/pano-scene.html src/capture-360.js 2>&1
    grep -n "built\|status" prompts/finish/_context/insta360-PROGRESS.md | tail -20

Record how marketing pages are structured (shared header and footer partials, CSS tokens, OG image pipeline, sitemap generation), which 360 surfaces already exist on disk, and any real results siblings logged.

## Tasks

1. **Page** `pages/insta360.html` plus a small `src/insta360-landing.js` if interactive, registered in `vercel.json` routes, `vite.config.js` inputs and `data/pages.json` (hot files, anchored edits, last). Title "Turn 360 footage into 3D you own". Nominative subtitle: "Works with Insta360 X3, X4, X5 and X6 files, and any 360 camera."
2. **Sections**, each linking to the real surface by path (C6):
   - Walk around, get a splat: `/capture` 360 mode. Embedded live example: a real splat produced from a real 360 walkaround (first choice: a sibling's verify output listed in the progress log, copied to R2 under a public `showcase/insta360/` path; second: run whichever 360 pipeline stages exist on disk on a real fixture through a Cloud Run Job; third, only if no 360 stage exists yet: leave the embed out and show the section's copy, then 347 adds the real result). Never show a result that was not produced by the lane you link.
   - Step inside one photo: `/pano-scene`.
   - Your 360 photo as your avatar's world: the viewer environment control.
   - 360 motion capture: `/video-to-motion` 360 mode.
   - In your editor: Blender extension, Premiere Pro panel (with honest status: "coming soon" only if the listing is not live, linking to install-from-file instructions in the integrations READMEs instead of fake store links).
   - For agents and scripts: MCP tools and the CLI.
   - What you get: PLY, SPZ, GLB, MP4 flythrough; no monthly scene cap; works with older models and other brands. Factual, no disparagement of Spatial Capture (context file wording).
3. **Shooting guide** inline and in the tutorial: walk slowly, camera on a stick above head height, loop back to the start, 30 s to 3 min, avoid mirrors, glass and moving crowds, overcast light, keep the same exposure (lock it in the app), shoot at the highest resolution, use the raw `.insv`.
4. **Tutorial** `docs/tutorials/insta360-to-3d.md` (or the repo's tutorial location from step 0) with steps for each lane, troubleshooting tied to the real error codes (`too_few_registered`, `unsupported_camera`, quality failure), and a model support table that reads from facts in the progress log (only list as supported what a sibling verified on real footage; others as "should work, not yet verified").
5. **SEO**: meta description, canonical, OG and Twitter cards with an OG image generated through the repo's OG pipeline from a real result frame, JSON-LD `HowTo` for the shooting guide, sitemap entry through the existing generator, internal links from `/capture` and the tools index.
6. **Launch drafts** in `docs/marketing/insta360-launch.md` (or the repo's drafts location): an X thread, a Reddit post for r/Insta360 and r/GaussianSplatting written per each subreddit's self-promotion rules (read them on the day and quote the relevant rule), and a short demo video script. Owner posts them; you never post.
7. **Quality**: Lighthouse on the local page (performance and accessibility 90 or higher on mobile; record scores), 400 px layout, hover, active, focus, reduced-motion respected for any animation, images in modern formats with sizes.
8. Changelog entry, `STRUCTURE.md` row (hot file, last), `npm run build:pages`.

## Definition of done

- [ ] `/insta360` reachable from navigation and linked from `/capture`; every link resolves to a real page on the local server (scripted link check).
- [ ] Every result shown was produced by the lane it links, with its source recorded in the page's data or the report.
- [ ] Tutorial and launch drafts committed; Lighthouse scores recorded.
- [ ] No console errors or warnings. `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Sibling surfaces not built yet | Link by the contract path; the scripted link check lists which return 404 today and 347 reruns it. Do not show those sections' results until they exist; show the copy and the "how it works". |
| No real showcase result yet | Task 2's order of choices; never stock or AI-generated imagery passed off as output. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Posting is the owner's: leave this file in `finish/` with a dated status line naming the drafts. Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the Lighthouse scores.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
