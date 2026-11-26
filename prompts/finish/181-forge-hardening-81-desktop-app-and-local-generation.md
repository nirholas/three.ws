# Forge hardening 81: Make the Forge desktop path honest about what it is and correct about how to install it

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository and send it. Nothing else is needed. This order depends on no other order: every fact, command and rule it needs is in this file. It is safe to run on its own, in any order, and at the same time as every other `forge-hardening` order. Its path in the repo is `prompts/finish/181-forge-hardening-81-desktop-app-and-local-generation.md`.

**Priority:** P2. **Area:** Forge desktop and local engines. **Dev port:** 4181. **Written:** 2026-11-26, from live production testing of Forge that day. Status claims rot, which is why Step 0 re-measures before you change anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- This order is one task. Stay inside it. A bug you find outside its scope goes in the report under "Found, not fixed" with the file and the evidence. Do not widen the work.
- Test, then fix, then prove. Exercise the real thing first so you know what is broken. Every bug fix is test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- Enterprise grade, no shortcuts. No mocks standing in for product behavior, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Errors are handled at the boundaries (network, user input) with a real recovery path, and every failure the user can hit has a working fallback or an honest message that says what to do next.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Do not onboard a new paid third-party API. Google Cloud surfaces are pre-approved. Never raise a Cloud Run service's minimum instances (owner spend cut of 2026-11-25).
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else. Everything that is not working gets fixed.** The full rule lives in `docs/ops/forge-protected-lanes.md`. The parts that bind you are repeated here so this file stands alone.

- **Protected by name:** `trellis_selfhost`, the self-hosted Microsoft TRELLIS lane on our own NVIDIA L4. On 2026-11-26 it carried about 72% of all Forge jobs at 93.3% success over 7 days. Do not edit `workers/model-trellis/`, its Cloud Run service, its entry or position in `api/_lib/forge-tiers.js` (`FREE_FALLBACK_FOR_PATH`, `SELF_HOST_IMAGE_LANES`, `DEFAULT_BACKEND_FOR_PATH`, the `FORGE_SELFHOST_PRIMARY` behavior), `SELFHOST_TRELLIS_QUALITY`, the request body the API sends it, or how its job is polled and finalized.
- **Protected by measurement:** any lane that Step 0 shows with 20 or more finished jobs and 85% or better success in the last 7 days.
- **Protected in position:** the keyless text-to-image rung (Pollinations) in `api/_mcp3d/text-to-image.js`. On 2026-11-26 it was the only rung producing reference images. Fix bugs inside it. Do not remove it, reorder it, or put an unproven rung in front of it.
- **Protected by your own test:** a feature that worked when you exercised it live. Do not restructure its code path in this session.
- **Allowed around a protected lane:** tests that pin its current behavior, metrics that only read, a fallback placed behind it that is taken only after it has already failed, and fixes in the steps before and after it, as long as the request that reaches the lane is unchanged for inputs that worked before.
- **A real bug inside a protected lane:** write the failing test, write the fix, and stop before committing that one fix. Ask for the owner's yes in your final message. Keep working on everything else.
- **Never promote an unproven lane ahead of a working one.** "The default is configured as X" is not proof that X serves. The stats say what serves.
- If Step 0 shows that the subject of this order is itself protected now, your job changes: pin it with tests, report what you measured, and change no behavior.

## Running alongside other sessions

Dozens of sessions may be working in this same worktree at once, many of them on other Forge orders. You need nothing from them and they need nothing from you.

- Stage explicit paths only (never `git add -A` or `git add .`). Re-check `git status` and `git diff --staged` immediately before each commit. Commit your own finished work promptly, because anything left uncommitted can be swept into someone else's commit.
- Re-read a file right before each edit. Never stash, reset, revert or reformat files you did not change.
- Hot files that many orders touch: `api/forge.js`, `src/forge.js`, `src/forge-studio/forge.js`, `api/_lib/forge-tiers.js`, `api/_mcp3d/text-to-image.js`, `docs/forge.md`, `data/changelog.json`, `public/locales/*.json`. Prefer a new module plus a one-line call site over a large edit inside a hot file. Edit hot files last, with the smallest possible diff, and commit within minutes.
- `api/gpt-forge.js` is a deliberate clone of `api/forge.js` that serves the ChatGPT surfaces, and `src/forge-studio/` holds copies of several `src/forge-*.js` modules. When you fix a defect in one copy, check the other for the same defect, fix it there too if it is in your scope, and say in the report which copies you checked.
- If a file changed under you, re-read it and re-apply your smallest diff. If another session already fixed your bug, verify their fix against your failing test, keep the test if it adds coverage, and report that.
- Start any dev server on this order's own port: `npx vite --port 4181 --strictPort`. Never the default 3000.
- Scratch files, screenshots and logs go in your session scratchpad, never in the repo.

## How to test Forge for real

- **The product.** Forge: AI 3D Model Generator, at `https://three.ws/forge`. A text prompt is optionally rewritten by an LLM ("direction"), painted into a reference image by a ladder of text-to-image providers, optionally expanded into more views, then reconstructed into a GLB by a lane. A photo or sketch skips the image step and goes straight to a lane. The finished model opens in the viewer, where the editing tools, exports and sharing live.
- **Production is Google Cloud Run** (service `three-ws-api`). Nothing you change is live until the owner deploys. An API fix is proven by its tests; a page fix is proven in a real browser on your dev server. Say plainly in the report that production still runs the old code.
- **An account is required** to generate or upload. The QA account is `AUDIT_EMAIL` / `AUDIT_PASSWORD` in `.env`. Its browser session is the Playwright storage state at `.auth/audit-state.json`. If that file is missing or expired, run `npm run audit:web:login`. Do not run `npm run audit:web:provision` when `.env` already holds the pair: it rewrites `.env` under every other session.
- **Calling the API with curl as the QA user:**

```bash
COOKIE=$(node -e 'const s=require("./.auth/audit-state.json");process.stdout.write(s.cookies.filter(c=>c.domain.includes("three.ws")).map(c=>c.name+"="+c.value).join("; "))')
curl -s https://three.ws/api/auth/me -H "cookie: $COOKIE" | head -c 300
```

  The page also sends an `x-forge-client` id header (see `CLIENT_HEADERS` in `src/forge.js`). Send one when you imitate the page.
- **Driving the page.** Playwright is installed. Launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader` so WebGL works headless, load the storage state, and record console errors, page errors and every `/api/` response with its status. The prompt box is `#prompt` and the button is `#generate` on `/forge`.
- **Your dev server** proxies `/api` to production by default (`DEV_API_PROXY` in `vite.config.js`), so a page change can be exercised locally against the real API. If the session cookie does not hold on localhost, say so and verify the signed-in part of the flow against production instead.
- **Handler tests** import the handler or module directly under vitest and stub only the network boundary. `tests/api/forge-nim-cooldown.test.js` and `tests/text-to-image-fallbacks.test.js` show the pattern. Run one file with `npx vitest run <file>`.
- **Read-only endpoints, free to call:** `/api/forge?health=1`, `/api/nvidia/stats`, `/api/v1/ai/image?health=1`, `/api/forged`.
- **Live budget (binding).** Production has one GPU behind the main lane, and the only live image rung allows one reference image per 45 seconds for the whole service. This order needs **no new generations**. Do not start one. Use finished models from the public feed (`GET https://three.ws/api/forged`) as inputs, and read-only endpoints for everything else. Never retry a throttled request before the wait it states. Tools that edit a finished model share one bucket of 30 calls per hour for the QA account across every session, so spend at most 4 such calls. Never pay for anything: a paid tier, a pay-to-keep or an x402 call is a stop-and-ask gate.
- **Database and logs.** The `forge_creations` table (per-generation backend, status, error, prompt) is the ground truth for generation problems, and Cloud Run logs are the ground truth for server errors. Both need Google Cloud access: `node scripts/read-service-env.mjs '^DATABASE_URL$' --raw` and the log commands in `docs/ops/production-log-triage.md`. Read-only queries only. If gcloud answers "Reauthentication failed", that is an owner step (`gcloud auth login`): carry on with public endpoints and tests, and list what you could not verify. Never read credentials out of another process, another session's files or shell history.

## What was measured on 2026-11-26 (re-verify, never trust)

- `trellis_selfhost`: 911 done, 65 failed in 7 days (93.3%), median about 150 seconds. Protected.
- `triposg` (sketch): 25 done, 35 failed (41.7%). `pixal3d` ("Match my photo"): 2 done, 9 failed (18.2%), about 16 minutes per success. `trellis2` (the configured first choice) and `trellis_nvcf` (hosted by NVIDIA): no jobs in 7 days. `hunyuan3d`: no jobs in 7 days.
- Text prompts were failing before any job existed, at the reference-image step. Vertex image generation answered 403 (a billing hold on the Google Cloud project), both Hugging Face image providers answered 402 (credits exhausted), the NVIDIA FLUX rung timed out, and no Replicate token is configured. Only the keyless rung served, at one image per 45 seconds.
- Commit `b41786cd6` fixed two bugs in that rung (seeds above 2147483647 were rejected, and the provider's stated wait was dropped). At 20:50 UTC that day production ran commit `f0eed584f` (built 06:57 UTC), which does not contain it: the fix was committed and not deployed. `curl -s https://three.ws/api/version` names the commit production runs, so check it before judging production.
- The chat LLM chain used for prompt direction was down (OpenRouter 402, OpenAI 429, Vertex Gemini 403). The NVIDIA and Hugging Face tokens authenticated. The editing workers (remesh, stylize, segment, background removal, motion, rig) were reachable.
- Billing holds and exhausted credits are owner-side. Your job is that Forge degrades honestly and falls back when they happen, not to buy a way around them.

## Why this order matters

Some users want to generate on their own GPU: for privacy, for unlimited use, or because they have the hardware. Forge has a desktop page and a local-engine bridge for that. Download pages go stale faster than anything else on a site: a release link that 404s, instructions for a version that no longer exists, a "download for Mac" button that offers nothing for Mac.

## What is known about this area (re-verify)

- Page: `pages/forge-desktop.html`, `src/forge-desktop.js`, release lookup `src/forge-desktop-release.js`. Local engine bridge: `src/forge-modly.js`, worker and packaging in `workers/modly/`. Doc: `docs/forge-desktop.md`. The lane list in `api/_lib/forge-tiers.js` includes `modly` and `modly_hunyuan` entries.
- Do not download or execute a desktop binary on this machine. Verify links, sizes, checksums and signatures from metadata, and the bridge protocol with tests.
- The page must work with a real release source. If there is no published release, the page says so plainly instead of showing a dead button.

## Step 0: re-derive the current state

Run these first and keep the output for your report. Skip any task whose outcome already exists, and say so.

```bash
git status --short | head -20 && git log --oneline -8
# Which lanes are protected right now
curl -s https://three.ws/api/nvidia/stats | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  for (const l of JSON.parse(s).lanes) {
    const w = l.jobs && l.jobs["7d"]; if (!w) continue;
    const n = (w.done||0) + (w.failed||0);
    const prot = l.id === "trellis_selfhost" || (n >= 20 && w.success_pct >= 85);
    console.log((prot ? "PROTECTED " : "open      ") + l.id.padEnd(18) + " 7d done=" + w.done + " failed=" + w.failed + " success=" + (w.success_pct ?? "n/a"));
  }
});'
curl -s 'https://three.ws/api/forge?health=1' | head -c 1500; echo
# Is the code you are reading the code production runs?
git fetch threews main --quiet; git log --oneline -1 threews/main
curl -s https://three.ws/api/version | head -c 320; echo
sed -n '1,50p' docs/forge-desktop.md
sed -n '1,60p' src/forge-desktop-release.js
curl -s -o /dev/null -w "forge-desktop page %{http_code}\n" https://three.ws/forge-desktop
ls workers/modly
ls tests tests/api | grep -iE "desktop|modly"
```

## Files in scope

- `pages/forge-desktop.html`
- `src/forge-desktop.js`
- `src/forge-desktop-release.js`
- `src/forge-modly.js`
- `docs/forge-desktop.md`
- `tests/forge-desktop-release.test.js` (new)

Read the tests that already cover these files before writing new ones (`ls tests tests/api | grep -i forge`), and put new tests beside them.

## Tasks

1. Establish the facts: is there a published desktop release today, where does the page look for it, and what does each download button resolve to. Follow every link with a HEAD request and record status, size and type.
2. The page reflects reality: buttons exist only for platforms that have a build, each shows its version, size and date, and a missing release yields an honest "not released yet" with a way to be notified. A failure to reach the release source shows a designed message, never an empty page.
3. Platform detection offers the right build first and lets the user choose another.
4. Trust: checksums are shown and correct, the page says whether builds are signed, and the install steps mention the operating system's warning for unsigned apps truthfully if that applies.
5. System requirements are stated honestly (GPU memory, disk, operating system), from the worker's real needs.
6. The local bridge: how the web page discovers and talks to a local engine. It must only ever talk to the local machine on a fixed port, must not be reachable or drivable by another website (origin checks, a pairing token), and must fail quietly when nothing is running. Test the origin and token checks.
7. In the engine picker, the local lanes appear only when a local engine is actually detected, and their failure falls back to the hosted lane with a clear note.
8. Bring the doc in line with all of the above.

## Definition of done

Every line is checkable. If you cannot verify one, say so explicitly and do not claim done.

- A test proves the page logic for: a release with all platforms, a release missing one platform, no release, and an unreachable source.
- A test proves the local bridge refuses a request from a foreign origin.
- Every download link's status is in the report.
- Step 0 output is in the report, including which lanes were protected at the time.
- Every fix has a test that failed first for the reported reason and passes now: `npx vitest run <your test files>`.
- The protected-lane suites still pass: `npx vitest run tests/api/forge-trellis-selfhost.test.js tests/api/forge-lane-routing.test.js tests/api/forge-tiers.test.js tests/api/forge-free-first.test.js`. If one was already red before you started, show that with `git stash`-free evidence (run it at Step 0) and do not claim it.
- None of your commits touches `workers/model-trellis/` or changes the protected parts of `api/_lib/forge-tiers.js`: `git show --stat <each of your commits>`.
- `npm run check:rules -- --paths <files you touched>` passes.
- A user-visible change has a `data/changelog.json` entry and the docs it makes stale are corrected, per the `changelog-and-docs` skill.
- Work is committed locally with explicit paths and a message that describes the diff (`type(scope): what changed and why`). Nothing is pushed or deployed.
- When every line above is verified, `git mv` this file to `prompts/archive/` in its own closing commit. If something remains that only the owner can do, leave the file here and add a dated `**Status (YYYY-MM-DD):**` line under the title saying exactly what remains and who owns it.

## Never blocked

| If this happens | Do this, do not ask |
|---|---|
| gcloud says "Reauthentication failed" | Owner step (`gcloud auth login`). Continue with public endpoints, the page and tests. List what stayed unverified. |
| No `DATABASE_URL` on this machine | Same as above. Use `/api/nvidia/stats`, `/api/forge?health=1` and your own live runs as evidence. |
| A request answers 429 with a wait | Wait the stated time once. If it is refused again, record both responses as evidence and move on. Do not hammer. |
| The QA session expired | `npm run audit:web:login`, then rebuild the cookie. |
| You need a finished model to test a tool | Take a public one from `GET https://three.ws/api/forged`. Do not generate one for this. |
| A lane or provider needs a key that is not configured | Build the path completely behind its env var, prove it with tests at the network boundary, and name the single missing variable in the report. |
| A provider is out of credits or behind a billing hold | Owner-side. Make the product fall back or say so honestly, and report the provider and its exact response. |
| Fixing it "properly" seems to need a different engine to serve | No. Read the protected-lanes section again. Add a fallback behind, or report. |
| A file changed under you | Re-read, re-apply the smallest diff, commit at once. |
| A test you did not touch is red | Fix it only if it blocks your own verification. Otherwise name it in the report and continue. |
| Verifying needs a production deploy | Not a blocker. Prove it with tests and your dev server, and list the deploy as an owner action (`npm run deploy:gcp:full`, after the `deploy-runbook` skill). |
| The fix would spend money or needs a new paid service | Stop-and-ask gate. Build everything around it and put the ask in the final message. |
| Headless Chromium shows no WebGL | Launch with `--use-gl=swiftshader --enable-unsafe-swiftshader`. |

## Report format

End the session with this, as short lists or prose. No markdown tables, no em or en dashes.

1. **Measured first:** the Step 0 numbers and which lanes were protected.
2. **Tested for real:** each thing you exercised, with evidence (status codes, timings, job ids, screenshots in the scratchpad).
3. **Works, left untouched:** what passed and was not changed.
4. **Broken and fixed:** for each, the symptom, the root cause, the test that failed first, the fix, and the files.
5. **Fallbacks added:** what now happens when this area fails.
6. **Found, not fixed:** out-of-scope problems, each with file and evidence.
7. **Owner actions:** everything that needs the owner (deploy, billing, credits, approvals), batched in one list.
8. **Commits:** hash and subject of each.
