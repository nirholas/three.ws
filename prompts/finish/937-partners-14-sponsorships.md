# partners 14: Sponsor the open source three.ws runs on (owner-gated)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Blocked on owner actions; do everything the order assigns to the agent first.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/partners-00-CONTEXT.md](_context/partners-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: irreversible spend, git push or deploy, external posting, committing content that names a crypto project other than $THREE, destroying unrecoverable data. Batch every such ask into ONE message at the end.
- Never contact a third party: no email, issue, pull request, form, listing or post. Write the exact text into the repo and put the step in the owner message (context file rules).
- Never onboard a paid API or spend. Wire paid vendors behind their env var and prove the code against the real API with whatever free or sandbox access exists.
- Verify each upstream license from its LICENSE file before adopting anything.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. The em-dash and en-dash characters are banned.
- Concurrent agents share this worktree: stage explicit paths only and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this is gated

Every sponsorship is recurring spend, which only the owner can approve.

## Why this matters

The [outreach plan](../../docs/partners/outreach-plan.md) puts "Contribute" before every ask to an open-source project. Money is the fastest contribution and the one that most clearly says "we know we depend on you". The projects below are the ones three.ws uses most heavily in production, per the [prospects list](../../docs/partners/prospects.md).

## Step 0: re-derive the current state

    grep -n '"three"\|"@gltf-transform\|"@pixiv/three-vrm\|"meshoptimizer\|"@react-three' package.json

For each project, read its sponsorship page today and record the tiers, what each tier gives the sponsor (logo, link, listing), and the payment route (GitHub Sponsors, Open Collective, Patreon, direct).

## Tasks

1. **Build the table** in `docs/partners/sponsorships.md`: project, what it powers in three.ws, tiers and prices read today, the tier recommended and why, and the recognition each tier gives. Start from: three.js, glTF-Transform, three-vrm (pixiv), meshoptimizer, Poly Haven, the Blender Development Fund, OrcaSlicer, Mesh2Motion, Quaternius and the pmndrs collective.
2. **Recommend a monthly total** sized to the platform's current revenue and say how it was sized. Link it from the prospects and outreach pages.
3. **Owner: approve and start** the sponsorships chosen.
4. **After approval**: add each sponsored project's "sponsored by three.ws" status to the credits page (order 086) and send the one-line note from message template 2 in the outreach plan, owner-sent.

## Definition of done

- [ ] `docs/partners/sponsorships.md` exists with tiers read on the day, linked from the partner docs.
- [ ] Owner decision recorded per project.
- [ ] Each approved sponsorship is live and shown on the credits page.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/937-partners-14-sponsorships.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
