# Home Assistant submissions: HACS default store

Target: [`hacs/default`](https://github.com/hacs/default) (the `integration` file). No
`home-assistant/brands` PR is needed; see that section below.

Re-verified 2026-11-14: BILLING LOCK STILL ACTIVE. `gh run list -R nirholas/three-ws-home-assistant`
shows every scheduled Hassfest and HACS run on `main` (latest 2026-11-13) failing in 3 to 4 seconds
with "The job was not started because your account is locked due to a billing issue", and
`node scripts/hacs-default-submit.mjs` (read-only mode) reports BLOCKED for both. Nothing else has
drifted that blocks us: `hacs/default` is live, not archived (MIT, default branch `master`, 5165
entries in `integration`, still sorted); the PR template is unchanged (same six checkboxes and three
links); our repo `nirholas/three-ws-home-assistant` is public, not archived, Apache-2.0, release
`v1.0.2` is still latest and `manifest.json` is unchanged. The fork branch
`nirholas:add-three-ws-home-assistant` is now 495 commits behind `hacs/default` `master` (still one
commit ahead, one added line), but the neighbouring entries `NirBY/ha-mashov` and
`Nischay-Pro/ha-zebra` are unchanged, so the line still merges cleanly and sorts correctly. No PR from
`nirholas` exists on `hacs/default`. New since 2026-11-04: the `hacs/default` `Check` workflow now runs
more checks on a new-repository PR (owner, releases, existing, removed, core domain conflict,
editable PR, its own Hassfest run, and the HACS action), and its Hassfest step fails the PR on any
`[BRAND_IMAGES]` warning. We pass each by inspection: PR author `nirholas` equals the repo owner, the
repo has releases, the domain `three_ws` is absent from
`https://next.home-assistant.io/integrations.json`, and the integration ships its own `brand/`
folder. I could not re-run the real HACS and hassfest containers today (no Docker daemon in this
environment), so the "all 10 checks passed" result below is still the 2026-11-04 one.

**Status (2026-11-04):** the standalone repository
[`nirholas/three-ws-home-assistant`](https://github.com/nirholas/three-ws-home-assistant) is live
with release [`v1.0.2`](https://github.com/nirholas/three-ws-home-assistant/releases/tag/v1.0.2),
and the `hacs/default` entry is committed on the fork branch
[`nirholas:add-three-ws-home-assistant`](https://github.com/nirholas/default/tree/add-three-ws-home-assistant).
The real HACS action passes against the live repository (all 10 checks). The pull request is not
open yet for one reason: the `hacs/default` template requires links to *successful* HACS and
hassfest runs in the repository's own CI, and every GitHub Actions job on the `nirholas` account
is refused with "The job was not started because your account is locked due to a billing issue".
Once billing is fixed, `node scripts/hacs-default-submit.mjs` finishes the job (see Owner steps).

## What ships

- [`home-assistant-integration/`](../../../home-assistant-integration): the integration itself.
  `manifest.json`'s `documentation` points at the live
  [`/docs/home-relay`](https://three.ws/docs/home-relay) page, `categories` is
  `ai_voice.voice_assistants` (the HACS validator warns when it is missing), and `version` is
  `1.0.2`. `hacs.json`'s minimum Home Assistant version is `2024.12.0`: `relay_client.py` uses
  `aiohttp.ClientWSTimeout`, which does not exist before aiohttp 3.11, and HA 2024.12.0 is the
  first release that bundles it (confirmed against the real `homeassistant/package_constraints.txt`
  for 2024.6.0 through 2025.1.0).
- `custom_components/three_ws/brand/{icon,icon@2x,dark_icon,dark_icon@2x}.png`: real 256x256 and
  512x512 PNGs rendered from the existing `public/pwa-icon.svg` three.ws cube mark (the dark
  variant strips the background rect so it sits on an already-dark host UI). This satisfies
  HACS's own brands check and is the whole brand requirement, per Home Assistant 2026.3.0's local
  brand images feature.
- [`scripts/export-hacs-repo.mjs`](../../../scripts/export-hacs-repo.mjs): builds the exact
  standalone-repository tree under `dist/hacs-export` (`--out` to choose another directory):
  the integration (without Python bytecode), `README.md`, `info.md`, `LICENSE` (Apache-2.0),
  `hacs.json`, and `.github/workflows/{hassfest,hacs}.yml`. This monorepo runs no GitHub Actions
  of its own, so those two workflow files exist only in the exported tree and the standalone
  repository.
- [`scripts/hacs-default-submit.mjs`](../../../scripts/hacs-default-submit.mjs): reads the
  latest Hassfest and HACS runs on the standalone repository's `main`, names the blocker if
  either is not green, re-cuts the release so it follows the green runs (the template's last
  checkbox), and opens the `hacs/default` PR with the template filled in from the real links.
- Docs: [`docs/home-relay.md`](../../../docs/home-relay.md),
  [`home-assistant-integration/README.md`](../../../home-assistant-integration/README.md).

## Verification packet (real tools, no mocks)

- **HACS action against the live repository (2026-11-04)**: the real `ghcr.io/hacs/action:main`
  container (the image `hacs/action`'s `action.yml` runs), pointed at
  `nirholas/three-ws-home-assistant` with category `integration` and no ignores:
  `All (10) checks passed` (archived, integration_manifest, brands, description, information,
  license, issues, topics, integration_categories, hacsjson), no warnings, release `v1.0.2`
  detected.
- **Hassfest**, the real `ghcr.io/home-assistant/hassfest:latest` image, against the exported
  1.0.2 tree: `Integrations: 1, Invalid integrations: 0`.
- **A real install, end to end (2026-10-13)**: a real `ghcr.io/home-assistant/home-assistant:stable`
  container (HA 2026.9.4) with `custom_components/three_ws` mounted; onboarded for real via its own
  REST API; the real config flow driven through `POST /api/config/config_entries/flow` with a real
  pairing code, against a real `services/home-relay` server (`createRelay` from `src/server.js`)
  and a real install token minted with `mintInstallToken` (`src/token.js`); result:
  `{"type": "create_entry", "result": {"state": "loaded"}}`. The integration then dialled into the
  relay on its own (`agent.online`), opened a session, and answered a real `get_states` call with
  18 real Home Assistant entities. After the relay was restarted, the integration's own backoff
  reconnected it without any intervention, and `binary_sensor.evolve_test_home_three_ws_connection`
  read `state: "on"` with a real `relay_id` and no `last_error`. The integration code has not
  changed since; 1.0.2 only adds the manifest `categories` field.

## HACS default: `hacs/default`

### Step 1: the standalone repository (done 2026-11-04)

- Created public, personal `github.com/nirholas/three-ws-home-assistant` from the exported tree.
- Description "A Home Assistant integration for three.ws: put a 3D agent with a voice in front
  of this home.", homepage `https://three.ws/docs/home-relay`, Issues on, topics `hacs`,
  `hacs-integration`, `home-assistant`, `homeassistant`, `smart-home`, `three-ws`. GitHub detects
  the license as Apache-2.0.
- Releases `v1.0.1` and `v1.0.2` (latest, matching `manifest.json`).
- Its `hassfest.yml` and `hacs.yml` workflows are in place but every run so far was refused by
  the account billing lock, not by a check.

### Step 2: the pull request (branch ready, PR waits on green CI)

- Forked `hacs/default` to `nirholas/default`; branch `add-three-ws-home-assistant` (from
  `master`) adds `"nirholas/three-ws-home-assistant"` between `"NirBY/ha-mashov"` and
  `"Nischay-Pro/ha-zebra"`. One commit, one line, valid JSON, and the list still equals its
  case-insensitive sort, which the PR's `lint sorted` check enforces. If `master` moves before the
  PR opens, GitHub merges the one-line change cleanly; a conflict would only come from a
  neighbouring entry being edited, and then the fix is to re-insert the line on a fresh branch.
- Title `Add three.ws`, from the personal `nirholas` account so it stays editable. The body is the
  upstream template with every checkbox ticked and the three links filled in
  (`buildPrBody` in the submit script, which `tests/hacs-default-submit.test.js` covers).

## `home-assistant/brands`: no pull request needed (re-checked 2026-11-03)

No submission. The brands repository's README now labels `custom_integrations/` a legacy folder
("Since HA 2026.3.0, custom components can include their brand icons directly") and says custom
integrations "ship their images in a `brand` folder of their own nowadays, instead of adding them
to this repository". The HACS brands check found the local `custom_components/three_ws/brand/icon.png`
in the live repository and passed.

## Owner steps

1. Clear the GitHub Actions billing lock at https://github.com/settings/billing (the API returns
   403 on billing for a token, so this is a browser step).
2. `node scripts/hacs-default-submit.mjs --rerun`, wait a few minutes, then
   `node scripts/hacs-default-submit.mjs` until it prints `Ready.` with both runs green.
3. `node scripts/hacs-default-submit.mjs --open`: re-creates `v1.0.2` after the green runs and
   opens the `hacs/default` PR. Do not request reviews on it (the template says that gets the PR
   closed); HACS maintainers pick it up from the queue.
