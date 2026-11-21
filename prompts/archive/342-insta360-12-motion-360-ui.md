# insta360 12: `/video-to-motion` and `/motion-swap` accept 360 clips with click-to-pick-the-person

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3342.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (you own the 360 input on these two pages; you send C3 fields over HTTP). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy) into ONE message at the end.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The worker side (order 341) can follow a person around the sphere; users need a way to hand it a 360 clip and say "that person". A 360 preview where you click the dancer is the clearest possible UI and it sets `subject.yaw_deg` and `pitch_deg` exactly.

## Step 0: re-derive the current state

    sed -n 1,160p pages/video-to-motion.html pages/motion-swap.html
    sed -n 1,240p src/video-to-motion.js
    sed -n 1,240p src/motion-swap.js
    grep -n "projection\|subject" api/motion-swap.js src/video-to-motion.js src/motion-swap.js

Record each page's upload path, size limits (360 clips are larger), request body, progress and result UI, and whether `api/motion-swap.js` already passes C3 fields (order 341 may have landed).

## Tasks

1. **Detect 360**: when the chosen video is 2:1 (metadata) or `.insv`, switch the page into 360 mode with a visible badge and a "This is a regular video" override. For `.insv` explain that motion needs a stitched clip and offer the path: "Export a 360 MP4 from Insta360 Studio or the app" (raw `.insv` support for motion is out of scope; the `/capture` splat lane handles raw files).
2. **Pick the person**: a 360 sphere preview (Three.js inverted sphere, drag to look, scrub bar) where the user clicks on the person; convert the click ray to `yaw_deg` and `pitch_deg` in the equirect frame convention the worker uses (C3: yaw 0 at the image centre, positive to the right; verify against 341's code if it exists, otherwise against the convention you document in the page code and the docs, and record it in the progress log). Show a marker at the picked spot; "Pick for me" leaves `subject` out (auto-detect).
3. **Request**: send `projection: "equirect"` and `subject` through the existing request path. If the upload path caps size below what a 3-minute 5.7K clip needs, raise the cap to match the worker's limit (read it in the worker README) with an anchored edit and a test.
4. **Result**: alongside the existing animation result, show the `reframe_url` video ("What the tracker followed") side by side with the avatar playback, synced on the same timeline, so a user can see why a motion looks the way it does. Handle a response without `reframe_url` (worker not yet upgraded) by hiding that panel and showing the result as usual.
5. **States**: designed errors for subject lost (with the worker's `message`), file too large, unsupported raw file; loading skeletons; hover, active, focus; 400 px layout. Copy uses the nominative wording from the context file.
6. **Tests** `tests/motion-360.test.js`: 2:1 detection, click-ray to yaw and pitch (centre, edges, poles, seam), request body shape with and without `subject`, result panel toggling.
7. Docs: motion docs section for 360 clips, changelog entry.

## Definition of done

- [ ] In a real browser on port 3342 with a real 2:1 clip of a person: 360 mode activates, the click sets a marker, the request body carries `projection` and `subject` (Network tab evidence).
- [ ] With the deployed worker (pre-341) the page still works and hides the reframe panel; with 341's response shape (from its tests or a 341 job output in the progress log) the side-by-side panel renders a real reframe video.
- [ ] No console errors or warnings from this code. Tests, `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| 341 not landed yet | Build to C3; prove the request side on the live worker (which ignores unknown fields) and the result panel against a real reframe MP4 you produce with ffmpeg's `v360` filter from a real 360 clip. |
| Sign-in needed | `self-unblock-playbook` QA login row. |

## Close out (required)

1. Verify every Definition of done line with the command output or browser evidence in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) including the yaw and pitch convention.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
