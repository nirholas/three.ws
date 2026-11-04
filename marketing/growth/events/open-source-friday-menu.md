# Open Source Friday: the contribution menu

The ready-to-go set of first contributions for the GitHub Open Source Friday stream
(campaign `MKT-2026-09-OSF`), plus the booking reply for
[githubevents/open-source-friday#254](https://github.com/githubevents/open-source-friday/issues/254).
The stream itself, the criteria, and the runsheet are in the
[stream plan](../../../docs/open-source-friday-plan.md); this file supplies what that plan's
"How can people contribute?" segment needs now that its original issues are done.

## Why the menu was rebuilt

Read-only check on 2026-09-17 with
`gh issue list --repo nirholas/three.ws --state open --limit 100`: **the repo has zero open
issues.** All six curated first issues from August (#110 to #115) were closed between
2026-09-14 and 2026-09-15, which is good news and leaves the stream's live-contribution segment
with nothing to point at. Issue #254 is open and carries the `approved` label; the booking bot
asked for a date on 2026-09-01 and no date has been posted.

## Status on 2026-11-04: the menu needs a new on-air issue

Re-verified against `main` on 2026-11-04 by running each issue's probe or opening its test file.
Every one of the seven is now fixed in code:

| # | Issue | How it was checked |
|---|---|---|
| 1 | HumanIK `Character1Hips` (held, never filed) | `Character1Hips -> Hips`, `Character1_LeftArm -> LeftArm`; `tests/animation-retarget-humanik.test.js` loads a HumanIK-renamed avatar through GLTFLoader |
| 2 | [#339](https://github.com/nirholas/three.ws/issues/339) Biped fingers | `Bip01 L Finger0 -> LeftHandThumb1`, `Finger01 -> LeftHandThumb2` |
| 3 | [#340](https://github.com/nirholas/three.ws/issues/340) ValveBiped | `ValveBiped.Bip01_Pelvis` and `ValveBipedBip01_Pelvis -> Hips`; Rig Doctor has a `source` convention |
| 4 | [#341](https://github.com/nirholas/three.ws/issues/341) GLB declared length | `isValidGlbMagic` rejects a header declaring 9999 or 12 bytes; `tests/glb-magic.test.js` |
| 5 | [#342](https://github.com/nirholas/three.ws/issues/342) URL scheme guard tests | `tests/url-scheme-guards.test.js`, `tests/safe-url.test.js` |
| 6 | [#343](https://github.com/nirholas/three.ws/issues/343) model URL allowlist tests | `tests/safe-model-url.test.js`, with evil-host cases |
| 7 | [#344](https://github.com/nirholas/three.ws/issues/344) Money Pulse rollover | `fmtUsd(999.6) = $1.0k`, `fmtUsd(999999) = $1.0M`, `fmtThree(999950) = 1.00M` |

So issues #339 to #344 are open on GitHub but stale: the work they describe is on `main`. Close
each one with a comment pointing at the code above (owner action; nothing here was closed or
commented on). That leaves the repo with no open good first issue again.

**The new on-air candidate is issue 8**, Blender Rigify's numbered spine, verified open on
2026-11-04. Rigify names its trunk `DEF-spine` to `DEF-spine.006`; the raw spelling collapses all
seven to `Spine`, the runtime spelling drops six of them, and `DEF-shoulder.L` collides with the
upper arm on `LeftArm`. It has the same shape as issue 1 had (a rig that does not animate, then
does) and follows the same worked example. Body:
[08-rig-rigify-numbered-spine.md](./osf-issues/08-rig-rigify-numbered-spine.md). Create it the
Monday before the stream:

```bash
gh issue create --repo nirholas/three.ws --title 'Rig: map the Blender Rigify numbered spine (`DEF-spine.001` to `.006`) instead of collapsing it onto `Spine`' --label 'good first issue' --label 'area: rig' --label 'enhancement' --body-file marketing/growth/events/osf-issues/08-rig-rigify-numbered-spine.md
```

The sections below are the 2026-09-17 record and are kept for history.

## The seven issues

Each was verified against `main` on 2026-09-17: the file paths exist, the probe in the body
reproduces the stated output, and every label below already exists on the repo. Bodies are
written for a contributor with no prior context.

| # | Title | Area | Size | Body file |
|---|---|---|---|---|
| 1 | Rig: map HumanIK joint names after three.js strips the namespace colon (`Character1Hips`) | rig | Small: one prefix rule and a test table | [01-rig-humanik-sanitized-names.md](./osf-issues/01-rig-humanik-sanitized-names.md) |
| 2 | Rig: map 3ds Max Biped finger chains (`Bip01 L Finger0`, `Finger01`) | rig | Small: one loop and a test table | [02-rig-biped-finger-chains.md](./osf-issues/02-rig-biped-finger-chains.md) |
| 3 | Rig: map Source engine `ValveBiped.Bip01_*` skeletons and teach Rig Doctor to name them | rig | Medium: prefix, three joints, a fingerprint, a docs row | [03-rig-source-engine-valvebiped.md](./osf-issues/03-rig-source-engine-valvebiped.md) |
| 4 | Upload check: `isValidGlbMagic` skips the declared-length check the server enforces | bug | Small: one check and a new test file | [04-glb-magic-declared-length.md](./osf-issues/04-glb-magic-declared-length.md) |
| 5 | Tests: cover the `safeUrl` and `sanitizeUrl` script-scheme guards | tests | Small: tests only | [05-tests-url-scheme-guards.md](./osf-issues/05-tests-url-scheme-guards.md) |
| 6 | Tests: lock in the anchored host allowlist in `isSafeQueryModelUrl` | tests | Small: tests only | [06-tests-model-url-allowlist.md](./osf-issues/06-tests-model-url-allowlist.md) |
| 7 | Money Pulse: compact numbers roll over into the wrong unit (`$1000`, `1000.0k`) | bug | Small: two functions and a test file | [07-pulse-format-unit-rollover.md](./osf-issues/07-pulse-format-unit-rollover.md) |

**Order of work for the stream.** Issue 1 is the on-air segment: it is the smallest change with
the most visible result (a rig that did not animate, animating), and it follows the worked
example in [docs/first-contribution.md](../../../docs/first-contribution.md) exactly. Issue 2
should land before issue 3, because Source skeletons reuse the Biped finger names. Issues 4 to 7
need no 3D knowledge at all, which is the point: they are the answer to "I am not a graphics
person, can I still help?"

## Create them (owner, one command each)

**Issues 2 to 7 were created on 2026-09-30**, after re-running every probe against `main` (all
six still reproduce): [#339](https://github.com/nirholas/three.ws/issues/339) Biped fingers,
[#340](https://github.com/nirholas/three.ws/issues/340) ValveBiped (its body links #339),
[#341](https://github.com/nirholas/three.ws/issues/341) GLB declared length,
[#342](https://github.com/nirholas/three.ws/issues/342) URL scheme guard tests,
[#343](https://github.com/nirholas/three.ws/issues/343) model URL allowlist tests,
[#344](https://github.com/nirholas/three.ws/issues/344) Money Pulse rollover. They went up before
the stream was booked because the repo had no open good first issue at all, which kept it off
GitHub's `/contribute` page and the aggregators that read the label. Issue 1 is still held for
the on-air segment; its command is below.

Run from the repo root. Titles use single quotes because several contain backticks. Create
issues 2 to 7 when the stream date is booked, so the community can claim them before air. Create
issue 1 the Monday before the stream so it is still open for the live segment.

```bash
gh issue create --repo nirholas/three.ws --title 'Rig: map 3ds Max Biped finger chains (`Bip01 L Finger0`, `Finger01`)' --label 'good first issue' --label 'area: rig' --label 'enhancement' --body-file marketing/growth/events/osf-issues/02-rig-biped-finger-chains.md

gh issue create --repo nirholas/three.ws --title 'Rig: map Source engine `ValveBiped.Bip01_*` skeletons and teach Rig Doctor to name them' --label 'good first issue' --label 'area: rig' --label 'enhancement' --body-file marketing/growth/events/osf-issues/03-rig-source-engine-valvebiped.md

gh issue create --repo nirholas/three.ws --title 'Upload check: `isValidGlbMagic` skips the declared-length check the server enforces' --label 'good first issue' --label 'bug' --body-file marketing/growth/events/osf-issues/04-glb-magic-declared-length.md

gh issue create --repo nirholas/three.ws --title 'Tests: cover the `safeUrl` and `sanitizeUrl` script-scheme guards' --label 'good first issue' --label 'area: tests' --body-file marketing/growth/events/osf-issues/05-tests-url-scheme-guards.md

gh issue create --repo nirholas/three.ws --title 'Tests: lock in the anchored host allowlist in `isSafeQueryModelUrl`' --label 'good first issue' --label 'area: tests' --body-file marketing/growth/events/osf-issues/06-tests-model-url-allowlist.md

gh issue create --repo nirholas/three.ws --title 'Money Pulse: compact numbers roll over into the wrong unit (`$1000`, `1000.0k`)' --label 'good first issue' --label 'bug' --body-file marketing/growth/events/osf-issues/07-pulse-format-unit-rollover.md
```

The Monday before the stream:

```bash
gh issue create --repo nirholas/three.ws --title 'Rig: map HumanIK joint names after three.js strips the namespace colon (`Character1Hips`)' --label 'good first issue' --label 'area: rig' --label 'enhancement' --body-file marketing/growth/events/osf-issues/01-rig-humanik-sanitized-names.md
```

Issue 3 says "tracked in the separate Biped finger-chain issue". Once issue 2 has a number, edit
that sentence on GitHub to link it.

## Book the stream

1. Pick a Friday at https://gh.io/osf-booking. The program asks for at least two weeks of lead
   time, so the earliest bookable Friday from 2026-09-17 is **October 2, 2026**. Fridays that
   stay clear of the IBM event two week (October 15) are October 2, October 9, and October 23.
   The stream is 1:00 PM Eastern.
2. Post the reply below on
   [#254](https://github.com/githubevents/open-source-friday/issues/254), replacing only
   `<DATE>` with the booked Friday written like `Friday, October 9, 2026`.
3. Create issues 2 to 7 with the commands above, then run the stream plan's T-7, T-1, T-0,
   and T+1 posts ([stream plan, section 5](../../../docs/open-source-friday-plan.md#5-what-githubs-own-account-tells-us-about-promotion)).

### Booking reply for issue #254

```text
Booked for <DATE> at 1:00 PM ET. Thank you!

Plan for the stream, in your Streaming Guide's order: a live demo that takes a text prompt to a rigged 3D avatar and then to a single embed tag on a blank page, then Rig Doctor showing exactly which joints of an unsupported skeleton will not move. For the contribution segment we will take one open good first issue that teaches the animation retargeter a new skeleton convention, write the mapping and the test, open the PR, and review and merge it on air. The open issues are here: https://github.com/nirholas/three.ws/labels/good%20first%20issue

We will be on wired ethernet at 1920x1080 with a fallback model staged in case a generation worker is slow. Happy to send a 16:9 card and a short demo clip ahead of your announcement; just let us know the format you prefer.
```

This reply replaces the shorter draft in
[templates.md](../templates.md#github-open-source-friday-booking-follow-through), which predates
the approval.
