# Home Assistant submissions: HACS default store

Target: [`hacs/default`](https://github.com/hacs/default) (the `integration` file). No
`home-assistant/brands` PR is needed; see that section below.

Ready for owner order 938. Built and validated end to end in work order 095; both submissions
need a repository the owner must create first (`nirholas/three-ws-home-assistant`, per HACS's own
"must be addable as a custom repository first" rule) and a pull request from a personal GitHub
account, so creating that repository and opening both PRs are owner actions (CLAUDE.md gate 2 and
the "Never blocked" rule for a step that needs a third-party account/repository).

## What ships

- [`home-assistant-integration/`](../../../home-assistant-integration): the integration itself,
  fixed this session. `manifest.json`'s `documentation` now points at the real, live
  [`/docs/home-relay`](https://three.ws/docs/home-relay) page (it previously 404'd), `version`
  bumped to `1.0.1`. `hacs.json`'s minimum Home Assistant version corrected from `2024.6.0` to
  `2024.12.0`: `relay_client.py` uses `aiohttp.ClientWSTimeout`, which does not exist before
  aiohttp 3.11, and HA 2024.12.0 is the first release that bundles it (confirmed against the real
  `homeassistant/package_constraints.txt` for 2024.6.0 through 2025.1.0).
- `custom_components/three_ws/brand/{icon,icon@2x,dark_icon,dark_icon@2x}.png`: real 256x256 and
  512x512 PNGs rendered from the existing `public/pwa-icon.svg` three.ws cube mark (the dark
  variant strips the background rect so it sits on an already-dark host UI). This satisfies
  HACS's own `brands.py` check locally and is the whole brand requirement, per Home Assistant
  2026.3.0's local brand images feature.
- [`scripts/export-hacs-repo.mjs`](../../../scripts/export-hacs-repo.mjs): builds the exact
  standalone-repository tree under `dist/hacs-export` (`--out` to choose another directory):
  the integration, `README.md`, `info.md`, `LICENSE` (Apache-2.0), `hacs.json`, and
  `.github/workflows/{hassfest,hacs}.yml`. This monorepo runs no GitHub Actions of its own, so
  those two workflow files exist only in the exported tree.
- Docs: [`docs/home-relay.md`](../../../docs/home-relay.md),
  [`home-assistant-integration/README.md`](../../../home-assistant-integration/README.md).
  Changelog and `npm run audit:docs` wired.

## Verification packet (this session, real tools, no mocks)

- **Hassfest**, the real `ghcr.io/home-assistant/hassfest` Docker image HACS's own CI runs,
  against the exported tree: `Integrations: 1, Invalid integrations: 0`.
- **HACS's local-file validators**, run with the real schema objects fetched from
  `hacs/integration`'s `custom_components/hacs/utils/validate.py` (`HACS_MANIFEST_JSON_SCHEMA`,
  `INTEGRATION_MANIFEST_JSON_SCHEMA`) against the exported tree's `hacs.json` and `manifest.json`:
  both pass. The local brand asset (`custom_components/three_ws/brand/icon.png`) and an
  information file (`README.md`) are both present at the paths `hacs/integration`'s own
  `brands.py`/`information.py` check. The remaining HACS checks (`description`, `topics`,
  `issues`, `archived`, `license`) read live GitHub repository settings via the GitHub API and are
  architecturally impossible to run against a repository that does not exist yet
  (`hacs.async_register_repository(repository_full_name=...)` in `hacs/action`'s `action.py` has
  no local-filesystem mode); they run for real inside `.github/workflows/hacs.yml` once the
  standalone repository exists.
- **A real install, end to end**: a real `ghcr.io/home-assistant/home-assistant:stable` container
  (HA 2026.9.4) with `custom_components/three_ws` mounted; onboarded for real via its own REST API;
  the real config flow driven through `POST /api/config/config_entries/flow` with a real pairing
  code, against a real `services/home-relay` server (`createRelay` from `src/server.js`) and a
  real install token minted with `mintInstallToken` (`src/token.js`); result:
  `{"type": "create_entry", "result": {"state": "loaded"}}`. The integration then dialled into the
  relay on its own (`agent.online`), opened a session, and answered a real `get_states` call with
  18 real Home Assistant entities. After the relay was restarted, the integration's own backoff
  reconnected it without any intervention, and `binary_sensor.evolve_test_home_three_ws_connection`
  read `state: "on"` with a real `relay_id` and no `last_error`.

## HACS default: `hacs/default`

### Step 1: create the standalone repository

1. Run `node scripts/export-hacs-repo.mjs` and push the resulting `dist/hacs-export/` tree to a
   new, public, personal (not organization) repository at `github.com/nirholas/three-ws-home-assistant`.
2. In that repository's Settings: add a description ("A Home Assistant integration for three.ws:
   put a 3D agent with a voice in front of this home."), enable Issues, and add topics
   (`home-assistant`, `hacs`, `hacs-integration`, `three-ws`, `smart-home`).
3. Confirm the two workflows in `.github/workflows/` (`hassfest.yml`, `hacs.yml`) both pass on
   `main`, then cut a GitHub release (tag `v1.0.1`, matching `manifest.json`'s `version`).
4. Add the repository to HACS as a custom repository in a real Home Assistant instance and confirm
   it installs (HACS's own first eligibility requirement, "must be addable as a custom repository
   first").

### Step 2: open the pull request

1. Fork `hacs/default`, branch from `master` (not `master` directly).
2. Add `"nirholas/three-ws-home-assistant"` to the `integration` file, between
   `"NirBY/ha-mashov"` and `"Nischay-Pro/ha-zebra"` (re-checked 2026-11-03 against the live file:
   4,563 entries, sorted case-insensitively, which the PR's `lint sorted` check enforces). The
   neighbours move as other repositories land, so re-derive the spot on the day: insert the entry
   and confirm the list still equals its case-insensitive sort.
3. Open the PR against `hacs/default` using its pull request template, from the personal
   `nirholas` account (not an organization) so it stays editable.

**PR title:** `Add three.ws`

**PR description:**

> Adds `nirholas/three-ws-home-assistant`, a Home Assistant custom integration that connects a
> LAN-only Home Assistant install to three.ws over one outbound WebSocket (no port forwarding, no
> inbound firewall rule, no Home Assistant credential ever leaves the house). Passes Hassfest and
> HACS validation in its own CI, ships local brand images, and has a tagged release.

## `home-assistant/brands`: no pull request needed (re-checked 2026-11-03)

No submission. The brands repository's README now labels `custom_integrations/` a legacy folder
("Since HA 2026.3.0, custom components can include their brand icons directly") and says custom
integrations "ship their images in a `brand` folder of their own nowadays, instead of adding them
to this repository". The `hacs/default` brands check looks for that local folder first, needs at
least `icon.png`, and only falls back to `home-assistant/brands` when the folder is missing. The
integration already ships all four images at
[`home-assistant-integration/custom_components/three_ws/brand/`](../../../home-assistant-integration/custom_components/three_ws/brand),
so the HACS PR stands on its own.

## Owner steps (not automatable here)

1. Create `github.com/nirholas/three-ws-home-assistant` from `dist/hacs-export/` (built by
   `node scripts/export-hacs-repo.mjs`), set its description/topics/issues, confirm its two
   workflows pass, and cut a `v1.0.1` release (HACS default, Step 1).
2. Fork and open the `hacs/default` PR with the title/description above (HACS default, Step 2).
