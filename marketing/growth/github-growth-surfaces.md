# GitHub and ecosystem growth surfaces

This is the product-led expansion of the [opportunity register](./opportunities.md). It
focuses on places where using three.ws creates a visible artifact, install, badge, link, or
contribution in somebody else's workflow. Those surfaces can compound; a one-off post
cannot.

Last verified: **2026-09-15**.

## What the GitHub audit says

| Signal                   |    Current state | Growth implication                                                           |
| ------------------------ | ---------------: | ---------------------------------------------------------------------------- |
| Stars / forks            |         172 / 40 | There is credible early interest, but not yet a repeatable acquisition loop. |
| Watchers / open issues   |            7 / 9 | Release and contributor activation are underused.                            |
| Contributors             |               12 | A focused contributor campaign can still feel personal and high-touch.       |
| GitHub releases          |                1 | Followers have almost no release-driven reason to return.                    |
| Discussions              | 3 seeded threads | The showcase exists, but it is not yet an active gallery.                    |
| Tracked files            |           19,546 | The monorepo is intimidating as the first product experience.                |
| Local packed Git history |    about 1.8 GiB | Clone cost is a meaningful activation tax.                                   |
| Root README              |     about 411 KB | It demonstrates breadth but delays the shortest path to a win.               |
| Community profile        |             100% | Basic trust files are not the constraint.                                    |

The conclusion is not "rewrite the README." Keep the monorepo as the source of truth, but
put smaller doors in front of it. A user should see a live result before they need to
understand the platform.

## The first four moves

### 1. Publish a tiny starter template

Create a separate public template repository with only:

- one `npm create @three-ws/agent` path;
- one committed lightweight sample or deterministic test fixture;
- one page using `<agent-3d>`;
- `.devcontainer/devcontainer.json` that starts the demo and forwards its port;
- a **Use this template** button and a **Create codespace** deep link;
- three next steps: change the prompt, change the mood, deploy the page.

The success event is not a clone. It is **first avatar rendered**. Track template uses,
Codespaces starts, successful generation, and downstream repositories that retain the
three.ws attribution link.

GitHub explicitly supports Codespaces-backed template repositories, where starter files and
development-container configuration open as a ready environment. Use prebuilds only after
measuring cold-start pain because each retained regional prebuild has a storage cost.

**Official sources:** [Codespaces from a template](https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-from-a-template),
[dev containers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers),
[prebuilds](https://docs.github.com/en/codespaces/prebuilding-your-codespaces).

### 2. Turn GLB diff into a Marketplace acquisition loop

Create a single-purpose repository for a **three.ws GLB Quality Gate** GitHub Action. The
existing [`@three-ws/glb-diff`](../../packages/glb-diff/README.md) already provides the core
contract: compare two models, format a pull-request-sized Markdown report, classify severity,
and fail CI at a chosen threshold.

The action should:

1. detect changed `.glb` files in a pull request;
2. retrieve the base and candidate versions;
3. comment the structural diff and, where practical, a rendered before/after image;
4. fail only at the configured severity;
5. add a small, linked "checked by three.ws" footer.

GitHub recommends one action per public repository for Marketplace publication. That is a
useful constraint here: the focused repository is easier to install, star, release, and
explain than another feature inside the monorepo. Marketplace actions can be published
immediately after the repository, root action metadata, and release meet the requirements.

Measure installs, unique repositories, weekly workflow runs, comments created, footer
referrals, and conversions into `@three-ws/glb-diff` use.

**Official source:** [Publishing actions in GitHub Marketplace](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).

### 3. Claim two high-intent curated directories

The current English READMEs for both target lists contain no `three.ws`, `threews`, or
`agent-3d` match.

| Surface                                                                | Audience                     | Submission                                                                    | Proof to lead with                                                                               |
| ---------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers) | Large MCP discovery audience | Add one installable, public server in alphabetical order; one server per line | The narrow open-source 3D server, local install command, tool list, license, and working example |
| [Awesome Three.js](https://github.com/AxiomeCG/awesome-threejs)        | Three.js builders            | Add the web component or GLB tooling under the closest existing category      | A tiny live demo and one-sentence developer outcome                                              |

Do not submit the whole platform or a list of every server. The first directory line should
describe one tool somebody can install and verify in minutes. Record accepted PR traffic with
a dedicated campaign ID.

### 4. Turn existing adopters into proof

GitHub code search already finds third-party use and coverage outside the canonical
repository. Start with [Bowyer](https://github.com/BowyerApp/bowyer), an active MIT-licensed
project that imports three.ws avatar/forge functionality. Ask for a 20-minute implementation
interview, permission to quote the maintainer, and one screenshot or short recording. Offer
an upstream fix or integration improvement before asking for promotion.

Then run the same audit monthly:

```text
code search -> verify real use -> open a helpful issue or PR -> document the outcome
            -> invite to Show and tell -> publish a maintainer-approved case study
```

The case-study CTA should point to the exact starter used, not the monorepo homepage.

## Activate the GitHub community surface

The repository has only three seeded Discussions. Convert **Show and tell** into a monthly
ritual:

- Pin a submission template: screenshot/video, live URL, repository, three.ws component used,
  and one thing learned.
- Feature one build in the README, release notes, and community social account each month.
- Attach a small, well-scoped `good first issue` to each monthly theme.
- During the approved Open Source Friday session, merge a real contribution into the starter
  or Action rather than navigating the full monorepo.

If the owner is eligible for GitHub Education, make the starter repository a **Learn and
Collaborate** submission to Community Exchange. A compliant submission needs a description,
README, license, `CONTRIBUTING.md`, open collaborator issues, and `LEARN.md`. The canonical
repository is owned by a personal account, which matches the platform's ownership rule, but
the smaller starter is the better learning experience.

**Official source:** [Submitting to GitHub Community Exchange](https://docs.github.com/en/education/contribute-with-github-community-exchange/submitting-your-repository-to-github-community-exchange).

## Use CloudCredits as a filter, not a shopping list

[CloudCredits](https://cloudcredits.io/) is useful discovery infrastructure: it indexes more
than 200 startup programs and keeps its data open in
[t3-sh/cloudcredits.io](https://github.com/t3-sh/cloudcredits.io). Also use the
[startup-credits registry](https://github.com/sourcey/startup-credits) as a cross-check because
it records sources and revisions. Neither directory is sufficient evidence for an
application; re-verify every benefit and eligibility condition on the provider's official
site.

Prioritize programs only when they supply distribution or customer access in addition to
credits:

| Program                                                            | Why it passes the filter                                                                                                                 | Gate before applying                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [DigitalOcean Startups](https://www.digitalocean.com/startups)     | Official materials offer marketplace reach, co-marketing support, and event partner opportunities in addition to infrastructure support. | Confirm company and product eligibility, then propose one marketplace-ready developer tool and one customer story. |
| [MongoDB for Startups](https://www.mongodb.com/solutions/startups) | The program advertises technical support and go-to-market opportunities; select startups can receive co-marketing and co-sell access.    | Apply only if the production architecture genuinely uses the product and three.ws meets the current stage rules.   |

Do not migrate infrastructure to chase credits. Score the value of customer access,
technical support, migration cost, lock-in, and engineering distraction separately.

There is also a reciprocal idea: create a real **three.ws Creator Grant** with a defined amount of
3D generation/rigging capacity, transparent eligibility, duration, support level, and public
terms. Only after the benefit exists should it be submitted to CloudCredits and similar open
registries. That turns a directory visit into an acquisition channel without making a false
"credits" claim.

## Three compounding campaigns

### Build an Agent in 10 Minutes

`starter template -> Codespace -> visible avatar -> Show and tell submission -> monthly feature`

The campaign succeeds when newcomers publish something, not when a launch post gets views.

### Model Review Week

`GLB Action install -> useful pull-request comment -> badge/footer referral -> package adoption`

Recruit five design-engineering or game-tool repositories as design partners before the
Marketplace launch. Their pull requests become the launch evidence.

### Compatibility Lab

Each month, choose one adjacent open-source 3D or agent project. Build the smallest useful
integration, contribute it upstream, and publish a two-sided demo. Start with maintainers who
already use or mention three.ws; expand to cold targets only after the format works.

## Implementation status

The first owned surfaces are built in the canonical repository:

- [`satellites/agent-starter`](../../satellites/agent-starter) contains the live responsive
  demo, Codespaces configuration, ten-minute guide, contribution guide, and structural test.
- [`satellites/glb-quality-gate`](../../satellites/glb-quality-gate) contains the complete
  GitHub Action, real serialized-GLB tests, bundled runtime build, usage docs, and release
  contract.
- [`scripts/export-growth-satellites.mjs`](../../scripts/export-growth-satellites.mjs) builds,
  tests, licenses, bundles, and stamps standalone repository histories for both.
- [The directory submission kit](./submissions/README.md) contains copy and verification
  packets for the two curated-list pull requests.
- [The Show and tell discussion form](../../.github/DISCUSSION_TEMPLATE/show-and-tell.yml)
  collects a project outcome, live/source links, the three.ws surface used, one lesson, media,
  and optional feature permission.

Publication requires GitHub authentication as the `nirholas` owner because both planned
destinations live in that personal namespace. Do not publish them under a different account.

## Decision sequence

| By         | Decision or deliverable                                              | Evidence                                            |
| ---------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| 2026-09-18 | Choose the starter's single use case and repository name             | One-sentence job and reserved repository            |
| 2026-09-21 | Open the starter with a dev container and instrumented success event | Fresh-account run reaches a rendered avatar         |
| 2026-09-23 | Open GLB Action design-partner issue                                 | Five named target repositories and install contract |
| 2026-09-25 | Submit one focused MCP directory PR                                  | External PR URL and campaign ID                     |
| 2026-09-28 | Ask the first verified adopter for an interview                      | Maintainer reply or next checkpoint                 |
| 2026-09-30 | Run the first Show and tell feature                                  | Discussion entry and featured-project link          |
| 2026-10-02 | Decide whether a Creator Grant has a funded, supportable benefit     | Published terms or explicit no-go                   |

External directory pull requests, adopter outreach, program applications, grants, and public
campaigns remain owner-gated. Prepare the artifact and exact copy first; dispatch only after
the owner approves the external action.
