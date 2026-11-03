# Autodesk HumanIK rigs animate after three.js load, and the rig gates and Rig Doctor agree with the runtime

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/285-plan-avatar-humanik-sanitized-bone-names.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 47 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

three.ws plays one shared clip library on any humanoid by rewriting bone names to a canonical skeleton. Autodesk HumanIK / MotionBuilder / Maya rigs are the standard mocap and game-export skeleton, and they ship every joint as `Character1:Hips`. The raw glTF spelling already canonicalizes, but three.js `GLTFLoader` runs node names through `PropertyBinding.sanitizeNodeName`, which deletes `:`, so the runtime retargeter in `src/animation-retarget.js` sees `Character1Hips`, which maps to nothing. Such an avatar lands in its bind pose (T-pose) with no animation and no explanation: the shared animation library silently does nothing on a whole class of avatars. The primary fix is one prefix rule plus a test table and is still unfixed. The source article also records two sibling defects of the same class: gates that disagree with each other (bone-count gate versus clip-coverage gate) and diagnostics that disagree with the runtime (Rig Doctor).

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `node --input-type=module -e "import {canonicalizeBoneName as c} from './src/glb-canonicalize.js'; console.log(c('Character1Hips'), c('Character1LeftArm'))"` prints `null null`. `Character1:Hips` maps to `Hips`. `CharacterMesh` correctly returns `null` today and must keep doing so.
- Already shipped (do not redo): 3ds Max Biped fingers and toes, Source engine `ValveBiped` skeletons (commit 638a7f687, tests in `tests/glb-canonicalize.test.js` lines ~262-340). Sibling rig issues 02 to 07 from the same Open Source Friday set (finger chains, ValveBiped, GLB declared length, URL scheme guards, model URL allowlist, pulse unit rollover) are already fixed in code; their GitHub issues, if filed, are stale, and closing issues is an owner action on the public tracker.
- `src/glb-canonicalize.js` `_lookupBone` (line ~460) strips a leading `identifier:` namespace (`^(?:[A-Za-z][\w]*:)+`) first, then vendor prefixes (`mixamorig\d*[_:]?`, `Armature`, `DEF|ORG|MCH`, `CH_`, `CC_Base_`, `Bip01`, `j_`). There is no `Character<digits>` fused or underscore strip.
- `src/animation-retarget.js` `canonicalBoneEntries` (line ~168) calls `canonicalizeBoneName(node.name)` on loaded (sanitized) names, which is where the fused spelling arrives. `retargetClipToRig` (line ~832) and `retargetClipToObject` (line ~878) each assemble their own inputs; the article records that `retargetClipToRig` once missed the A-pose rest directions.
- `tests/glb-canonicalize.test.js` has a HumanIK block (around lines 339 to 372) in `describe` + `it.each` table style with `Character1:` cases.
- `src/rig-report.js` is Rig Doctor's fingerprinter (`character-namespaced joints (Character1:Hips)` at line ~139); the article says Rig Doctor does not use the clavicle/upper-arm resolver the runtime uses.
- `marketing/growth/events/osf-issues/01-rig-humanik-sanitized-names.md` is a ready-written issue body with acceptance criteria.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
node --input-type=module -e "
import { canonicalizeBoneName as c } from './src/glb-canonicalize.js';
for (const n of ['Character1:Hips','Character1Hips','Character1LeftArm','Character1_Hips','Character2Hips','Character1LeftHandIndex1','CharacterMesh']) console.log(n,'->',c(n));
"
grep -n "Character" src/glb-canonicalize.js | head
grep -n "Character1" tests/glb-canonicalize.test.js | head
sed -n 825,880p src/animation-retarget.js
grep -n "resolveArmShoulderCollisions\|canonicalBoneEntries" src/rig-report.js src/rig-doctor-page.js
grep -rn "coverage" src/animation-retarget.js | head
ls tests | grep -i retarget
npx vitest run tests/glb-canonicalize.test.js tests/rig-report.test.js
```

Skip any task below whose behavior already holds.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first (bug fix): in `tests/glb-canonicalize.test.js`, next to the existing HumanIK `Character1:` table, add `it.each` tables for the fused form (`Character1Hips`, `Character1Spine`, `Character1Spine1`, `Character1Neck`, `Character1Head`, `Character1LeftShoulder`, `Character1LeftArm`, `Character1LeftForeArm`, `Character1LeftHand`, `Character1LeftUpLeg`, `Character1LeftLeg`, `Character1LeftFoot`, `Character1LeftToeBase`, and the Right counterparts), the underscore form (`Character1_LeftArm`), another character number (`Character2Hips`), and finger joints including thumbs (`Character1LeftHandIndex1`, `Character1RightHandThumb2`). Assert each equals the canonical result of its `Character1:` spelling, assert no mapping crosses sides, and assert `CharacterMesh`, `Character` and `CharacterHips` (no digits) still return `null`. Run `npx vitest run tests/glb-canonicalize.test.js` and confirm the new cases fail because the names return `null`, not because of a typo.
2. Fix `_lookupBone` in `src/glb-canonicalize.js`: after the colon-namespace strip and beside the other vendor-prefix strips, strip a leading `Character<digits>` prefix in its fused and single-underscore forms (`s = s.replace(/^Character\d+_?/, '')`, digits required), with a comment in the style of the neighbours explaining why the fused form exists (three.js `PropertyBinding.sanitizeNodeName` removes the colon). The probe plus the full existing table is the guard against collisions with real bone names; all existing `Character1:` cases must still pass.
3. Runtime end-to-end test: add a case beside the existing retarget tests (`tests/animation-retarget-rig-parity.test.js` or its neighbours) that builds a small in-memory skeleton from the canonical bone list renamed `Character1:<Bone>`, applies the loader's name sanitization (`PropertyBinding.sanitizeNodeName` on each name, or a real `GLTFLoader` parse), and asserts `canonicalBoneEntries` resolves the full humanoid set and the idle clip finds a home for at least the coverage floor of its tracks.
4. Make the gates agree: find the bone-count gate and the clip-coverage gate (grep `coverage` in `src/animation-retarget.js` and the callers that decide "fall back to default body"). Add a test that a rig which passes the bone-count gate but would map fewer tracks than the coverage floor is reported as unanimated rather than silently bind-posing, and make the gate decide on what the library would actually do (would any clip clear coverage). Change only the decision function, keep callers' signatures, and prove it with the parity tests.
5. Rig Doctor parity: make `src/rig-report.js` report the same collision/resolution outcome the runtime computes (use the same `resolveArmShoulderCollisions`), so a Rigify rig no longer reports a collision the runtime resolves. Test in `tests/rig-report.test.js`. Add a HumanIK fingerprint line that recognises both `Character1:` and `Character1` spellings.
6. Entry-point parity: confirm `retargetClipToObject`, `retargetClipToRig` and the manager path pass identical rest-direction inputs for an A-posed rig; extend the parity test to cover them if it does not.
7. Run `node scripts/audit-rig-coverage.mjs` (read its header for arguments) and `npm test` to confirm no previously mapped rig regresses.
8. Docs: update the HumanIK row in `docs/3d-asset-pipeline.md` (line ~209) and the supported-skeleton tables where Rig Doctor lists conventions (`grep -rn "CC_Base_\|mixamorig" docs | head`), and remove the "not supported yet" line from `docs/first-contribution.md` (leave it consistent with Biped and ValveBiped being done). Add a `data/changelog.json` entry and run `npm run build:pages`.
9. Housekeeping for the owner: list the stale OSF issues in the report (`gh issue list --repo nirholas/three.ws --label "good first issue"`), noting 02 to 07 are already fixed in code. Do not close or comment on issues yourself.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The Step 0 node snippet prints a canonical name (`Hips`, `LeftArm`, `LeftHandIndex1`) for every `Character1*` input and `Character2Hips`, and `null` for `CharacterMesh`.
- [ ] `npx vitest run tests/glb-canonicalize.test.js tests/rig-report.test.js tests/animation-retarget-rig-parity.test.js` passes, and the new HumanIK cases were observed failing before the fix.
- [ ] The retarget test shows `canonicalBoneEntries` resolving a sanitized HumanIK skeleton.
- [ ] Rig Doctor (`/rig-doctor`) on a HumanIK-spelled GLB shows the same mapped-bone count the runtime reports; checked in a real browser.
- [ ] `npm test` and `node scripts/audit-rig-coverage.mjs` show no regression.
- [ ] `docs/first-contribution.md` no longer lists HumanIK, Biped fingers or Source skeletons as open.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No HumanIK GLB fixture | Build a synthetic skeleton in the test from the canonical bone list, renamed `Character1<Bone>`, as the existing convention tests do. Do not commit a third-party model |
| Coverage-gate change touches many callers | Change only the decision function; keep callers' signatures; prove with the parity tests |
| Regex change breaks a neighbouring rig | The existing tables are the guard; narrow the rule (digits required, optional single underscore) rather than loosening other rules |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/285-plan-avatar-humanik-sanitized-bone-names.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `285-plan-avatar-humanik-sanitized-bone-names.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/aws-builder-center-universal-retargeting.md` (section "9. Failure modes and the fallback ladder")

~~~~markdown
## 9. Failure modes and the fallback ladder

The rule we hold is that the library should rather leave an avatar alone than animate it badly, and the next rule is that "alone" must not mean a frozen T-pose when anything better is available. That gives a ladder of gates, each cheaper than the one after it.

**Rung 1: is this a drivable humanoid at all?** The manager's gate needs a skinned mesh and at least eight canonical bones:

```js
function _modelSupportsCanonicalClips(model) {
	let hasSkinnedMesh = false;
	const canonical = new Set();
	model.traverse((node) => {
		if (node.isSkinnedMesh) hasSkinnedMesh = true;
		if (node.name) {
			const c = canonicalizeBoneName(node.name);
			if (c) canonical.add(c);
		}
	});
	return hasSkinnedMesh && canonical.size >= MIN_CANONICAL_BONES;
}
```

`supportsCanonicalClips()` returns that answer, and callers decide what "no" means. A shared scene substitutes a known-good performer: the theater stage tries the agent's own avatar, then an assigned fallback avatar, then the plain mannequin, and only one that passes this gate gets to perform. A personal view, like an agent's own screen, shows the model as authored. Non-humanoid skeletons fail this rung on purpose: there is no safe automatic mapping for them.

**Rung 2: does this clip find enough of a home?** Coverage below `MIN_COVERAGE` returns `clip: null` with an honest breakdown of matched, total and dropped bones. No half-puppet plays.

**Rung 3: would this clip knock the avatar over?** Before an action plays, the manager poses the hips at the clip's first keyframe and measures how far the bone's up-axis tilts from vertical, once per avatar and clip. Past 45 degrees the clip is disabled for that avatar, the rig keeps its authored pose, and one report goes to our client-error channel. Healthy rigs rest under about 18 degrees.

**Rung 4: the body maps but the arms do not.** If neither upper arm resolved, the clip plays on the torso and legs while the arms stay out. `relaxUndrivenArms` finds those arms geometrically, with no name needed (an upper-body bone pointing mostly sideways, not steeply up), and swings them down to a relaxed rest. It runs only when neither upper arm mapped, so it never touches a rig the clip drives.

**Deliberate refusals.** Blender control rigs of the "tracker" family export deform bones that hang off tracker nodes instead of forming a chain, and glTF cannot carry the trackers' constraints. Rotate one mapped deform bone and the next segment stays put: the arm comes apart. So the canonicalizer leaves that layer unmapped, a test pins the refusal, and those uploads need re-rigging, not renaming.

**Where the ladder still has a hole.** Rung 1 counts bones and rung 2 counts tracks, and a rig can pass the first and fail the second. A 3ds Max Biped skeleton is the live example: its body maps (`Bip01 L UpperArm` resolves), its numbered finger chain (`Bip01 L Finger0`, `Finger01`) does not. We built that skeleton in a scratch test against the current code: the idle finds a home for 21 of its 53 tracks, about 40 percent, so no clip plays; and because the arms did map, rung 4 does not engage either. The avatar shows its bind pose. Biped fingers are written up as an open task in our contribution guide, alongside two other verified gaps: HumanIK names after three.js strips the colon from them on load (`Character1Hips` maps to nothing), and Source-engine `ValveBiped` skeletons.

**What no gate can see.** A rig can map all 52 joints and still move badly if its bones are oriented unusually, and the mesh follows whatever skin weights it shipped with: a sleeve weighted to the wrong bone bends with that bone. Retargeting moves skeletons; it cannot repair skinning.
~~~~

### `docs/aws-builder-center-universal-retargeting.md` (section "11. What we would build differently")

~~~~markdown
## 11. What we would build differently

**Derive descriptive claims from data.** Writing this article, we found our own comments disagreeing: one says the reference rig rests in an A-pose, the comment added by the October fix says T-pose, and the generated rest data settles it (T-pose). A comment cannot fail a test. Where a stance or a number can be computed from reference data, compute it or assert it.

**Write the test in the same commit as the geometric fix.** The A-pose re-aim shipped with no unit test of its own, and the gap it left is exactly the kind a test would have caught on day one (see the next point). The test that finally came is a parity test, `tests/animation-retarget-rig-parity.test.js`: it loads the A-posed parametric base, retargets the idle and the walk through both entry points, and requires every limb track to agree. Run without the fix, it fails with the right upper arm about 50 degrees off.

**One retarget entry point, not three.** The runtime manager, `retargetClipToObject` and `retargetClipToRig` each assemble their own inputs. The re-aim reached the first two and missed the third: `retargetClipToRig`, used by the Animation Studio's preset gallery and its animated-GLB export, did not pass rest directions for five days, although the helper it needed (`canonicalRestDirectionMapFromRig`) shipped in the same commit. An A-posed body animated correctly on its own page and put its arms through its torso in the studio. The fix was four lines; the lesson is that entry points which assemble their own inputs drift, and a parity test is the cheapest guard against it.

**Make the gates agree.** The bone-count gate and the coverage gate answer different questions, which is how the Biped case slips between them. Gate on what the library will actually do (would any clip clear coverage?), not on a proxy. Likewise Rig Doctor uses the same canonicalizer but not the clavicle/upper-arm resolver, so on a Rigify rig it reports a collision the runtime resolves. A diagnostic that disagrees with the runtime teaches the wrong thing.
~~~~

### `marketing/growth/events/osf-issues/01-rig-humanik-sanitized-names.md` (whole file)

~~~~markdown
## Context

three.ws plays one shared animation library on any humanoid avatar by first rewriting every bone name to one canonical skeleton. The map lives in [`src/glb-canonicalize.js`](https://github.com/nirholas/three.ws/blob/main/src/glb-canonicalize.js), and the whole approach is explained in [docs/first-contribution.md](https://github.com/nirholas/three.ws/blob/main/docs/first-contribution.md).

Autodesk HumanIK / MotionBuilder rigs put every joint behind a character namespace: `Character1:Hips`, `Character1:LeftArm`. The raw glTF spelling already works, because `_lookupBone` strips a leading `identifier:` namespace, and `tests/glb-canonicalize.test.js` covers it.

The gap is the spelling the **runtime** sees. three.js's `GLTFLoader` passes every node name through `PropertyBinding.sanitizeNodeName`, which deletes `:` (along with `[`, `]`, `.`, `/`). So after loading, the same bone is named `Character1Hips`. The runtime retargeter in [`src/animation-retarget.js`](https://github.com/nirholas/three.ws/blob/main/src/animation-retarget.js) (`canonicalBoneEntries`) calls `canonicalizeBoneName(node.name)` on those loaded bones, and the fused name maps to nothing. Some exporters also write the underscore form `Character1_Hips`, which maps to nothing either.

Verified on `main`:

```bash
node --input-type=module -e "
import { canonicalizeBoneName as c } from './src/glb-canonicalize.js';
for (const n of ['Character1:Hips', 'Character1Hips', 'Character1LeftArm', 'Character1_Hips', 'Character1LeftHandIndex1']) console.log(n, '->', c(n));
"
```

```
Character1:Hips -> Hips
Character1Hips -> null
Character1LeftArm -> null
Character1_Hips -> null
Character1LeftHandIndex1 -> null
```

## What to change

In `_lookupBone` in `src/glb-canonicalize.js`, strip a leading HumanIK character prefix in its fused (`Character1Hips`) and underscore (`Character1_Hips`) forms, next to the existing vendor-prefix strips (`mixamorig`, `CH_`, `CC_Base_`, `Bip01`). Add a comment that says why the fused form exists (the three.js sanitizer), the same way the neighbouring strips explain themselves.

Require the digits (`Character` followed by one or more digits). A bare word like `CharacterMesh` must not be stripped.

## Acceptance criteria

- [ ] `Character1Hips`, `Character1Spine`, `Character1Neck`, `Character1Head`, and the left and right arm, forearm, hand, up-leg, leg, foot, and toe joints resolve to the same canonical names as their `Character1:` forms.
- [ ] The same holds for the underscore form (`Character1_LeftArm`) and for other character numbers (`Character2Hips`).
- [ ] Finger joints resolve too (`Character1LeftHandIndex1` to `LeftHandIndex1`, thumbs included), because fingers are most of every clip's tracks.
- [ ] Every existing `Character1:` case still passes, and no mapping crosses sides (test both sides).
- [ ] A name that only starts with `Character` without digits (`CharacterMesh`) still returns `null`.
- [ ] New cases live in `tests/glb-canonicalize.test.js`, in the file's `describe` + `it.each` table style, next to the existing HumanIK block.

## How to test

```bash
npx vitest run tests/glb-canonicalize.test.js
npm test
```

Re-run the probe above; every line should now print a canonical name.

Good first issue: one prefix rule, one comment, one test table. Comment "taking this" before you start.
~~~~

