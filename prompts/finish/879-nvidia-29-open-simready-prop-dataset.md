# nvidia 29: A free, open pack of simulation-ready props made by Forge, with physics, labels and a validation report per asset, ready for the owner to publish where robotics developers look

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3279 (`npm run dev -- --port 3279 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, creating the Hugging Face dataset repository and uploading to it, any forum or social post, the Inception portal edit) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **Generation here is a background caller, never a competitor.** New models are made through the ordinary Forge path, one at a time, only while no interactive job is waiting on the image rung. The image rung allows about 1 image per 45 seconds for the whole site: a visitor always goes first.
- **The export worker's behavior is pinned.** `workers/usd-export/` is called as it is today.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

The startups NVIDIA named beside its 2026 Omniverse releases make simulation-ready assets, and NVIDIA publishes its own SimReady library as an open dataset (`huggingface.co/datasets/nvidia/simready-assets`, which we already ingest: `docs/simready-assets.md`, `scripts/ingest-simready.py`). Robotics and synthetic-data teams need large numbers of varied everyday objects with collision, mass and labels, and there are never enough. three.ws can make them from text and already exports OpenUSD with convex collision, mass, semantics and a validator report (`workers/usd-export/`). A published, clearly licensed pack of a few hundred such props, each with its report, is useful to exactly the developers NVIDIA is courting, shows the pipeline working at scale, and is something they can link to. Publishing is the owner's step; this order makes the pack and everything needed to publish it in one command.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/nvidia/stats | head -c 4000; echo
    sed -n 1,140p workers/usd-export/README.md
    sed -n 1,80p docs/simready-assets.md
    sed -n 1,60p scripts/ingest-simready.py
    sed -n 1,80p docs/cookbook/parallel-asset-pack.md
    grep -rn -i "license\|ownership\|rights" docs/forge.md pages/legal 2>/dev/null | head -20

Read the export worker end to end and its report format. Read our terms for who owns a generated model and under what terms the platform may republish one: only models generated by the platform's own account for this purpose go in the pack, never a visitor's creation. Read the license of every component whose output ends up in an asset (the reference-image source, the 3D model, the texture step) and write down whether its output can be released under a permissive license; quote the clauses. Read the dataset card and layout of NVIDIA's SimReady dataset so ours is familiar to the same users, without copying any of its files.

## Tasks

1. **License decision, in writing.** Choose the most permissive license every component allows for the outputs (CC0 if they all allow it, otherwise the least restrictive that is true) and record the reasoning with the quoted clauses in `docs/simready-prop-pack.md`. If any component forbids open release of its outputs, generate with a route that does not use it, and say so.
2. **The object list.** At least 300 everyday objects across the classes the exporter already knows (furniture, containers, tools, kitchenware, toys, warehouse items and so on), each with a Forge-ready prompt, a real-world size in meters and a class label. Sizes come from a cited public source or a stated typical range, not from a guess left unmarked. The list is a committed data file with a schema test.
3. **A resumable, polite builder.** A script under `scripts/` that works through the list with the platform's own account: submits one job, waits, exports to OpenUSD through the existing worker, runs the validators, stores the GLB, the USD package and the report in our bucket, and records the outcome in a manifest. It yields to interactive visitors (it submits only while no interactive job is waiting on the image rung, enforced by a check that is unit-tested), survives being stopped and restarted without regenerating finished items, and stops itself at a daily cap. An asset that fails validation is retried once with a different seed and otherwise excluded with the reason recorded.
4. **Run it for real.** Start the build and let it run within this session as far as the image rate allows; the script is the deliverable that finishes the rest. Report the honest count finished, the pass rate by class, and the time and GPU cost per asset. At least 25 finished, validated assets are required to close this order.
5. **Quality gate before anything is published.** Every included asset passes the existing validators with no error, has a plausible mass for its class and size, and passes the existing quality judge on the rendered preview. Publish the exclusion reasons as counts.
6. **The dataset package.** A script that assembles the pack from the bucket into the layout a dataset host expects: one folder per asset (USD package, GLB, preview image, report), a metadata file with prompt, class, size, mass, triangle count, validator versions and seed, a dataset card that states plainly how the assets were made, by which models, on what hardware, their limits (generated geometry, approximate mass, convex collision), and the license. NVIDIA-facing wording stays technical: no token, price or monetization vocabulary, and no claim beyond "three.ws is a member of the NVIDIA Inception program".
7. **A page on our own site.** `/simready/props` (registered in `data/pages.json`): a browsable grid of the pack from the real manifest with search, class filter, a 3D preview and download links, with designed loading, empty and error states. This is live for users whether or not the pack is ever published elsewhere.
8. **Publishing prepared, not done.** `docs/simready-prop-pack.md` ends with the exact one command that uploads the assembled pack to a Hugging Face dataset under the owner's organization, and the paste-ready description. Do not create the remote repository.
9. **Docs.** A `STRUCTURE.md` row, `docs/simready-assets.md` cross-link, and a `data/changelog.json` entry for users (then `npm run build:pages`).

## Definition of done

- [ ] License clauses quoted for every component whose output is in the pack, and the chosen license follows from them.
- [ ] The object list has 300 or more entries with sourced sizes and passes its schema test.
- [ ] The builder ran for real, is resumable (proven by stopping and restarting it), and the yield-to-visitors check has a passing test.
- [ ] 25 or more validated assets exist in the bucket with reports; counts, pass rates and cost per asset are in the doc.
- [ ] `/simready/props` shows the real pack in a browser with no console errors.
- [ ] The assemble script produces the dataset layout locally; the upload command is documented and was not run.
- [ ] `git diff --stat` shows no change to lane order or under `workers/model-trellis/`. `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The image rung is slow | That is expected: about 80 assets a day at most, less when visitors are active. The builder is resumable for this reason. Report the real rate and the date the full list would finish. |
| A component's license forbids open release of outputs | Exclude assets made with it, switch the builder to a route without it, and record the clause. |
| The platform has no dedicated account for this | Create one through the real registration flow the way `npm run audit:web:provision` does for QA, and record its name (not its password) in the doc. |
| The export worker rejects a model | Record the validator finding, retry once with another seed, and exclude it. Do not loosen the validators. |
| No Hugging Face credentials | None are needed: publishing is the owner's step. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, creating the Hugging Face dataset repository and uploading to it, any forum or social post, the Inception portal edit); one-line judgment calls. No trailing questions.
