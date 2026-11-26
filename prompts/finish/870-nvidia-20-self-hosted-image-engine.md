# nvidia 20: Forge gets its own reference-image engine on an NVIDIA GPU, placed behind the working rung and measured before anyone promotes it

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3270.

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, Inception portal edits, promoting the new engine) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. The parts that bind this order:

- **Protected in position:** the keyless text-to-image rung (`pollinationsImage` in `api/_mcp3d/text-to-image.js`). On 2026-11-26 it was the only rung producing reference images. Do not remove it, reorder it, change its request, or put the new engine in front of it.
- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service or its place in `api/_lib/forge-tiers.js`. The new engine must never take its GPU: deploy in a way that cannot starve it (see task 3).
- **Allowed:** a fallback placed behind the keyless rung that is taken only after that rung has failed or said to wait, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving the new engine ahead of any rung that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. The new service runs at minimum 0.

## Why this matters

Text to 3D in Forge is two steps: a reference image, then the 3D model. The 3D step is healthy. The image step is the bottleneck. Measured on 2026-11-26: Vertex Imagen answered 403 (billing hold), the Hugging Face routes answered 402 (credits), NVIDIA NIM FLUX timed out, no Replicate token exists, and the keyless rung allows about 1 image per 45 seconds for the whole site. Every fix so far depends on someone else's quota. An image engine on our own NVIDIA GPU removes that dependency, and it is a NVIDIA GPU workload with a number we can publish.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/version | head -c 320; echo
    curl -s https://three.ws/api/nvidia/stats | head -c 4000; echo
    grep -n "async function \|export async function textToImage" api/_mcp3d/text-to-image.js
    ls workers/model-triposg && sed -n 1,80p workers/model-triposg/README.md
    ls workers | grep -iE "image|flux|sana"

Read `textToImage` in `api/_mcp3d/text-to-image.js` end to end: the rung order, `ladderBudgetMs`, `laneTimeoutMs`, `isBlankFrame`, and how a `rate_limited` error with a stated wait leaves the keyless rung. Read `docs/ops/worker-and-avatar-rules.md` and one existing GPU worker (`workers/model-triposg/`) for the house layout: `main.py`, `Dockerfile`, `cloudbuild.yaml`, tests, README, shared-key auth. If an image worker already exists, finish it instead of starting a second one.

Check L4 quota per region before choosing where to deploy: `gcloud compute regions describe <region> --project aerial-vehicle-466722-p5 --account nich@sperax.io`.

## Tasks

1. **Choose the model, on evidence.** Requirements: a license that permits commercial hosted use (read the model card and license file yourself and quote the clause in the report), fits a 24 GB NVIDIA L4, and produces a clean single-subject 1024 px image in about 10 seconds warm. Evaluate at least two candidates on a real L4 over the same 30 prompts with fixed seeds, taken from real Forge prompt shapes (characters, props, creatures, vehicles). Include one model published by NVIDIA if its license qualifies. Record time per image, VRAM, cold load time and a quality score from the existing reference-image judge.
2. **Build the worker** as `workers/model-image/` in the house layout: `POST` a prompt, aspect ratio and seed, get an image stored in our bucket and its URL back; a health route; the same shared-key auth as sibling workers; the same seed gives the same image; its own test suite; a README with the deploy command. Weights come from `gs://three-ws-model-weights`, never downloaded on the request path.
3. **Deploy it beside, not instead.** A new Cloud Run GPU service, minimum instances 0, maximum 1, in a region where it cannot compete with `trellis_selfhost` for L4 quota. Measure five forced cold starts and thirty warm requests on the real service.
4. **Wire it behind the keyless rung.** Behind an environment variable for the worker URL, add the engine as the last rung of `textToImage`, taken only when the keyless rung has failed or returned a stated wait, and only while the ladder budget allows a cold start. Unset variable means the code path does not exist for the request. Test-first: a failing test for "keyless rung says wait 45 s, our engine answers" and one proving the rung order above it is unchanged.
5. **Shadow measurement.** Add a sampled background run of the engine on a small share of real prompts, never on the user's path and never served, recording success, latency and the blank-frame check. Register the lane in `api/_lib/nvidia-lanes.js` so `/api/nvidia/stats` and `/nvidia` show its numbers.
6. **Evidence for the owner.** `docs/nvidia/evals/image-engine-<date>.md`: both candidates, the chosen one, cold and warm numbers, shadow results, and a side-by-side against the keyless rung on the same 30 prompts. End it with the exact one-line change that would move the engine ahead, for the owner to approve or not.
7. **Docs.** Worker README, a `STRUCTURE.md` row, section 2 of `docs/nvidia-models.md`, and a `data/changelog.json` entry written for users (then `npm run build:pages`). Follow the technology-claim rule: the engine is "under evaluation" in `docs/nvidia-apps-catalog-listing.md` until the API deploy is live and it has served real requests.

## Definition of done

- [ ] Two candidates measured on a real L4 with the license clause quoted; one chosen with the reason.
- [ ] The service is deployed at minimum 0, with five cold and thirty warm measurements in the report.
- [ ] With the variable set on the dev server, a throttled keyless rung falls through to our engine and Forge finishes a real text-to-3D job (at most 3 live generations for this order). With it unset, the ladder behaves exactly as before, proven by a test.
- [ ] `trellis_selfhost` and the keyless rung are byte-for-byte untouched: `git diff --stat` shows no change under `workers/model-trellis/` and no reorder in the ladder.
- [ ] The lane shows on `/api/nvidia/stats` locally; worker tests and `npm test` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No region has free L4 quota | File the quota request, record the link, and deploy to the region with the most headroom on a different GPU family that the model supports. |
| A candidate's license forbids commercial hosting | Drop it, say so in the report with the clause, and evaluate the next candidate. |
| Cold start exceeds the ladder budget | Keep the rung behind the budget check so it is skipped when cold, report the number, and reduce load time (weights format, image size, lazy components). Do not raise the minimum-instance floor. |
| `gcloud` needs a login | Build, test and benchmark what you can locally and on Cloud Build, write the exact deploy command into the README, and list the login in the owner message. |
| Local docker dies at session end | Run long builds and benchmarks through Cloud Build or a GCE GPU VM that deletes itself. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
4. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the one batched owner message (push, API deploy, setting the worker URL on `three-ws-api`, the promotion decision); one-line judgment calls. No trailing questions.
