# nvidia 18: a one-click NVIDIA Brev Launchable that runs the three.ws self-hosted GPU stack for any developer

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3268.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

NVIDIA Brev Launchables are shareable one-click GPU environments (compute, container and notebook in one link) that NVIDIA features for developers. A Launchable that boots the three.ws inference node with a redistributable 3D model, a guided notebook and a live viewer lets any developer try our GPU stack in minutes. That gives NVIDIA something concrete to feature and gives us a developer acquisition channel.

## Step 0: re-derive the current state

    sed -n 1,120p docs/inference-node-operator.md
    sed -n 185,230p docs/nvidia-ngc-listing.md

Read NVIDIA's current Brev Launchable docs: what a Launchable contains (VM or container mode, GPU selection, disk, exposed ports, startup script, notebook, repository) and how it is shared. Check the redistribution licence of each candidate model (the NGC doc's licence gate is the reference).

## Tasks

1. **Choose the payload**: the inference node plus one model whose licence allows redistribution and commercial demo use; record the licence reasoning.
2. **Build** `distributions/nvidia-brev/`: container or startup script, a Jupyter notebook that generates a model, shows it in an embedded viewer, explains the GPU timings, and optionally connects the node to three.ws; health checks; a README that works from a clean machine.
3. **Verify** on a clean GCE GPU VM matching Brev's environment (Ubuntu, NVIDIA driver, container toolkit), following only the README, end to end, with timings.
4. **Launchable values**: the exact configuration (GPU type and count, disk, ports, image reference, notebook path) in `distributions/nvidia-brev/LAUNCHABLE.md`, and the public image build ready for the owner to publish.
5. **Docs**: a page `docs/nvidia-brev-launchable.md` linked from [docs/inference-node-operator.md](../../docs/inference-node-operator.md); changelog entry only when the link is live.

## Definition of done

- [ ] Clean-VM run completed from the README alone (log and timings in the report).
- [ ] Licence reasoning recorded; no restricted weights in the image.
- [ ] Launchable values and owner steps written; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Brev account | Owner step: create the Launchable from the written values. |
| Publishing the image to a public registry | Owner gate: build and verify locally or in Artifact Registry privately, give the push command. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
